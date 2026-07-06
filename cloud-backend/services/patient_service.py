"""
services/patient_service.py — Patient business logic.
"""

import uuid
import json
from datetime import datetime
from flask import jsonify, g
from sqlalchemy.orm import joinedload

from core.db import get_db
from models import Clinic, Patient
from services.auth_service import _log, verify_jwt, require_role
from services.audit_service import audit, Actions
from services.notification_service import notify
from services.realtime_service import emit_to_clinic
from validation import validation_error, get_json_body, require_fields, validate_string, validate_custom_fields, validate_version
from core.serializer import serialize


def create_patient():
    data, err = get_json_body()
    if err:
        return err

    missing = require_fields(data, "full_name")
    if missing:
        return validation_error(f"{missing} is required")

    full_name = data.get("full_name", "").strip()
    err = validate_string(full_name, "full_name", max_length=255)
    if err:
        return validation_error(err)

    if "custom_fields" in data:
        err = validate_custom_fields(data["custom_fields"])
        if err:
            return validation_error(err)

    db = get_db()
    try:
        clinic = db.query(Clinic).filter_by(id=g.clinic_id).first()
        if not clinic:
            return jsonify({"error": "Clinic not found", "code": "NOT_FOUND"}), 404

        global_id = data.get("global_id") or str(uuid.uuid4())

        existing = db.query(Patient).filter(
            Patient.global_id == global_id,
            Patient.clinic_id == g.clinic_id,
            Patient.deleted_at == None,
        ).first()
        if existing:
            return jsonify({"success": True, "patient": serialize(existing), "created": False}), 200

        patient = Patient(
            global_id=global_id,
            clinic_id=g.clinic_id,
            full_name=full_name,
            phone=data.get("phone"),
            email=data.get("email"),
            notes=data.get("notes"),
            appointment=data.get("appointment"),
            status=data.get("status", "Active"),
            updated_by=g.role,
        )
        if "custom_fields" in data:
            patient.custom_fields = data["custom_fields"]
        db.add(patient)

        audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
              action_type=Actions.CREATE_PATIENT, entity_type="patient", entity_id=global_id,
              metadata={"full_name": full_name})

        target = "secretary" if g.role == "doctor" else "doctor"
        by = "Doctor" if g.role == "doctor" else "Secretary"
        notif = notify(db, clinic_id=g.clinic_id, type="patient", target_role=target,
                       title="New patient added",
                       message=f"{by} added patient: {full_name}",
                       actor_role=g.role, actor_name=by)
        notif_id = notif.id if notif else None
        emit_to_clinic(g.clinic_id, "notification_new", {
            "id": notif_id, "type": "patient", "title": "New patient added",
            "message": f"{by} added patient: {full_name}",
            "actor_role": g.role, "actor_name": by,
            "created_at": datetime.utcnow().isoformat(),
        })

        db.commit()
        db.refresh(patient)
        emit_to_clinic(g.clinic_id, "patient_created", {
            "global_id": patient.global_id, "clinic_id": g.clinic_id,
            "full_name": patient.full_name, "created_by": g.role,
        })
        return jsonify({"success": True, "patient": serialize(patient), "created": True}), 201

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()


def update_patient(identifier, by_global=False):
    data, err = get_json_body()
    if err:
        return err

    client_version = data.get("version")
    err = validate_version(client_version)
    if err:
        return validation_error(err)

    if "custom_fields" in data:
        err = validate_custom_fields(data["custom_fields"])
        if err:
            return validation_error(err)

    db = get_db()
    try:
        filters = [Patient.clinic_id == g.clinic_id, Patient.deleted_at == None]
        if by_global:
            filters.append(Patient.global_id == identifier)
        else:
            filters.append(Patient.id == identifier)

        patient = db.query(Patient).filter(*filters).with_for_update().first()
        if not patient:
            return jsonify({"error": "Patient not found", "code": "NOT_FOUND"}), 404

        if client_version is not None and int(client_version) != patient.version:
            if not data.get("force"):
                emit_to_clinic(g.clinic_id, "sync_failed", {
                    "global_id": patient.global_id, "clinic_id": g.clinic_id,
                    "reason": "version_conflict", "server_version": patient.version,
                    "client_version": client_version,
                })
                return jsonify({
                    "error": "conflict",
                    "message": "Record was modified by another user. Please reload and try again.",
                    "server_version": patient.version,
                    "client_version": client_version,
                    "server_updated_at": patient.updated_at.isoformat() if patient.updated_at else None,
                    "server_patient": serialize(patient),
                }), 409
        elif client_version is None and not data.get("force"):
            return validation_error("version is required for updates. Client must send the version it last saw.")

        for field in ("full_name", "phone", "email", "notes", "appointment", "status"):
            if field in data and data[field] is not None:
                setattr(patient, field, data[field])
        if "custom_fields" in data:
            existing_cf = dict(patient.custom_fields or {})
            existing_cf.update(data["custom_fields"])
            patient.custom_fields = existing_cf

        patient.updated_by = g.role
        patient.updated_at = datetime.utcnow()
        patient.version = (patient.version or 0) + 1

        audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
              action_type=Actions.UPDATE_PATIENT, entity_type="patient",
              entity_id=patient.global_id,
              metadata={"full_name": patient.full_name, "version": patient.version})

        db.commit()
        db.refresh(patient)
        emit_to_clinic(g.clinic_id, "patient_updated", {
            "global_id": patient.global_id, "clinic_id": g.clinic_id,
            "updated_by": g.role, "updated_at": patient.updated_at.isoformat(),
            "version": patient.version,
        })
        return jsonify({"success": True, "patient": serialize(patient)})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()


def delete_patient(identifier, by_global=False):
    db = get_db()
    try:
        filters = [Patient.clinic_id == g.clinic_id, Patient.deleted_at == None]
        if by_global:
            filters.append(Patient.global_id == identifier)
        else:
            filters.append(Patient.id == identifier)

        patient = db.query(Patient).filter(*filters).with_for_update().first()
        if not patient:
            return jsonify({"error": "Patient not found", "code": "NOT_FOUND"}), 404

        audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
              action_type=Actions.DELETE_PATIENT, entity_type="patient",
              entity_id=patient.global_id or str(patient.id),
              metadata={"full_name": patient.full_name})

        patient.deleted_at = datetime.utcnow()
        patient.status = "Deleted"
        patient.version = (patient.version or 0) + 1
        db.commit()
        return jsonify({"success": True})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()


def restore_patient(patient_id):
    db = get_db()
    try:
        patient = db.query(Patient).filter(
            Patient.id == patient_id,
            Patient.clinic_id == g.clinic_id,
            Patient.deleted_at != None,
        ).with_for_update().first()
        if not patient:
            return jsonify({"error": "Patient not found or not deleted", "code": "NOT_FOUND"}), 404

        patient.deleted_at = None
        patient.status = "Active"
        patient.version = (patient.version or 0) + 1

        audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
              action_type=Actions.UPDATE_PATIENT, entity_type="patient",
              entity_id=patient.global_id or str(patient.id),
              metadata={"full_name": patient.full_name, "action": "restore"})

        db.commit()
        return jsonify({"success": True, "patient": serialize(patient)})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()
