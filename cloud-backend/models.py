from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Text, Date, Time
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from database import Base


def new_global_id():
    """Generate a new UUID4 global_id. Called as a server-side default."""
    return str(uuid.uuid4())


class Clinic(Base):
    __tablename__ = "clinics"

    id = Column(String, primary_key=True)
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
    name = Column(String(255), nullable=False)
    role = Column(String(10), nullable=False)
    clinic_id = Column(String, ForeignKey("clinics.id", ondelete="RESTRICT"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    google_id = Column(String, nullable=True, unique=True)
    email = Column(String(255), nullable=True)
    password_hash = Column(String, nullable=True)

    status = Column(String(10), nullable=True, default="invited")
    invited_at = Column(DateTime, nullable=True)
    activated_at = Column(DateTime, nullable=True)

    clinic = relationship("Clinic", back_populates="users")


class Patient(Base):
    __tablename__ = "patients"

    id = Column(Integer, primary_key=True, autoincrement=True)
    global_id = Column(String, unique=True, nullable=False, default=new_global_id)
    clinic_id = Column(String, ForeignKey("clinics.id", ondelete="RESTRICT"), nullable=False)
    full_name = Column(String(255), nullable=False)
    phone = Column(String(30))
    email = Column(String(255))
    notes = Column(Text)
    appointment = Column(String)
    status = Column(String(20), default="Active")
    updated_by = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime, nullable=True)
    version = Column(Integer, nullable=False, default=0)
    custom_fields = Column(JSONB, nullable=True)

    clinic = relationship("Clinic", back_populates="patients")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    clinic_id = Column(String, ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False)
    sender_role = Column(String, nullable=False)
    text = Column(Text, nullable=False)
    is_task = Column(Boolean, default=False)
    status = Column(String, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)

    clinic = relationship("Clinic", back_populates="messages")


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    global_id = Column(String, unique=True, nullable=False, default=new_global_id)
    clinic_id = Column(String, ForeignKey("clinics.id", ondelete="RESTRICT"), nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id", ondelete="SET NULL"), nullable=True)
    patient_name = Column(String(255), nullable=False)
    date = Column(Date, nullable=False)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    status = Column(String(20), nullable=False, default="scheduled")
    notes = Column(Text, nullable=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    clinic = relationship("Clinic", back_populates="appointments")
    patient = relationship("Patient", foreign_keys=[patient_id])  # For joinedload optimization


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    clinic_id = Column(String, ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, nullable=True)
    user_role = Column(String, nullable=True)
    action_type = Column(String, nullable=False)
    entity_type = Column(String, nullable=True)
    entity_id = Column(String, nullable=True)
    metadata_json = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)

    clinic = relationship("Clinic", back_populates="audit_logs")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    clinic_id = Column(String, ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False)
    target_role = Column(String, nullable=False, default="all")
    actor_role = Column(String, nullable=True)
    actor_name = Column(String, nullable=True)
    type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    clinic = relationship("Clinic", back_populates="notifications")


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    jti = Column(String, unique=True, nullable=False, index=True)
    user_id = Column(String, nullable=False, index=True)
    revoked_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)


class ClinicColumn(Base):
    __tablename__ = "clinic_columns"

    id = Column(String, primary_key=True)
    clinic_id = Column(String, ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False, index=True)
    column_name = Column(String(255), nullable=False)
    column_type = Column(String(10), nullable=False, default="text")
    created_at = Column(DateTime, default=datetime.utcnow)
