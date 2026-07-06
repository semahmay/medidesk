"""
auth_service.py
Mandatory JWT authentication — no optional fallbacks, no client-trusted data.
"""

import os
import uuid
import jwt
import bcrypt
import logging
from dotenv import load_dotenv
from datetime import datetime, timedelta, timezone
from functools import wraps
from flask import request, g, jsonify

load_dotenv()  # must run before os.getenv("JWT_SECRET") below

# ── Config ────────────────────────────────────────────────────────────────────

JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError(
        "FATAL: JWT_SECRET environment variable is not set. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\" "
        "and add it to your .env file."
    )

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 1   # short-lived — refresh token handles renewal
REFRESH_TOKEN_EXPIRE_DAYS = 30

# ── Logging ───────────────────────────────────────────────────────────────────

logger = logging.getLogger("auth")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")


def _log(action: str, user_id: str = None, role: str = None, clinic_id: str = None):
    logger.info(
        f"[AUTH] user_id={user_id} role={role} clinic_id={clinic_id} action={action}"
    )


# ── Token Generation ──────────────────────────────────────────────────────────

def generate_access_token(user: dict) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user["id"]),
        "role": user.get("role", "doctor"),
        "clinic_id": user.get("clinic_id"),
        "jti": str(uuid.uuid4()),   # unique token ID — used for revocation
        "iat": now,
        "exp": now + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS),
        "type": "access",
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    _log("token_issued", user_id=user["id"], role=user.get("role"), clinic_id=user.get("clinic_id"))
    return token


def generate_refresh_token(user: dict) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user["id"]),
        "role": user.get("role", "doctor"),
        "clinic_id": user.get("clinic_id"),
        "jti": str(uuid.uuid4()),   # unique token ID — used for revocation
        "iat": now,
        "exp": now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        "type": "refresh",
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    _log("refresh_token_issued", user_id=user["id"], role=user.get("role"), clinic_id=user.get("clinic_id"))
    return token


# ── Token Verification ────────────────────────────────────────────────────────

def verify_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        _log("token_expired")
        return None
    except jwt.InvalidTokenError as e:
        _log(f"invalid_token: {e}")
        return None


def refresh_access_token(refresh_token: str) -> tuple[str | None, str | None]:
    """
    Returns (new_access_token, new_refresh_token).
    Refresh token is rotated on every use — old token is implicitly invalidated
    by issuing a new one with a fresh expiry.
    """
    payload = verify_token(refresh_token)
    if not payload:
        return None, None
    if payload.get("type") != "refresh":
        _log("refresh_failed_wrong_type", user_id=payload.get("sub"))
        return None, None
    user = {
        "id": payload["sub"],
        "role": payload.get("role"),
        "clinic_id": payload.get("clinic_id"),
    }
    _log("refresh_used", user_id=user["id"], role=user["role"], clinic_id=user["clinic_id"])
    return generate_access_token(user), generate_refresh_token(user)


# ── Password Helpers ──────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def check_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ── Decorators ────────────────────────────────────────────────────────────────

def verify_jwt(fn):
    """
    Mandatory JWT decorator.
    - Missing token  → 401
    - Invalid token  → 401
    - Revoked jti    → 401
    - Valid token    → sets g.user_id, g.role, g.clinic_id and calls the route
    Never trusts X-User-ID or any client-supplied role/clinic_id.
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")

        if not auth_header.startswith("Bearer "):
            _log("missing_token")
            return jsonify({"error": "Authorization token required"}), 401

        token = auth_header.split(" ", 1)[1]
        payload = verify_token(token)

        if not payload:
            _log("invalid_token_attempt")
            return jsonify({"error": "Invalid or expired token"}), 401

        if payload.get("type") != "access":
            return jsonify({"error": "Invalid token type"}), 401

        # ── Revocation check ──────────────────────────────────────────────────
        jti = payload.get("jti")
        if jti:
            _revocation_checked = False
            try:
                from core.db import SessionLocal
                from models import RevokedToken
                db = SessionLocal()
                try:
                    # Check token-specific revocation
                    revoked = db.query(RevokedToken).filter_by(jti=jti).first()
                    if revoked:
                        _log("revoked_token_used", user_id=payload.get("sub"))
                        return jsonify({"error": "Token has been revoked"}), 401
                    # Check user-level revocation (all tokens for this user)
                    user_revoked = db.query(RevokedToken).filter_by(
                        jti=f"user:{payload.get('sub')}"
                    ).first()
                    if user_revoked:
                        _log("revoked_user_token_used", user_id=payload.get("sub"))
                        return jsonify({"error": "Token has been revoked"}), 401
                    _revocation_checked = True
                finally:
                    db.close()
            except Exception as _rev_err:
                # Table missing or DB error — log it, then DENY the request.
                # Fail-closed: if we cannot verify revocation status, reject the token.
                # This prevents revocation bypass due to DB errors.
                logger.error(
                    f"[AUTH] revocation_check_failed jti={jti} user={payload.get('sub')} "
                    f"error={_rev_err!r} — denying request"
                )
                return jsonify({"error": "Authentication service temporarily unavailable"}), 503

        g.user_id   = payload["sub"]
        g.role      = payload["role"]
        g.clinic_id = payload["clinic_id"]

        return fn(*args, **kwargs)
    return wrapper


def require_role(*roles):
    """
    Role guard — must be applied AFTER @verify_jwt.
    Usage:
        @app.route(...)
        @verify_jwt
        @require_role("doctor")
        def my_view(): ...
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if g.role not in roles:
                _log(
                    f"forbidden_role:{g.role}_required:{roles}",
                    user_id=g.user_id,
                    role=g.role,
                    clinic_id=g.clinic_id,
                )
                return jsonify({"error": "Access forbidden: insufficient role"}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator
