"""
routes/auth.py — Authentication endpoints (public, no JWT).
"""

from flask import Blueprint, request, jsonify, g
import requests as http_requests
import os
import uuid
from datetime import datetime, timedelta
from sqlalchemy import text

from core.db import get_db
from models import Clinic, User, RevokedToken
from services.auth_service import (
    generate_access_token, generate_refresh_token,
    refresh_access_token, verify_jwt, require_role,
    hash_password, check_password, verify_token, _log,
    REFRESH_TOKEN_EXPIRE_DAYS,
)
from services.audit_service import audit, Actions
from core.extensions import limiter
from utils import generate_clinic_id
from validation import validation_error, get_json_body, require_fields, validate_string, validate_enum

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@bp.route("/google", methods=["POST"])
@limiter.limit("20 per minute")
def auth_google():
    from services.observability import _report_to_sentry
    data, err = get_json_body()
    if err:
        return err

    google_token = data.get("google_token")
    if not google_token or not isinstance(google_token, str):
        return validation_error("google_token is required and must be a string")

    try:
        resp = http_requests.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {google_token}"},
            timeout=10,
        )
        if resp.status_code != 200:
            return jsonify({"error": "Invalid Google token", "code": "UNAUTHORIZED"}), 401
        google_user = resp.json()
    except Exception as e:
        return jsonify({"error": f"Google verification failed: {str(e)}", "code": "INTERNAL_ERROR"}), 500

    google_id = google_user.get("id")
    email = google_user.get("email")
    name = google_user.get("name", email)

    if not google_id:
        return jsonify({"error": "Could not retrieve Google user ID", "code": "VALIDATION_ERROR"}), 400

    db = get_db()
    try:
        user = db.query(User).filter_by(google_id=google_id).first()

        if not user:
            clinic = db.query(Clinic).filter_by(doctor_user_id=google_id).first()
            if clinic:
                user = db.query(User).filter_by(id=google_id, clinic_id=clinic.id).first()
                if user:
                    user.google_id = google_id
                    user.email = email
                    db.commit()

        if not user:
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
            user.name = name
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
            "access_token": generate_access_token(user_dict),
            "refresh_token": generate_refresh_token(user_dict),
            "user": user_dict,
            "clinic_id": user.clinic_id,
        })

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()


@bp.route("/secretary/check", methods=["POST"])
def secretary_check():
    data, err = get_json_body()
    if err:
        return err

    missing = require_fields(data, "clinic_id", "name")
    if missing:
        return validation_error(f"{missing} is required")

    clinic_id = data.get("clinic_id", "").strip()
    name = data.get("name", "").strip().lower()

    db = get_db()
    try:
        user = (
            db.query(User)
            .filter_by(clinic_id=clinic_id, name=name, role="secretary")
            .first()
        )
        if not user:
            return jsonify({"status": "not_found"})

        effective_status = user.status or ("active" if user.password_hash else "invited")
        return jsonify({"status": effective_status})
    finally:
        db.close()


@bp.route("/secretary/set-password", methods=["POST"])
@limiter.limit("10 per minute")
def secretary_set_password():
    data, err = get_json_body()
    if err:
        return err

    missing = require_fields(data, "clinic_id", "name", "password")
    if missing:
        return validation_error(f"{missing} is required")

    clinic_id = data.get("clinic_id", "").strip()
    name = data.get("name", "").strip().lower()
    password = data.get("password", "")

    if not isinstance(password, str):
        return validation_error("password must be a string")
    if len(password) < 6:
        return validation_error("Password must be at least 6 characters")

    db = get_db()
    try:
        user = (
            db.query(User)
            .filter_by(clinic_id=clinic_id, name=name, role="secretary")
            .first()
        )
        if not user:
            return jsonify({"error": "Secretary not found", "code": "NOT_FOUND"}), 404
        if user.status != "invited":
            return jsonify({"error": "Secretary is already activated", "code": "CONFLICT"}), 409

        user.password_hash = hash_password(password)
        user.status = "active"
        user.activated_at = datetime.utcnow()
        db.commit()

        audit(db, clinic_id=clinic_id, user_id=user.id, user_role="secretary",
              action_type=Actions.SECRETARY_ACTIVATED, entity_type="auth", entity_id=user.id)

        return jsonify({"success": True, "message": "Password set successfully"})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()


@bp.route("/secretary/login", methods=["POST"])
@limiter.limit("5 per minute")
def secretary_login():
    data, err = get_json_body()
    if err:
        return err

    missing = require_fields(data, "clinic_id", "name", "password")
    if missing:
        return validation_error(f"{missing} is required")

    clinic_id = data.get("clinic_id", "").strip().upper()
    name = data.get("name", "").strip().lower()
    password = data.get("password", "")

    if not isinstance(password, str):
        return validation_error("password must be a string")

    db = get_db()
    try:
        user = (
            db.query(User)
            .filter_by(clinic_id=clinic_id, name=name, role="secretary")
            .first()
        )
        if not user:
            return jsonify({"error": "Invalid credentials", "code": "UNAUTHORIZED"}), 401

        effective_status = user.status or ("active" if user.password_hash else "invited")
        if effective_status != "active":
            return jsonify({"error": "Account is not active", "code": "FORBIDDEN"}), 403

        if not user.password_hash or not check_password(password, user.password_hash):
            audit(db, clinic_id=clinic_id, user_id=user.id, user_role="secretary",
                  action_type=Actions.SECRETARY_LOGIN_FAIL, entity_type="auth", entity_id=user.id)
            return jsonify({"error": "Invalid credentials", "code": "UNAUTHORIZED"}), 401

        audit(db, clinic_id=clinic_id, user_id=user.id, user_role="secretary",
              action_type=Actions.SECRETARY_LOGIN, entity_type="auth", entity_id=user.id)

        return jsonify({
            "access_token": generate_access_token({"id": user.id, "role": "secretary", "clinic_id": clinic_id}),
            "refresh_token": generate_refresh_token({"id": user.id, "role": "secretary", "clinic_id": clinic_id}),
            "clinic_id": clinic_id,
        })
    finally:
        db.close()


@bp.route("/refresh", methods=["POST"])
@limiter.limit("30 per minute")
def auth_refresh():
    data, err = get_json_body()
    if err:
        return err

    refresh_token = data.get("refresh_token")
    if not refresh_token or not isinstance(refresh_token, str):
        return validation_error("refresh_token is required and must be a string")

    new_access, new_refresh = refresh_access_token(refresh_token)
    if not new_access:
        return jsonify({"error": "Invalid or expired refresh token", "code": "UNAUTHORIZED"}), 401

    return jsonify({"access_token": new_access, "refresh_token": new_refresh})


@bp.route("/revoke", methods=["POST"])
@verify_jwt
@require_role("doctor")
@limiter.limit("20 per minute")
def revoke_user_tokens():
    data, err = get_json_body()
    if err:
        return err

    user_id = data.get("user_id", "").strip()
    if not user_id or not isinstance(user_id, str):
        return validation_error("user_id is required and must be a string")

    db = get_db()
    try:
        from models import User as UserModel, RevokedToken
        target = db.query(UserModel).filter_by(id=user_id, clinic_id=g.clinic_id).first()
        if not target:
            return jsonify({"error": "User not found in your clinic", "code": "NOT_FOUND"}), 404

        revoke_entry = RevokedToken(
            id=str(uuid.uuid4()),
            jti=f"user:{user_id}",
            user_id=user_id,
            revoked_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        )
        db.add(revoke_entry)
        db.commit()

        _log("tokens_revoked", user_id=user_id, role=target.role, clinic_id=g.clinic_id)
        return jsonify({"success": True, "message": f"All tokens revoked for user {user_id}"})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()
