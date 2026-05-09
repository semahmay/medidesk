#!/usr/bin/env python3
import requests
import os
import time

BASE = 'http://localhost:8000'
CLINIC_ID = 'MEDI-92021'
USER = 'secretary 1'
PASSWORD = 'password123'

results = {}

print('Logging in...')
resp = requests.post(f'{BASE}/api/auth/secretary/login', json={'clinic_id': CLINIC_ID, 'name': USER, 'password': PASSWORD})
print('login', resp.status_code, resp.text)
if resp.status_code != 200:
    raise SystemExit('Login failed')
token = resp.json()['access_token']
headers = {'Authorization': f'Bearer {token}'}

# Create a patient
payload = {'full_name': 'SaaS Fix Test Patient', 'phone': '+15550000000', 'notes': 'Routing validation', 'status': 'Active', 'global_id': 'saas-fix-test-patient'}
resp = requests.post(f'{BASE}/api/patients', json=payload, headers=headers)
print('create patient', resp.status_code, resp.text)
if resp.status_code not in (200, 201):
    raise SystemExit('Create patient failed')
patient = resp.json().get('patient')
patient_id = patient['id']
results['patient_create'] = resp.status_code in (200, 201)

# Get patient details
resp = requests.get(f'{BASE}/api/patients/{patient_id}', headers=headers)
print('get patient', resp.status_code, resp.text)
results['patient_get'] = resp.status_code == 200 and resp.json().get('patient', {}).get('id') == patient_id

# Get invalid patient
resp = requests.get(f'{BASE}/api/patients/9999999', headers=headers)
print('invalid patient', resp.status_code, resp.text)
results['invalid_patient'] = resp.status_code == 404 and resp.json().get('error') == 'Not found'

# Create appointment for patient
appt_payload = {'patient_id': patient_id, 'patient_name': patient['full_name'], 'date': '2026-04-20', 'start_time': '11:00', 'end_time': '11:30', 'status': 'scheduled'}
resp = requests.post(f'{BASE}/api/appointments', json=appt_payload, headers=headers)
print('create appointment', resp.status_code, resp.text)
if resp.status_code != 201:
    raise SystemExit('Create appointment failed')
appointment = resp.json()['appointment']
appt_id = appointment['id']
results['appointment_create'] = True

# Get appointment details
resp = requests.get(f'{BASE}/api/appointments/{appt_id}', headers=headers)
print('get appointment', resp.status_code, resp.text)
results['appointment_get'] = resp.status_code == 200 and resp.json().get('appointment', {}).get('id') == appt_id

# Invalid appointment
resp = requests.get(f'{BASE}/api/appointments/9999999', headers=headers)
print('invalid appointment', resp.status_code, resp.text)
results['invalid_appointment'] = resp.status_code == 404 and resp.json().get('error') == 'Not found'

# Search pagination
resp = requests.get(f'{BASE}/api/patients/search?q=SaaS&limit=1&page=1', headers=headers)
print('search page1', resp.status_code, resp.text)
results['search_pagination'] = resp.status_code == 200 and 'data' in resp.json() and 'hasMore' in resp.json()

# Attachment list for patient (should return empty list, not error)
resp = requests.get(f'{BASE}/api/patients/{patient_id}/attachments', headers=headers)
print('patient attachments', resp.status_code, resp.text)
results['attachments_list'] = resp.status_code == 200 and resp.json().get('attachments') == []

# Check 405 handling with wrong method
resp = requests.post(f'{BASE}/api/patients/{patient_id}', headers=headers)
print('wrong method patient', resp.status_code, resp.text)
results['method_not_allowed'] = resp.status_code == 405 and resp.json().get('error') == 'Method not allowed'

print('\nRESULTS:')
for k, v in results.items():
    print(f'{k}:', 'PASS' if v else 'FAIL')

if all(results.values()):
    print('\nALL TESTS PASS')
else:
    print('\nSOME TESTS FAIL')
    raise SystemExit(1)
