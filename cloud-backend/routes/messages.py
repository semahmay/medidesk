"""
routes/messages.py — Message endpoints.
"""

from flask import Blueprint, request, jsonify, g
from datetime import datetime

from core.db import get_db
from models import Message, Clinic
from services.auth_service import verify_jwt
from services.audit_service import audit, Actions
from services.notification_service import notify
from services.realtime_service import emit_to_clinic
from core.extensions import limiter
from validation import validation_error, get_json_body, require_fields, validate_string, validate_enum

bp = Blueprint("messages", __name__, url_prefix="/api/messages")


@bp.route("", methods=["GET"])
@verify_jwt
@limiter.limit("120 per minute")
def get_messages():
    from app import serialize
    db = get_db()
    try:
        limit = min(int(request.args.get("limit", 100)), 500)
        offset = max(int(request.args.get("offset", 0)), 0)
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


@bp.route("", methods=["POST"])
@verify_jwt
@limiter.limit("60 per minute")
def create_message():
    data, err = get_json_body()
    if err:
        return err

    text = data.get("text", "").strip()
    if not text or not isinstance(text, str):
        return validation_error("text is required and must be a string")

    db = get_db()
    try:
        clinic = db.query(Clinic).filter_by(id=g.clinic_id).first()
        if not clinic:
            return jsonify({"error": "Clinic not found", "code": "NOT_FOUND"}), 404

        message = Message(
            clinic_id=g.clinic_id,
            sender_role=g.role,
            text=text,
            is_task=data.get("is_task", False),
        )
        db.add(message)
        db.flush()

        audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
              action_type=Actions.SEND_MESSAGE, entity_type="message", entity_id=str(message.id))

        emit_to_clinic(g.clinic_id, "message_new", {
            "id": message.id, "clinic_id": g.clinic_id,
            "sender_role": g.role, "text": text,
            "is_task": message.is_task, "created_at": message.created_at.isoformat(),
        })

        db.commit()
        from app import serialize
        return jsonify({"success": True, "message": serialize(message)}), 201

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()


@bp.route("/<int:message_id>", methods=["PATCH"])
@verify_jwt
def update_message_status(message_id):
    data, err = get_json_body()
    if err:
        return err

    status = data.get("status")
    err = validate_enum(status, "status", ("pending", "done"))
    if err:
        return validation_error(err)

    db = get_db()
    try:
        msg = db.query(Message).filter_by(id=message_id, clinic_id=g.clinic_id).first()
        if not msg:
            return jsonify({"error": "Message not found", "code": "NOT_FOUND"}), 404

        msg.status = status
        db.commit()
        from app import serialize
        return jsonify({"success": True, "message": serialize(msg)})

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()
