"""
conftest.py — pytest fixtures for MediDesk AI backend tests.

Uses an in-memory SQLite database so tests run without PostgreSQL.
Redis is mocked via unittest.mock.
"""

import pytest
import uuid
from unittest.mock import MagicMock, patch

# ── Force SQLite in-memory for all tests ─────────────────────────────────────
import os
os.environ["DATABASE_URL"]    = "sqlite:///:memory:"
os.environ["REDIS_URL"]       = ""          # disable Redis in tests
os.environ["STORAGE_BACKEND"] = "local"
os.environ["JWT_SECRET"]      = "test-secret-do-not-use-in-production"
os.environ["FLASK_ENV"]       = "test"

# Import AFTER env vars are set
from app import app as flask_app
from database import Base, engine, init_db
from models import Clinic, User, Patient, Appointment, Message
from sqlalchemy.orm import sessionmaker
from auth_service import generate_access_token


@pytest.fixture(scope="session", autouse=True)
def create_tables():
    """Create all tables once per test session."""
    init_db()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session():
    """Provide a clean DB session per test, rolled back after each test."""
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.rollback()
    session.close()


@pytest.fixture
def client():
    """Flask test client."""
    flask_app.config["TESTING"] = True
    with flask_app.test_client() as c:
        yield c


def make_clinic(session, clinic_id=None, doctor_id=None):
    """Helper: create a clinic + doctor user and return (clinic, doctor, token)."""
    clinic_id  = clinic_id  or f"TEST-{uuid.uuid4().hex[:6].upper()}"
    doctor_id  = doctor_id  or f"doc_{uuid.uuid4().hex[:8]}"

    clinic = Clinic(id=clinic_id, doctor_user_id=doctor_id, name=f"Clinic {clinic_id}")
    doctor = User(
        id=doctor_id, name="Test Doctor", role="doctor",
        clinic_id=clinic_id, google_id=doctor_id, email=f"{doctor_id}@test.local",
    )
    session.add(clinic)
    session.add(doctor)
    session.commit()

    token = generate_access_token({"id": doctor_id, "role": "doctor", "clinic_id": clinic_id})
    return clinic, doctor, token


def make_secretary(session, clinic_id, name="sara"):
    """Helper: create an active secretary and return (user, token)."""
    from auth_service import hash_password
    sec_id = f"sec_{uuid.uuid4().hex[:8]}"
    user = User(
        id=sec_id, name=name, role="secretary",
        clinic_id=clinic_id, status="active",
        password_hash=hash_password("testpass123"),
    )
    session.add(user)
    session.commit()
    token = generate_access_token({"id": sec_id, "role": "secretary", "clinic_id": clinic_id})
    return user, token
