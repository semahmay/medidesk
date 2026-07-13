"""
routes/clinic.py — Clinic management + analytics endpoints.
Performance optimized: module-level imports, pagination on analytics.
"""

from flask import Blueprint, request, jsonify, g
from datetime import datetime, timedelta
from sqlalchemy import func
from sqlalchemy.orm import joinedload

from core.db import get_db, session_scope
from core.serializer import serialize
from models import Clinic, User, Patient, Appointment, AuditLog
from services.auth_service import verify_jwt, require_role, _log
from services.audit_service import audit, Actions
from services.observability import get_sync_metrics, get_system_metrics
from core.extensions import limiter
from validation import validation_error, get_json_body, require_fields, validate_string
from utils import generate_clinic_id

bp = Blueprint("clinic", __name__, url_prefix="/api")


@bp.route("/clinic/create", methods=["POST"])
@verify_jwt
@require_role("doctor")
def create_clinic():
    data, err = get_json_body()
    if err:
        return err

    clinic_name = data.get("name", "").strip()
    if not clinic_name or not isinstance(clinic_name, str):
        return validation_error("name is required and must be a string")

    db = get_db()
    try:
        existing = db.query(Clinic).filter_by(doctor_user_id=g.user_id).first()
        if existing:
            user = db.query(User).filter_by(id=g.user_id).first()
            return jsonify({"success": True, "clinic_id": existing.id, "user": {"id": user.id, "role": user.role, "name": user.name}}), 200

        clinic_id = generate_clinic_id(db)
        clinic = Clinic(id=clinic_id, doctor_user_id=g.user_id, name=clinic_name)
        db.add(clinic)
        doctor = User(id=g.user_id, name=clinic_name, role="doctor", clinic_id=clinic_id)
        db.add(doctor)
        db.commit()
        return jsonify({"success": True, "clinic_id": clinic_id}), 201
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()


@bp.route("/clinic/join", methods=["POST"])
@verify_jwt
def join_clinic():
    return jsonify({"error": "Clinic joining is deprecated. Use OAuth login."}), 410


@bp.route("/clinic/by-doctor/<doctor_user_id>", methods=["GET"])
@verify_jwt
@require_role("doctor")
@limiter.limit("60 per minute")
def get_clinic_by_doctor(doctor_user_id):
    if g.user_id != doctor_user_id:
        return jsonify({"error": "Forbidden", "code": "FORBIDDEN"}), 403
    db = get_db()
    try:
        clinic = db.query(Clinic).filter_by(doctor_user_id=doctor_user_id).first()
        if not clinic:
            return jsonify({"clinic": None})
        return jsonify({"clinic": serialize(clinic)})
    finally:
        db.close()


@bp.route("/clinic/<clinic_id_param>", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def get_clinic(clinic_id_param):
    if g.clinic_id != clinic_id_param:
        return jsonify({"error": "Forbidden", "code": "FORBIDDEN"}), 403
    db = get_db()
    try:
        clinic = db.query(Clinic).filter_by(id=clinic_id_param).first()
        if not clinic:
            return jsonify({"error": "Clinic not found", "code": "NOT_FOUND"}), 404
        return jsonify({"clinic": serialize(clinic)})
    finally:
        db.close()


@bp.route("/clinic/secretaries/create", methods=["POST"])
@verify_jwt
@require_role("doctor")
def create_secretary():
    data, err = get_json_body()
    if err:
        return err

    name = data.get("name", "").strip().lower()
    email = data.get("email", "").strip() or None
    if not name or not isinstance(name, str):
        return validation_error("name is required and must be a string")

    db = get_db()
    try:
        existing = db.query(User).filter_by(clinic_id=g.clinic_id, name=name, role="secretary").first()
        if existing:
            return jsonify({"error": f"A secretary named '{name}' already exists in this clinic", "code": "CONFLICT"}), 409

        import uuid
        user = User(
            id=str(uuid.uuid4()),
            name=name,
            email=email,
            role="secretary",
            clinic_id=g.clinic_id,
            status="invited",
            invited_at=datetime.utcnow(),
        )
        db.add(user)
        db.commit()
        return jsonify({"success": True, "secretary": {"id": user.id, "name": user.name}}), 201
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()


@bp.route("/clinic/secretaries", methods=["GET"])
@verify_jwt
@require_role("doctor")
@limiter.limit("60 per minute")
def list_secretaries():
    """List secretaries in clinic. No pagination needed - typically < 10 secretaries."""
    db = get_db()
    try:
        users = db.query(User).filter_by(clinic_id=g.clinic_id, role="secretary").all()
        return jsonify({"secretaries": [serialize(u) for u in users]})
    finally:
        db.close()


@bp.route("/clinic/secretaries/<secretary_id>/reset-password", methods=["POST"])
@verify_jwt
@require_role("doctor")
def reset_secretary_password(secretary_id):
    db = get_db()
    try:
        user = db.query(User).filter_by(id=secretary_id, clinic_id=g.clinic_id, role="secretary").first()
        if not user:
            return jsonify({"error": "Secretary not found", "code": "NOT_FOUND"}), 404

        user.password_hash = None
        user.status = "invited"
        db.commit()
        return jsonify({"success": True, "message": "Password reset. Secretary must set a new password."})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()


@bp.route("/clinics/me", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def get_my_clinic():
    """Get current user's clinic with doctor info.
    Performance: Single query with joinedload instead of 2 separate queries."""
    db = get_db()
    try:
        clinic = (
            db.query(Clinic)
            .options(joinedload(Clinic.users))
            .filter_by(id=g.clinic_id)
            .first()
        )
        if not clinic:
            return jsonify({"error": "Clinic not found", "code": "NOT_FOUND"}), 404
        result = serialize(clinic)
        doctor = next((u for u in clinic.users if u.role == "doctor"), None)
        if doctor:
            result["doctor"] = {"id": doctor.id, "name": doctor.name, "email": doctor.email}
        return jsonify({"clinic": result})
    finally:
        db.close()


@bp.route("/clinics/me", methods=["PUT"])
@verify_jwt
@require_role("doctor")
@limiter.limit("20 per minute")
def update_my_clinic():
    data, err = get_json_body()
    if err:
        return err

    name = data.get("name", "").strip()
    if not name or not isinstance(name, str):
        return validation_error("name is required and must be a string")

    db = get_db()
    try:
        clinic = db.query(Clinic).filter_by(id=g.clinic_id).first()
        if not clinic:
            return jsonify({"error": "Clinic not found", "code": "NOT_FOUND"}), 404
        clinic.name = name
        db.commit()
        return jsonify({"success": True, "clinic_name": clinic.name})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()


@bp.route("/health", methods=["GET"])
def health_check():
    from core.config import REDIS_URL
    db = get_db()
    try:
        db.execute(func.now())
        db_status = "ok"
    except Exception:
        db_status = "error"

    redis_status = "not_configured"
    if REDIS_URL:
        try:
            import redis
            r = redis.from_url(REDIS_URL, socket_connect_timeout=2)
            r.ping()
            redis_status = "ok"
        except Exception:
            redis_status = "error"

    status_code = 503 if db_status != "ok" else 200
    return jsonify({
        "status": "healthy" if status_code == 200 else "degraded",
        "api": "ok",
        "database": db_status,
        "redis": redis_status,
    }), status_code


@bp.route("/metrics", methods=["GET"])
@verify_jwt
@require_role("doctor")
def metrics():
    return jsonify(get_sync_metrics(g.clinic_id))


@bp.route("/admin/metrics", methods=["GET"])
@verify_jwt
@require_role("doctor")
def admin_metrics():
    return jsonify(get_system_metrics())


# ── Analytics routes ──────────────────────────────────────────────────────────

@bp.route("/analytics/overview", methods=["GET"])
@verify_jwt
def analytics_overview():
    db = get_db()
    try:
        total_patients = db.query(Patient).filter(
            Patient.clinic_id == g.clinic_id, Patient.deleted_at == None
        ).count()
        total_appointments = db.query(Appointment).filter(
            Appointment.clinic_id == g.clinic_id
        ).count()
        today = datetime.utcnow().date().isoformat()
        today_appointments = db.query(Appointment).filter(
            Appointment.clinic_id == g.clinic_id,
            Appointment.date == today,
            Appointment.status != "cancelled",
        ).count()
        return jsonify({
            "total_patients": total_patients,
            "total_appointments": total_appointments,
            "today_appointments": today_appointments,
        })
    finally:
        db.close()


@bp.route("/analytics/patient-growth", methods=["GET"])
@verify_jwt
def analytics_patient_growth():
    db = get_db()
    try:
        from sqlalchemy import func as _f
        rows = (
            db.query(
                _f.date_trunc("month", Patient.created_at).label("month"),
                _f.count(Patient.id).label("count"),
            )
            .filter(Patient.clinic_id == g.clinic_id)
            .group_by(_f.date_trunc("month", Patient.created_at))
            .order_by("month")
            .all()
        )
        return jsonify({"growth": [{"month": str(r.month), "count": r.count} for r in rows]})
    finally:
        db.close()


@bp.route("/analytics/appointments-by-month", methods=["GET"])
@verify_jwt
def analytics_appointments_by_month():
    db = get_db()
    try:
        from sqlalchemy import func as _f
        rows = (
            db.query(
                _f.date_trunc("month", func.date(Appointment.date)).label("month"),
                _f.count(Appointment.id).label("count"),
            )
            .filter(Appointment.clinic_id == g.clinic_id)
            .group_by(_f.date_trunc("month", func.date(Appointment.date)))
            .order_by("month")
            .all()
        )
        return jsonify({"appointments": [{"month": str(r.month), "count": r.count} for r in rows]})
    finally:
        db.close()


@bp.route("/analytics/status-distribution", methods=["GET"])
@verify_jwt
def analytics_status_distribution():
    db = get_db()
    try:
        rows = (
            db.query(Patient.status, func.count(Patient.id))
            .filter(Patient.clinic_id == g.clinic_id)
            .group_by(Patient.status)
            .all()
        )
        return jsonify({"distribution": {r[0] or "unknown": r[1] for r in rows}})
    finally:
        db.close()


@bp.route("/analytics/appointment-status", methods=["GET"])
@verify_jwt
def analytics_appointment_status():
    db = get_db()
    try:
        rows = (
            db.query(Appointment.status, func.count(Appointment.id))
            .filter(Appointment.clinic_id == g.clinic_id)
            .group_by(Appointment.status)
            .all()
        )
        return jsonify({"statuses": {r[0] or "unknown": r[1] for r in rows}})
    finally:
        db.close()


@bp.route("/analytics/busiest-days", methods=["GET"])
@verify_jwt
def analytics_busiest_days():
    db = get_db()
    try:
        rows = (
            db.query(
                func.date_trunc("day", func.date(Appointment.date)).label("day"),
                func.count(Appointment.id).label("count"),
            )
            .filter(Appointment.clinic_id == g.clinic_id)
            .group_by(func.date_trunc("day", func.date(Appointment.date)))
            .order_by(func.count(Appointment.id).desc())
            .limit(30)
            .all()
        )
        return jsonify({"days": [{"date": str(r.day), "count": r.count} for r in rows]})
    finally:
        db.close()


@bp.route("/analytics/recent-activity", methods=["GET"])
@verify_jwt
def analytics_recent_activity():
    """Recent audit logs with pagination. Limited to 50 entries."""
    db = get_db()
    try:
        limit = min(int(request.args.get("limit", 50)), 100)
        logs = (
            db.query(AuditLog)
            .filter(AuditLog.clinic_id == g.clinic_id)
            .order_by(AuditLog.timestamp.desc())
            .limit(limit)
            .all()
        )
        return jsonify({"activity": [serialize(log) for log in logs]})
    finally:
        db.close()
