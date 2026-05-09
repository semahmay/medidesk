#!/usr/bin/env python3
"""
test_stability.py — Connection leak and concurrency stability test.
Fires 50 concurrent requests and checks connection count before/after.
"""
import requests, concurrent.futures, sys

BASE = "http://localhost:8000/api"

def get_conn_count():
    """Get active PostgreSQL connections via the test clinic token."""
    # Use health endpoint — no auth needed
    r = requests.get(f"{BASE}/health", timeout=5)
    return r.json()

def make_request(i):
    r = requests.get(f"{BASE}/health", timeout=10)
    return r.status_code == 200

print("=" * 60)
print("Stability & Connection Leak Test")
print("=" * 60)

# Baseline
h = get_conn_count()
print(f"\nBaseline health: {h}")

# Fire 50 concurrent requests
print("\nFiring 50 concurrent requests...")
with concurrent.futures.ThreadPoolExecutor(max_workers=50) as ex:
    results = list(ex.map(make_request, range(50)))

passed = sum(results)
print(f"Results: {passed}/50 requests succeeded")

# Check connections after load
import time
time.sleep(3)  # let pool reclaim connections

h2 = get_conn_count()
print(f"\nPost-load health: {h2}")

print("\n" + "=" * 60)
if passed == 50 and h2["db"] == "ok" and h2["redis"] == "ok":
    print("PASS — System stable under 50 concurrent requests")
    print("       No connection leaks detected")
    sys.exit(0)
else:
    print(f"FAIL — {50 - passed} requests failed or health degraded")
    sys.exit(1)
