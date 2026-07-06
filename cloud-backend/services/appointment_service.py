"""
services/appointment_service.py — Appointment business logic.
"""

from datetime import datetime, date as Date, time as Time
from flask import jsonify, g

from core.db import get_db
from models import Appointment
from services.audit_service import audit, Actions
from services.notification_service import notify
from services.realtime_service import emit_to_clinic
from validation import validation_error, get_json_body, require_fields, validate_string, validate_enum, validate_time_string
from core.serializer import serialize


def _check_conflict(db, clinic_id, date, start_time, end_time, exclude_id=None):
    query = (
        db.query(Appointment)
        .filter(
            Appointment.clinic_id == clinic_id,
            Appointment.date == date,
            Appointment.status != "cancelled",
            Appointment.start_time < end_time,
            Appointment.end_time > start_time,
        )
        .with_for_update()
    )
    if exclude_id is not None:
        query = query.filter(Appointment.id != exclude_id)
    return query.first()


def create_appointment():
    data, err = get_json_body()
    if err:
        return err

    missing = require_fields(data, "patient_name", "date", "start_time", "end_time")
    if missing:
        return validation_error(f"{missing} is required")

    patient_name = data.get("patient_name", "").strip()
    date_str = data.get("date") or data.get("appointment_date", "")
    start_str = data.get("start_time", "").strip()
    end_str = data.get("end_time", "").strip()

    err = validate_string(patient_name, "patient_name", max_length=255)
    if err:
        return validation_error(err)
    err = validate_string(date_str, "date", max_length=20)
    if err:
        return validation_error(err)
    err = validate_time_string(start_str, "start_time")
    if err:
        return validation_error(err)
    err = validate_time_string(end_str, "end_time")
    if err:
        return validation_error(err)
    if "status" in data:
        err = validate_enum(data["status"], "status", ("scheduled", "completed", "cancelled", "no_show"))
        if err:
            return validation_error(err)

    try:
        parsed_date = Date.fromisoformat(date_str)
        parsed_start = Time.fromisoformat(start_str)
        parsed_end = Time.fromisoformat(end_str)
    except (ValueError, TypeError) as e:
        return validation_error(f"Invalid date/time format: {str(e)}")

    if parsed_start >= parsed_end:
        return validation_error("start_time must be before end_time")

    db = get_db()
    try:
        with db.begin():
            conflict = _check_conflict(db, g.clinic_id, parsed_date, parsed_start, parsed_end)
            if conflict:
                return jsonify({
                    "error": "conflict",
                    "message": f"Time slot already booked: {conflict.patient_name} {conflict.start_time.isoformat()}–{conflict.end_time.isoformat()}",
                    "conflict": serialize(conflict),
                }), 409

            appt = Appointment(
                clinic_id=g.clinic_id,
                patient_id=data.get("patient_id"),
                patient_name=patient_name,
                date=parsed_date,
                start_time=parsed_start,
                end_time=parsed_end,
                status=data.get("status", "scheduled"),
                notes=data.get("notes"),
                created_by=g.role,
            )
            db.add(appt)
            db.flush()

            audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
                  action_type=Actions.CREATE_APPOINTMENT, entity_type="appointment",
                  entity_id=appt.global_id,
                  metadata={"patient_name": patient_name, "date": date_str,
                            "start_time": start_str, "end_time": end_str})

            target = "secretary" if g.role == "doctor" else "doctor"
            by = "Doctor" if g.role == "doctor" else "Secretary"
            notif = notify(db, clinic_id=g.clinic_id, type="appointment", target_role=target,
                           title="New appointment",
                           message=f"{patient_name} — {parsed_date.isoformat()} {parsed_start.strftime('%H:%M')}–{parsed_end.strftime('%H:%M')} (by {by})",
                           actor_role=g.role, actor_name=by)
            notif_id = notif.id if notif else None
            emit_to_clinic(g.clinic_id, "notification_new", {
                "id": notif_id, "type": "appointment",
                "title": "New appointment",
                "message": f"{patient_name} — {parsed_date.isoformat()} {parsed_start.strftime('%H:%M')}–{parsed_end.strftime('%H:%M')} (by {by})",
                "actor_role": g.role, "actor_name": by,
                "created_at": datetime.utcnow().isoformat(),
            })

        db.refresh(appt)
        return jsonify({"success": True, "appointment": serialize(appt)}), 201

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()


def update_appointment(appt_id):
    data, err = get_json_body()
    if err:
        return err

    if "status" in data:
        err = validate_enum(data["status"], "status", ("scheduled", "completed", "cancelled", "no_show"))
        if err:
            return validation_error(err)
    if "patient_name" in data:
        err = validate_string(data["patient_name"], "patient_name", max_length=255)
        if err:
            return validation_error(err)

    db = get_db()
    try:
        appt = db.query(Appointment).filter_by(id=appt_id, clinic_id=g.clinic_id).first()
        if not appt:
            return jsonify({"error": "Appointment not found", "code": "NOT_FOUND"}), 404

        raw_date = data.get("date") or data.get("appointment_date")
        raw_start = data.get("start_time")
        raw_end = data.get("end_time")

        try:
            new_date = Date.fromisoformat(raw_date) if raw_date else appt.date
            new_start = Time.fromisoformat(raw_start) if raw_start else appt.start_time
            new_end = Time.fromisoformat(raw_end) if raw_end else appt.end_time
        except (ValueError, TypeError) as e:
            return validation_error(f"Invalid date/time format: {str(e)}")

        if new_start >= new_end:
            return validation_error("start_time must be before end_time")

        time_changed = (new_date != appt.date or new_start != appt.start_time or new_end != appt.end_time)
        if time_changed:
            conflict = _check_conflict(db, g.clinic_id, new_date, new_start, new_end, exclude_id=appt_id)
            if conflict:
                return jsonify({
                    "error": "conflict",
                    "message": f"Time slot already booked: {conflict.patient_name} {conflict.start_time.isoformat()}–{conflict.end_time.isoformat()}",
                    "conflict": serialize(conflict),
                }), 409

        appt.date = new_date
        appt.start_time = new_start
        appt.end_time = new_end
        if "patient_name" in data and data["patient_name"] is not None: appt.patient_name = data["patient_name"]
        if "patient_id" in data and data["patient_id"] is not None: appt.patient_id = data["patient_id"]
        if "status" in data and data["status"] is not None: appt.status = data["status"]
        if "notes" in data and data["notes"] is not None: appt.notes = data["notes"]
        appt.updated_at = datetime.utcnow()

        audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
              action_type=Actions.UPDATE_APPOINTMENT, entity_type="appointment",
              entity_id=appt.global_id or str(appt.id),
              metadata={"patient_name": appt.patient_name, "status": appt.status})

        target = "secretary" if g.role == "doctor" else "doctor"
        by = "Doctor" if g.role == "doctor" else "Secretary"
        notif = notify(db, clinic_id=g.clinic_id, type="appointment", target_role=target,
                       title="Appointment updated",
                       message=f"{appt.patient_name} — {appt.date.isoformat()} {appt.start_time.strftime('%H:%M')}–{appt.end_time.strftime('%H:%M')} → {appt.status} (by {by})",
                       actor_role=g.role, actor_name=by)
        notif_id = notif.id if notif else None
        emit_to_clinic(g.clinic_id, "notification_new", {
            "id": notif_id, "type": "appointment",
            "title": "Appointment updated",
            "message": f"{appt.patient_name} — {appt.date.isoformat()} {appt.start_time.strftime('%H:%M')}–{appt.end_time.strftime('%H:%M')} → {appt.status} (by {by})",
            "actor_role": g.role, "actor_name": by,
            "created_at": datetime.utcnow().isoformat(),
        })

        db.commit()
        db.refresh(appt)
        return jsonify({"success": True, "appointment": serialize(appt)})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()


def delete_appointment(appt_id, hard=False):
    db = get_db()
    try:
        appt = db.query(Appointment).filter_by(id=appt_id, clinic_id=g.clinic_id).first()
        if not appt:
            return jsonify({"error": "Appointment not found", "code": "NOT_FOUND"}), 404
        if hard and g.role == "doctor":
            audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
                  action_type=Actions.DELETE_APPOINTMENT, entity_type="appointment",
                  entity_id=appt.global_id or str(appt.id),
                  metadata={"patient_name": appt.patient_name})
            db.delete(appt)
        else:
            old_status = appt.status
            appt.status = "cancelled"

            audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
                  action_type=Actions.CANCEL_APPOINTMENT, entity_type="appointment",
                  entity_id=appt.global_id or str(appt.id),
                  metadata={"patient_name": appt.patient_name, "previous_status": old_status})

            target = "secretary" if g.role == "doctor" else "doctor"
            by = "Doctor" if g.role == "doctor" else "Secretary"
            notif = notify(db, clinic_id=g.clinic_id, type="appointment", target_role=target,
                           title="Appointment cancelled",
                           message=f"{appt.patient_name} — {appt.date.isoformat()} {appt.start_time.strftime('%H:%M')}–{appt.end_time.strftime('%H:%M')} (by {by})",
                           actor_role=g.role, actor_name=by)
            notif_id = notif.id if notif else None
            emit_to_clinic(g.clinic_id, "notification_new", {
                "id": notif_id, "type": "appointment",
                "title": "Appointment cancelled",
                "message": f"{appt.patient_name} — {appt.date.isoformat()} {appt.start_time.strftime('%H:%M')}–{appt.end_time.strftime('%H:%M')} (by {by})",
                "actor_role": g.role, "actor_name": by,
                "created_at": datetime.utcnow().isoformat(),
            })

        db.commit()
        return jsonify({"success": True})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()
