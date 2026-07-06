"""
routes/appointments.py — Appointment CRUD endpoints.
"""

from flask import Blueprint, request, jsonify, g
from datetime import datetime, date as Date, time as Time

from core.db import get_db
from models import Appointment, Patient
from services.auth_service import verify_jwt, require_role
from services.appointment_service import create_appointment, update_appointment, delete_appointment
from core.extensions import limiter
from validation import validation_error, get_json_body, require_fields, validate_string, validate_enum, validate_time_string

bp = Blueprint("appointments", __name__, url_prefix="/api/appointments")


@bp.route("", methods=["GET"])
@verify_jwt
@limiter.limit("120 per minute")
def get_appointments():
    from app import serialize
    db = get_db()
    try:
        today = datetime.utcnow().date()
        start_date = request.args.get("start_date")
        end_date = request.args.get("end_date")
        date_param = request.args.get("date")

        if date_param:
            start_date = end_date = date_param

        if not start_date:
            start_date = today.isoformat()
        if not end_date:
            end_date = (today + __import__("datetime").timedelta(days=30)).isoformat()

        appts = (
            db.query(Appointment)
            .filter(
                Appointment.clinic_id == g.clinic_id,
                Appointment.date.between(start_date, end_date),
            )
            .order_by(Appointment.date, Appointment.start_time)
            .all()
        )
        result = []
        for appt in appts:
            payload = serialize(appt)
            if appt.patient_id is not None:
                patient = db.query(Patient).filter(
                    Patient.id == appt.patient_id,
                    Patient.clinic_id == g.clinic_id,
                    Patient.deleted_at == None,
                ).first()
                if patient:
                    payload["patient"] = {"id": patient.id, "global_id": patient.global_id, "full_name": patient.full_name}
            result.append(payload)
        return jsonify({"appointments": result})
    finally:
        db.close()


@bp.route("/<int:appointment_id>", methods=["GET"])
@verify_jwt
@limiter.limit("120 per minute")
def get_appointment(appointment_id):
    from app import serialize
    db = get_db()
    try:
        appt = db.query(Appointment).filter_by(id=appointment_id, clinic_id=g.clinic_id).first()
        if not appt:
            return jsonify({"error": "Appointment not found", "code": "NOT_FOUND"}), 404
        payload = serialize(appt)
        if appt.patient_id is not None:
            patient = db.query(Patient).filter(
                Patient.id == appt.patient_id,
                Patient.clinic_id == g.clinic_id,
                Patient.deleted_at == None,
            ).first()
            if patient:
                payload["patient"] = {"id": patient.id, "global_id": patient.global_id, "full_name": patient.full_name}
        return jsonify({"appointment": payload})
    finally:
        db.close()


@bp.route("", methods=["POST"])
@verify_jwt
@limiter.limit("60 per minute")
def handle_create_appointment():
    return create_appointment()


@bp.route("/<int:appt_id>", methods=["PUT"])
@verify_jwt
def handle_update_appointment(appt_id):
    return update_appointment(appt_id)


@bp.route("/<int:appt_id>", methods=["DELETE"])
@verify_jwt
def handle_delete_appointment(appt_id):
    hard = request.args.get("hard") == "1"
    return delete_appointment(appt_id, hard=hard)
