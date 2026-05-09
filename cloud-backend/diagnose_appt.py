#!/usr/bin/env python3
import requests, uuid, concurrent.futures

BASE = "http://localhost:8000/api"

r = requests.post(f"{BASE}/internal/seed-test-clinic", json={"clinic_num": 77001})
token = r.json()["access_token"]
H = {"Authorization": f"Bearer {token}"}

errors = []
def create_appt(i):
    r = requests.post(f"{BASE}/appointments", headers=H,
                      json={"global_id": str(uuid.uuid4()),
                            "patient_name": f"P{i}",
                            "date": "2026-06-01",
                            "start_time": f"{(8 + i % 8):02d}:00",
                            "end_time":   f"{(9 + i % 8):02d}:00",
                            "status": "scheduled"},
                      timeout=15)
    if r.status_code not in (200, 201):
        errors.append({"status": r.status_code, "body": r.text[:400]})
    return r.status_code

with concurrent.futures.ThreadPoolExecutor(max_workers=25) as ex:
    results = list(ex.map(create_appt, range(50)))

ok = sum(1 for s in results if s in (200, 201))
print(f"OK: {ok}/50")
print(f"Status distribution: {dict((s, results.count(s)) for s in set(results))}")
if errors:
    print(f"\nFirst error: HTTP {errors[0]['status']}")
    print(errors[0]['body'])
