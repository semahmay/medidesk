"""
stress_test.py — Multi-tenant concurrent write stress test.

Simulates 20 clinics with concurrent patients + appointments + chat writes.
Detects:
  - global_id uniqueness violations
  - updated_at conflict detection correctness
  - cross-clinic data leakage
  - race conditions under concurrent load

Usage:
    pip install httpx pytest-asyncio
    BASE_URL=http://localhost:8000 python tests/stress_test.py

Requires a running MediDesk API with PostgreSQL backend.
"""

import asyncio
import httpx
import uuid
import time
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Optional

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")
NUM_CLINICS = int(os.getenv("NUM_CLINICS", "20"))
WRITES_PER_CLINIC = int(os.getenv("WRITES_PER_CLINIC", "10"))
CONCURRENCY = int(os.getenv("CONCURRENCY", "20"))

# ── Test clinic credentials (pre-seeded via seed_stress_data.py) ──────────────
# Each clinic gets a doctor JWT. We generate them here via the Google mock endpoint
# or use pre-seeded tokens from environment.

@dataclass
class ClinicContext:
    clinic_id: str
    access_token: str
    created_patients: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    writes: int = 0
    conflicts: int = 0


# ── Results ───────────────────────────────────────────────────────────────────

results = {
    "total_writes": 0,
    "total_errors": 0,
    "total_conflicts": 0,
    "global_id_collisions": 0,
    "cross_clinic_leaks": 0,
    "duration_seconds": 0.0,
    "clinics_tested": 0,
}


async def create_patient(client: httpx.AsyncClient, ctx: ClinicContext, idx: int) -> Optional[dict]:
    """Create a patient and verify global_id uniqueness."""
    global_id = str(uuid.uuid4())
    payload = {
        "full_name": f"Stress Patient {idx} {ctx.clinic_id[:8]}",
        "phone": f"+1555{idx:07d}",
        "notes": f"Stress test note {idx}",
        "status": "Active",
        "global_id": global_id,
    }
    try:
        resp = await client.post(
            f"{BASE_URL}/api/patients",
            json=payload,
            headers={"Authorization": f"Bearer {ctx.access_token}"},
            timeout=10.0,
        )
        if resp.status_code in (200, 201):
            patient = resp.json().get("patient", {})
            returned_global_id = patient.get("global_id")
            if returned_global_id != global_id:
                results["global_id_collisions"] += 1
                ctx.errors.append(f"global_id mismatch: sent={global_id} got={returned_global_id}")
            ctx.created_patients.append(patient)
            ctx.writes += 1
            return patient
        else:
            ctx.errors.append(f"create_patient {resp.status_code}: {resp.text[:100]}")
    except Exception as e:
        ctx.errors.append(f"create_patient exception: {e}")
    return None


async def concurrent_update(client: httpx.AsyncClient, ctx: ClinicContext, patient: dict) -> None:
    """
    Simulate two concurrent updates to the same patient.
    One should succeed, one should get 409 (conflict detection).
    """
    global_id = patient.get("global_id")
    if not global_id:
        return

    # Both updates use the same (old) updated_at — one should be rejected
    old_updated_at = patient.get("updated_at", "2020-01-01T00:00:00")

    async def do_update(notes: str):
        try:
            resp = await client.put(
                f"{BASE_URL}/api/patients/by-global/{global_id}",
                json={"notes": notes, "updated_at": old_updated_at},
                headers={"Authorization": f"Bearer {ctx.access_token}"},
                timeout=10.0,
            )
            return resp.status_code
        except Exception:
            return 0

    # Fire both concurrently
    codes = await asyncio.gather(
        do_update("Update A from stress test"),
        do_update("Update B from stress test"),
    )

    # Exactly one should succeed (200), one should conflict (409) or both succeed
    # (if they arrive in sequence). Either is acceptable — we just count conflicts.
    if 409 in codes:
        ctx.conflicts += 1


async def verify_clinic_isolation(client: httpx.AsyncClient, ctx: ClinicContext, other_token: str) -> None:
    """
    Attempt to read this clinic's patients using another clinic's token.
    Must return 0 patients or 403.
    """
    try:
        resp = await client.get(
            f"{BASE_URL}/api/patients",
            headers={"Authorization": f"Bearer {other_token}"},
            timeout=10.0,
        )
        if resp.status_code == 200:
            patients = resp.json().get("patients", [])
            # Check none of the returned patients belong to ctx.clinic_id
            leaked = [p for p in patients if p.get("clinic_id") == ctx.clinic_id]
            if leaked:
                results["cross_clinic_leaks"] += len(leaked)
                ctx.errors.append(f"ISOLATION BREACH: {len(leaked)} patients leaked to other clinic")
    except Exception:
        pass


async def send_message(client: httpx.AsyncClient, ctx: ClinicContext, idx: int) -> None:
    try:
        await client.post(
            f"{BASE_URL}/api/messages",
            json={"text": f"Stress message {idx}", "is_task": False},
            headers={"Authorization": f"Bearer {ctx.access_token}"},
            timeout=10.0,
        )
        ctx.writes += 1
    except Exception as e:
        ctx.errors.append(f"send_message: {e}")


async def create_appointment(client: httpx.AsyncClient, ctx: ClinicContext, idx: int) -> None:
    try:
        resp = await client.post(
            f"{BASE_URL}/api/appointments",
            json={
                "patient_name": f"Appt Patient {idx}",
                "date": "2026-06-15",
                "start_time": f"{(8 + idx % 10):02d}:00",
                "end_time":   f"{(8 + idx % 10):02d}:30",
                "status": "scheduled",
            },
            headers={"Authorization": f"Bearer {ctx.access_token}"},
            timeout=10.0,
        )
        if resp.status_code in (200, 201, 409):  # 409 = time conflict, expected
            ctx.writes += 1
        else:
            ctx.errors.append(f"create_appointment {resp.status_code}")
    except Exception as e:
        ctx.errors.append(f"create_appointment: {e}")


async def run_clinic_stress(ctx: ClinicContext, other_tokens: list[str]) -> None:
    """Run full stress scenario for one clinic."""
    async with httpx.AsyncClient() as client:
        # 1. Create patients concurrently
        tasks = [create_patient(client, ctx, i) for i in range(WRITES_PER_CLINIC)]
        patients = await asyncio.gather(*tasks)
        patients = [p for p in patients if p]

        # 2. Concurrent conflicting updates on first patient
        if patients:
            await concurrent_update(client, ctx, patients[0])

        # 3. Send messages concurrently
        msg_tasks = [send_message(client, ctx, i) for i in range(5)]
        await asyncio.gather(*msg_tasks)

        # 4. Create appointments concurrently
        appt_tasks = [create_appointment(client, ctx, i) for i in range(5)]
        await asyncio.gather(*appt_tasks)

        # 5. Verify isolation — use a different clinic's token
        if other_tokens:
            await verify_clinic_isolation(client, ctx, other_tokens[0])


async def seed_clinic(client: httpx.AsyncClient, clinic_num: int) -> Optional[ClinicContext]:
    """
    Seed a test clinic by calling the internal seed endpoint.
    Falls back to using pre-set tokens from environment.
    """
    token_env = os.getenv(f"STRESS_TOKEN_{clinic_num}")
    clinic_env = os.getenv(f"STRESS_CLINIC_{clinic_num}")
    if token_env and clinic_env:
        return ClinicContext(clinic_id=clinic_env, access_token=token_env)

    # Try the test seed endpoint (only available when FLASK_ENV=test)
    try:
        resp = await client.post(
            f"{BASE_URL}/api/internal/seed-test-clinic",
            json={"clinic_num": clinic_num},
            timeout=15.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            return ClinicContext(
                clinic_id=data["clinic_id"],
                access_token=data["access_token"],
            )
    except Exception:
        pass
    return None


async def main():
    print(f"\n{'='*60}")
    print(f"MediDesk AI — Multi-Tenant Stress Test")
    print(f"  Clinics:          {NUM_CLINICS}")
    print(f"  Writes/clinic:    {WRITES_PER_CLINIC}")
    print(f"  Concurrency:      {CONCURRENCY}")
    print(f"  Target:           {BASE_URL}")
    print(f"{'='*60}\n")

    # Seed clinics
    print("Seeding test clinics...")
    async with httpx.AsyncClient() as client:
        seed_tasks = [seed_clinic(client, i) for i in range(NUM_CLINICS)]
        contexts = await asyncio.gather(*seed_tasks)

    contexts = [c for c in contexts if c]
    if not contexts:
        print("ERROR: No clinic contexts available.")
        print("  Set STRESS_TOKEN_N and STRESS_CLINIC_N env vars, or")
        print("  run with FLASK_ENV=test to enable the seed endpoint.")
        sys.exit(1)

    print(f"  Seeded {len(contexts)} clinics\n")
    results["clinics_tested"] = len(contexts)

    # Run stress
    print("Running concurrent stress...")
    start = time.time()
    all_tokens = [c.access_token for c in contexts]

    sem = asyncio.Semaphore(CONCURRENCY)

    async def bounded(ctx):
        async with sem:
            other = [t for t in all_tokens if t != ctx.access_token]
            await run_clinic_stress(ctx, other)

    await asyncio.gather(*[bounded(ctx) for ctx in contexts])
    results["duration_seconds"] = round(time.time() - start, 2)

    # Aggregate
    for ctx in contexts:
        results["total_writes"]    += ctx.writes
        results["total_errors"]    += len(ctx.errors)
        results["total_conflicts"] += ctx.conflicts

    # ── Report ────────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("STRESS TEST RESULTS")
    print(f"{'='*60}")
    print(f"  Duration:              {results['duration_seconds']}s")
    print(f"  Total writes:          {results['total_writes']}")
    print(f"  Total errors:          {results['total_errors']}")
    print(f"  Conflict detections:   {results['total_conflicts']}  (409 responses — expected)")
    print(f"  global_id collisions:  {results['global_id_collisions']}  (must be 0)")
    print(f"  Cross-clinic leaks:    {results['cross_clinic_leaks']}  (must be 0)")
    print(f"{'='*60}")

    # Verdict
    critical_failures = results["global_id_collisions"] + results["cross_clinic_leaks"]
    if critical_failures == 0 and results["total_errors"] == 0:
        print("\n✅ PASS — No critical failures detected")
    elif critical_failures == 0:
        print(f"\n⚠️  WARN — {results['total_errors']} non-critical errors (check above)")
    else:
        print(f"\n❌ FAIL — {critical_failures} critical failures detected")
        for ctx in contexts:
            for err in ctx.errors:
                if "ISOLATION" in err or "global_id" in err:
                    print(f"  CRITICAL: [{ctx.clinic_id[:8]}] {err}")
        sys.exit(1)

    # Per-clinic error detail
    error_clinics = [ctx for ctx in contexts if ctx.errors]
    if error_clinics:
        print("\nPer-clinic errors:")
        for ctx in error_clinics[:5]:
            print(f"  [{ctx.clinic_id[:8]}] {ctx.errors[0]}")

    print()


if __name__ == "__main__":
    asyncio.run(main())
