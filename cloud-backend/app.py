"""
app.py — Minimal Flask bootstrap.
All business logic in routes/ and services/.
"""
import eventlet; eventlet.monkey_patch()

from dotenv import load_dotenv; load_dotenv()

from flask import Flask, jsonify, g, request
from datetime import datetime, date as Date, time as Time
from core.db import init_db
from core.config import REDIS_URL
from core.extensions import limiter, init_extensions, get_allowed_origins
from core.serializer import serialize
from services.realtime_service import socketio
from services.observability import setup_observability

app = Flask(__name__)

init_extensions(app)

socketio.init_app(
    app,
    cors_allowed_origins=get_allowed_origins(),
    message_queue=REDIS_URL,
    async_mode="eventlet",
)

setup_observability(app)
init_db()

# ── Error response helper ───────────────────────────────────────────────────
def error_response(message, code="UNKNOWN_ERROR", status_code=400):
    return jsonify({"error": message, "code": code}), status_code

# ── Rate limit key function, used by limiter ────────────────────────────────
from flask_limiter.util import get_remote_address
def _rate_limit_key():
    user_id = getattr(g, "user_id", None)
    if user_id:
        return f"user:{user_id}"
    return get_remote_address()

limiter.key_func = _rate_limit_key

# ── Global error handlers ───────────────────────────────────────────────────
@app.errorhandler(429)
def rate_limit_exceeded(e):
    return jsonify({"error": "rate_limit_exceeded", "message": "Too many requests, please slow down"}), 429

@app.errorhandler(404)
def not_found_error(e):
    return error_response("Not found", "NOT_FOUND", 404)

@app.errorhandler(405)
def method_not_allowed_error(e):
    return error_response("Method not allowed", "METHOD_NOT_ALLOWED", 405)

@app.errorhandler(500)
def internal_server_error(e):
    return error_response("Internal server error", "INTERNAL_ERROR", 500)

# ── Register blueprints ─────────────────────────────────────────────────────
from routes.auth import bp as auth_bp
from routes.patients import bp as patients_bp
from routes.appointments import bp as appointments_bp
from routes.clinic import bp as clinic_bp
from routes.messages import bp as messages_bp
from routes.notifications import bp as notifications_bp
from routes.columns import bp as columns_bp
from routes.medical import bp as medical_bp
from routes.attachments import bp as attachments_bp
from routes.internal import bp as internal_bp

app.register_blueprint(auth_bp)
app.register_blueprint(patients_bp)
app.register_blueprint(appointments_bp)
app.register_blueprint(clinic_bp)
app.register_blueprint(messages_bp)
app.register_blueprint(notifications_bp)
app.register_blueprint(columns_bp)
app.register_blueprint(medical_bp)
app.register_blueprint(attachments_bp)
app.register_blueprint(internal_bp)

# ── Boot ────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import logging
    from core.config import DATABASE_URL
    logger = logging.getLogger("startup")
    logger.setLevel(logging.INFO)
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
    logger.addHandler(handler)

    if DATABASE_URL.startswith("postgresql"):
        import re
        match = re.search(r'postgresql://[^:]+:[^@]+@([^/]+)', DATABASE_URL)
        logger.info(f"[DB] Connected to PostgreSQL @ {match.group(1)}" if match else "[DB] Connected to PostgreSQL")

    socketio.run(app, debug=False, host="0.0.0.0", port=8000)
