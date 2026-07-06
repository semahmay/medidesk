"""
core/extensions.py — Centralized Flask extension instances.
Import these in app.py to attach to the app.
"""

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_cors import CORS
from flask import g
from core.config import REDIS_URL, parse_allowed_origins


def _rate_limit_key():
    user_id = getattr(g, "user_id", None)
    if user_id:
        return f"user:{user_id}"
    return get_remote_address()


limiter_storage = REDIS_URL if REDIS_URL else "memory://"

limiter = Limiter(
    key_func=_rate_limit_key,
    default_limits=[],
    storage_uri=limiter_storage,
)

_allowed_origins = None

def get_allowed_origins():
    global _allowed_origins
    if _allowed_origins is None:
        _allowed_origins = parse_allowed_origins()
    return _allowed_origins


def init_extensions(app):
    """Attach all shared extensions to the Flask app."""
    origins = get_allowed_origins()
    CORS(app, resources={
        r"/api/*": {"origins": origins},
        r"/ws/*":  {"origins": origins},
    })
    limiter.init_app(app)
