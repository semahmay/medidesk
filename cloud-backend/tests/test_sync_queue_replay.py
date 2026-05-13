"""
test_sync_queue_replay.py — Verify sync queue behavior.

Tests the Python-side queue logic. The JS queue (patientSyncService.js)
is tested separately via the stress_test.py harness.
"""

import pytest
import uuid
from tests.conftest import make_clinic


def test_create_patient_idempotent_on_replay(client, db_session):
    """
    Simulates queue replay: same global_id POSTed twice.
    Second POST must return existing record (idempotent).
    """
    _, _, token = make_clinic(db_session)
    gid = str(uuid.uuid4())
    headers = {"Authorization": f"Bearer {token}"}

    # First create (online)
    r1 = client.post("/api/patients",
        json={"full_name": "Replay Patient", "notes": "queued", "global_id": gid},
        headers=headers,
    )
    assert r1.status_code == 201

    # Replay (simulates queue retry after network recovery)
    r2 = client.post("/api/patients",
        json={"full_name": "Replay Patient", "notes": "queued", "global_id": gid},
        headers=headers,
    )
    assert r2.status_code == 200
    assert r2.json["created"] is False

    # Only one record exists
    res = client.get("/api/patients", headers=headers)
    matching = [p for p in res.json["patients"] if p["global_id"] == gid]
    assert len(matching) == 1


def test_update_replay_with_stale_version_rejected(client, db_session):
    """
    Simulates: patient edited online by doctor, then offline edit replayed.
    Offline edit has old version → must be rejected (not silently applied).
    """
    _, _, token = make_clinic(db_session)
    headers = {"Authorization": f"Bearer {token}"}

    # Create
    r = client.post("/api/patients",
        json={"full_name": "Version Test", "notes": "v0", "global_id": str(uuid.uuid4())},
        headers=headers,
    )
    patient = r.json["patient"]
    gid = patient["global_id"]
    v0  = patient.get("version", 0)

    # Online update (version advances to v0+1)
    client.put(f"/api/patients/by-global/{gid}",
        json={"notes": "online edit", "version": v0},
        headers=headers,
    )

    # Offline edit replay with stale version
    res = client.put(f"/api/patients/by-global/{gid}",
        json={"notes": "offline stale edit", "version": v0},
        headers=headers,
    )
    assert res.status_code == 409

    # Verify online edit is preserved
    res = client.get("/api/patients", headers=headers)
    p = next(p for p in res.json["patients"] if p["global_id"] == gid)
    assert p["notes"] == "online edit"


def test_delete_replay_404_is_success(client, db_session):
    """
    Simulates: patient deleted, then delete replayed from queue.
    Second delete (404) must be treated as success, not an error.
    """
    _, _, token = make_clinic(db_session)
    headers = {"Authorization": f"Bearer {token}"}

    r = client.post("/api/patients",
        json={"full_name": "To Delete", "notes": "bye", "global_id": str(uuid.uuid4())},
        headers=headers,
    )
    patient_id = r.json["patient"]["id"]

    # First delete
    r1 = client.delete(f"/api/patients/{patient_id}", headers=headers)
    assert r1.status_code == 200

    # Replay delete — patient already gone
    r2 = client.delete(f"/api/patients/{patient_id}", headers=headers)
    assert r2.status_code == 404  # expected — queue should treat this as success
