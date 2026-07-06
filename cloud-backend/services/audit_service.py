"""
audit_service.py
Fire-and-forget audit logging.

Usage:
    from audit_service import audit
    audit(db, clinic_id=g.clinic_id, user_id=g.user_id, user_role=g.role,
          action_type="CREATE_PATIENT", entity_type="patient", entity_id=patient.global_id,
          metadata={"full_name": patient.full_name})

Rules:
- NEVER raises — all exceptions are swallowed so audit never blocks main execution.
- metadata must be JSON-serialisable dict or None.
"""

import json
import logging
from datetime import datetime
from models import AuditLog

logger = logging.getLogger("audit")


# ── Action type constants ─────────────────────────────────────────────────────

class Actions:
    # Patients
    CREATE_PATIENT  = "CREATE_PATIENT"
    UPDATE_PATIENT  = "UPDATE_PATIENT"
    DELETE_PATIENT  = "DELETE_PATIENT"

    # Appointments
    CREATE_APPOINTMENT  = "CREATE_APPOINTMENT"
    UPDATE_APPOINTMENT  = "UPDATE_APPOINTMENT"
    CANCEL_APPOINTMENT  = "CANCEL_APPOINTMENT"
    DELETE_APPOINTMENT  = "DELETE_APPOINTMENT"

    # Auth
    DOCTOR_LOGIN        = "DOCTOR_LOGIN"
    SECRETARY_LOGIN     = "SECRETARY_LOGIN"
    SECRETARY_LOGIN_FAIL = "SECRETARY_LOGIN_FAIL"
    SECRETARY_ACTIVATED = "SECRETARY_ACTIVATED"
    LOGOUT              = "LOGOUT"

    # Messages
    SEND_MESSAGE        = "SEND_MESSAGE"


def audit(
    db,
    *,
    clinic_id: str,
    action_type: str,
    user_id: str = None,
    user_role: str = None,
    entity_type: str = None,
    entity_id: str = None,
    metadata: dict = None,
):
    """
    Write one audit log entry. Never raises.
    db must be an open SQLAlchemy session — caller owns commit/close.
    """
    try:
        entry = AuditLog(
            clinic_id     = clinic_id,
            user_id       = user_id,
            user_role     = user_role,
            action_type   = action_type,
            entity_type   = entity_type,
            entity_id     = str(entity_id) if entity_id is not None else None,
            metadata_json = json.dumps(metadata) if metadata else None,
            timestamp     = datetime.utcnow(),
        )
        db.add(entry)
        # We do NOT commit here — the caller's commit covers this entry.
        # If the caller rolls back, the audit entry is also rolled back (correct behaviour).
        logger.info(
            f"[AUDIT] {action_type} | clinic={clinic_id} | user={user_id}({user_role}) "
            f"| entity={entity_type}:{entity_id}"
        )
    except Exception as exc:
        # Audit must never crash the main flow
        logger.error(f"[AUDIT] Failed to write audit log: {exc}")
