"""
test_conflict_resolution.py — Verify version-based conflict detection.

Clock skew must NOT affect conflict detection.
Only the server-side version integer matters.
"""

import pytest
import uuid
from tests.conftest import make_clinic, make_secretary


def _create_patient(client, token, gid=None):
    gid = gid or str(uuid.uuid4())
    res = client.post("/api/patients",
        json={"full_name": "Test Patient", "notes": "initial", "global_id": gid},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 201
    return res.json["patient"]


def test_update_with_correct_version_succeeds(client, db_session):
    """Update with matching version succeeds and increments version."""
    _, _, token = make_clinic(db_session)
    patient = _create_patient(client, token)
    gid = patient["global_id"]
    v0  = patient.get("version", 0)

    res = client.put(f"/api/patients/by-global/{gid}",
        json={"notes": "updated", "version": v0},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    assert res.json["patient"]["version"] == v0 + 1
    assert res.json["patient"]["notes"] == "updated"


def test_update_with_stale_version_rejected(client, db_session):
    """Update with stale version returns 409."""
    _, _, token = make_clinic(db_session)
    patient = _create_patient(client, token)
    gid = patient["global_id"]
    v0  = patient.get("version", 0)

    # First update — succeeds, version becomes v0+1
    client.put(f"/api/patients/by-global/{gid}",
        json={"notes": "first update", "version": v0},
        headers={"Authorization": f"Bearer {token}"},
    )

    # Second update with OLD version — must be rejected
    res = client.put(f"/api/patients/by-global/{gid}",
        json={"notes": "stale update", "version": v0},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 409
    assert res.json["error"] == "conflict"
    assert "server_version" in res.json


def test_clock_skew_does_not_affect_conflict(client, db_session):
    """
    Even if client sends a future updated_at, version-based detection is unaffected.
    The server ignores client timestamps for conflict detection.
    """
    _, _, token = make_clinic(db_session)
    patient = _create_patient(client, token)
    gid = patient["global_id"]
    v0  = patient.get("version", 0)

    # First update with correct version
    client.put(f"/api/patients/by-global/{gid}",
        json={"notes": "real update", "version": v0},
        headers={"Authorization": f"Bearer {token}"},
    )

    # Second update: client sends a FUTURE updated_at (clock skew +5 hours)
    # but stale version — must still be rejected
    res = client.put(f"/api/patients/by-global/{gid}",
        json={
            "notes": "clock skew attack",
            "version": v0,                              # stale
            "updated_at": "2099-01-01T00:00:00Z",      # far future — ignored
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 409  # rejected by version, not timestamp


def test_update_without_version_allowed(client, db_session):
    """
    Update without version field is allowed (backward compat for legacy sync queue items).
    """
    _, _, token = make_clinic(db_session)
    patient = _create_patient(client, token)
    gid = patient["global_id"]

    res = client.put(f"/api/patients/by-global/{gid}",
        json={"notes": "legacy update, no version"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200


def test_secretary_conflict_with_doctor(client, db_session):
    """Doctor edits patient, then secretary tries to edit with stale version → 409."""
    clinic, _, doc_token = make_clinic(db_session)
    _, sec_token = make_secretary(db_session, clinic.id)

    patient = _create_patient(client, doc_token)
    gid = patient["global_id"]
    v0  = patient.get("version", 0)

    # Doctor updates first
    client.put(f"/api/patients/by-global/{gid}",
        json={"notes": "doctor update", "version": v0},
        headers={"Authorization": f"Bearer {doc_token}"},
    )

    # Secretary tries to update with old version
    res = client.put(f"/api/patients/by-global/{gid}",
        json={"notes": "secretary stale update", "version": v0},
        headers={"Authorization": f"Bearer {sec_token}"},
    )
    assert res.status_code == 409
