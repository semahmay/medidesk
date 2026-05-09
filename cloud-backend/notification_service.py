"""
notification_service.py
Fire-and-forget notification creation.

Usage:
    from notification_service import notify
    notify(db, clinic_id=g.clinic_id,
           type="appointment", target_role="all",
           title="New appointment", message="Sara booked Ahmed at 10:00")

Rules:
- NEVER raises — swallows all exceptions.
- target_role: "doctor" | "secretary" | "all"
"""

import logging
from datetime import datetime
from models import Notification

logger = logging.getLogger("notify")


def notify(
    db,
    *,
    clinic_id: str,
    type: str,
    title: str,
    message: str,
    target_role: str = "all",
):
    """
    Create a notification. Never raises.
    db must be an open SQLAlchemy session — caller owns commit/close.
    """
    try:
        n = Notification(
            clinic_id   = clinic_id,
            type        = type,
            title       = title,
            message     = message,
            target_role = target_role,
            is_read     = False,
            created_at  = datetime.utcnow(),
        )
        db.add(n)
        logger.info(f"[NOTIFY] {type} → {target_role} | clinic={clinic_id} | {title}")
    except Exception as exc:
        logger.error(f"[NOTIFY] Failed to create notification: {exc}")
