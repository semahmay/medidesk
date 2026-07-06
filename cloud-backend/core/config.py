"""
core/config.py — All configuration from environment, validated at startup.
"""

import os
from dotenv import load_dotenv

load_dotenv()


def _fail(name):
    raise RuntimeError(
        f"FATAL: {name} environment variable is not set. "
        f"Add it to your .env file."
    )


# ── Flask ──────────────────────────────────────────────────────────────────────
FLASK_ENV = os.getenv("FLASK_ENV", "production")
IS_PRODUCTION = FLASK_ENV == "production"
IS_TEST = FLASK_ENV == "test"

# ── Database ───────────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL or not DATABASE_URL.startswith("postgresql"):
    _fail("DATABASE_URL")

# ── Redis ──────────────────────────────────────────────────────────────────────
REDIS_URL = os.getenv("REDIS_URL")

# ── CORS ───────────────────────────────────────────────────────────────────────
RAW_ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "").strip()


def parse_allowed_origins():
    """Parse ALLOWED_ORIGINS into a list."""
    raw = RAW_ALLOWED_ORIGINS
    if not raw:
        if IS_PRODUCTION:
            import logging as _logging
            _logging.getLogger("cors").critical(
                "[CORS] FATAL: ALLOWED_ORIGINS not set in production."
            )
            _fail("ALLOWED_ORIGINS")
        import logging as _logging
        _logging.getLogger("cors").warning(
            "[CORS] ALLOWED_ORIGINS not set — defaulting to localhost + file://."
        )
        return ["file://", "http://localhost", "http://localhost:3000", "http://127.0.0.1"]
    if raw == "*":
        return "*"
    return [o.strip() for o in raw.split(",") if o.strip()]


# ── JWT ────────────────────────────────────────────────────────────────────────
# Validated inside services/auth_service.py

# ── Storage ────────────────────────────────────────────────────────────────────
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local")

# ── Sentry / Observability ─────────────────────────────────────────────────────
SENTRY_DSN = os.getenv("SENTRY_DSN", "").strip()
SENTRY_TRACES_SAMPLE_RATE = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1"))
APP_VERSION = os.getenv("APP_VERSION", "1.0.0")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
