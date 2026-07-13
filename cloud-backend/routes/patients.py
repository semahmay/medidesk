"""
routes/patients.py — Patient CRUD endpoints.
Performance optimized: pagination enforced, module-level imports.
"""

from flask import Blueprint, request, jsonify, g
from sqlalchemy import or_, case
from datetime import datetime

from core.db import get_db
from core.serializer import serialize
from models import Clinic, Patient, Appointment
from services.auth_service import verify_jwt, require_role
from services.patient_service import (
    create_patient, update_patient, delete_patient,
    restore_patient, get_patient, get_patients,
)
from services.realtime_service import emit_to_clinic
from core.extensions import limiter
from validation import validation_error, get_json_body, require_fields, validate_string, validate_custom_fields, validate_version

bp = Blueprint("patients", __name__, url_prefix="/api/patients")


@bp.route("/duplicates", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def check_patient_duplicates():
    """Check for duplicate patients by name or phone. Limited to 10 results."""
    name = request.args.get("name", "").strip()
    phone = request.args.get("phone", "").strip()
    if not name and not phone:
        return jsonify({"duplicates": []})

    db = get_db()
    try:
        filters = [Patient.clinic_id == g.clinic_id, Patient.deleted_at == None]
        if name:
            filters.append(Patient.full_name.ilike(f"%{name}%"))
        if phone:
            filters.append(Patient.phone == phone)
        patients = db.query(Patient).filter(*filters).limit(10).all()
        return jsonify({"duplicates": [serialize(p) for p in patients]})
    except Exception as e:
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()


@bp.route("", methods=["GET"])
@verify_jwt
@limiter.limit("120 per minute")
def list_patients():
    """
    List patients with pagination and search.
    Performance: Hard limit of 500 items, offset-based pagination.
    """
    limit = min(int(request.args.get("limit", 100)), 500)
    offset = 0
    page = request.args.get("page", "1")
    try:
        page = max(int(page), 1)
        offset = (page - 1) * limit
    except (ValueError, TypeError):
        page = 1
        offset = 0

    db = get_db()
    try:
        query = db.query(Patient).filter(
            Patient.clinic_id == g.clinic_id,
            Patient.deleted_at == None,
        )
        search = request.args.get("search", "").strip()
        if search:
            search_term = f"%{search}%"
            query = query.filter(or_(
                Patient.full_name.ilike(search_term),
                Patient.phone.ilike(search_term),
                Patient.email.ilike(search_term),
                Patient.notes.ilike(search_term),
            ))
        total = query.count()
        patients = query.order_by(Patient.updated_at.desc()).offset(offset).limit(limit).all()
        return jsonify({
            "patients": [serialize(p) for p in patients],
            "total": total,
            "page": page,
            "limit": limit,
        })
    finally:
        db.close()


@bp.route("/search", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def search_patients():
    """
    Search patients with ranked results.
    Performance: Hard limit of 500 items, exact prefix matches ranked higher.
    Count query combined via query.count() before pagination.
    """
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"error": "q is required", "code": "VALIDATION_ERROR"}), 400

    limit = min(int(request.args.get("limit", 50)), 500)
    page = max(int(request.args.get("page", "1")), 1)
    offset = (page - 1) * limit

    db = get_db()
    try:
        term = f"%{q}%"
        base_filters = [
            Patient.clinic_id == g.clinic_id,
            Patient.deleted_at == None,
            or_(
                Patient.full_name.ilike(term),
                Patient.phone.ilike(term),
                Patient.email.ilike(term),
                Patient.notes.ilike(term),
            ),
        ]
        total = db.query(Patient).filter(*base_filters).count()
        patients = (
            db.query(Patient)
            .filter(*base_filters)
            .order_by(
                case(
                    (Patient.full_name.ilike(f"{q}%"), 0),
                    else_=1
                ),
                Patient.full_name
            )
            .limit(limit)
            .offset(offset)
            .all()
        )
        return jsonify({"patients": [serialize(p) for p in patients], "total": total, "limit": limit, "offset": offset})
    finally:
        db.close()


@bp.route("", methods=["POST"])
@verify_jwt
@limiter.limit("90 per minute")
def handle_create_patient():
    return create_patient()


@bp.route("/<int:patient_id>", methods=["GET"])
@verify_jwt
@limiter.limit("120 per minute")
def get_patient_by_id(patient_id):
    """Get patient by numeric ID."""
    db = get_db()
    try:
        patient = db.query(Patient).filter(
            Patient.id == patient_id,
            Patient.clinic_id == g.clinic_id,
        ).first()
        if not patient:
            return jsonify({"error": "Patient not found", "code": "NOT_FOUND"}), 404
        return jsonify({"patient": serialize(patient)})
    finally:
        db.close()


@bp.route("/by-global/<global_id_param>", methods=["GET"])
@verify_jwt
@limiter.limit("120 per minute")
def get_patient_by_global_id(global_id_param):
    """Get patient by global UUID."""
    db = get_db()
    try:
        patient = db.query(Patient).filter(
            Patient.global_id == global_id_param,
            Patient.clinic_id == g.clinic_id,
        ).first()
        if not patient:
            return jsonify({"error": "Patient not found", "code": "NOT_FOUND"}), 404
        return jsonify({"patient": serialize(patient)})
    finally:
        db.close()


@bp.route("/<int:patient_id>", methods=["PUT"])
@verify_jwt
@limiter.limit("60 per minute")
def handle_update_patient(patient_id):
    return update_patient(patient_id)


@bp.route("/by-global/<global_id_param>", methods=["PUT"])
@verify_jwt
def handle_update_patient_by_global(global_id_param):
    return update_patient(global_id_param, by_global=True)


@bp.route("/<int:patient_id>", methods=["DELETE"])
@verify_jwt
@require_role("doctor")
def handle_delete_patient(patient_id):
    return delete_patient(patient_id)


@bp.route("/by-global/<global_id_param>", methods=["DELETE"])
@verify_jwt
def handle_delete_patient_by_global(global_id_param):
    return delete_patient(global_id_param, by_global=True)


@bp.route("/<int:patient_id>/restore", methods=["POST"])
@verify_jwt
@require_role("doctor")
def handle_restore_patient(patient_id):
    return restore_patient(patient_id)
