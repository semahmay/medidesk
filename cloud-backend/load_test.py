#!/usr/bin/env python3
"""
load_test.py — Real load test: 5 clinics, concurrent patient/appointment creation,
conflict simulation, and measurement of response times, error rates, DB connections.

Requires: pip install requests
Run: python load_test.py
"""
import requests
import concurrent.futures
import uuid
import time
import statistics
import sys
import json

BASE = "http://localhost:8000/api"
NUM_CLINICS = 5
PATIENTS_PER_CLINIC = 20
APPOINTMENTS_PER_CLINIC = 10
CONCURRENT_WORKERS = 25

# ── Helpers ───────────────────────────────────────────────────────────────────

def seed_clinic(n):
    r = requests.post(f"{BASE}/internal/seed-test-clinic",
                      json={"clinic_num": 80000 + n}, timeout=10)
    if r.status_code != 200:
        raise RuntimeError(f"Seed failed for clinic {n}: {r.text}")
    d = r.json()
    return {"clinic_id": d["clinic_id"], "token": d["access_token"]}

def H(token):
    return {"Authorization": f"Bearer {token}"}

def get_db_connections():
    """Query PostgreSQL connection count via psql inside the container."""
    import subprocess
    result = subprocess.run(
        ["docker", "exec", "cloud-backend-db-1", "psql", "-U", "medidesk", "-d", "medidesk",
         "-t", "-c", "SELECT count(*) FROM pg_stat_activity WHERE datname='medidesk';"],
        capture_output=True, text=True, timeout=5
    )
    try:
        return int(result.stdout.strip())
    except Exception:
        return -1

# ── Test functions ────────────────────────────────────────────────────────────

def create_patient(clinic, i):
    gid = str(uuid.uuid4())
    start = time.monotonic()
    try:
        r = requests.post(f"{BASE}/patients", headers=H(clinic["token"]),
                          json={"global_id": gid, "full_name": f"Load Patient {i}",
                                "phone": f"+155500{i:04d}"},
                          timeout=10)
        elapsed = (time.monotonic() - start) * 1000
        return {"ok": r.status_code in (200, 201), "ms": elapsed,
                "status": r.status_code, "gid": gid,
                "version": r.json().get("patient", {}).get("version", 0) if r.status_code in (200,201) else 0}
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        return {"ok": False, "ms": elapsed, "status": 0, "error": str(e)}

def create_appointment(clinic, i):
    gid = str(uuid.uuid4())
    # Use unique time slots to avoid legitimate 409 time conflicts
    hour = 8 + (i % 10)
    minute = (i // 10) * 6  # 0, 6, 12, 18, 24 — unique within each hour
    start = time.monotonic()
    try:
        r = requests.post(f"{BASE}/appointments", headers=H(clinic["token"]),
                          json={"global_id": gid, "patient_name": f"Load Patient {i}",
                                "date": f"2026-0{6 + (i // 50)}-{1 + (i % 28):02d}",
                                "start_time": f"{hour:02d}:{minute:02d}",
                                "end_time":   f"{hour:02d}:{(minute+5):02d}",
                                "status": "scheduled"},
                          timeout=10)
        elapsed = (time.monotonic() - start) * 1000
        return {"ok": r.status_code in (200, 201), "ms": elapsed, "status": r.status_code}
    except Exception as e:
        elapsed = (time.monotonic() - start) * 1000
        return {"ok": False, "ms": elapsed, "status": 0, "error": str(e)}

def simulate_conflict(clinic, gid, version):
    """Two concurrent updates to the same patient — one must get 409."""
    results = []
    def update(v):
        start = time.monotonic()
        r = requests.put(f"{BASE}/patients/by-global/{gid}",
                         headers=H(clinic["token"]),
                         json={"full_name": f"Conflict Update {v}", "version": v},
                         timeout=10)
        elapsed = (time.monotonic() - start) * 1000
        return {"status": r.status_code, "ms": elapsed}

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        futs = [ex.submit(update, version), ex.submit(update, version)]
        results = [f.result() for f in futs]
    return results

# ── Main ──────────────────────────────────────────────────────────────────────

def run():
    print()
    print("=" * 70)
    print("LOAD TEST — 5 Clinics, Concurrent Operations")
    print("=" * 70)
    print(f"  Clinics:              {NUM_CLINICS}")
    print(f"  Patients per clinic:  {PATIENTS_PER_CLINIC}")
    print(f"  Appointments/clinic:  {APPOINTMENTS_PER_CLINIC}")
    print(f"  Concurrent workers:   {CONCURRENT_WORKERS}")
    print()

    # ── Phase 0: Check baseline ───────────────────────────────────────────────
    baseline_conns = get_db_connections()
    print(f"[Phase 0] Baseline DB connections: {baseline_conns}")

    r = requests.get(f"{BASE}/health", timeout=5)
    assert r.json()["db"] == "ok", "DB not healthy at start"
    print(f"[Phase 0] Health check: OK")
    print()

    # ── Phase 1: Seed 5 clinics ───────────────────────────────────────────────
    print("[Phase 1] Seeding 5 test clinics...")
    clinics = []
    for n in range(NUM_CLINICS):
        c = seed_clinic(n)
        clinics.append(c)
        print(f"  Clinic {n+1}: {c['clinic_id']}")
    print()

    # ── Phase 2: Concurrent patient creation ──────────────────────────────────
    print(f"[Phase 2] Creating {NUM_CLINICS * PATIENTS_PER_CLINIC} patients concurrently...")
    tasks = []
    for clinic in clinics:
        for i in range(PATIENTS_PER_CLINIC):
            tasks.append((clinic, i))

    patient_results = []
    patient_gids = {c["clinic_id"]: [] for c in clinics}

    phase2_start = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT_WORKERS) as ex:
        futs = {ex.submit(create_patient, t[0], t[1]): t[0] for t in tasks}
        for fut, clinic in futs.items():
            res = fut.result()
            patient_results.append(res)
            if res["ok"] and res.get("gid"):
                patient_gids[clinic["clinic_id"]].append(
                    {"gid": res["gid"], "version": res.get("version", 0)}
                )
    phase2_elapsed = time.monotonic() - phase2_start

    p2_ok  = sum(1 for r in patient_results if r["ok"])
    p2_err = len(patient_results) - p2_ok
    p2_ms  = [r["ms"] for r in patient_results]
    p2_conns = get_db_connections()

    print(f"  Created:    {p2_ok}/{len(patient_results)}")
    print(f"  Errors:     {p2_err}")
    print(f"  Total time: {phase2_elapsed:.2f}s")
    print(f"  Throughput: {len(patient_results)/phase2_elapsed:.1f} req/s")
    print(f"  Latency p50: {statistics.median(p2_ms):.0f}ms")
    print(f"  Latency p95: {sorted(p2_ms)[int(len(p2_ms)*0.95)]:.0f}ms")
    print(f"  Latency max: {max(p2_ms):.0f}ms")
    print(f"  DB connections during: {p2_conns}")
    print()

    # ── Phase 3: Concurrent appointment creation ──────────────────────────────
    print(f"[Phase 3] Creating {NUM_CLINICS * APPOINTMENTS_PER_CLINIC} appointments concurrently...")
    appt_tasks = []
    for clinic in clinics:
        for i in range(APPOINTMENTS_PER_CLINIC):
            appt_tasks.append((clinic, i))

    appt_results = []
    phase3_start = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT_WORKERS) as ex:
        futs = [ex.submit(create_appointment, t[0], t[1]) for t in appt_tasks]
        appt_results = [f.result() for f in futs]
    phase3_elapsed = time.monotonic() - phase3_start

    a3_ok  = sum(1 for r in appt_results if r["ok"])
    a3_err = len(appt_results) - a3_ok
    a3_ms  = [r["ms"] for r in appt_results]

    print(f"  Created:    {a3_ok}/{len(appt_results)}")
    print(f"  Errors:     {a3_err}")
    print(f"  Total time: {phase3_elapsed:.2f}s")
    print(f"  Throughput: {len(appt_results)/phase3_elapsed:.1f} req/s")
    print(f"  Latency p50: {statistics.median(a3_ms):.0f}ms")
    print(f"  Latency p95: {sorted(a3_ms)[int(len(a3_ms)*0.95)]:.0f}ms")
    print(f"  Latency max: {max(a3_ms):.0f}ms")
    print()

    # ── Phase 4: Conflict simulation ──────────────────────────────────────────
    print("[Phase 4] Simulating concurrent conflicts (2 writers, same patient)...")
    conflict_results = []
    for clinic in clinics:
        gids = patient_gids[clinic["clinic_id"]]
        if not gids:
            continue
        target = gids[0]
        results = simulate_conflict(clinic, target["gid"], target["version"])
        statuses = [r["status"] for r in results]
        got_409 = 409 in statuses
        got_200 = 200 in statuses
        conflict_results.append({
            "clinic": clinic["clinic_id"],
            "statuses": statuses,
            "correct": got_409 and got_200,
        })
        print(f"  {clinic['clinic_id']}: statuses={statuses} {'CORRECT (one 409)' if got_409 and got_200 else 'UNEXPECTED'}")

    conflicts_correct = sum(1 for r in conflict_results if r["correct"])
    print(f"  Conflict detection: {conflicts_correct}/{len(conflict_results)} correct")
    print()

    # ── Phase 5: Sustained load — 100 mixed requests ─────────────────────────
    print("[Phase 5] Sustained mixed load (100 requests across all clinics)...")
    mixed_tasks = []
    for i in range(100):
        clinic = clinics[i % NUM_CLINICS]
        mixed_tasks.append(clinic)

    def mixed_request(clinic):
        start = time.monotonic()
        r = requests.get(f"{BASE}/patients", headers=H(clinic["token"]),
                         params={"limit": 10}, timeout=10)
        elapsed = (time.monotonic() - start) * 1000
        return {"ok": r.status_code == 200, "ms": elapsed, "status": r.status_code}

    phase5_start = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT_WORKERS) as ex:
        mixed_results = list(ex.map(mixed_request, mixed_tasks))
    phase5_elapsed = time.monotonic() - phase5_start

    m5_ok  = sum(1 for r in mixed_results if r["ok"])
    m5_ms  = [r["ms"] for r in mixed_results]
    peak_conns = get_db_connections()

    print(f"  Succeeded:  {m5_ok}/100")
    print(f"  Total time: {phase5_elapsed:.2f}s")
    print(f"  Throughput: {100/phase5_elapsed:.1f} req/s")
    print(f"  Latency p50: {statistics.median(m5_ms):.0f}ms")
    print(f"  Latency p95: {sorted(m5_ms)[int(len(m5_ms)*0.95)]:.0f}ms")
    print(f"  Latency max: {max(m5_ms):.0f}ms")
    print(f"  Peak DB connections: {peak_conns}")
    print()

    # ── Phase 6: Post-load health check ──────────────────────────────────────
    time.sleep(10)  # wait for pool to settle
    post_conns = get_db_connections()
    health = requests.get(f"{BASE}/health", timeout=5).json()
    print(f"[Phase 6] Post-load health: {health}")
    print(f"[Phase 6] Post-load DB connections: {post_conns} (baseline was {baseline_conns})")
    # Pool holds idle connections open (pool_size=5 × 4 workers = 20 expected).
    # Only flag as leak if significantly above expected pool size.
    leak = post_conns - baseline_conns
    is_leak = leak > 25
    print(f"[Phase 6] Connection delta: {'+' if leak >= 0 else ''}{leak} {'(POSSIBLE LEAK)' if is_leak else '(OK — pool idle connections)'}")
    print()

    # ── Summary ───────────────────────────────────────────────────────────────
    total_requests = len(patient_results) + len(appt_results) + len(mixed_results)
    total_errors   = p2_err + a3_err + (100 - m5_ok)
    all_ms         = p2_ms + a3_ms + m5_ms
    error_rate     = (total_errors / total_requests) * 100

    print("=" * 70)
    print("LOAD TEST SUMMARY")
    print("=" * 70)
    print(f"  Total requests:      {total_requests}")
    print(f"  Total errors:        {total_errors}")
    print(f"  Error rate:          {error_rate:.1f}%")
    print(f"  Overall p50 latency: {statistics.median(all_ms):.0f}ms")
    print(f"  Overall p95 latency: {sorted(all_ms)[int(len(all_ms)*0.95)]:.0f}ms")
    print(f"  Overall max latency: {max(all_ms):.0f}ms")
    print(f"  Peak DB connections: {peak_conns}")
    print(f"  Post-load DB conns:  {post_conns}")
    print(f"  Conflict detection:  {conflicts_correct}/{len(conflict_results)} correct")
    print()

    # ── Bottleneck analysis ───────────────────────────────────────────────────
    print("BOTTLENECK ANALYSIS")
    print("-" * 70)

    p95 = sorted(all_ms)[int(len(all_ms)*0.95)]
    if p95 > 500:
        print(f"  [WARN] p95 latency {p95:.0f}ms > 500ms — response times are high")
    else:
        print(f"  [OK]   p95 latency {p95:.0f}ms — within acceptable range")

    if error_rate > 1:
        print(f"  [WARN] Error rate {error_rate:.1f}% > 1% — investigate failures")
    else:
        print(f"  [OK]   Error rate {error_rate:.1f}% — acceptable")

    if peak_conns > 80:
        print(f"  [WARN] Peak connections {peak_conns} > 80 — approaching pool limit")
    else:
        print(f"  [OK]   Peak connections {peak_conns} — well within pool limit (200)")

    if is_leak:
        print(f"  [WARN] Possible connection leak: +{leak} above baseline")
    else:
        print(f"  [OK]   Connections normal: +{leak} = pool idle connections (expected)")

    if conflicts_correct < len(conflict_results):
        print(f"  [FAIL] Conflict detection broken: {conflicts_correct}/{len(conflict_results)}")
    else:
        print(f"  [OK]   Conflict detection working correctly")

    print()
    sys.exit(0 if error_rate < 5 else 1)

if __name__ == "__main__":
    run()
