#!/usr/bin/env python3
"""
clinic_stress_test.py — Full clinic stress test simulation.

Simulates:
- 1 Doctor + 2 Secretaries
- 3000+ patients
- Concurrent patient edits
- Search on large dataset
- Appointments
- Chat spam
- Unstable network (random failures)
"""

import asyncio
import httpx
import uuid
import time
import json
import os
import random
import threading
from dataclasses import dataclass, field
from typing import Optional, List

BASE_URL = "http://localhost:8000"
CLINIC_ID = "MEDI-92021"
NUM_PATIENTS = 3100  # 3000+ patients
NUM_APPOINTMENTS = 250  # 200+
CHAT_MESSAGES = 60  # 50+ messages/minute
CONCURRENCY = 5  # Simulate parallel users

# Tokens
SECRETARY_TOKENS = []  # Will populate
DOCTOR_TOKEN = None

@dataclass
class UserSession:
    token: str
    role: str
    name: str

sessions: List[UserSession] = []

# Results
results = {
    "patients_created": 0,
    "appointments_created": 0,
    "messages_sent": 0,
    "search_queries": 0,
    "conflicts_detected": 0,
    "network_failures": 0,
    "errors": [],
}

# Unstable network simulation
def unstable_request(method, url, **kwargs):
    """Simulate network instability: 3-7 min cycles of online/offline."""
    if random.random() < 0.1:  # 10% chance of failure
        results["network_failures"] += 1
        raise httpx.ConnectError("Simulated network failure")
    return httpx.request(method, url, **kwargs)

httpx.request = unstable_request

async def login_users():
    """Login doctor and secretaries."""
    global DOCTOR_TOKEN, SECRETARY_TOKENS

    # Doctor login (mock Google)
    # For simplicity, use secretary tokens for all, since doctor auth is different
    # Let's use secretary 1 as "doctor" for testing

    for i in range(3):  # 2 secretaries + 1 "doctor"
        name = f"secretary {i+1}"
        resp = httpx.post(f"{BASE_URL}/api/auth/secretary/login", json={
            "clinic_id": CLINIC_ID,
            "name": name,
            "password": "password123"
        })
        if resp.status_code == 200:
            token = resp.json()["access_token"]
            sessions.append(UserSession(token=token, role="secretary", name=name))
            if i == 0:
                DOCTOR_TOKEN = token
            else:
                SECRETARY_TOKENS.append(token)
        else:
            print(f"Login failed for {name}: {resp.text}")

async def create_patients(session: UserSession, count: int):
    """Create patients."""
    for i in range(count):
        global_id = str(uuid.uuid4())
        payload = {
            "full_name": f"Patient {i+1} {session.name}",
            "phone": f"+1555{random.randint(1000000,9999999)}",
            "notes": f"Stress test notes {i}",
            "status": "Active",
            "global_id": global_id,
        }
        try:
            resp = await httpx.post(
                f"{BASE_URL}/api/patients",
                json=payload,
                headers={"Authorization": f"Bearer {session.token}"},
                timeout=10.0,
            )
            if resp.status_code in (200, 201):
                results["patients_created"] += 1
            else:
                results["errors"].append(f"Create patient {i}: {resp.status_code} {resp.text}")
        except Exception as e:
            results["errors"].append(f"Create patient {i} exception: {e}")

async def concurrent_edits():
    """Simulate concurrent patient edits."""
    # Get some patient IDs first
    resp = await httpx.get(f"{BASE_URL}/api/patients", headers={"Authorization": f"Bearer {SECRETARY_TOKENS[0]}"})
    if resp.status_code != 200:
        print("Failed to get patients")
        return
    patients = resp.json().get("patients", [])[:10]  # First 10

    async def edit_patient(session: UserSession, patient: dict):
        payload = {
            "full_name": patient["full_name"] + " edited",
            "version": patient["version"],
        }
        try:
            resp = await httpx.put(
                f"{BASE_URL}/api/patients/{patient['id']}",
                json=payload,
                headers={"Authorization": f"Bearer {session.token}"},
            )
            if resp.status_code == 409:
                results["conflicts_detected"] += 1
            elif resp.status_code not in (200, 201):
                results["errors"].append(f"Edit patient {patient['id']}: {resp.status_code}")
        except Exception as e:
            results["errors"].append(f"Edit patient {patient['id']} exception: {e}")

    tasks = []
    for patient in patients:
        for session in sessions:
            tasks.append(edit_patient(session, patient))

    await asyncio.gather(*tasks, return_exceptions=True)

async def search_tests():
    """Test search on large dataset."""
    queries = ["Patient", "555", "Active", "notes"]
    for q in queries:
        try:
            resp = await httpx.get(f"{BASE_URL}/api/patients/search?q={q}", headers={"Authorization": f"Bearer {SECRETARY_TOKENS[0]}"})
            if resp.status_code == 200:
                results["search_queries"] += 1
            else:
                results["errors"].append(f"Search {q}: {resp.status_code}")
        except Exception as e:
            results["errors"].append(f"Search {q} exception: {e}")

async def appointment_tests():
    """Create appointments and test conflicts."""
    # Get patients
    resp = await httpx.get(f"{BASE_URL}/api/patients", headers={"Authorization": f"Bearer {SECRETARY_TOKENS[0]}"})
    patients = resp.json().get("patients", [])[:NUM_APPOINTMENTS]

    for i, patient in enumerate(patients):
        payload = {
            "patient_id": patient["id"],
            "patient_name": patient["full_name"],
            "date": "2026-04-20",
            "start_time": f"{9+i%8:02d}:00",
            "end_time": f"{10+i%8:02d}:00",
            "status": "scheduled"
        }
        try:
            resp = await httpx.post(
                f"{BASE_URL}/api/appointments",
                json=payload,
                headers={"Authorization": f"Bearer {SECRETARY_TOKENS[0]}"},
            )
            if resp.status_code in (200, 201):
                results["appointments_created"] += 1
            else:
                results["errors"].append(f"Appointment {i}: {resp.status_code}")
        except Exception as e:
            results["errors"].append(f"Appointment {i} exception: {e}")

async def chat_spam():
    """Send chat messages rapidly."""
    for i in range(CHAT_MESSAGES):
        payload = {
            "text": f"Stress message {i} from clinic chat",
            "sender_role": "secretary"
        }
        try:
            resp = await httpx.post(
                f"{BASE_URL}/api/messages",
                json=payload,
                headers={"Authorization": f"Bearer {SECRETARY_TOKENS[0]}"},
            )
            if resp.status_code in (200, 201):
                results["messages_sent"] += 1
            else:
                results["errors"].append(f"Message {i}: {resp.status_code}")
        except Exception as e:
            results["errors"].append(f"Message {i} exception: {e}")
        await asyncio.sleep(0.5)  # 2 messages/second, but we want 50/min = ~0.8/sec

async def run_stress_test():
    await login_users()

    # Create patients in parallel
    tasks = []
    patients_per_session = NUM_PATIENTS // len(sessions)
    for session in sessions:
        tasks.append(create_patients(session, patients_per_session))

    await asyncio.gather(*tasks)

    # Concurrent edits
    await concurrent_edits()

    # Search tests
    await search_tests()

    # Appointments
    await appointment_tests()

    # Chat spam
    await chat_spam()

    print("Stress test completed")
    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    asyncio.run(run_stress_test())