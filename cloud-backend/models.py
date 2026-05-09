from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from database import Base


def new_global_id():
    """Generate a new UUID4 global_id. Called as a server-side default."""
    return str(uuid.uuid4())


class Clinic(Base):
    __tablename__ = "clinics"

    id = Column(String, primary_key=True)           # e.g. MEDI-48291
    doctor_user_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    users = relationship("User", back_populates="clinic")
    patients = relationship("Patient", back_populates="clinic")
    messages = relationship("Message", back_populates="clinic")
    appointments = relationship("Appointment", back_populates="clinic")
    audit_logs = relationship("AuditLog", back_populates="clinic")
    notifications = relationship("Notification", back_populates="clinic")


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    role = Column(String, nullable=False)           # "doctor" or "secretary"
    clinic_id = Column(String, ForeignKey("clinics.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    google_id = Column(String, nullable=True, unique=True)
    email = Column(String, nullable=True)
    password_hash = Column(String, nullable=True)

    status = Column(String, nullable=True, default="invited")
    invited_at = Column(DateTime, nullable=True)
    activated_at = Column(DateTime, nullable=True)

    clinic = relationship("Clinic", back_populates="users")


class Patient(Base):
    __tablename__ = "patients"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # global_id is the universal identity key — generated on creation, never changes
    global_id = Column(String, unique=True, nullable=True, default=new_global_id)
    clinic_id = Column(String, ForeignKey("clinics.id"), nullable=False)
    full_name = Column(String, nullable=False)
    phone = Column(String)
    email = Column(String)
    notes = Column(Text)
    appointment = Column(String)
    status = Column(String, default="Active")
    updated_by = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime, nullable=True)
    # version is the clock-skew-safe conflict key.
    # Incremented by the SERVER on every write — never trusted from client.
    # Client sends back the version it last saw; server rejects if it has moved on.
    version = Column(Integer, nullable=False, default=0)

    clinic = relationship("Clinic", back_populates="patients")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    clinic_id = Column(String, ForeignKey("clinics.id"), nullable=False)
    sender_role = Column(String, nullable=False)
    text = Column(Text, nullable=False)
    is_task = Column(Boolean, default=False)
    status = Column(String, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)

    clinic = relationship("Clinic", back_populates="messages")


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # global_id is the universal identity key — generated on creation, never changes
    global_id = Column(String, unique=True, nullable=True, default=new_global_id)
    clinic_id = Column(String, ForeignKey("clinics.id"), nullable=False)
    patient_id = Column(Integer, nullable=True)
    patient_name = Column(String, nullable=False)
    date = Column(String, nullable=False)
    start_time = Column(String, nullable=False)
    end_time = Column(String, nullable=False)
    status = Column(String, nullable=False, default="scheduled")
    notes = Column(Text, nullable=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    clinic = relationship("Clinic", back_populates="appointments")


# ── Audit Log ─────────────────────────────────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    clinic_id = Column(String, ForeignKey("clinics.id"), nullable=False)
    user_id = Column(String, nullable=True)         # JWT sub — null for system events
    user_role = Column(String, nullable=True)       # "doctor" | "secretary"
    action_type = Column(String, nullable=False)    # e.g. CREATE_PATIENT, DELETE_APPOINTMENT
    entity_type = Column(String, nullable=True)     # "patient" | "appointment" | "auth"
    entity_id = Column(String, nullable=True)       # global_id of the affected record
    metadata_json = Column(Text, nullable=True)     # JSON string with extra context
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)

    clinic = relationship("Clinic", back_populates="audit_logs")


# ── Notification ──────────────────────────────────────────────────────────────

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    clinic_id = Column(String, ForeignKey("clinics.id"), nullable=False)
    # "doctor" | "secretary" | "all"
    target_role = Column(String, nullable=False, default="all")
    type = Column(String, nullable=False)           # "appointment" | "patient" | "message" | "system"
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    clinic = relationship("Clinic", back_populates="notifications")


# ── Revoked Tokens ────────────────────────────────────────────────────────────

class RevokedToken(Base):
    """
    Stores revoked JWT IDs (jti). Checked on every authenticated request.
    Rows are cleaned up automatically when the token's natural expiry passes.
    """
    __tablename__ = "revoked_tokens"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    jti        = Column(String, unique=True, nullable=False, index=True)
    user_id    = Column(String, nullable=False, index=True)   # JWT sub
    revoked_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)             # natural token expiry
