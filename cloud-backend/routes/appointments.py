"""
routes/appointments.py — Appointment CRUD endpoints.
Performance optimized: joinedload for N+1 prevention, pagination enforced.
"""

from flask import Blueprint, request, jsonify, g
from datetime import datetime, date as Date, time as Time, timedelta
from sqlalchemy.orm import joinedload

from core.db import get_db
from models import Appointment, Patient
from services.auth_service import verify_jwt, require_role
from services.appointment_service import create_appointment, update_appointment, delete_appointment
from core.extensions import limiter
from core.serializer import serialize
from validation import validation_error, get_json_body, require_fields, validate_string, validate_enum, validate_time_string

bp = Blueprint("appointments", __name__, url_prefix="/api/appointments")


@bp.route("", methods=["GET"])
@verify_jwt
@limiter.limit("120 per minute")
def get_appointments():
    """
    List appointments with pagination.
    Performance: Uses joinedload to prevent N+1 queries when fetching patient data.
    """
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
            end_date = (today + timedelta(days=30)).isoformat()

        # Pagination parameters with hard limits
        limit = min(int(request.args.get("limit", 100)), 500)
        offset = max(int(request.args.get("offset", 0)), 0)

        # OPTIMIZED: Use joinedload to fetch patient data in a single query
        # Previously: N+1 queries (1 for appointments + N for patients)
        # Now: 1 query total
        appts = (
            db.query(Appointment)
            .options(joinedload(Appointment.patient))
            .filter(
                Appointment.clinic_id == g.clinic_id,
                Appointment.date.between(start_date, end_date),
            )
            .order_by(Appointment.date, Appointment.start_time)
            .offset(offset)
            .limit(limit)
            .all()
        )

        # Get total count for pagination metadata
        total = (
            db.query(Appointment)
            .filter(
                Appointment.clinic_id == g.clinic_id,
                Appointment.date.between(start_date, end_date),
            )
            .count()
        )

        result = []
        for appt in appts:
            payload = serialize(appt)
            # Patient data already loaded via joinedload - no additional query
            if appt.patient and appt.patient.deleted_at is None:
                payload["patient"] = {
                    "id": appt.patient.id,
                    "global_id": appt.patient.global_id,
                    "full_name": appt.patient.full_name
                }
            result.append(payload)
        return jsonify({"appointments": result, "total": total, "limit": limit, "offset": offset})
    finally:
        db.close()


@bp.route("/<int:appointment_id>", methods=["GET"])
@verify_jwt
@limiter.limit("120 per minute")
def get_appointment(appointment_id):
    """
    Get single appointment by ID.
    Performance: Uses joinedload to fetch patient in same query.
    """
    db = get_db()
    try:
        # OPTIMIZED: Use joinedload to fetch patient data in a single query
        appt = (
            db.query(Appointment)
            .options(joinedload(Appointment.patient))
            .filter_by(id=appointment_id, clinic_id=g.clinic_id)
            .first()
        )
        if not appt:
            return jsonify({"error": "Appointment not found", "code": "NOT_FOUND"}), 404
        payload = serialize(appt)
        # Patient data already loaded via joinedload - no additional query
        if appt.patient and appt.patient.deleted_at is None:
            payload["patient"] = {
                "id": appt.patient.id,
                "global_id": appt.patient.global_id,
                "full_name": appt.patient.full_name
            }
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
