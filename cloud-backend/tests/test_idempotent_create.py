"""
test_idempotent_create.py — Verify idempotent patient creation by global_id.

A POST with the same global_id must never create a duplicate record.
"""

import pytest
import uuid
from tests.conftest import make_clinic


def test_duplicate_global_id_returns_existing(client, db_session):
    """POSTing the same global_id twice returns the existing record, not a new one."""
    _, _, token = make_clinic(db_session)
    gid = str(uuid.uuid4())

    res1 = client.post("/api/patients",
        json={"full_name": "Alice", "notes": "first", "global_id": gid},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res1.status_code == 201
    assert res1.json["created"] is True

    res2 = client.post("/api/patients",
        json={"full_name": "Alice Duplicate", "notes": "second", "global_id": gid},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res2.status_code == 200
    assert res2.json["created"] is False
    # Must return the ORIGINAL record, not the duplicate data
    assert res2.json["patient"]["full_name"] == "Alice"
    assert res2.json["patient"]["notes"] == "first"


def test_no_global_id_generates_one(client, db_session):
    """POST without global_id generates one server-side."""
    _, _, token = make_clinic(db_session)

    res = client.post("/api/patients",
        json={"full_name": "Bob", "notes": "auto id"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 201
    assert res.json["patient"]["global_id"] is not None
    assert len(res.json["patient"]["global_id"]) == 36  # UUID4 format


def test_concurrent_same_global_id(client, db_session):
    """
    Simulate two concurrent requests with the same global_id.
    Only one record must exist after both complete.
    (Sequential simulation — true concurrency requires threading test.)
    """
    _, _, token = make_clinic(db_session)
    gid = str(uuid.uuid4())
    payload = {"full_name": "Concurrent", "notes": "test", "global_id": gid}
    headers = {"Authorization": f"Bearer {token}"}

    r1 = client.post("/api/patients", json=payload, headers=headers)
    r2 = client.post("/api/patients", json=payload, headers=headers)

    # Both must succeed (200 or 201)
    assert r1.status_code in (200, 201)
    assert r2.status_code in (200, 201)

    # Exactly one record must exist
    res = client.get("/api/patients", headers=headers)
    matching = [p for p in res.json["patients"] if p["global_id"] == gid]
    assert len(matching) == 1
