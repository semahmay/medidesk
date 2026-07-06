"""
auth_service.py — Backward-compatible wrapper.
Logic moved to services/auth_service.py. Re-exports for existing imports.
"""
from services.auth_service import (
    JWT_SECRET, JWT_ALGORITHM, ACCESS_TOKEN_EXPIRE_HOURS, REFRESH_TOKEN_EXPIRE_DAYS,
    generate_access_token, generate_refresh_token, verify_token,
    refresh_access_token, hash_password, check_password, verify_jwt, require_role,
)
