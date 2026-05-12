# FULL CLOUD MIGRATION REPORT
**Date:** May 12, 2026  
**Goal:** Electron frontend communicates ONLY with Azure cloud backend (40.81.230.3)  
**Current state:** Mixed architecture — secretary is cloud-native, doctor is hybrid local+cloud

---

## EXECUTIVE SUMMARY

| Category | Status |
|----------|--------|
| Secretary mode | ✅ Already 100% cloud-native |
| Doctor — patients/appointments | ⚠️ Dual-write (local + cloud) |
| Doctor — AI Chat | ❌ Local-only (Groq via localhost:5000) |
| Doctor — Medical Reference | ❌ Local-only (Groq via localhost:5000) |
| Doctor — Voice Transcription | ❌ Local-only (Whisper via localhost:5000) |
| Doctor — Attachments | ❌ Local filesystem only |
| Doctor — Custom Columns | ❌ Local SQLite only |
| Doctor — Analytics | ❌ Local SQLite only |
| Electron backend spawning | ⚠️ Dead code (not called in production) |

**Migration complexity:** Medium-High  
**Estimated effort:** 3–5 days of focused implementation  
**Data loss risk:** Low (with proper migration script)

---

## PART 1: COMPLETE LOCAL DEPENDENCY INVENTORY

### 1.1 — `api.js` (The Local API Client)

**File:** `medidesk-ai/frontend/src/api.js`

```javascript
export const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';
```

This is the root of all local backend calls. Every `api.get()`, `api.post()`, `api.put()`, `api.delete()` call in the frontend hits `localhost:5000`. This file must be **eliminated** or repurposed.

**Used in:**

| File | Calls | Feature |
|------|-------|---------|
| `AIChat.jsx` | `api.post('/api/chat')` | AI patient chat |
| `MedicalReference.jsx` | `api.post('/api/medical-reference')` | Medical knowledge queries |
| `VoiceRecorder.jsx` | `api.post('/api/transcribe')` | Audio → text transcription |
| `Analytics.jsx` | `api.get('/api/analytics/*')` × 7 | All analytics charts |
| `Dashboard-New.jsx` | `api.get('/api/patients')`, `api.put`, `api.delete` | Doctor patient list |
| `PatientForm.jsx` | `api.get('/api/patients')`, `api.post('/api/patients')`, `api.put` | Create/edit patient |
| `PatientDetail.jsx` | `api.get('/api/setup')`, `api.get('/api/patients/{id}/attachments')`, `api.post('/api/attachments')`, `api.delete('/api/attachments/{id}')`, `api.post('/api/chat')` | Patient detail panel |
| `PatientTable.jsx` | `api.get('/api/columns')`, `api.delete('/api/columns/{id}')`, `api.post('/api/columns')` | Custom columns |
| `TopBar.jsx` | `api.get('/api/setup')` | Clinic name display |
| `patientSyncService.js` | `api.put('/api/patients/{id}')` | Cloud ID write-back to local |
| `appointmentSyncService.js` | `api.get('/api/appointments')`, `api.post`, `api.put`, `api.delete` | Doctor appointments |

---

### 1.2 — `electron/main.js` — Backend Spawning (Dead Code)

**File:** `medidesk-ai/electron/main.js`

These functions exist but are **never called** in the current production flow:

```javascript
// DEAD CODE — never called in production
function startBackend(googleId) { ... spawn(python, ['app.py'], ...) }
function stopBackend() { ... backendProcess.kill() }
function restartBackendForUser(googleId) { ... }
function waitForBackend(onReady) { ... http.get('http://localhost:5000/api/health') }
```

**Still present but unused:**
- `spawn` import from `child_process`
- `backendProcess` variable
- `backendStarting` guard variable
- `waitForBackend` health poll loop
- `stopBackend()` call in `app.on('before-quit')` and `app.on('window-all-closed')`
- `stopBackend()` call in `logout` IPC handler

**Risk:** `stopBackend()` in logout is a no-op (backendProcess is null) but adds confusion.

---

### 1.3 — Local Backend Endpoints (What `localhost:5000` Serves)

**File:** `medidesk-ai/backend/app.py`

| Endpoint | Method | Cloud Equivalent | Migration Status |
|----------|--------|-----------------|-----------------|
| `/api/health` | GET | `/api/health` | ✅ Done |
| `/api/setup` | GET/POST | `/api/clinics/me` | ⚠️ Needs mapping |
| `/api/patients` | GET | `/api/patients` | ✅ Cloud ready |
| `/api/patients` | POST | `/api/patients` | ✅ Cloud ready |
| `/api/patients/{id}` | GET/PUT/DELETE | `/api/patients/{id}` | ✅ Cloud ready |
| `/api/patients/search` | GET | `/api/patients?search=` | ✅ Cloud ready |
| `/api/patients/{id}/attachments` | GET/POST | ❌ Not implemented | **BLOCKER** |
| `/api/attachments/{id}` | DELETE/GET | ❌ Not implemented | **BLOCKER** |
| `/api/columns` | GET/POST/DELETE | ❌ Not implemented | **BLOCKER** |
| `/api/appointments` | GET/POST/PUT/DELETE | `/api/appointments` | ✅ Cloud ready |
| `/api/appointments/week` | GET | `/api/appointments?week=` | ✅ Cloud ready |
| `/api/chat` | POST | ❌ Not implemented | **BLOCKER** |
| `/api/medical-reference` | POST | ❌ Not implemented | **BLOCKER** |
| `/api/transcribe` | POST | ❌ Not implemented | **BLOCKER** |
| `/api/analytics/*` | GET × 7 | ❌ Not implemented | **BLOCKER** |

---

### 1.4 — SQLite Database (Local Only)

**File:** `medidesk-ai/backend/database.py`

Tables that exist locally but have no cloud equivalent:

| Table | Purpose | Cloud Status |
|-------|---------|-------------|
| `patients` | Patient records | ✅ PostgreSQL `patients` table |
| `appointments` | Appointments | ✅ PostgreSQL `appointments` table |
| `attachments` | File metadata | ❌ No cloud table or API |
| `columns_config` | Custom field definitions | ❌ No cloud equivalent |
| `custom_field_data` | Custom field values per patient | ❌ No cloud equivalent |
| `settings` | Clinic config (doctor_name, clinic_name) | ⚠️ Partial — `clinics` table exists |
| `audit_log` | Action tracking | ✅ PostgreSQL `audit_logs` table |

**Data at risk:** Any patient data, attachments, or custom column data stored only in local SQLite will be lost if the local backend is removed without migration.

---

### 1.5 — `patientSyncService.js` — Dual-Write Logic

**File:** `medidesk-ai/frontend/src/services/patientSyncService.js`

The sync service currently:
1. Writes to local SQLite first (`api.put('/api/patients/{id}')`)
2. Then mirrors to cloud (`cloudApi.put('/patients/...')`)
3. Writes back `cloud_id` to local SQLite after cloud create

In full cloud mode:
- Step 1 is eliminated
- Step 2 becomes the primary write
- Step 3 is eliminated (no local DB to write back to)
- The entire `writeBackCloudId()` function is removed
- The `mergePatients()` function is simplified (no local records to merge)

---

### 1.6 — `appointmentSyncService.js` — Dual-Write Logic

**File:** `medidesk-ai/frontend/src/services/appointmentSyncService.js`

Doctor mode currently:
- Reads from `api.get('/api/appointments')` (local)
- Writes to `api.post('/api/appointments')` (local) then mirrors to cloud
- Queue fallback for cloud failures

In full cloud mode: all calls go directly to `cloudApi` — same as secretary mode already does.

---

### 1.7 — `PatientForm.jsx` — Mixed Writes

**File:** `medidesk-ai/frontend/src/components/PatientForm.jsx`

Doctor path:
```javascript
// Creates locally first, then syncs to cloud
await api.post('/api/patients', formData);
await syncPatientToCloud(savedPatient);
```

Secretary path (already cloud-native):
```javascript
await cloudApi.post('/patients', formData);
```

In full cloud mode: doctor uses the same path as secretary.

---

### 1.8 — `Dashboard-New.jsx` — Dual-Read Pattern

**File:** `medidesk-ai/frontend/src/pages/Dashboard-New.jsx`

Doctor currently fetches from BOTH sources and merges:
```javascript
const [localRes, cloud] = await Promise.all([
  fetchWithRetry(() => api.get('/api/patients?page=...')).catch(() => null),
  fetchCloudPatients(page, 50, ''),
]);
const { merged } = mergePatients(local, cloud);
```

In full cloud mode: only `fetchCloudPatients()` is called — same as secretary.

---

## PART 2: FEATURES REQUIRING LOCAL BACKEND

### BLOCKER 1 — AI Chat (`/api/chat`)
- **File:** `AIChat.jsx`, `PatientDetail.jsx`
- **What it does:** Sends patient context + user message to Groq LLM, returns AI response
- **Local dependency:** Groq Python client in `medidesk-ai/backend/ai_service.py`
- **Migration path:** Add `/api/chat` endpoint to cloud backend (`cloud-backend/app.py`) using the same Groq client. Requires `GROQ_API_KEY` in cloud `.env`.
- **Complexity:** Low — the endpoint is simple, just move the Groq call to cloud
- **Data loss risk:** None — chat history is in localStorage, not SQLite

### BLOCKER 2 — Medical Reference (`/api/medical-reference`)
- **File:** `MedicalReference.jsx`
- **What it does:** Answers medical questions using Groq LLM
- **Local dependency:** Groq Python client
- **Migration path:** Same as AI Chat — add endpoint to cloud backend
- **Complexity:** Low
- **Data loss risk:** None — no persistent data

### BLOCKER 3 — Voice Transcription (`/api/transcribe`)
- **File:** `VoiceRecorder.jsx`
- **What it does:** Sends audio blob to Whisper, returns transcribed text
- **Local dependency:** `whisper_service.py` — uses either local Whisper model or Groq Whisper API
- **Migration path:** Add `/api/transcribe` to cloud backend. If using Groq's Whisper API (not local model), this is straightforward. If using local Whisper model, cloud needs GPU or use Groq's hosted Whisper.
- **Complexity:** Medium — audio file upload to cloud, then transcription
- **Data loss risk:** None — transcriptions are appended to patient notes

### BLOCKER 4 — File Attachments (`/api/patients/{id}/attachments`)
- **File:** `PatientDetail.jsx`
- **What it does:** Upload, list, download, delete patient files (PDFs, images)
- **Local dependency:** Local filesystem at `medidesk-ai/data/attachments/`
- **Migration path:** Cloud backend already has MinIO S3 storage configured. Add attachment endpoints to `cloud-backend/app.py` using `storage_service.py` (already exists). Add `Attachment` model to `models.py`.
- **Complexity:** Medium — model + endpoints + MinIO integration (storage_service already written)
- **Data loss risk:** ⚠️ HIGH — existing local attachments will be lost unless migrated to MinIO

### BLOCKER 5 — Custom Columns (`/api/columns`)
- **File:** `PatientTable.jsx`, `PatientForm.jsx`, `Dashboard-New.jsx`
- **What it does:** Allows doctors to add custom fields to patient records
- **Local dependency:** `columns_config` and `custom_field_data` SQLite tables
- **Migration path:** Add `ClinicColumn` and `PatientCustomField` models to cloud backend. Add CRUD endpoints.
- **Complexity:** Medium — new models + endpoints + frontend already handles the UI
- **Data loss risk:** ⚠️ HIGH — existing custom column definitions and data will be lost

### BLOCKER 6 — Analytics (`/api/analytics/*`)
- **File:** `Analytics.jsx`
- **What it does:** 7 chart endpoints — patient growth, appointment stats, status distribution, etc.
- **Local dependency:** SQLite queries in local backend
- **Migration path:** Add analytics endpoints to cloud backend querying PostgreSQL. The queries are straightforward aggregations.
- **Complexity:** Medium — 7 endpoints, all read-only SQL aggregations
- **Data loss risk:** None — analytics are computed from existing data

### BLOCKER 7 — Clinic Settings (`/api/setup`)
- **File:** `TopBar.jsx`, `PatientDetail.jsx`
- **What it does:** Returns `doctor_name` and `clinic_name` for display
- **Local dependency:** `settings` SQLite table
- **Migration path:** Cloud already has `clinics` table with `name` and `doctor_user_id`. Add a `/api/clinics/me` endpoint that returns clinic info. Map `doctor_name` from the doctor's `User` record.
- **Complexity:** Low — endpoint already partially exists
- **Data loss risk:** Low — settings can be re-entered

---

## PART 3: WHAT IS ALREADY CLOUD-NATIVE

These features require **zero migration work**:

| Feature | File | Status |
|---------|------|--------|
| Secretary login | `JoinClinic.jsx` | ✅ Cloud-only |
| Doctor Google login | `main.js` + `JoinClinic.jsx` | ✅ Cloud-only |
| Secretary patient CRUD | `patientSyncService.js` | ✅ Cloud-only |
| Secretary appointments | `appointmentSyncService.js` | ✅ Cloud-only |
| Clinic chat (messages) | `ClinicChat.jsx` | ✅ Cloud-only |
| Notifications | `TopBar.jsx` | ✅ Cloud-only |
| Clinic management | `ClinicModal.jsx` | ✅ Cloud-only |
| Secretary management | `ClinicModal.jsx` | ✅ Cloud-only |
| JWT auth + refresh | `cloudApi.js` | ✅ Cloud-only |
| Token persistence | `tokenStore.js` | ✅ Electron disk |
| Session persistence | `userStore.js` | ✅ Electron disk |
| Sync queue | `syncQueueStore.js` | ✅ Electron disk |
| Realtime WebSocket | `cloudApi.js` | ✅ Cloud-only |
| Appointments page | `Appointments.jsx` | ✅ Uses `appointmentSyncService` |

---

## PART 4: RISKS AND BLOCKERS

### Data Loss Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Local patient data not in cloud | 🔴 HIGH | Run migration script before removing local backend |
| Local attachments not in MinIO | 🔴 HIGH | Upload all local files to MinIO before cutover |
| Custom column definitions lost | 🟠 MEDIUM | Export to JSON, re-import via new cloud API |
| Custom field values per patient lost | 🟠 MEDIUM | Include in patient migration script |
| AI chat history lost | 🟢 LOW | Stored in localStorage — survives if same machine |

### Technical Risks

| Risk | Severity | Notes |
|------|----------|-------|
| Groq API key must be in cloud `.env` | 🟠 MEDIUM | Currently only in local `.env` |
| Whisper on cloud needs audio upload | 🟠 MEDIUM | Audio blobs are large — need multipart upload to cloud |
| MinIO attachment URLs must be accessible | 🟠 MEDIUM | S3 presigned URLs or public bucket needed |
| Offline mode loses local DB fallback | 🟠 MEDIUM | Must implement proper offline queue for all writes |
| `patientSyncService.js` has complex merge logic | 🟡 LOW | Can be simplified once local DB is removed |

### Risky Migrations

1. **Attachments** — Files on local disk must be uploaded to MinIO before the local backend is removed. If a doctor has 100s of patient files, this migration must be automated and verified.

2. **Custom columns** — If a doctor has custom fields with patient data, this data must be migrated to the new cloud schema. The schema design (JSON column vs. separate table) affects query performance.

3. **Patient data** — Any patients created locally but not yet synced to cloud (e.g., created while offline and never reconnected) will be lost. The sync queue must be fully replayed before cutover.

---

## PART 5: MIGRATION PLAN

### Phase 1 — Cloud Backend Additions (No frontend changes)
**Estimated effort: 1–2 days**

Add these endpoints to `cloud-backend/app.py`:

1. **`GET /api/clinics/me`** — Returns clinic info (doctor_name, clinic_name)
   - Complexity: Low
   - Unblocks: TopBar clinic name, PatientDetail prescription

2. **`POST /api/chat`** — AI chat with patient context (Groq)
   - Complexity: Low (copy from local backend, add GROQ_API_KEY to cloud .env)
   - Unblocks: AIChat.jsx, PatientDetail prescription generation

3. **`POST /api/medical-reference`** — Medical knowledge queries (Groq)
   - Complexity: Low
   - Unblocks: MedicalReference.jsx

4. **`POST /api/transcribe`** — Audio transcription (Groq Whisper API)
   - Complexity: Medium (multipart file upload)
   - Unblocks: VoiceRecorder.jsx

5. **`GET/POST/DELETE /api/analytics/*`** — 7 analytics endpoints
   - Complexity: Medium (PostgreSQL aggregation queries)
   - Unblocks: Analytics.jsx

6. **Attachment model + endpoints** — `GET/POST/DELETE /api/patients/{id}/attachments`
   - Complexity: Medium (MinIO integration via existing storage_service.py)
   - Unblocks: PatientDetail file upload/download

7. **Custom columns endpoints** — `GET/POST/DELETE /api/columns`
   - Complexity: Medium (new model + endpoints)
   - Unblocks: PatientTable, PatientForm custom fields

---

### Phase 2 — Frontend Migration (Doctor mode → cloud-only)
**Estimated effort: 1 day**

1. **`Dashboard-New.jsx`** — Remove dual-read, use `fetchCloudPatients()` only for doctor
2. **`PatientForm.jsx`** — Remove local `api.post('/api/patients')`, use `cloudApi.post('/patients')` for doctor
3. **`patientSyncService.js`** — Remove `writeBackCloudId()`, remove `api.put()` write-back, simplify `mergePatients()` to cloud-only
4. **`appointmentSyncService.js`** — Remove doctor local path, use cloudApi for both roles
5. **`AIChat.jsx`** — Change `api.post('/api/chat')` → `cloudApi.post('/chat')`
6. **`MedicalReference.jsx`** — Change `api.post('/api/medical-reference')` → `cloudApi.post('/medical-reference')`
7. **`VoiceRecorder.jsx`** — Change `api.post('/api/transcribe')` → `cloudApi.post('/transcribe')`
8. **`Analytics.jsx`** — Change all `api.get('/api/analytics/*')` → `cloudApi.get('/analytics/*')`
9. **`TopBar.jsx`** — Remove `api.get('/api/setup')`, use `cloudApi.get('/clinics/me')`
10. **`PatientDetail.jsx`** — Remove `api.get('/api/setup')`, use `cloudApi.get('/clinics/me')`; change attachment calls to cloudApi

---

### Phase 3 — Electron Cleanup
**Estimated effort: 2 hours**

Remove from `main.js`:
- `startBackend()` function
- `stopBackend()` function
- `restartBackendForUser()` function
- `waitForBackend()` function
- `backendProcess` variable
- `backendStarting` variable
- `spawn` import from `child_process`
- `stopBackend()` calls in `before-quit`, `window-all-closed`, and `logout`

Remove from `preload.js`:
- `onBackendStartFailed` IPC bridge (no longer needed)

Remove from `App.jsx`:
- `backendFailed` state
- `onBackendStartFailed` listener
- Backend failure banner UI

---

### Phase 4 — Data Migration (Before cutover)
**Estimated effort: 1 day**

1. **Patient data** — Run sync queue replay to push all local patients to cloud
2. **Attachments** — Script to upload all files from `medidesk-ai/data/attachments/` to MinIO
3. **Custom columns** — Export column definitions + values, import via new cloud API
4. **Verify** — Confirm all local patient IDs have matching `global_id` in cloud

---

### Phase 5 — Remove Local Backend
**Estimated effort: 30 minutes**

After Phase 4 is verified:
- Remove `medidesk-ai/backend/` directory from the project
- Remove `medidesk-ai/backend/` from Electron build config (`package.json` extraResources)
- Remove Python runtime from Electron build
- Remove `api.js` from frontend (or keep as empty stub)
- Update `.gitignore`

---

## PART 6: RECOMMENDED MIGRATION ORDER

```
Priority 1 (Unblocks everything):
  → Add /api/clinics/me to cloud backend
  → Add /api/chat to cloud backend (Groq)
  → Add /api/medical-reference to cloud backend (Groq)

Priority 2 (Core data features):
  → Add analytics endpoints to cloud backend
  → Add attachment model + endpoints to cloud backend
  → Run patient data migration script

Priority 3 (Complete feature parity):
  → Add /api/transcribe to cloud backend (Groq Whisper)
  → Add custom columns endpoints to cloud backend
  → Migrate custom column data

Priority 4 (Frontend cutover):
  → Switch all api.js calls to cloudApi
  → Remove dual-write logic from patientSyncService
  → Remove dual-read logic from Dashboard-New

Priority 5 (Cleanup):
  → Remove Electron backend spawning code
  → Remove local backend directory
  → Remove Python from build
```

---

## PART 7: ESTIMATED MIGRATION COMPLEXITY

| Task | Effort | Risk | Priority |
|------|--------|------|----------|
| Add `/api/clinics/me` | 1h | Low | P1 |
| Add `/api/chat` (Groq) | 2h | Low | P1 |
| Add `/api/medical-reference` (Groq) | 1h | Low | P1 |
| Add `/api/transcribe` (Groq Whisper) | 3h | Medium | P2 |
| Add analytics endpoints (7 queries) | 4h | Low | P2 |
| Add attachment model + MinIO endpoints | 6h | Medium | P2 |
| Add custom columns model + endpoints | 4h | Medium | P3 |
| Patient data migration script | 2h | High | P2 |
| Attachment file migration to MinIO | 3h | High | P2 |
| Frontend: switch all api.js → cloudApi | 4h | Low | P3 |
| Frontend: remove dual-write/read logic | 3h | Medium | P3 |
| Electron: remove backend spawning code | 1h | Low | P4 |
| Remove local backend directory | 30m | Low | P5 |
| **TOTAL** | **~35h** | | |

---

## PART 8: FINAL VERDICT

**The migration is feasible and low-risk if done in order.**

The biggest risks are:
1. **Attachment data loss** — must migrate files to MinIO before removing local backend
2. **Unsynced patient data** — must replay offline queue before cutover
3. **Groq API key** — must be added to cloud `.env` before AI features work

The biggest wins from migration:
- Electron app no longer needs Python runtime bundled (~200MB saved)
- No more local SQLite — single source of truth in PostgreSQL
- Doctor and secretary have identical data views (no merge conflicts)
- Offline queue becomes simpler (no local DB to sync from)
- App startup is instant (no backend health polling)

**Recommended start:** Phase 1 (cloud backend additions) — no frontend changes, no risk, unblocks everything.
