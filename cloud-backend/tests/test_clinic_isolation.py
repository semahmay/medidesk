"""
test_clinic_isolation.py — Verify no cross-clinic data leakage.

Critical: a JWT for clinic A must NEVER return data from clinic B.
"""

import pytest
import uuid
from tests.conftest import make_clinic, make_secretary
from models import Patient


def test_patient_list_isolated(client, db_session):
    """Doctor A cannot see Doctor B's patients."""
    _, _, token_a = make_clinic(db_session)
    clinic_b, _, token_b = make_clinic(db_session)

    # Create a patient in clinic B
    res = client.post("/api/patients",
        json={"full_name": "Clinic B Patient", "notes": "secret"},
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert res.status_code == 201

    # Doctor A fetches patients — must not see clinic B's patient
    res = client.get("/api/patients",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res.status_code == 200
    names = [p["full_name"] for p in res.json["patients"]]
    assert "Clinic B Patient" not in names


def test_patient_update_cross_clinic_rejected(client, db_session):
    """Doctor A cannot update a patient belonging to clinic B."""
    clinic_a, _, token_a = make_clinic(db_session)
    clinic_b, _, token_b = make_clinic(db_session)

    # Create patient in clinic B
    res = client.post("/api/patients",
        json={"full_name": "B Patient", "notes": "b notes", "global_id": str(uuid.uuid4())},
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert res.status_code == 201
    global_id = res.json["patient"]["global_id"]

    # Doctor A tries to update it via global_id route
    res = client.put(f"/api/patients/by-global/{global_id}",
        json={"notes": "hacked"},
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res.status_code == 404  # not found in clinic A's scope


def test_messages_isolated(client, db_session):
    """Clinic A cannot read clinic B's messages."""
    _, _, token_a = make_clinic(db_session)
    _, _, token_b = make_clinic(db_session)

    client.post("/api/messages",
        json={"text": "Secret message from B"},
        headers={"Authorization": f"Bearer {token_b}"},
    )

    res = client.get("/api/messages",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res.status_code == 200
    texts = [m["text"] for m in res.json["messages"]]
    assert "Secret message from B" not in texts


def test_appointments_isolated(client, db_session):
    """Clinic A cannot see clinic B's appointments."""
    _, _, token_a = make_clinic(db_session)
    _, _, token_b = make_clinic(db_session)

    client.post("/api/appointments",
        json={"patient_name": "B Appt", "date": "2026-07-01",
              "start_time": "10:00", "end_time": "10:30"},
        headers={"Authorization": f"Bearer {token_b}"},
    )

    res = client.get("/api/appointments",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res.status_code == 200
    names = [a["patient_name"] for a in res.json["appointments"]]
    assert "B Appt" not in names


def test_no_token_rejected(client, db_session):
    """All protected endpoints reject requests with no token."""
    for path in ["/api/patients", "/api/messages", "/api/appointments"]:
        res = client.get(path)
        assert res.status_code == 401
