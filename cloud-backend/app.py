# ── eventlet monkey-patch — MUST be first, before any other import ────────────
# Required for Gunicorn --worker-class eventlet to work correctly with
# Flask-SocketIO, SQLAlchemy, and Redis. Without this, concurrent WebSocket
# connections deadlock under load.
import eventlet
eventlet.monkey_patch()
# ─────────────────────────────────────────────────────────────────────────────

# ── load_dotenv MUST run before any module that reads os.getenv at import time ─
# database.py reads DATABASE_URL at import time to build the engine.
# If load_dotenv() runs after the import, DATABASE_URL is not set yet and
# the DATABASE_URL is not set yet and defaults incorrectly.
from dotenv import load_dotenv
load_dotenv()
# ─────────────────────────────────────────────────────────────────────────────

from flask import Flask, request, jsonify, g, send_file
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import or_, case
from database import init_db, SessionLocal
from models import Clinic, User, Patient, Message, Appointment, AuditLog, Notification
from utils import generate_clinic_id
from auth_service import (
    generate_access_token, generate_refresh_token,
    refresh_access_token, verify_jwt, require_role,
    hash_password, check_password, verify_token, _log,
    REFRESH_TOKEN_EXPIRE_DAYS,
)
from audit_service import audit, Actions
from notification_service import notify
from realtime_service import socketio, emit_to_clinic
from storage_service import storage, MAX_FILE_SIZE
from observability import setup_observability, get_sync_metrics, get_system_metrics
from datetime import datetime, timedelta
from werkzeug.utils import secure_filename
import uuid
import os
import io
import requests as http_requests

app = Flask(__name__)

# ── CORS — strictly ENV-based, no wildcard default ───────────────────────────
# ALLOWED_ORIGINS must be set explicitly in .env.
# If missing, defaults to localhost only — never "*" in production.
#
# Electron desktop (file://), production domain, dev servers.
# Example: ALLOWED_ORIGINS=file://,http://localhost:3000,https://medidesk.app
_raw_origins = os.getenv("ALLOWED_ORIGINS", "").strip()

if not _raw_origins:
    _allowed_origins = ["file://", "http://localhost", "http://localhost:3000", "http://127.0.0.1"]
    import logging as _logging
    _logging.getLogger("cors").warning(
        "[CORS] ALLOWED_ORIGINS not set — defaulting to localhost + file://. "
        "Set ALLOWED_ORIGINS in .env for production."
    )
elif _raw_origins == "*":
    _allowed_origins = "*"
else:
    _allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

CORS(app, resources={
    r"/api/*": {"origins": _allowed_origins},
    r"/ws/*":  {"origins": _allowed_origins},
})

# ── SocketIO ──────────────────────────────────────────────────────────────────
REDIS_URL = os.getenv("REDIS_URL")
socketio.init_app(
    app,
    cors_allowed_origins=_allowed_origins,  # same origins as Flask-CORS — never hardcoded
    message_queue=REDIS_URL,
    async_mode="eventlet",
)

# ── Observability ─────────────────────────────────────────────────────────────
setup_observability(app)

# ── Database initialization — runs at import time (Gunicorn + dev) ────────────
# Must be called at module level, NOT inside __main__, because Gunicorn imports
# the app object directly and never executes __main__.
init_db()

# ── Rate limiting ─────────────────────────────────────────────────────────────
# Uses Redis when available (SaaS), falls back to in-memory (Electron/dev).
# Key function: use JWT user_id for authenticated requests (so each user gets
# their own bucket regardless of IP — critical for multi-tenant SaaS where
# multiple users share the same NAT/proxy IP).
# Falls back to remote IP for unauthenticated routes (auth endpoints).
_limiter_storage = REDIS_URL if REDIS_URL else "memory://"


def _rate_limit_key():
    """
    Per-user rate limiting for authenticated requests.
    Falls back to IP for unauthenticated requests.
    This ensures each clinic user has their own rate limit bucket,
    not shared with other users behind the same IP/proxy.
    """
    # g.user_id is set by @verify_jwt before the route handler runs.
    # For unauthenticated routes (auth endpoints), g.user_id is not set.
    user_id = getattr(g, "user_id", None)
    if user_id:
        return f"user:{user_id}"
    return get_remote_address()


limiter = Limiter(
    key_func=_rate_limit_key,
    app=app,
    default_limits=[],
    storage_uri=_limiter_storage,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_db():
    """
    Returns a SQLAlchemy session. Caller MUST call db.close() in a finally block.
    All route handlers already do this — this pattern is safe for Flask (non-DI).
    """
    return SessionLocal()


# Fields that must never appear in any API response regardless of model
_SENSITIVE_FIELDS = frozenset({"password_hash"})


def serialize(obj):
    result = {}
    for col in obj.__table__.columns:
        if col.name in _SENSITIVE_FIELDS:
            continue
        val = getattr(obj, col.name)
        result[col.name] = val.isoformat() if isinstance(val, datetime) else val
    return result


# ── Auth Routes (public — no JWT required) ────────────────────────────────────

@app.route("/api/auth/google", methods=["POST"])
@limiter.limit("20 per minute")
def auth_google():
    """
    POST /api/auth/google
    Body: { "google_token": "<google_access_token>" }
    Verifies with Google, finds/creates user+clinic, returns JWT pair.
    """
    data = request.get_json() or {}
    google_token = data.get("google_token")

    if not google_token:
        return jsonify({"error": "google_token is required"}), 400

    try:
        resp = http_requests.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {google_token}"},
            timeout=10,
        )
        if resp.status_code != 200:
            return jsonify({"error": "Invalid Google token"}), 401
        google_user = resp.json()
    except Exception as e:
        return jsonify({"error": f"Google verification failed: {str(e)}"}), 500

    google_id = google_user.get("id")
    email     = google_user.get("email")
    name      = google_user.get("name", email)

    if not google_id:
        return jsonify({"error": "Could not retrieve Google user ID"}), 400

    db = get_db()
    try:
        user = db.query(User).filter_by(google_id=google_id).first()

        if not user:
            # Migrate legacy user created before JWT
            clinic = db.query(Clinic).filter_by(doctor_user_id=google_id).first()
            if clinic:
                user = db.query(User).filter_by(id=google_id, clinic_id=clinic.id).first()
                if user:
                    user.google_id = google_id
                    user.email = email
                    db.commit()

        if not user:
            # Brand new doctor
            clinic_id = generate_clinic_id(db)
            clinic = Clinic(id=clinic_id, doctor_user_id=google_id, name=f"{name}'s Clinic")
            db.add(clinic)
            user = User(
                id=google_id,
                name=name,
                role="doctor",
                clinic_id=clinic_id,
                google_id=google_id,
                email=email,
            )
            db.add(user)
            db.commit()
            _log("new_doctor_registered", user_id=google_id, role="doctor", clinic_id=clinic_id)
        else:
            user.name  = name
            user.email = email
            db.commit()

        user_dict = {
            "id": user.id, "role": user.role,
            "clinic_id": user.clinic_id, "name": user.name, "email": user.email,
        }
        audit(db, clinic_id=user.clinic_id, user_id=user.id, user_role="doctor",
              action_type=Actions.DOCTOR_LOGIN, entity_type="auth", entity_id=user.id,
              metadata={"email": email})
        return jsonify({
            "access_token":  generate_access_token(user_dict),
            "refresh_token": generate_refresh_token(user_dict),
            "user":          user_dict,
            "clinic_id":     user.clinic_id,
        })

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/auth/secretary/check", methods=["POST"])
def secretary_check():
    """
    POST /api/auth/secretary/check
    Body: { "clinic_id": "MEDI-XXXXX", "name": "Sara" }
    Returns the secretary's lifecycle status without exposing sensitive data.
    """
    data      = request.get_json() or {}
    clinic_id = data.get("clinic_id", "").strip()
    name      = data.get("name", "").strip().lower()

    if not clinic_id or not name:
        return jsonify({"error": "clinic_id and name are required"}), 400

    db = get_db()
    try:
        user = (
            db.query(User)
            .filter_by(clinic_id=clinic_id, name=name, role="secretary")
            .first()
        )
        if not user:
            return jsonify({"status": "not_found"})

        # Treat legacy secretaries (no status field) with a password as active
        effective_status = user.status or ("active" if user.password_hash else "invited")
        return jsonify({"status": effective_status})
    finally:
        db.close()


@app.route("/api/auth/secretary/set-password", methods=["POST"])
@limiter.limit("10 per minute")
def secretary_set_password():
    """
    POST /api/auth/secretary/set-password
    Body: { "clinic_id": "MEDI-XXXXX", "name": "Sara", "password": "abc123" }
    Activates an invited secretary by setting their password.
    No JWT required — this IS the activation step.
    """
    data      = request.get_json() or {}
    clinic_id = data.get("clinic_id", "").strip()
    name      = data.get("name", "").strip().lower()
    password  = data.get("password", "")

    if not all([clinic_id, name, password]):
        return jsonify({"error": "clinic_id, name, and password are required"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    db = get_db()
    try:
        user = (
            db.query(User)
            .filter_by(clinic_id=clinic_id, name=name, role="secretary")
            .first()
        )
        if not user:
            return jsonify({"error": "Secretary not found in this clinic"}), 404
        if user.status != "invited":
            return jsonify({"error": "Account already activated or invalid"}), 400

        user.password_hash = hash_password(password)
        user.status        = "active"
        user.activated_at  = datetime.utcnow()
        db.commit()

        _log("secretary_activated", user_id=user.id, role="secretary", clinic_id=clinic_id)
        audit(db, clinic_id=clinic_id, user_id=user.id, user_role="secretary",
              action_type=Actions.SECRETARY_ACTIVATED, entity_type="auth", entity_id=user.id)
        db.commit()
        return jsonify({"success": True, "message": "Account activated successfully"})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/auth/secretary/login", methods=["POST"])
@limiter.limit("5 per minute")
def secretary_login():
    """
    POST /api/auth/secretary/login
    Body: { "clinic_id": "MEDI-XXXXX", "name": "...", "password": "..." }
    clinic_id here is trusted only for lookup — the JWT issued is the authority.
    """
    data      = request.get_json() or {}
    clinic_id = data.get("clinic_id")
    name      = data.get("name", "").strip().lower()
    password  = data.get("password", "")

    if not all([clinic_id, name, password]):
        return jsonify({"error": "clinic_id, name, and password are required"}), 400

    db = get_db()
    try:
        user = (
            db.query(User)
            .filter_by(clinic_id=clinic_id, name=name, role="secretary")
            .first()
        )
        if not user:
            return jsonify({"error": "Secretary not found in this clinic"}), 404

        # Block login for non-active accounts
        effective_status = user.status or ("active" if user.password_hash else "invited")
        if effective_status != "active":
            return jsonify({"error": "Account not activated. Please set your password first."}), 403

        if not user.password_hash:
            return jsonify({"error": "No password set. Contact your doctor."}), 403
        if not check_password(password, user.password_hash):
            _log("failed_login", user_id=user.id, role="secretary", clinic_id=clinic_id)
            audit(db, clinic_id=clinic_id, user_id=user.id, user_role="secretary",
                  action_type=Actions.SECRETARY_LOGIN_FAIL, entity_type="auth", entity_id=user.id)
            db.commit()
            return jsonify({"error": "Invalid password"}), 401

        user_dict = {
            "id": user.id, "role": user.role,
            "clinic_id": user.clinic_id, "name": user.name,
        }
        _log("secretary_login_success", user_id=user.id, role="secretary", clinic_id=clinic_id)
        audit(db, clinic_id=clinic_id, user_id=user.id, user_role="secretary",
              action_type=Actions.SECRETARY_LOGIN, entity_type="auth", entity_id=user.id)
        db.commit()
        return jsonify({
            "access_token":  generate_access_token(user_dict),
            "refresh_token": generate_refresh_token(user_dict),
            "user":          user_dict,
            "clinic_id":     clinic_id,
        })
    finally:
        db.close()


@app.route("/api/auth/refresh", methods=["POST"])
@limiter.limit("30 per minute")
def auth_refresh():
    """
    POST /api/auth/refresh — Body: { "refresh_token": "..." }
    Issues a new access token AND rotates the refresh token.
    """
    data = request.get_json() or {}
    refresh_token = data.get("refresh_token")
    if not refresh_token:
        return jsonify({"error": "refresh_token is required"}), 400

    new_access, new_refresh = refresh_access_token(refresh_token)
    if not new_access:
        return jsonify({"error": "Invalid or expired refresh token"}), 401

    return jsonify({"access_token": new_access, "refresh_token": new_refresh})


@app.route("/api/auth/revoke", methods=["POST"])
@verify_jwt
@require_role("doctor")
@limiter.limit("20 per minute")
def revoke_user_tokens():
    """
    POST /api/auth/revoke
    Body: { "user_id": "<secretary_user_id>" }
    Doctor revokes all active tokens for a user in their clinic.
    Inserts the current token's jti into revoked_tokens.
    The target user's next request will be rejected.

    Note: This revokes the *current* access token of the target user.
    Since we cannot enumerate all issued tokens, we store a per-user
    revocation marker. Any token issued before revoked_at is rejected.
    """
    data    = request.get_json() or {}
    user_id = data.get("user_id", "").strip()
    if not user_id:
        return jsonify({"error": "user_id is required"}), 400

    db = get_db()
    try:
        # Verify the target user belongs to the doctor's clinic
        from models import User as UserModel, RevokedToken
        target = db.query(UserModel).filter_by(id=user_id, clinic_id=g.clinic_id).first()
        if not target:
            return jsonify({"error": "User not found in your clinic"}), 404

        # Store a wildcard revocation marker keyed by user_id.
        # verify_jwt checks both jti-specific and user-level revocations.
        # Use a synthetic jti of "user:<user_id>" to mark all tokens for this user.
        synthetic_jti = f"user:{user_id}"
        existing = db.query(RevokedToken).filter_by(jti=synthetic_jti).first()
        if not existing:
            revocation = RevokedToken(
                jti        = synthetic_jti,
                user_id    = user_id,
                expires_at = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
            )
            db.add(revocation)
            db.commit()

        _log("tokens_revoked", user_id=user_id, role=target.role, clinic_id=g.clinic_id)
        return jsonify({"success": True, "message": f"All tokens revoked for user {user_id}"})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ── Clinic Routes (JWT required) ──────────────────────────────────────────────

@app.route("/api/clinic/create", methods=["POST"])
@verify_jwt
@require_role("doctor")
def create_clinic():
    """
    Doctor creates their clinic on first login.
    clinic_id comes from the JWT — body name is the clinic display name only.
    """
    data = request.get_json() or {}
    clinic_name = data.get("name", "").strip()
    if not clinic_name:
        return jsonify({"error": "name is required"}), 400

    db = get_db()
    try:
        # Idempotent — return existing clinic if already created
        existing = db.query(Clinic).filter_by(doctor_user_id=g.user_id).first()
        if existing:
            user = db.query(User).filter_by(id=g.user_id).first()
            return jsonify({
                "success": True,
                "clinic_id": existing.id,
                "user": serialize(user),
            }), 200

        clinic_id = generate_clinic_id(db)
        clinic = Clinic(id=clinic_id, doctor_user_id=g.user_id, name=clinic_name)
        db.add(clinic)

        doctor = User(id=g.user_id, name=clinic_name, role="doctor", clinic_id=clinic_id)
        db.add(doctor)
        db.commit()

        return jsonify({
            "success": True,
            "clinic_id": clinic_id,
            "user": serialize(doctor),
        }), 201

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/clinic/join", methods=["POST"])
def join_clinic():
    """
    DEPRECATED — superseded by POST /api/clinic/secretaries/create (doctor JWT required).
    Disabled to prevent unauthenticated secretary account creation.
    """
    return jsonify({
        "error": "This endpoint is disabled. Doctors must create secretary accounts via the Clinic modal.",
        "use": "POST /api/clinic/secretaries/create (requires doctor JWT)",
    }), 410


@app.route("/api/clinic/by-doctor/<doctor_user_id>", methods=["GET"])
@verify_jwt
@require_role("doctor")
@limiter.limit("60 per minute")
def get_clinic_by_doctor(doctor_user_id):
    """Doctor looks up their own clinic. Enforces they can only see their own."""
    if g.user_id != doctor_user_id:
        return jsonify({"error": "Forbidden"}), 403

    db = get_db()
    try:
        clinic = db.query(Clinic).filter_by(doctor_user_id=g.user_id).first()
        if not clinic:
            return jsonify({"error": "No clinic found for this doctor"}), 404
        return jsonify({"clinic_id": clinic.id, "clinic": serialize(clinic)})
    finally:
        db.close()


@app.route("/api/clinic/<clinic_id_param>", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def get_clinic(clinic_id_param):
    """Return clinic info. User can only view their own clinic."""
    if g.clinic_id != clinic_id_param:
        return jsonify({"error": "Forbidden"}), 403

    db = get_db()
    try:
        clinic = db.query(Clinic).filter_by(id=g.clinic_id).first()
        if not clinic:
            return jsonify({"error": "Clinic not found"}), 404

        users = db.query(User).filter_by(clinic_id=g.clinic_id).all()
        return jsonify({
            "clinic": serialize(clinic),
            "users":  [serialize(u) for u in users],
        })
    finally:
        db.close()


@app.route("/api/clinic/secretaries/create", methods=["POST"])
@verify_jwt
@require_role("doctor")
def create_secretary():
    """
    POST /api/clinic/secretaries/create
    Doctor creates a secretary account in their clinic.
    Secretary starts as "invited" with no password.
    """
    data  = request.get_json() or {}
    name  = data.get("name", "").strip().lower()
    email = data.get("email", "").strip() or None

    if not name:
        return jsonify({"error": "name is required"}), 400

    db = get_db()
    try:
        # Prevent duplicate names in the same clinic
        existing = db.query(User).filter_by(clinic_id=g.clinic_id, name=name, role="secretary").first()
        if existing:
            return jsonify({"error": f"A secretary named '{name}' already exists in this clinic"}), 409

        user = User(
            id=str(uuid.uuid4()),
            name=name,
            email=email,
            role="secretary",
            clinic_id=g.clinic_id,
            status="invited",
            invited_at=datetime.utcnow(),
            password_hash=None,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        _log("secretary_created", user_id=user.id, role="secretary", clinic_id=g.clinic_id)
        return jsonify({"success": True, "user": serialize(user)}), 201

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/clinic/secretaries", methods=["GET"])
@verify_jwt
@require_role("doctor")
@limiter.limit("60 per minute")
def list_secretaries():
    """
    GET /api/clinic/secretaries
    Returns all secretaries for the doctor's clinic with their status.
    """
    db = get_db()
    try:
        users = (
            db.query(User)
            .filter_by(clinic_id=g.clinic_id, role="secretary")
            .order_by(User.created_at.asc())
            .all()
        )
        return jsonify({"secretaries": [serialize(u) for u in users]})
    finally:
        db.close()


@app.route("/api/clinic/secretaries/<secretary_id>/reset-password", methods=["POST"])
@verify_jwt
@require_role("doctor")
def reset_secretary_password(secretary_id):
    """
    POST /api/clinic/secretaries/<id>/reset-password
    Doctor resets a secretary's password by setting status back to "invited"
    and clearing the password hash. Secretary must re-activate via set-password flow.
    """
    db = get_db()
    try:
        user = db.query(User).filter_by(
            id=secretary_id, clinic_id=g.clinic_id, role="secretary"
        ).first()
        if not user:
            return jsonify({"error": "Secretary not found in your clinic"}), 404

        user.password_hash = None
        user.status        = "invited"
        user.activated_at  = None
        db.commit()

        _log("secretary_password_reset", user_id=secretary_id, role="secretary", clinic_id=g.clinic_id)
        return jsonify({"success": True, "message": "Password reset. Secretary must re-activate."})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ── Patient Routes (JWT required) ─────────────────────────────────────────────

@app.route("/api/patients", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def get_patients():
    """Both roles can list patients in their clinic."""
    db = get_db()
    try:
        limit  = min(int(request.args.get("limit",  200)), 500)
        search = (request.args.get("search", "") or "").strip()
        page   = request.args.get("page", None)
        offset = request.args.get("offset", None)
        if page is not None:
            try:
                offset = max((int(page) - 1) * limit, 0)
            except ValueError:
                offset = 0
        elif offset is not None:
            try:
                offset = max(int(offset), 0)
            except ValueError:
                offset = 0
        else:
            offset = 0

        query = db.query(Patient).filter(Patient.clinic_id == g.clinic_id, Patient.deleted_at == None)
        if search:
            search_pattern = f"%{search}%"
            query = query.filter(
                or_(
                    Patient.full_name.ilike(search_pattern),
                    Patient.phone.ilike(search_pattern),
                    Patient.email.ilike(search_pattern),
                )
            )

        total = query.count()
        patients = query.order_by(Patient.created_at.desc()).limit(limit).offset(offset).all()
        return jsonify({"patients": [serialize(p) for p in patients], "total": total, "limit": limit, "offset": offset})
    finally:
        db.close()


@app.route("/api/patients/search", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def search_patients():
    """Server-side search across all patients in the clinic with pagination."""
    query_text = (request.args.get("q", "") or "").strip()
    if not query_text:
        return jsonify({"data": [], "page": 1, "hasMore": False, "query": ""})

    limit = min(max(int(request.args.get("limit", 50)), 1), 200)
    page = max(int(request.args.get("page", 1)), 1)
    offset = (page - 1) * limit

    db = get_db()
    try:
        search_pattern = f"%{query_text}%"
        base_query = (
            db.query(Patient)
              .filter(Patient.clinic_id == g.clinic_id, Patient.deleted_at == None)
              .filter(
                  or_(
                      Patient.full_name.ilike(search_pattern),
                      Patient.phone.ilike(search_pattern),
                      Patient.email.ilike(search_pattern),
                      Patient.notes.ilike(search_pattern),
                  )
              )
        )
        total = base_query.count()
        patients = (
            base_query
              .order_by(
                  case(
                      (Patient.full_name.ilike(search_pattern), 0),
                      (Patient.phone.ilike(search_pattern), 1),
                      (Patient.email.ilike(search_pattern), 2),
                      (Patient.notes.ilike(search_pattern), 3),
                      else_=4,
                  ),
                  Patient.updated_at.desc()
              )
              .limit(limit)
              .offset(offset)
              .all()
        )
        return jsonify({
            "data": [serialize(p) for p in patients],
            "page": page,
            "hasMore": offset + len(patients) < total,
            "total": total,
            "query": query_text,
        })
    finally:
        db.close()


@app.route("/api/patients", methods=["POST"])
@verify_jwt
@limiter.limit("30 per minute")
def create_patient():
    """
    POST /api/patients — idempotent UPSERT by global_id.
    If a patient with the same global_id already exists in this clinic,
    return the existing record (201 → 200). Prevents duplicate creation on retries.
    clinic_id comes from JWT only.
    """
    data      = request.get_json() or {}
    full_name = data.get("full_name", "").strip()

    if not full_name:
        return jsonify({"error": "full_name is required"}), 400

    db = get_db()
    try:
        clinic = db.query(Clinic).filter_by(id=g.clinic_id).first()
        if not clinic:
            return jsonify({"error": "Clinic not found"}), 404

        # Accept a global_id from the client (doctor syncing from local) or generate one
        global_id = data.get("global_id") or str(uuid.uuid4())

        # ── Idempotent: if this global_id already exists, return existing record ──
        existing = db.query(Patient).filter(
            Patient.global_id == global_id,
            Patient.clinic_id == g.clinic_id,
            Patient.deleted_at == None,
        ).first()
        if existing:
            return jsonify({"success": True, "patient": serialize(existing), "created": False}), 200

        patient = Patient(
            global_id   = global_id,
            clinic_id   = g.clinic_id,
            full_name   = full_name,
            phone       = data.get("phone"),
            email       = data.get("email"),
            notes       = data.get("notes"),
            appointment = data.get("appointment"),
            status      = data.get("status", "Active"),
            updated_by  = g.role,
        )
        db.add(patient)

        audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
              action_type=Actions.CREATE_PATIENT, entity_type="patient", entity_id=global_id,
              metadata={"full_name": full_name})

        # Notify doctor when secretary creates a patient
        if g.role == "secretary":
            notify(db, clinic_id=g.clinic_id, type="patient", target_role="doctor",
                   title="New patient added",
                   message=f"Secretary added patient: {full_name}")

        db.commit()
        db.refresh(patient)
        emit_to_clinic(g.clinic_id, "patient_created", {
            "global_id": patient.global_id,
            "clinic_id": g.clinic_id,
            "full_name": patient.full_name,
            "created_by": g.role,
        })
        return jsonify({"success": True, "patient": serialize(patient), "created": True}), 201

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/patients/by-global/<global_id_param>", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def get_patient_by_global_id(global_id_param):
    """
    GET /api/patients/by-global/<global_id>
    Fetch a single patient by global_id. Used by conflict resolution to get
    the current cloud version after a 409.
    clinic_id enforced from JWT — cannot access another clinic's patient.
    """
    db = get_db()
    try:
        patient = db.query(Patient).filter_by(
            global_id=global_id_param, clinic_id=g.clinic_id
        ).first()
        if not patient:
            return jsonify({"error": "Patient not found"}), 404
        return jsonify({"patient": serialize(patient)})
    finally:
        db.close()


@app.route("/api/patients/by-global/<global_id_param>", methods=["PUT"])
@verify_jwt
def update_patient_by_global_id(global_id_param):
    """
    PUT /api/patients/by-global/<global_id>
    Preferred update path — clock-skew-safe via version field.

    Conflict detection (version-based, NOT timestamp-based):
      - Client sends the `version` it last saw.
      - Server rejects with 409 if stored version != client version.
      - Server increments version on every successful write.
      - Client timestamps are IGNORED for conflict detection.

    This is immune to clock skew, NTP corrections, and timezone differences.
    """
    data = request.get_json() or {}

    db = get_db()
    try:
        # Use SELECT FOR UPDATE to serialize concurrent writes to the same patient.
        # This prevents two requests with the same version from both succeeding —
        # the second one will wait for the first to commit, then see the incremented
        # version and correctly return 409.
        patient = db.query(Patient).filter(
            Patient.global_id == global_id_param,
            Patient.clinic_id == g.clinic_id,
            Patient.deleted_at == None,
        ).with_for_update().first()
        if not patient:
            return jsonify({"error": "Patient not found"}), 404

        # ── Version-based conflict detection (clock-skew-safe) ────────────────
        client_version = data.get("version")
        if client_version is not None and int(client_version) != patient.version:
            if not data.get("force"):
                emit_to_clinic(g.clinic_id, "sync_failed", {
                    "global_id": patient.global_id,
                    "clinic_id": g.clinic_id,
                    "reason": "version_conflict",
                    "server_version": patient.version,
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
            # Force overwrite requested — continue with update.

        for field in ("full_name", "phone", "email", "notes", "appointment", "status"):
            if field in data:
                setattr(patient, field, data[field])

        patient.updated_by = g.role
        patient.updated_at = datetime.utcnow()   # server-stamped, never from client
        patient.version    = (patient.version or 0) + 1

        audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
              action_type=Actions.UPDATE_PATIENT, entity_type="patient",
              entity_id=patient.global_id,
              metadata={"full_name": patient.full_name, "version": patient.version})

        db.commit()
        db.refresh(patient)
        emit_to_clinic(g.clinic_id, "patient_updated", {
            "global_id":  patient.global_id,
            "clinic_id":  g.clinic_id,
            "updated_by": g.role,
            "updated_at": patient.updated_at.isoformat(),
            "version":    patient.version,
        })
        return jsonify({"success": True, "patient": serialize(patient)})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/patients/by-global/<global_id_param>", methods=["DELETE"])
@verify_jwt
def delete_patient_by_global_id(global_id_param):
    """Soft-delete a patient by global_id for conflict-safe offline delete replay."""
    db = get_db()
    try:
        patient = db.query(Patient).filter(
            Patient.global_id == global_id_param,
            Patient.clinic_id == g.clinic_id,
        ).first()
        if patient and patient.deleted_at is None:
            patient.deleted_at = datetime.utcnow()
            patient.status = "Deleted"
            audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
                  action_type=Actions.DELETE_PATIENT, entity_type="patient",
                  entity_id=patient.global_id or str(patient.id),
                  metadata={"full_name": patient.full_name})
            db.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/patients/<int:patient_id>", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def get_patient(patient_id):
    """Return patient details for the current clinic."""
    db = get_db()
    try:
        patient = db.query(Patient).filter(
            Patient.id == patient_id,
            Patient.clinic_id == g.clinic_id,
            Patient.deleted_at == None,
        ).first()
        if not patient:
            return jsonify({"error": "Not found"}), 404
        return jsonify({"patient": serialize(patient)})
    finally:
        db.close()


@app.route("/api/patients/<int:patient_id>", methods=["PUT"])
@verify_jwt
@limiter.limit("30 per minute")
def update_patient(patient_id):
    """Both roles can update patients. clinic_id comes from JWT."""
    data = request.get_json() or {}

    db = get_db()
    try:
        patient = db.query(Patient).filter(
            Patient.id == patient_id,
            Patient.clinic_id == g.clinic_id,
            Patient.deleted_at == None,
        ).first()
        if not patient:
            return jsonify({"error": "Patient not found"}), 404

        # ── Version-based conflict detection (clock-skew-safe) ────────────
        client_version = data.get("version")
        if client_version is not None and int(client_version) != patient.version:
            if not data.get("force"):
                emit_to_clinic(g.clinic_id, "sync_failed", {
                    "global_id": patient.global_id,
                    "clinic_id": g.clinic_id,
                    "reason": "version_conflict",
                    "server_version": patient.version,
                    "client_version": client_version,
                })
                return jsonify({
                    "error": "conflict",
                    "message": "Record was modified by another user. Please reload and try again.",
                    "server_version": patient.version,
                    "server_patient": serialize(patient),
                }), 409
            # Force overwrite requested — continue with update.

        for field in ("full_name", "phone", "email", "notes", "appointment", "status"):
            if field in data:
                setattr(patient, field, data[field])

        patient.updated_by = g.role
        patient.updated_at = datetime.utcnow()
        patient.version    = (patient.version or 0) + 1

        audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
              action_type=Actions.UPDATE_PATIENT, entity_type="patient",
              entity_id=patient.global_id or str(patient.id),
              metadata={"full_name": patient.full_name})

        db.commit()
        db.refresh(patient)
        return jsonify({"success": True, "patient": serialize(patient)})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/patients/<int:patient_id>/attachments", methods=["GET"])
@verify_jwt
@limiter.limit("30 per minute")
def get_patient_attachments(patient_id):
    """List attachments for a specific patient in the clinic."""
    db = get_db()
    try:
        patient = db.query(Patient).filter(
            Patient.id == patient_id,
            Patient.clinic_id == g.clinic_id,
            Patient.deleted_at == None,
        ).first()
        if not patient:
            return jsonify({"error": "Not found"}), 404

        files = storage.list_files(g.clinic_id)
        prefix = f"{patient.global_id}_" if patient.global_id else ""
        attachments = []
        for filename in files:
            if prefix and filename.startswith(prefix):
                url = f"/api/v2/attachments/{g.clinic_id}/{filename}"
                attachments.append({"filename": filename, "url": url})
        return jsonify({"attachments": attachments})
    finally:
        db.close()


@app.errorhandler(404)
def not_found_error(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed_error(e):
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_server_error(e):
    return jsonify({"error": "Internal server error"}), 500


@app.route("/api/patients/<int:patient_id>", methods=["DELETE"])
@verify_jwt
@require_role("doctor")
def delete_patient(patient_id):
    """Only doctors can delete patients."""
    db = get_db()
    try:
        patient = db.query(Patient).filter(
            Patient.id == patient_id,
            Patient.clinic_id == g.clinic_id,
            Patient.deleted_at == None,
        ).first()
        if not patient:
            return jsonify({"error": "Patient not found"}), 404

        audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
              action_type=Actions.DELETE_PATIENT, entity_type="patient",
              entity_id=patient.global_id or str(patient.id),
              metadata={"full_name": patient.full_name})

        patient.deleted_at = datetime.utcnow()
        patient.status = "Deleted"
        db.commit()
        return jsonify({"success": True})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/patients/<int:patient_id>/restore", methods=["POST"])
@verify_jwt
@require_role("doctor")
def restore_patient(patient_id):
    """
    POST /api/patients/<id>/restore
    Restore a soft-deleted patient. Doctor only.
    """
    db = get_db()
    try:
        patient = db.query(Patient).filter(
            Patient.id == patient_id,
            Patient.clinic_id == g.clinic_id,
        ).first()
        if not patient:
            return jsonify({"error": "Patient not found"}), 404
        if patient.deleted_at is None:
            return jsonify({"error": "Patient is not deleted"}), 400

        patient.deleted_at = None
        patient.status = "Active"
        patient.updated_at = datetime.utcnow()
        patient.version = (patient.version or 0) + 1

        audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
              action_type="RESTORE_PATIENT", entity_type="patient",
              entity_id=patient.global_id or str(patient.id),
              metadata={"full_name": patient.full_name})

        db.commit()
        db.refresh(patient)
        return jsonify({"success": True, "patient": serialize(patient)})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ── Message Routes (JWT required) ─────────────────────────────────────────────

@app.route("/api/messages", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def get_messages():
    """Both roles can read messages in their clinic."""
    db = get_db()
    try:
        limit  = min(int(request.args.get("limit",  100)), 500)
        offset = max(int(request.args.get("offset", 0)),   0)
        messages = (
            db.query(Message)
            .filter_by(clinic_id=g.clinic_id)
            .order_by(Message.created_at.asc())
            .limit(limit)
            .offset(offset)
            .all()
        )
        total = db.query(Message).filter_by(clinic_id=g.clinic_id).count()
        return jsonify({"messages": [serialize(m) for m in messages], "total": total})
    finally:
        db.close()


@app.route("/api/messages", methods=["POST"])
@verify_jwt
@limiter.limit("30 per minute")
def create_message():
    """
    Both roles can send messages.
    sender_role is taken from the JWT — never from the request body.
    """
    data = request.get_json() or {}
    text = data.get("text", "").strip()

    if not text:
        return jsonify({"error": "text is required"}), 400

    db = get_db()
    try:
        clinic = db.query(Clinic).filter_by(id=g.clinic_id).first()
        if not clinic:
            return jsonify({"error": "Clinic not found"}), 404

        message = Message(
            clinic_id=g.clinic_id,
            sender_role=g.role,          # from JWT — never from body
            text=text,
            is_task=data.get("is_task", False),
            status="pending",
        )
        db.add(message)
        db.commit()
        db.refresh(message)
        emit_to_clinic(g.clinic_id, "message_new", {
            "id":          message.id,
            "clinic_id":   g.clinic_id,
            "sender_role": message.sender_role,
            "text":        message.text,
            "is_task":     message.is_task,
            "status":      message.status,
            "created_at":  message.created_at.isoformat(),
        })
        return jsonify({"success": True, "message": serialize(message)}), 201

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/messages/<int:message_id>", methods=["PATCH"])
@verify_jwt
def update_message_status(message_id):
    """Both roles can mark a task done."""
    data   = request.get_json() or {}
    status = data.get("status")

    if status not in ("pending", "done"):
        return jsonify({"error": "status must be 'pending' or 'done'"}), 400

    db = get_db()
    try:
        msg = db.query(Message).filter_by(id=message_id, clinic_id=g.clinic_id).first()
        if not msg:
            return jsonify({"error": "Message not found"}), 404

        msg.status = status
        db.commit()
        db.refresh(msg)
        return jsonify({"success": True, "message": serialize(msg)})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ── Appointment Routes (JWT required) ────────────────────────────────────────

def _check_conflict(db, clinic_id, date, start_time, end_time, exclude_id=None):
    """
    Return the first conflicting appointment in the clinic on the given date.
    Uses SELECT FOR UPDATE to prevent race conditions under concurrent bookings.
    Overlap condition: start < other.end AND end > other.start
    """
    query = (
        db.query(Appointment)
        .filter(
            Appointment.clinic_id == clinic_id,
            Appointment.date == date,
            Appointment.status != "cancelled",
            Appointment.start_time < end_time,
            Appointment.end_time > start_time,
        )
        .with_for_update()   # row-level lock — prevents concurrent double-booking
    )
    if exclude_id is not None:
        query = query.filter(Appointment.id != exclude_id)
    return query.first()


@app.route("/api/appointments", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def get_appointments():
    """
    GET /api/appointments
    Returns appointments for the current clinic (from JWT).
    Optional query params:
      ?date=YYYY-MM-DD          → single day
      ?start_date=...&end_date= → date range
    Default: last 30 days + next 30 days (rolling window).
    """
    db = get_db()
    try:
        q = db.query(Appointment).filter_by(clinic_id=g.clinic_id)

        date = request.args.get("date")
        start_date = request.args.get("start_date")
        end_date = request.args.get("end_date")

        if date:
            q = q.filter(Appointment.date == date)
        elif start_date and end_date:
            q = q.filter(Appointment.date >= start_date, Appointment.date <= end_date)
        else:
            # Default: 30-day rolling window centred on today
            from datetime import timedelta
            today = datetime.utcnow().date()
            q = q.filter(
                Appointment.date >= str(today - timedelta(days=30)),
                Appointment.date <= str(today + timedelta(days=30)),
            )

        appointments = q.order_by(Appointment.date, Appointment.start_time).all()
        return jsonify({"appointments": [serialize(a) for a in appointments]})
    finally:
        db.close()


@app.route("/api/appointments/<int:appointment_id>", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def get_appointment(appointment_id):
    """Return appointment details for the current clinic."""
    db = get_db()
    try:
        appt = db.query(Appointment).filter(
            Appointment.id == appointment_id,
            Appointment.clinic_id == g.clinic_id,
        ).first()
        if not appt:
            return jsonify({"error": "Not found"}), 404

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


@app.route("/api/appointments", methods=["POST"])
@verify_jwt
@limiter.limit("30 per minute")
def create_appointment():
    """
    POST /api/appointments
    Both roles can create appointments. clinic_id from JWT only.
    Validates: start_time < end_time, no overlap.
    """
    data = request.get_json() or {}

    patient_name = data.get("patient_name", "").strip()
    date         = data.get("date") or data.get("appointment_date", "")
    start_time   = data.get("start_time", "")
    end_time     = data.get("end_time", "")

    if not patient_name:
        return jsonify({"error": "patient_name is required"}), 400
    if not date or not start_time or not end_time:
        return jsonify({"error": "date, start_time, and end_time are required"}), 400
    if start_time >= end_time:
        return jsonify({"error": "start_time must be before end_time"}), 422

    db = get_db()
    try:
        # ── CRITICAL FIX: Wrap conflict check + insert in single transaction ──
        # This prevents race condition where two requests both pass conflict check
        # before either commits their appointment
        
        # Start explicit transaction with row-level locking
        with db.begin():
            conflict = _check_conflict(db, g.clinic_id, date, start_time, end_time)
            if conflict:
                return jsonify({
                    "error": "conflict",
                    "message": f"Time slot already booked: {conflict.patient_name} {conflict.start_time}–{conflict.end_time}",
                    "conflict": serialize(conflict),
                }), 409

            appt = Appointment(
                clinic_id    = g.clinic_id,
                patient_id   = data.get("patient_id"),
                patient_name = patient_name,
                date         = date,
                start_time   = start_time,
                end_time     = end_time,
                status       = data.get("status", "scheduled"),
                notes        = data.get("notes"),
                created_by   = g.role,
            )
            db.add(appt)
            
            # Flush to get the ID for audit logging
            db.flush()

            audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
                  action_type=Actions.CREATE_APPOINTMENT, entity_type="appointment",
                  entity_id=appt.global_id,
                  metadata={"patient_name": patient_name, "date": date,
                            "start_time": start_time, "end_time": end_time})

            notify(db, clinic_id=g.clinic_id, type="appointment", target_role="all",
                   title="New appointment",
                   message=f"{patient_name} — {date} {start_time}–{end_time} (by {g.role})")
            
            # Transaction commits automatically when exiting with block
        
        # Refresh outside transaction to get final state
        db.refresh(appt)
        return jsonify({"success": True, "appointment": serialize(appt)}), 201

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/appointments/<int:appt_id>", methods=["PUT"])
@verify_jwt
def update_appointment(appt_id):
    """
    PUT /api/appointments/<id>
    Both roles can update. Re-checks conflicts if time/date changed.
    """
    data = request.get_json() or {}

    db = get_db()
    try:
        appt = db.query(Appointment).filter_by(id=appt_id, clinic_id=g.clinic_id).first()
        if not appt:
            return jsonify({"error": "Appointment not found"}), 404

        # Determine new values (fall back to existing if not provided)
        new_date       = data.get("date") or data.get("appointment_date") or appt.date
        new_start      = data.get("start_time", appt.start_time)
        new_end        = data.get("end_time",   appt.end_time)

        if new_start >= new_end:
            return jsonify({"error": "start_time must be before end_time"}), 422

        # Re-check conflicts only if time or date changed
        time_changed = (new_date != appt.date or new_start != appt.start_time or new_end != appt.end_time)
        if time_changed:
            conflict = _check_conflict(db, g.clinic_id, new_date, new_start, new_end, exclude_id=appt_id)
            if conflict:
                return jsonify({
                    "error": "conflict",
                    "message": f"Time slot already booked: {conflict.patient_name} {conflict.start_time}–{conflict.end_time}",
                    "conflict": serialize(conflict),
                }), 409

        # Apply updates
        appt.date         = new_date
        appt.start_time   = new_start
        appt.end_time     = new_end
        if "patient_name" in data: appt.patient_name = data["patient_name"]
        if "patient_id"   in data: appt.patient_id   = data["patient_id"]
        if "status"       in data: appt.status        = data["status"]
        if "notes"        in data: appt.notes         = data["notes"]
        appt.updated_at = datetime.utcnow()

        audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
              action_type=Actions.UPDATE_APPOINTMENT, entity_type="appointment",
              entity_id=appt.global_id or str(appt.id),
              metadata={"patient_name": appt.patient_name, "status": appt.status})

        notify(db, clinic_id=g.clinic_id, type="appointment", target_role="all",
               title="Appointment updated",
               message=f"{appt.patient_name} — {appt.date} {appt.start_time}–{appt.end_time} → {appt.status}")

        db.commit()
        db.refresh(appt)
        return jsonify({"success": True, "appointment": serialize(appt)})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/appointments/<int:appt_id>", methods=["DELETE"])
@verify_jwt
def delete_appointment(appt_id):
    """
    DELETE /api/appointments/<id>
    Soft-delete: sets status to "cancelled".
    Both roles can cancel. Only doctors can hard-delete (query param ?hard=1).
    """
    db = get_db()
    try:
        appt = db.query(Appointment).filter_by(id=appt_id, clinic_id=g.clinic_id).first()
        if not appt:
            return jsonify({"error": "Appointment not found"}), 404

        hard_delete = request.args.get("hard") == "1" and g.role == "doctor"
        if hard_delete:
            audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
                  action_type=Actions.DELETE_APPOINTMENT, entity_type="appointment",
                  entity_id=appt.global_id or str(appt.id),
                  metadata={"patient_name": appt.patient_name})
            db.delete(appt)
        else:
            appt.status = "cancelled"
            appt.updated_at = datetime.utcnow()
            audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
                  action_type=Actions.CANCEL_APPOINTMENT, entity_type="appointment",
                  entity_id=appt.global_id or str(appt.id),
                  metadata={"patient_name": appt.patient_name})
            notify(db, clinic_id=g.clinic_id, type="appointment", target_role="all",
                   title="Appointment cancelled",
                   message=f"{appt.patient_name} — {appt.date} {appt.start_time}–{appt.end_time}")

        db.commit()
        return jsonify({"success": True})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ── Audit Log Routes (JWT required) ──────────────────────────────────────────

@app.route("/api/audit-logs", methods=["GET"])
@verify_jwt
@require_role("doctor")
def get_audit_logs():
    """
    GET /api/audit-logs
    Doctor-only. Returns last 100 audit entries for the clinic.
    Optional: ?entity_type=patient|appointment|auth  ?limit=N
    """
    db = get_db()
    try:
        q = (
            db.query(AuditLog)
            .filter_by(clinic_id=g.clinic_id)
            .order_by(AuditLog.timestamp.desc())
        )
        entity_type = request.args.get("entity_type")
        if entity_type:
            q = q.filter(AuditLog.entity_type == entity_type)

        limit = min(int(request.args.get("limit", 100)), 500)
        logs = q.limit(limit).all()
        return jsonify({"audit_logs": [serialize(l) for l in logs]})
    finally:
        db.close()


# ── Notification Routes (JWT required) ───────────────────────────────────────

@app.route("/api/notifications", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def get_notifications():
    """
    GET /api/notifications
    Returns last 20 notifications for the current role.
    target_role filter: returns "all" + role-specific notifications.
    Optional: ?unread_only=1
    """
    db = get_db()
    try:
        q = (
            db.query(Notification)
            .filter(
                Notification.clinic_id == g.clinic_id,
                Notification.target_role.in_(["all", g.role]),
            )
            .order_by(Notification.created_at.desc())
            .limit(20)
        )
        if request.args.get("unread_only") == "1":
            q = q.filter(Notification.is_read == False)  # noqa: E712

        notifications = q.all()
        unread_count = (
            db.query(Notification)
            .filter(
                Notification.clinic_id == g.clinic_id,
                Notification.target_role.in_(["all", g.role]),
                Notification.is_read == False,  # noqa: E712
            )
            .count()
        )
        return jsonify({
            "notifications": [serialize(n) for n in notifications],
            "unread_count": unread_count,
        })
    finally:
        db.close()


@app.route("/api/notifications/<int:notif_id>/read", methods=["PATCH"])
@verify_jwt
def mark_notification_read(notif_id):
    """PATCH /api/notifications/<id>/read — mark one notification as read."""
    db = get_db()
    try:
        n = db.query(Notification).filter_by(id=notif_id, clinic_id=g.clinic_id).first()
        if not n:
            return jsonify({"error": "Notification not found"}), 404
        n.is_read = True
        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/notifications/read-all", methods=["PATCH"])
@verify_jwt
def mark_all_notifications_read():
    """PATCH /api/notifications/read-all — mark all unread notifications for this role as read."""
    db = get_db()
    try:
        db.query(Notification).filter(
            Notification.clinic_id == g.clinic_id,
            Notification.target_role.in_(["all", g.role]),
            Notification.is_read == False,  # noqa: E712
        ).update({"is_read": True}, synchronize_session=False)
        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ── Health check ──────────────────────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def health_check():
    """
    GET /api/health — liveness probe for Docker/Nginx/load balancers.
    Returns 200 if the API is up. Checks DB and Redis connectivity.
    """
    from database import DATABASE_URL
    
    if DATABASE_URL.startswith("postgresql"):
        db_type = "postgresql"
    else:
        db_type = "unknown"
    
    status = {"api": "ok", "db": "unknown", "db_type": db_type, "redis": "unknown"}
    http_status = 200

    # DB check
    try:
        db = get_db()
        db.execute(__import__("sqlalchemy").text("SELECT 1"))
        db.close()
        status["db"] = "ok"
    except Exception as e:
        status["db"] = f"error: {str(e)[:50]}"
        http_status = 503

    # Redis check
    redis_url = os.getenv("REDIS_URL")
    if redis_url:
        try:
            import redis as _redis
            r = _redis.from_url(redis_url, socket_connect_timeout=2)
            r.ping()
            status["redis"] = "ok"
        except Exception as e:
            status["redis"] = f"error: {str(e)[:50]}"
            # Redis failure is non-fatal — app still works without it
    else:
        status["redis"] = "not_configured"

    return jsonify(status), http_status


@app.route("/api/metrics", methods=["GET"])
@verify_jwt
@require_role("doctor")
def get_metrics():
    """
    GET /api/metrics — sync failure dashboard for the doctor's clinic.
    Returns success/failure counts and recent sync errors.
    """
    metrics = get_sync_metrics(g.clinic_id)
    return jsonify(metrics)


@app.route("/api/admin/metrics", methods=["GET"])
@verify_jwt
@require_role("doctor")
def get_admin_metrics():
    """
    GET /api/admin/metrics — system-wide health dashboard.
    Returns request counts, latency distribution, DB connections, Redis info.
    Includes Sentry status so you can confirm error tracking is active.
    """
    return jsonify(get_system_metrics())


# ── Internal Test Endpoints (test/dev only) ───────────────────────────────────

@app.route("/api/internal/seed-test-clinic", methods=["POST"])
def seed_test_clinic():
    """
    POST /api/internal/seed-test-clinic
    Creates a throwaway clinic + doctor JWT for stress testing.
    ONLY available when FLASK_ENV=test. Returns 404 in production.
    """
    if os.getenv("FLASK_ENV") != "test":
        return jsonify({"error": "Not found"}), 404

    data = request.get_json() or {}
    clinic_num = data.get("clinic_num", 0)

    db = get_db()
    try:
        clinic_id = f"TEST-{clinic_num:05d}"
        google_id = f"stress_doctor_{clinic_num}"

        # Idempotent — reuse if exists
        clinic = db.query(Clinic).filter_by(id=clinic_id).first()
        if not clinic:
            clinic = Clinic(id=clinic_id, doctor_user_id=google_id, name=f"Stress Clinic {clinic_num}")
            db.add(clinic)

        user = db.query(User).filter_by(id=google_id).first()
        if not user:
            user = User(id=google_id, name=f"Stress Doctor {clinic_num}", role="doctor",
                        clinic_id=clinic_id, google_id=google_id, email=f"stress{clinic_num}@test.local")
            db.add(user)

        db.commit()

        user_dict = {"id": google_id, "role": "doctor", "clinic_id": clinic_id, "name": user.name}
        return jsonify({
            "clinic_id":    clinic_id,
            "access_token": generate_access_token(user_dict),
        })
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ── Cloud Attachment Routes (JWT required) ────────────────────────────────────

ALLOWED_ATTACHMENT_TYPES = {"pdf", "png", "jpg", "jpeg", "gif", "webp"}

@app.route("/api/v2/attachments/<clinic_id_param>/<filename>", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def serve_cloud_attachment(clinic_id_param, filename):
    """Serve or redirect to a cloud attachment. Enforces clinic isolation."""
    if g.clinic_id != clinic_id_param:
        return jsonify({"error": "Forbidden"}), 403
    url = storage.presigned_url(clinic_id_param, filename)
    # If local storage, serve the file directly; if S3, redirect to presigned URL
    if url.startswith("/api/"):
        data = storage.get(clinic_id_param, filename)
        if not data:
            return jsonify({"error": "File not found"}), 404
        return send_file(io.BytesIO(data), download_name=filename, as_attachment=False)
    from flask import redirect
    return redirect(url)


@app.route("/api/v2/attachments/<clinic_id_param>", methods=["POST"])
@verify_jwt
@limiter.limit("20 per minute")
def upload_cloud_attachment(clinic_id_param):
    """Upload an attachment to cloud storage. Enforces clinic isolation."""
    if g.clinic_id != clinic_id_param:
        return jsonify({"error": "Forbidden"}), 403

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "No file selected"}), 400

    if request.content_length is not None and request.content_length > MAX_FILE_SIZE:
        return jsonify({"error": "File too large (max 25MB)"}), 400

    filename = secure_filename(file.filename)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_ATTACHMENT_TYPES:
        return jsonify({"error": f"File type not allowed. Allowed: {', '.join(ALLOWED_ATTACHMENT_TYPES)}"}), 400

    # Prefix with patient global_id if provided to namespace files
    patient_global_id = request.form.get("patient_global_id", "")
    stored_name = f"{patient_global_id}_{filename}" if patient_global_id else filename

    try:
        url = storage.save(
            clinic_id_param,
            stored_name,
            file.stream,
            file.content_type or "application/octet-stream"
        )
    except ValueError as err:
        return jsonify({"error": str(err)}), 400
    except Exception as err:
        return jsonify({"error": str(err)}), 500

    return jsonify({"success": True, "url": url, "filename": stored_name}), 201


@app.route("/api/v2/attachments/<clinic_id_param>/<filename>", methods=["DELETE"])
@verify_jwt
def delete_cloud_attachment(clinic_id_param, filename):
    """Delete a cloud attachment. Enforces clinic isolation."""
    if g.clinic_id != clinic_id_param:
        return jsonify({"error": "Forbidden"}), 403
    deleted = storage.delete(clinic_id_param, filename)
    if not deleted:
        return jsonify({"error": "File not found"}), 404
    return jsonify({"success": True})


@app.route("/api/v2/attachments/<clinic_id_param>/usage", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def get_storage_usage(clinic_id_param):
    """
    GET /api/v2/attachments/<clinic_id>/usage
    Returns storage usage and quota for the clinic.
    Both roles can check their own clinic's usage.
    """
    if g.clinic_id != clinic_id_param:
        return jsonify({"error": "Forbidden"}), 403
    try:
        usage = storage.get_usage(clinic_id_param)
        return jsonify(usage)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/internal/sentry-test", methods=["POST"])
@verify_jwt
@require_role("doctor")
def sentry_test():
    """
    POST /api/internal/sentry-test
    Triggers a test exception to verify Sentry is capturing errors.
    Only available when FLASK_ENV=test. Returns 404 in production.
    Used during deployment verification — never expose in production.
    """
    if os.getenv("FLASK_ENV") != "test":
        return jsonify({"error": "Not found"}), 404
    raise RuntimeError("Sentry test error — triggered intentionally via /api/internal/sentry-test")


# ── Clinic Info ───────────────────────────────────────────────────────────────

@app.route("/api/clinics/me", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def get_my_clinic():
    """
    GET /api/clinics/me
    Returns clinic info for the current user's clinic.
    Used by TopBar and PatientDetail to display doctor_name and clinic_name.
    """
    db = get_db()
    try:
        clinic = db.query(Clinic).filter_by(id=g.clinic_id).first()
        if not clinic:
            return jsonify({"error": "Clinic not found"}), 404
        doctor = db.query(User).filter_by(clinic_id=g.clinic_id, role="doctor").first()
        return jsonify({
            "clinic_id":   clinic.id,
            "clinic_name": clinic.name,
            "doctor_name": doctor.name if doctor else "",
            "doctor_email": doctor.email if doctor else "",
        })
    finally:
        db.close()


@app.route("/api/clinics/me", methods=["PUT"])
@verify_jwt
@require_role("doctor")
@limiter.limit("20 per minute")
def update_my_clinic():
    """PUT /api/clinics/me — Doctor updates their clinic name."""
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    db = get_db()
    try:
        clinic = db.query(Clinic).filter_by(id=g.clinic_id).first()
        if not clinic:
            return jsonify({"error": "Clinic not found"}), 404
        clinic.name = name
        db.commit()
        return jsonify({"success": True, "clinic_name": clinic.name})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ── AI Chat ───────────────────────────────────────────────────────────────────

@app.route("/api/chat", methods=["POST"])
@verify_jwt
@require_role("doctor")
@limiter.limit("30 per minute")
def ai_chat():
    """
    POST /api/chat
    Body: { "message": "...", "patient_context": { ... } }
    Sends a message to Groq LLM with optional patient context.
    Requires GROQ_API_KEY in environment.
    """
    GROQ_API_KEY = os.getenv("GROQ_API_KEY")
    if not GROQ_API_KEY:
        return jsonify({"error": "AI features are not configured on this server. Set GROQ_API_KEY."}), 503

    data    = request.get_json() or {}
    message = data.get("message", "").strip()
    patient = data.get("patient_context") or {}

    if not message:
        return jsonify({"error": "message is required"}), 400

    try:
        from groq import Groq
        client = Groq(api_key=GROQ_API_KEY)

        if patient:
            system_prompt = f"""You are a concise medical AI assistant helping a doctor.
Patient information:
- Name: {patient.get('full_name', '')}
- Status: {patient.get('status', '')}
- Appointment: {patient.get('appointment', '')}
- Notes: {patient.get('notes', '')}

Rules:
- Answer ONLY what the doctor asked — nothing more
- Keep responses to 3-5 sentences maximum
- Do not add sections the doctor didn't ask for
- Do not use headers or bullet points unless specifically asked
- Be direct and clinical
- You assist the doctor, you do not replace them"""
        else:
            system_prompt = (
                "You are a concise medical AI assistant helping a doctor. "
                "Be direct and clinical. Keep responses to 3-5 sentences maximum."
            )

        resp = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            max_tokens=1000,
            messages=[
                {"role": "system",  "content": system_prompt},
                {"role": "user",    "content": "Doctor's Question: " + message},
            ],
        )
        return jsonify({"response": resp.choices[0].message.content})

    except Exception as e:
        return jsonify({"error": f"AI request failed: {str(e)}"}), 500


# ── Medical Reference ─────────────────────────────────────────────────────────

@app.route("/api/medical-reference", methods=["POST"])
@verify_jwt
@require_role("doctor")
@limiter.limit("30 per minute")
def medical_reference():
    """
    POST /api/medical-reference
    Body: { "question": "...", "category": "General" }
    Answers medical reference questions using Groq LLM.
    """
    GROQ_API_KEY = os.getenv("GROQ_API_KEY")
    if not GROQ_API_KEY:
        return jsonify({"error": "AI features are not configured on this server. Set GROQ_API_KEY."}), 503

    data     = request.get_json() or {}
    question = data.get("question", "").strip()
    category = data.get("category", "General")

    if not question:
        return jsonify({"error": "question is required"}), 400

    try:
        from groq import Groq
        client = Groq(api_key=GROQ_API_KEY)

        system_prompt = """You are a professional medical reference assistant for doctors.
You provide accurate, concise, and clinically relevant medical information.

Rules:
- Answer only medical and clinical questions
- Be concise but complete
- Use bullet points for lists
- Include dosages, contraindications, and interactions when relevant
- Always mention when something requires clinical judgment
- Never give advice to patients — you assist doctors only
- Respond in the same language the doctor writes in (French or English)"""

        resp = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            max_tokens=1000,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": f"Category: {category}\n\nQuestion: {question}"},
            ],
        )
        return jsonify({"success": True, "answer": resp.choices[0].message.content})

    except Exception as e:
        return jsonify({"error": f"AI request failed: {str(e)}"}), 500


# ── Voice Transcription ───────────────────────────────────────────────────────

@app.route("/api/transcribe", methods=["POST"])
@verify_jwt
@require_role("doctor")
@limiter.limit("20 per minute")
def transcribe_audio():
    """
    POST /api/transcribe (multipart/form-data, field: "file")
    Transcribes audio using Groq's Whisper API.
    Requires GROQ_API_KEY in environment.
    """
    GROQ_API_KEY = os.getenv("GROQ_API_KEY")
    if not GROQ_API_KEY:
        return jsonify({"error": "Transcription not configured. Set GROQ_API_KEY."}), 503

    if "file" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "No file selected"}), 400

    audio_data = file.read()
    if len(audio_data) > 25 * 1024 * 1024:
        return jsonify({"error": "Audio file too large (max 25MB)"}), 400
    if len(audio_data) == 0:
        return jsonify({"error": "Audio file is empty"}), 400

    filename = secure_filename(file.filename) or "audio.webm"

    try:
        from groq import Groq
        client = Groq(api_key=GROQ_API_KEY)

        # Groq Whisper API accepts file-like objects
        transcription = client.audio.transcriptions.create(
            model="whisper-large-v3-turbo",
            file=(filename, io.BytesIO(audio_data), file.content_type or "audio/webm"),
        )
        return jsonify({"success": True, "text": transcription.text})

    except Exception as e:
        return jsonify({"error": f"Transcription failed: {str(e)}"}), 500


# ── Analytics ─────────────────────────────────────────────────────────────────

@app.route("/api/analytics/overview", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def analytics_overview():
    """GET /api/analytics/overview — Summary stats for the clinic."""
    db = get_db()
    try:
        from sqlalchemy import func
        now   = datetime.utcnow()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        total_patients = db.query(func.count(Patient.id)).filter(
            Patient.clinic_id == g.clinic_id, Patient.deleted_at == None
        ).scalar() or 0

        new_this_month = db.query(func.count(Patient.id)).filter(
            Patient.clinic_id == g.clinic_id,
            Patient.deleted_at == None,
            Patient.created_at >= month_start,
        ).scalar() or 0

        appts_this_month = db.query(func.count(Appointment.id)).filter(
            Appointment.clinic_id == g.clinic_id,
            Appointment.date >= month_start.strftime("%Y-%m-%d"),
        ).scalar() or 0

        cancelled = db.query(func.count(Appointment.id)).filter(
            Appointment.clinic_id == g.clinic_id,
            Appointment.status == "cancelled",
        ).scalar() or 0

        return jsonify({
            "total_patients":            total_patients,
            "new_patients_this_month":   new_this_month,
            "appointments_this_month":   appts_this_month,
            "cancelled_appointments":    cancelled,
        })
    finally:
        db.close()


@app.route("/api/analytics/patient-growth", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def analytics_patient_growth():
    """GET /api/analytics/patient-growth — Monthly new patients for last 6 months."""
    db = get_db()
    try:
        from sqlalchemy import func, extract
        now = datetime.utcnow()
        result = []
        for i in range(5, -1, -1):
            month_date = (now.replace(day=1) - timedelta(days=i * 30)).replace(day=1)
            next_month = (month_date.replace(day=28) + timedelta(days=4)).replace(day=1)
            count = db.query(func.count(Patient.id)).filter(
                Patient.clinic_id == g.clinic_id,
                Patient.deleted_at == None,
                Patient.created_at >= month_date,
                Patient.created_at < next_month,
            ).scalar() or 0
            result.append({
                "month": month_date.strftime("%b %Y"),
                "count": count,
            })
        return jsonify(result)
    finally:
        db.close()


@app.route("/api/analytics/appointments-by-month", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def analytics_appointments_by_month():
    """GET /api/analytics/appointments-by-month — Monthly appointments for last 6 months."""
    db = get_db()
    try:
        from sqlalchemy import func
        now = datetime.utcnow()
        result = []
        for i in range(5, -1, -1):
            month_date = (now.replace(day=1) - timedelta(days=i * 30)).replace(day=1)
            next_month = (month_date.replace(day=28) + timedelta(days=4)).replace(day=1)
            count = db.query(func.count(Appointment.id)).filter(
                Appointment.clinic_id == g.clinic_id,
                Appointment.date >= month_date.strftime("%Y-%m-%d"),
                Appointment.date < next_month.strftime("%Y-%m-%d"),
            ).scalar() or 0
            result.append({
                "month": month_date.strftime("%b %Y"),
                "count": count,
            })
        return jsonify(result)
    finally:
        db.close()


@app.route("/api/analytics/status-distribution", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def analytics_status_distribution():
    """GET /api/analytics/status-distribution — Patient status breakdown."""
    db = get_db()
    try:
        from sqlalchemy import func
        rows = db.query(Patient.status, func.count(Patient.id)).filter(
            Patient.clinic_id == g.clinic_id,
            Patient.deleted_at == None,
        ).group_by(Patient.status).all()
        return jsonify([{"status": r[0] or "Unknown", "count": r[1]} for r in rows])
    finally:
        db.close()


@app.route("/api/analytics/appointment-status", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def analytics_appointment_status():
    """GET /api/analytics/appointment-status — Appointment status breakdown."""
    db = get_db()
    try:
        from sqlalchemy import func
        rows = db.query(Appointment.status, func.count(Appointment.id)).filter(
            Appointment.clinic_id == g.clinic_id,
        ).group_by(Appointment.status).all()
        return jsonify([{"status": r[0] or "Unknown", "count": r[1]} for r in rows])
    finally:
        db.close()


@app.route("/api/analytics/busiest-days", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def analytics_busiest_days():
    """GET /api/analytics/busiest-days — Appointment count by day of week."""
    db = get_db()
    try:
        from sqlalchemy import func
        rows = db.query(Appointment.date, func.count(Appointment.id)).filter(
            Appointment.clinic_id == g.clinic_id,
        ).group_by(Appointment.date).all()

        day_counts = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0}
        day_names  = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        for date_str, count in rows:
            try:
                d = datetime.strptime(date_str, "%Y-%m-%d")
                day_counts[d.weekday()] += count
            except Exception:
                pass
        return jsonify([{"day": day_names[i], "count": day_counts[i]} for i in range(7)])
    finally:
        db.close()


@app.route("/api/analytics/recent-activity", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def analytics_recent_activity():
    """GET /api/analytics/recent-activity — Last 10 audit log entries."""
    db = get_db()
    try:
        rows = db.query(AuditLog).filter(
            AuditLog.clinic_id == g.clinic_id,
        ).order_by(AuditLog.timestamp.desc()).limit(10).all()
        return jsonify([serialize(r) for r in rows])
    finally:
        db.close()


# ── Attachments ───────────────────────────────────────────────────────────────

@app.route("/api/patients/<int:patient_id>/attachments", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def list_attachments(patient_id):
    """GET /api/patients/{id}/attachments — List all attachments for a patient."""
    db = get_db()
    try:
        patient = db.query(Patient).filter_by(id=patient_id, clinic_id=g.clinic_id).first()
        if not patient:
            return jsonify({"error": "Patient not found"}), 404

        files = storage.list_files(g.clinic_id)
        # Filter to files belonging to this patient (prefixed with patient_id)
        prefix = f"p{patient_id}_"
        patient_files = [f for f in files if f.startswith(prefix)]
        attachments = []
        for fname in patient_files:
            display_name = fname[len(prefix):]  # strip the patient prefix
            attachments.append({
                "id":        fname,   # use filename as stable ID
                "file_name": display_name,
                "url":       storage.presigned_url(g.clinic_id, fname),
                "created_at": None,
            })
        return jsonify({"attachments": attachments})
    finally:
        db.close()


@app.route("/api/patients/<int:patient_id>/attachments", methods=["POST"])
@verify_jwt
@limiter.limit("20 per minute")
def upload_attachment(patient_id):
    """POST /api/patients/{id}/attachments — Upload a file for a patient."""
    db = get_db()
    try:
        patient = db.query(Patient).filter_by(id=patient_id, clinic_id=g.clinic_id).first()
        if not patient:
            return jsonify({"error": "Patient not found"}), 404

        if "file" not in request.files:
            return jsonify({"error": "No file provided"}), 400

        file = request.files["file"]
        if not file.filename:
            return jsonify({"error": "No file selected"}), 400

        file_data = file.read()
        if len(file_data) > MAX_FILE_SIZE:
            return jsonify({"error": f"File too large (max {MAX_FILE_SIZE // (1024*1024)}MB)"}), 400

        filename = secure_filename(file.filename)
        # Prefix with patient_id so we can filter by patient later
        stored_name = f"p{patient_id}_{filename}"

        try:
            url = storage.save(g.clinic_id, stored_name, io.BytesIO(file_data), file.content_type or "application/octet-stream")
        except ValueError as ve:
            return jsonify({"error": str(ve)}), 400

        attachment = {
            "id":        stored_name,
            "file_name": filename,
            "url":       url,
            "created_at": datetime.utcnow().isoformat(),
        }
        return jsonify({"success": True, "attachment": attachment}), 201

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/attachments/<path:file_id>", methods=["DELETE"])
@verify_jwt
@limiter.limit("30 per minute")
def delete_attachment(file_id):
    """DELETE /api/attachments/{file_id} — Delete an attachment."""
    deleted = storage.delete(g.clinic_id, file_id)
    if not deleted:
        return jsonify({"error": "File not found"}), 404
    return jsonify({"success": True})


@app.route("/api/attachments/<path:file_id>/open", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def open_attachment(file_id):
    """GET /api/attachments/{file_id}/open — Download/view an attachment."""
    data = storage.get(g.clinic_id, file_id)
    if data is None:
        return jsonify({"error": "File not found"}), 404
    # Determine content type from extension
    ext = file_id.rsplit(".", 1)[-1].lower() if "." in file_id else ""
    content_types = {
        "pdf": "application/pdf", "png": "image/png",
        "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "gif": "image/gif", "webp": "image/webp",
    }
    ct = content_types.get(ext, "application/octet-stream")
    return send_file(io.BytesIO(data), mimetype=ct, as_attachment=False)


# ── Custom Columns ────────────────────────────────────────────────────────────

@app.route("/api/columns", methods=["GET"])
@verify_jwt
@require_role("doctor")
@limiter.limit("60 per minute")
def get_columns():
    """GET /api/columns — List custom columns for the clinic."""
    db = get_db()
    try:
        from models import ClinicColumn
        cols = db.query(ClinicColumn).filter_by(clinic_id=g.clinic_id).order_by(ClinicColumn.created_at).all()
        # Always include default columns so PatientTable renders correctly
        defaults = [
            {"id": "default_full_name",   "column_name": "full_name",   "column_type": "text",   "is_default": True},
            {"id": "default_phone",       "column_name": "phone",       "column_type": "text",   "is_default": True},
            {"id": "default_appointment", "column_name": "appointment", "column_type": "text",   "is_default": True},
            {"id": "default_status",      "column_name": "status",      "column_type": "text",   "is_default": True},
            {"id": "default_notes",       "column_name": "notes",       "column_type": "text",   "is_default": True},
        ]
        custom = [{"id": c.id, "column_name": c.column_name, "column_type": c.column_type, "is_default": False} for c in cols]
        return jsonify({"columns": defaults + custom})
    finally:
        db.close()


@app.route("/api/columns", methods=["POST"])
@verify_jwt
@require_role("doctor")
@limiter.limit("20 per minute")
def create_column():
    """POST /api/columns — Add a custom column to the clinic."""
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    col_type = data.get("type", "text").strip()

    if not name:
        return jsonify({"error": "name is required"}), 400
    if col_type not in ("text", "number", "date", "boolean"):
        return jsonify({"error": "type must be text, number, date, or boolean"}), 400

    db = get_db()
    try:
        from models import ClinicColumn
        existing = db.query(ClinicColumn).filter_by(clinic_id=g.clinic_id, column_name=name).first()
        if existing:
            return jsonify({"error": f"Column '{name}' already exists"}), 409

        col = ClinicColumn(
            id=str(uuid.uuid4()),
            clinic_id=g.clinic_id,
            column_name=name,
            column_type=col_type,
        )
        db.add(col)
        db.commit()
        db.refresh(col)
        return jsonify({"success": True, "column": {"id": col.id, "column_name": col.column_name, "column_type": col.column_type, "is_default": False}}), 201
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@app.route("/api/columns/<column_id>", methods=["DELETE"])
@verify_jwt
@require_role("doctor")
@limiter.limit("20 per minute")
def delete_column(column_id):
    """DELETE /api/columns/{id} — Remove a custom column."""
    db = get_db()
    try:
        from models import ClinicColumn
        col = db.query(ClinicColumn).filter_by(id=column_id, clinic_id=g.clinic_id).first()
        if not col:
            return jsonify({"error": "Column not found"}), 404
        db.delete(col)
        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


# ── Boot ──────────────────────────────────────────────────────────────────────

# ── Production safety check — runs at module load (Gunicorn + direct) ─────────
_flask_env = os.getenv("FLASK_ENV", "production")
_is_production = _flask_env == "production"

import logging as _boot_logging
_boot_logger = _boot_logging.getLogger("startup")

if _flask_env == "test":
    _boot_logger.warning(
        "[SECURITY] FLASK_ENV=test — internal test endpoints are ENABLED. "
        "Never run with FLASK_ENV=test in production."
    )
elif _flask_env == "development":
    _boot_logger.warning(
        "[SECURITY] FLASK_ENV=development — debug mode may be active."
    )
else:
    _boot_logger.info("[SECURITY] FLASK_ENV=production — test endpoints disabled")

if __name__ == "__main__":
    from database import DATABASE_URL
    import logging
    
    logger = logging.getLogger("startup")
    logger.setLevel(logging.INFO)
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
    logger.addHandler(handler)
    
    # Log database connection info
    if DATABASE_URL.startswith("postgresql"):
        import re
        match = re.search(r'postgresql://[^:]+:[^@]+@([^/]+)', DATABASE_URL)
        if match:
            host_port = match.group(1)
            logger.info(f"[DB] Connected to PostgreSQL @ {host_port}")
        else:
            logger.info("[DB] Connected to PostgreSQL")
    else:
        logger.info(f"[DB] Connected to {DATABASE_URL.split(':')[0]}")
    
    # Initialize database
    init_db()
    logger.info("[DB] Schema initialized")
    
    # Start server
    socketio.run(app, debug=True, host="0.0.0.0", port=8000)