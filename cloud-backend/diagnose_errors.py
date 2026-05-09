#!/usr/bin/env python3
"""Diagnose the 54% error rate from the load test."""
import requests, uuid, concurrent.futures

BASE = "http://localhost:8000/api"

# Seed 5 clinics
clinics = []
for n in range(5):
    r = requests.post(f"{BASE}/internal/seed-test-clinic", json={"clinic_num": 88000+n})
    d = r.json()
    clinics.append({"token": d["access_token"], "id": d["clinic_id"]})

print(f"Seeded {len(clinics)} clinics")

# 100 concurrent across 5 clinics
tasks = [(clinics[i % 5], i) for i in range(100)]
errors = []
statuses = []

def create(args):
    clinic, i = args
    token = clinic["token"]
    r = requests.post(
        f"{BASE}/patients",
        headers={"Authorization": f"Bearer {token}"},
        json={"global_id": str(uuid.uuid4()), "full_name": f"P{i}"},
        timeout=15,
    )
    statuses.append(r.status_code)
    if r.status_code not in (200, 201):
        errors.append({"status": r.status_code, "body": r.text[:400]})
    return r.status_code

with concurrent.futures.ThreadPoolExecutor(max_workers=25) as ex:
    results = list(ex.map(create, tasks))

ok = sum(1 for s in results if s in (200, 201))
print(f"OK: {ok}/100")
print(f"Status distribution: {dict((s, statuses.count(s)) for s in set(statuses))}")
if errors:
    print(f"\nFirst 3 errors:")
    for e in errors[:3]:
        print(f"  HTTP {e['status']}: {e['body']}")
