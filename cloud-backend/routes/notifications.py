"""
routes/notifications.py — Notification endpoints.
"""

from flask import Blueprint, request, jsonify, g

from core.db import get_db
from models import Notification
from services.auth_service import verify_jwt
from core.extensions import limiter

bp = Blueprint("notifications", __name__, url_prefix="/api/notifications")


@bp.route("", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def get_notifications():
    db = get_db()
    try:
        unread_only = request.args.get("unread_only", "").lower() == "true"
        query = db.query(Notification).filter(
            Notification.clinic_id == g.clinic_id,
            Notification.target_role.in_(["all", g.role]),
        )
        if unread_only:
            query = query.filter(Notification.is_read == False)
        notifications = query.order_by(Notification.created_at.desc()).limit(100).all()

        unread_count = db.query(Notification).filter(
            Notification.clinic_id == g.clinic_id,
            Notification.target_role.in_(["all", g.role]),
            Notification.is_read == False,
        ).count()

        from app import serialize
        return jsonify({
            "notifications": [serialize(n) for n in notifications],
            "unread_count": unread_count,
        })
    finally:
        db.close()


@bp.route("/<int:notif_id>/read", methods=["PATCH"])
@verify_jwt
def mark_notification_read(notif_id):
    db = get_db()
    try:
        notif = db.query(Notification).filter_by(id=notif_id, clinic_id=g.clinic_id).first()
        if not notif:
            return jsonify({"error": "Notification not found", "code": "NOT_FOUND"}), 404

        notif.is_read = True
        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()


@bp.route("/read-all", methods=["PATCH"])
@verify_jwt
def mark_all_notifications_read():
    db = get_db()
    try:
        db.query(Notification).filter(
            Notification.clinic_id == g.clinic_id,
            Notification.target_role.in_(["all", g.role]),
            Notification.is_read == False,
        ).update({"is_read": True})
        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()
