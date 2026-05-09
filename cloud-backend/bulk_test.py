#!/usr/bin/env python3
import requests

# Login
resp = requests.post('http://localhost:8000/api/auth/secretary/login', json={
    'clinic_id': 'MEDI-92021',
    'name': 'secretary 1',
    'password': 'password123'
})
token = resp.json()['access_token']
headers = {'Authorization': f'Bearer {token}'}

print("Creating 100 patients...")
for i in range(100):
    payload = {
        'full_name': f'Bulk Patient {i}',
        'phone': f'+1555{i:06d}',
        'notes': f'Bulk notes {i}',
        'status': 'Active',
        'global_id': f'bulk-{i}'
    }
    resp = requests.post('http://localhost:8000/api/patients', json=payload, headers=headers)
    if resp.status_code != 201:
        print(f'Failed at {i}: {resp.status_code} {resp.text}')
        break

print('Created 100 patients')

# Test search
resp = requests.get('http://localhost:8000/api/patients/search?q=Bulk', headers=headers)
if resp.status_code == 200:
    patients = resp.json()['patients']
    print(f'Search found {len(patients)} patients')
else:
    print(f'Search failed: {resp.status_code} {resp.text}')

# Test pagination
resp = requests.get('http://localhost:8000/api/patients?limit=10', headers=headers)
if resp.status_code == 200:
    patients = resp.json()['patients']
    print(f'List returned {len(patients)} patients')
else:
    print(f'List failed: {resp.status_code} {resp.text}')