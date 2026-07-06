"""
routes/internal.py — Test/internal endpoints (only active in test env).
"""

from flask import Blueprint, request, jsonify, g
import os
import uuid

from core.db import get_db
from core.config import IS_TEST
from models import Clinic, User
from services.auth_service import verify_jwt, require_role
from utils import generate_clinic_id

bp = Blueprint("internal", __name__, url_prefix="/api/internal")


@bp.route("/seed-test-clinic", methods=["POST"])
def seed_test_clinic():
    if not IS_TEST:
        return jsonify({"error": "Not found", "code": "NOT_FOUND"}), 404

    data = request.get_json() or {}
    clinic_num = data.get("clinic_num", 1)

    db = get_db()
    try:
        clinic_id = f"MEDI-TEST{clinic_num}"
        existing = db.query(Clinic).filter_by(id=clinic_id).first()
        if existing:
            doctor = db.query(User).filter_by(clinic_id=clinic_id, role="doctor").first()
            return jsonify({
                "clinic_id": clinic_id,
                "doctor_user_id": doctor.id if doctor else None,
            })

        doctor_id = f"test_doctor_{clinic_num}"
        clinic = Clinic(id=clinic_id, doctor_user_id=doctor_id, name=f"Test Clinic {clinic_num}")
        db.add(clinic)
        doctor = User(id=doctor_id, name=f"Doctor {clinic_num}", role="doctor", clinic_id=clinic_id)
        db.add(doctor)
        db.commit()
        return jsonify({"clinic_id": clinic_id, "doctor_user_id": doctor_id})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@bp.route("/sentry-test", methods=["POST"])
@verify_jwt
@require_role("doctor")
def sentry_test():
    if not IS_TEST:
        return jsonify({"error": "Not found", "code": "NOT_FOUND"}), 404
    raise RuntimeError("Sentry test exception — intentionally raised to verify error tracking")
