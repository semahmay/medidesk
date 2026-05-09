#!/usr/bin/env python3
"""
quick_stress_test.py — Quick tests to find bugs.
"""

import requests
import threading
import time
import json

BASE_URL = "http://localhost:8000"
CLINIC_ID = "MEDI-92021"
TOKEN = None

def login():
    global TOKEN
    resp = requests.post(f"{BASE_URL}/api/auth/secretary/login", json={
        "clinic_id": CLINIC_ID,
        "name": "secretary 1",
        "password": "password123"
    })
    if resp.status_code == 200:
        TOKEN = resp.json()["access_token"]
        print("Logged in")
    else:
        print(f"Login failed: {resp.text}")
        exit(1)

def create_patient(name):
    payload = {
        "full_name": name,
        "phone": "+1555123456",
        "notes": "Test patient",
        "status": "Active",
        "global_id": f"test-{name.replace(' ', '-')}"
    }
    resp = requests.post(f"{BASE_URL}/api/patients", json=payload, headers={"Authorization": f"Bearer {TOKEN}"})
    if resp.status_code in (200, 201):
        return resp.json()["patient"]
    else:
        print(f"Create patient failed: {resp.status_code} {resp.text}")
        return None

def edit_patient(patient_id, version, new_name):
    payload = {
        "full_name": new_name,
        "version": version
    }
    resp = requests.put(f"{BASE_URL}/api/patients/{patient_id}", json=payload, headers={"Authorization": f"Bearer {TOKEN}"})
    return resp.status_code, resp.text

def test_concurrent_edits():
    print("Testing concurrent patient edits...")
    patient = create_patient("Concurrent Test")
    if not patient:
        return

    patient_id = patient["id"]
    version = patient["version"]

    results = []

    def edit_thread(name):
        code, text = edit_patient(patient_id, version, f"Edited by {name}")
        results.append((name, code, text))

    threads = []
    for i in range(5):
        t = threading.Thread(target=edit_thread, args=(f"Thread {i}",))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    print("Results:")
    for name, code, text in results:
        print(f"  {name}: {code} - {text[:100]}")

    # Check final state
    resp = requests.get(f"{BASE_URL}/api/patients/{patient_id}", headers={"Authorization": f"Bearer {TOKEN}"})
    if resp.status_code == 200:
        final_patient = resp.json()
        print(f"Final patient: {final_patient['full_name']}, version: {final_patient['version']}")
    else:
        print(f"Get patient failed: {resp.status_code}")

def test_search():
    print("Testing search...")
    # Create some patients
    for i in range(10):
        create_patient(f"Search Test {i}")

    resp = requests.get(f"{BASE_URL}/api/patients/search?q=Search", headers={"Authorization": f"Bearer {TOKEN}"})
    if resp.status_code == 200:
        patients = resp.json()
        print(f"Search found {len(patients)} patients")
    else:
        print(f"Search failed: {resp.status_code} {resp.text}")

def test_pagination():
    print("Testing pagination...")
    resp = requests.get(f"{BASE_URL}/api/patients?limit=5", headers={"Authorization": f"Bearer {TOKEN}"})
    if resp.status_code == 200:
        patients = resp.json()["patients"]
        print(f"First page: {len(patients)} patients")
        if len(patients) == 5:
            # Try page 100
            resp2 = requests.get(f"{BASE_URL}/api/patients?limit=5&offset=495", headers={"Authorization": f"Bearer {TOKEN}"})
            if resp2.status_code == 200:
                patients2 = resp2.json()["patients"]
                print(f"Page 100: {len(patients2)} patients")
            else:
                print(f"Page 100 failed: {resp2.status_code}")
    else:
        print(f"Pagination failed: {resp.status_code}")

if __name__ == "__main__":
    login()
    test_concurrent_edits()
    test_search()
    test_pagination()