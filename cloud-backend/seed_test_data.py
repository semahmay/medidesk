#!/usr/bin/env python3
"""
seed_test_data.py — Create test clinic with doctor and secretaries for stress testing.
"""

from database import init_db, SessionLocal
from models import Clinic, User
from auth_service import hash_password
from utils import generate_clinic_id
import uuid

def seed():
    db = SessionLocal()
    try:
        # Create clinic
        from utils import generate_clinic_id
        clinic_id = generate_clinic_id(db)
        clinic = Clinic(
            id=clinic_id,
            doctor_user_id=str(uuid.uuid4()),
            name="Test Clinic"
        )
        db.add(clinic)

        # Create doctor
        doctor = User(
            id=clinic.doctor_user_id,
            name="Dr. Test",
            role="doctor",
            clinic_id=clinic_id,
            google_id="test_google_id",
            email="doctor@test.com",
            status="active"
        )
        db.add(doctor)

        # Create secretaries
        for i in range(3):
            secretary = User(
                id=str(uuid.uuid4()),
                name=f"secretary {i+1}",
                role="secretary",
                clinic_id=clinic_id,
                password_hash=hash_password("password123"),
                status="active"
            )
            db.add(secretary)

        db.commit()
        print(f"Seeded clinic {clinic_id} with doctor and 3 secretaries")
        print("Secretary login: clinic_id={clinic_id}, name=secretary 1/2/3, password=password123")
        print("Doctor Google ID: test_google_id")

    finally:
        db.close()

if __name__ == "__main__":
    init_db()
    seed()