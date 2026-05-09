# MediDesk AI — System Architecture & State Report
> Generated: April 2026 | Role: Senior Architecture Review
> Purpose: Engineering reference for scaling, debugging, and onboarding

---

## 1. Project Overview

**MediDesk AI** is a desktop-first medical practice management application built as an Electron app. It enables a doctor to manage patients, appointments, notes, and AI-assisted workflows locally, with optional cloud sync for collaboration with a secretary.

### Core Goals
- Offline-first: doctor works without internet, data syncs when available
- Role separation: doctor has full local + cloud access; secretary is cloud-only
- AI-augmented: Groq LLM for patient chat + Whisper for voice-to-notes
- Clinic isolation: each clinic's data is strictly separated at the JWT level

### Target Users
| Role | Auth Method | Data Source | Backend Access |
|------|-------------|-------------|----------------|
| Doctor | Google OAuth → JWT | Local SQLite + Cloud | Local (5000) + Cloud (8000) |
| Secretary | Password → JWT | Cloud only | Cloud (8000) only |

### Key Features
- Patient CRUD with custom columns, attachments, voice notes
- Appointment calendar (day/week/month views)
- Doctor ↔ Secretary real-time-ish chat (5s polling)
- AI chat per patient (Groq llama-3.1-8b-instant)
- Voice transcription (OpenAI Whisper base model, local)
- Medical reference AI (doctor only)
- AI prescription generation (doctor only)
- Analytics dashboard (doctor only)
- Offline queue with disk persistence

---

## 2. System Architecture

### 2.1 Frontend (React — Electron Renderer Process)

**Entry point:** `frontend/src/index.jsx` → `App.jsx`

**State management:** No Redux/Zustand. Two layers:
- **In-memory module-level store** in `App.jsx` (`_session` object) — single source of truth for `clinicId`, `userRole`, `userName`
- **Component-local `useState`** for all UI state
- **`cloudApi.js` module-level variables** (`_accessToken`, `_refreshToken`) — JWT tokens in memory only

**Session handling:**
- On startup: `electronAPI.getSession()` IPC call returns `{ googleUser, tokens, clinic }` from disk
- Tokens loaded into `cloudApi` memory via `setCloudTokens()`
- Google ID loaded into `api.js` memory via `setUserId()` (sets `X-User-ID` header for local backend)
- Clinic session loaded into `App.jsx` memory via `setSession()`
- No localStorage dependency at runtime (localStorage kept only as dev fallback)

**IPC usage pattern:**
```
App.jsx (mount)
  → electronAPI.getSession()          // restore session from disk
  → setCloudTokens()                  // load JWT into cloudApi
  → setUserId()                       // load googleId into api.js
  → setSession()                      // load clinic into memory
```

**Two API clients:**
- `api.js` (axios, baseURL: `localhost:5000`) — local Flask backend, doctor only
- `cloudApi.js` (axios, baseURL: `localhost:8000/api`) — cloud Flask backend, both roles

**cloudApi interceptors:**
- Request: injects `Authorization: Bearer <token>` — rejects immediately if no token
- Response: on 401, attempts token refresh once, queues concurrent requests, retries. On refresh failure: clears tokens + calls `electronAPI.logout()`

---

### 2.2 Desktop Layer (Electron Main Process)

**Responsibilities:**
- Google OAuth flow (local HTTP server on port 9876 catches redirect)
- Secretary login (HTTP request to cloud backend)
- Local Flask backend process lifecycle (spawn/kill/restart)
- Disk file management (tokens.json, clinic.json, session.json, users.json, sync queues)
- Window management (size changes on login/logout)
- IPC bridge between renderer and OS

**Security model:**
- `contextIsolation: true`, `nodeIntegration: false` — renderer cannot access Node.js directly
- All sensitive operations (file I/O, process spawn, HTTP to cloud) happen in main process only
- `contextBridge` exposes only named functions — no raw IPC channel access

**File storage (Electron userData folder):**
```
%APPDATA%/medidesk-ai/
  tokens.json          → { accessToken, refreshToken }
  clinic.json          → { clinicId, userRole, userName }
  session.json         → { googleId }
  users.json           → { [googleId]: { name, email, picture, ... } }
  sync_queue_<id>.json → [ { action, patient, timestamp } ]
```

**Local backend orchestration:**
1. On doctor login: `startBackend(googleId)` spawns `python app.py` with `MEDIDESK_USER_ID=<googleId>`
2. Health polling: `GET localhost:5000/api/health` up to 20 × 300ms before showing dashboard
3. On user switch: `restartBackendForUser(newGoogleId)` kills old process, waits for exit, starts new
4. On app quit: `stopBackend()` kills process

---

### 2.3 Local Backend (Flask + SQLite, port 5000)

**Responsibilities:**
- Patient CRUD (local SQLite per user)
- Appointments CRUD
- File attachments (stored on disk, path in DB)
- Voice transcription (Whisper, runs locally)
- AI chat (Groq API call)
- Medical reference (Groq API call)
- Analytics (SQL aggregations on local data)
- Custom columns management

**Data scope:** Doctor-only. Each doctor has their own SQLite database at:
```
data/users/<googleId>/medidesk.db
data/users/<googleId>/attachments/
```

**Authentication model:** No JWT. Trusts `X-User-ID` header (set by `api.js` from `_googleId`). This is acceptable because Electron is a trusted environment — the header is set by the app, not by an external user.

**AI + Whisper integration:**
- Whisper `base` model loaded once at startup (`whisper_service.py`) — ~150MB RAM, ~2s startup cost
- Groq client initialized at startup with `GROQ_API_KEY` from `.env`
- Transcription: audio saved to temp file → Whisper → temp file deleted
- AI chat: patient context injected into system prompt, single-turn (no history on backend)

---

### 2.4 Cloud Backend (Flask + SQLite, port 8000)

**Responsibilities:**
- Doctor authentication (Google token → JWT)
- Secretary authentication (password → JWT)
- Secretary lifecycle management (invited → active)
- Patient sync (shared across doctor + secretary)
- Clinic chat messages
- Clinic and user management

**Multi-user handling:**
- Each clinic is identified by a unique `MEDI-XXXXX` ID
- All data is scoped by `clinic_id` extracted from JWT — never from request body
- Multiple secretaries per clinic supported
- SQLite used currently (single file `cloud.db`) — not suitable for multi-server deployment

**JWT system:**
```
Access token:  1 hour  (HS256, payload: sub, role, clinic_id, type="access")
Refresh token: 30 days (HS256, payload: sub, role, clinic_id, type="refresh")
```
- `verify_jwt` decorator: validates token, sets `g.user_id`, `g.role`, `g.clinic_id`
- `require_role(*roles)`: must be applied after `verify_jwt`
- Refresh endpoint: issues new access token only (refresh token NOT rotated — risk)

**Clinic isolation:**
- Every protected route reads `clinic_id` from `g.clinic_id` (JWT)
- No route accepts `clinic_id` from request body for data access decisions
- Exception: `/api/auth/secretary/*` endpoints use `clinic_id` from body for lookup only (safe — used for authentication, not authorization)

---

## 3. Data Model & Identity System

### Identity Fields Per Patient

| Field | Source | Scope | Notes |
|-------|--------|-------|-------|
| `id` (local) | SQLite autoincrement | Doctor's local DB | Changes per machine |
| `cloud_id` | Cloud DB autoincrement | Shared across clinic | Written back to local after sync |
| `_fromCloud` | Runtime flag | In-memory only | Set by `fetchCloudPatients()` |

**There is no global UUID.** The system uses `cloud_id` as the shared identifier. This is a design limitation — if a patient is created locally and never synced, they have no cross-device identity.

### Merge Strategy (Doctor)
```
mergePatients(local[], cloud[])
  → Build Set of known cloud_ids from local records
  → Append cloud patients NOT in that set
  → Result: local records + cloud-only records
```
**Gap:** Cloud updates to existing local records are NOT merged — local version wins.

### Entity Relationships (Cloud DB)
```
Clinic (id: MEDI-XXXXX)
  ├── User[] (role: doctor | secretary, status: invited | active)
  ├── Patient[] (clinic_id FK)
  └── Message[] (clinic_id FK)
```

### Entity Relationships (Local DB, per doctor)
```
patients (id, full_name, phone, email, notes, appointment, status, cloud_id, ...)
appointments (id, patient_id, patient_name, appointment_date, start_time, end_time, status)
columns_config (id, column_name, column_type, is_default)
custom_field_data (patient_id, column_id, field_value)
attachments (id, patient_id, file_name, file_path, file_type)
settings (doctor_name, clinic_name, language)
```

### Migration Strategy
- `migrate.py` (cloud): adds columns with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` pattern — safe to run multiple times
- Local DB: `Database.__init__` creates tables on first run — no migration script for schema changes
- **Risk:** If local DB schema changes, existing doctor databases are not migrated automatically

---

## 4. Sync System

### 4.1 Doctor Flow (Local → Cloud)

```
PatientForm.handleSubmit()
  1. api.post('/api/patients')          → local DB, returns local_id
  2. syncPatientToCloud({ ...data, id: local_id })
       → cloudApi.post('/patients')     → cloud DB, returns cloud_id
       → on success: api.put('/api/patients/:local_id', { cloud_id })
       → on failure: enqueue({ action: 'create', patient, timestamp })
  3. setSyncStatus('synced' | 'offline')
```

**Edit flow:**
```
  1. api.put('/api/patients/:local_id')  → local DB
  2. updateCloudPatient({ ...data, cloud_id })
       → cloudApi.put('/patients/:cloud_id')
       → on failure: enqueue({ action: 'update', patient, timestamp })
```

### 4.2 Secretary Flow (Cloud Only)

```
PatientForm.handleSubmit()
  → cloudApi.post('/patients')   (create)
  → cloudApi.put('/patients/:cloud_id')  (edit)
  No local DB involved. No queue needed.
```

### 4.3 Offline Queue

**Storage:** `sync_queue_<userId>.json` in Electron userData via IPC

**Queue item shape:**
```json
{
  "action": "create" | "update",
  "patient": { ...patientData, "id": localId, "cloud_id": cloudId | null },
  "timestamp": 1712345678000
}
```

**Enqueue logic:**
- `create`: always appended
- `update`: replaces existing entry for same `cloud_id` (deduplication)

**Replay logic (`replayQueue`):**
```
Called on: Dashboard mount, after reconnect
For each item:
  create → cloudApi.post('/patients') → write cloud_id back to local DB
  update → cloudApi.put('/patients/:cloud_id')
  on failure → push to remaining[], BREAK (stops processing)
saveQueue(remaining)
```

**Critical flaw:** `break` on first failure means items 2..N are never retried even if they would succeed independently.

### 4.4 Conflict Handling

**Current state: None.** Last write wins.

- No `version` field on patients
- No `updated_at` comparison during merge
- No conflict detection on cloud PUT
- If doctor and secretary edit the same patient simultaneously, the last HTTP request to reach the server wins

### 4.5 Duplicate Prevention

- Frontend: checks existing patients by name/phone/email before submit (stale — fetched once on mount)
- Backend: no unique constraint on patient name/phone — duplicates can be created
- Sync: no idempotency key — network timeout after server processes request creates duplicate

---

## 5. Core Features Breakdown

### 5.1 Patient Management

| Feature | Doctor | Secretary |
|---------|--------|-----------|
| List patients | ✅ Local + Cloud merged | ✅ Cloud only |
| View patient detail | ✅ Local API | ❌ Broken (calls local API) |
| Create patient | ✅ Local → Cloud sync | ✅ Cloud direct |
| Edit patient | ✅ Local + Cloud update | ⚠️ Cloud only (cloud_id required) |
| Delete patient | ⚠️ Local only (cloud not deleted) | ❌ No endpoint |
| Attachments | ✅ Local disk | ❌ No cloud attachment support |
| Voice notes | ✅ Local Whisper | ❌ No cloud transcription |
| Custom columns | ✅ Local DB | ❌ Not available (local API) |
| AI Chat | ✅ Doctor only | — |
| Export PDF | ✅ | ⚠️ May be blocked |

### 5.2 Appointment System

| Feature | Doctor | Secretary |
|---------|--------|-----------|
| View appointments | ✅ Local | ❌ No cloud endpoint |
| Create appointment | ✅ Local | ❌ Broken |
| Edit/delete | ✅ Local | ❌ Broken |
| Status handling | ✅ pending/confirmed/cancelled/urgent | — |
| Conflict detection | ❌ None | — |

### 5.3 Clinic Chat (Messaging)

- **Polling:** `setInterval(fetchMessages, 5000)` — 5-second refresh
- **Message types:** regular text + task (flagged with `is_task: true`)
- **Task status:** pending/done, togglable by both roles
- **UI:** chat bubbles, own vs other differentiation, task badge
- **Limitations:** no read receipts, no pagination, no real-time push, send errors silent

### 5.4 Analytics

- **Scope:** Local SQLite only — does not include cloud patients
- **Charts:** Patient growth (area), appointments/month (bar), status distribution (pie), busiest days (bar), recent activity (feed)
- **Empty states:** handled gracefully with placeholder UI
- **Access:** Doctor only (route guard in App.jsx) — but Analytics page itself has no guard

### 5.5 AI System

**Groq (llama-3.1-8b-instant):**
- Patient AI chat: stateful in localStorage per patient, stateless on backend (no history sent)
- Medical reference: category-aware system prompt, doctor only
- Prescription generation: JSON-structured response, editable before print
- Response sanitized with DOMPurify before rendering (XSS protection in place)

**Whisper (base model):**
- Loaded once at startup, runs locally
- Supports: webm, wav, mp3 (via ffmpeg)
- Output appended to patient notes
- Doctor only (secretary has no local backend)

---

## 6. Security Model

### Trust Assumptions
- Electron main process is trusted — it controls file I/O, process spawn, and HTTP requests
- Renderer process is untrusted — no Node.js access, all sensitive ops via IPC
- Local backend (port 5000) trusts `X-User-ID` header — acceptable because only Electron sets it
- Cloud backend trusts JWT only — no client-supplied role or clinic_id accepted

### Token Handling
- Access tokens: in-memory only (`cloudApi.js` module variable) — not in localStorage
- Refresh tokens: in-memory + persisted to `tokens.json` via IPC
- On 401: automatic refresh with request queuing — concurrent requests don't cause multiple refresh calls
- On refresh failure: full logout + storage clear

### API Protection
| Endpoint Group | Auth | Role Check |
|----------------|------|------------|
| `/api/auth/*` | None (public) | N/A |
| `/api/clinic/secretaries/create` | JWT | Doctor only |
| `/api/patients/*` | JWT | Both roles |
| `/api/messages/*` | JWT | Both roles |
| Local `/api/*` | X-User-ID header | None (trusted env) |

### Known Security Issues
1. `password_hash` returned in `serialize()` output — exposed in `/api/clinic/<id>` response
2. `POST /api/clinic/join` (legacy) allows unauthenticated secretary creation
3. `GROQ_API_KEY` printed to stdout on every backend start
4. No token revocation — stolen tokens valid until expiry
5. Refresh token not rotated on use

---

## 7. Current System State

### Fully Working
- Doctor authentication (Google OAuth → JWT)
- Secretary authentication (password lifecycle)
- Session persistence and restoration
- Doctor patient list (local + cloud merge)
- Doctor patient creation with cloud sync
- Doctor appointments (full CRUD)
- Clinic chat (both roles)
- AI chat (doctor, per patient)
- Voice transcription (doctor)
- Medical reference (doctor)
- Prescription generation (doctor)
- Analytics (doctor, local data)
- Offline queue (create/update, disk-based)
- JWT system (access + refresh)
- Clinic isolation

### Partially Working
- Secretary patient list (visible but detail broken)
- Secretary patient creation (works, poor error UX)
- Secretary patient edit (works if cloud_id present)
- Offline mode (doctor: local fallback works; secretary: in-memory cache only)
- Patient delete (local only, cloud record persists)
- Sync merge (appends cloud-only, does not update existing)

### Broken / Not Working
- Secretary patient detail view
- Secretary appointments (no cloud endpoint)
- Secretary analytics (no cloud endpoint + no route guard)
- Secretary voice transcription
- Secretary attachments
- Secretary custom columns
- Sync conflict resolution
- Offline queue replay (stops on first failure)
- Patient delete from cloud

---

## 8. Technical Debt & Risks

### High Risk
| Risk | Location | Impact |
|------|----------|--------|
| Secretary cannot view patient details | `Dashboard-New.jsx:handlePatientSelect` | Core workflow broken |
| `replayQueue` stops on first failure | `patientSyncService.js:replayQueue` | Queued edits permanently lost |
| Patient delete doesn't remove from cloud | `Dashboard-New.jsx:handleDeletePatient` | Deleted patients reappear |
| `password_hash` in API responses | `cloud-backend/app.py:serialize()` | Security leak |
| Legacy `/api/clinic/join` endpoint | `cloud-backend/app.py` | Unauthenticated account creation |
| No React Error Boundary | `App.jsx` | Single component crash kills app |

### Medium Risk
| Risk | Location | Impact |
|------|----------|--------|
| No sync conflict detection | `patientSyncService.js` | Silent data loss on concurrent edits |
| `session.json` written before cloud JWT | `googleAuth.js` | Broken state on cloud failure |
| Refresh token not rotated | `cloud-backend/auth_service.py` | Stolen refresh token valid 30 days |
| 5s polling for chat | `ClinicChat.jsx` | Server load at scale |
| No pagination on patient list | `cloud-backend/app.py` | Performance at 500+ patients |
| Secretary queue keyed as 'anonymous' | `main.js:loadQueue` | Queue collision between secretaries |
| GROQ_API_KEY printed to console | `backend/app.py` | API key in logs |

### Low Risk
| Risk | Location | Impact |
|------|----------|--------|
| SQLite for cloud backend | `cloud-backend/database.py` | Not suitable for multi-server |
| Whisper base model at startup | `whisper_service.py` | 150MB RAM always consumed |
| No message pagination | `ClinicChat.jsx` | Memory at 1000+ messages |
| Analytics sort bug | `analytics_methods.py:get_recent_activity` | Wrong activity order |
| No rate limiting on AI endpoints | `backend/app.py` | API cost abuse |

---

## 9. Scalability Readiness

### Ready for Scale
- JWT architecture scales horizontally (stateless)
- Clinic isolation is clean — adding more clinics requires no schema changes
- Cloud backend is RESTful — can be put behind a load balancer
- Offline queue is per-user — no shared state

### Will Break Under Load
| Component | Breaking Point | Reason |
|-----------|---------------|--------|
| SQLite cloud DB | ~10 concurrent writes | SQLite has write lock — use PostgreSQL |
| 5s chat polling | ~50 concurrent users | 50 × 12 req/min = 600 req/min per server |
| `GET /api/patients` (no pagination) | ~500 patients | Full table scan returned as JSON |
| Whisper model (local) | N/A (local per doctor) | Not a cloud scaling concern |
| `replayQueue` (sequential) | Large queues | Processes one item at a time |

---

## 10. Recommended Next Steps (Priority Order)

### P0 — Fix Before Any Real Usage
1. **Fix secretary patient detail** — branch `handlePatientSelect` by role in `Dashboard-New.jsx`. Use cloud patient object directly (already has all fields) instead of re-fetching from local API.
2. **Fix `replayQueue` stop-on-failure** — replace `break` with `continue` in `patientSyncService.js`. Items should be retried independently.
3. **Fix patient delete** — call `cloudApi.delete('/patients/:cloud_id')` alongside local delete in `Dashboard-New.jsx`.
4. **Remove `password_hash` from serialize()** — add exclusion list in `cloud-backend/app.py`.
5. **Remove legacy `/api/clinic/join`** — superseded by new secretary creation flow.

### P1 — Core Secretary Workflow
6. **Add cloud appointments endpoints** — secretary needs to create/view appointments. Add CRUD to `cloud-backend/app.py`.
7. **Fix secretary name display** — set `currentUser` in `secretary-login` IPC handler in `main.js`.
8. **Add analytics route guard** — same pattern as `/medical-reference` in `App.jsx`.
9. **Fix offline queue key for secretary** — use `clinicId + userName` instead of `googleId || 'anonymous'`.

### P2 — Stability & UX
10. **Add React Error Boundary** — wrap routes in `App.jsx` with a fallback UI.
11. **Replace `alert()` with inline errors** — in `PatientForm.jsx` and anywhere else using `alert()`.
12. **Proactive token validation on startup** — decode JWT expiry before loading dashboard, refresh if needed.
13. **Remove GROQ_API_KEY console print** — delete `print("GROQ KEY:", ...)` from `backend/app.py`.
14. **Rotate refresh tokens** — issue new refresh token on each refresh call in `cloud-backend/auth_service.py`.

### P3 — Data Integrity
15. **Sync conflict detection** — add `version` or `updated_at` comparison in merge and cloud PUT.
16. **Persist secretary offline cache to disk** — write `cachedCloudPatients` to a file via IPC so it survives restarts.
17. **Add idempotency key to patient creation** — prevent duplicate cloud records on network timeout.
18. **Migrate cloud backend to PostgreSQL** — required before multi-server deployment.

### P4 — Performance & Scale
19. **Replace chat polling with WebSocket or SSE** — eliminate 5s polling overhead.
20. **Add pagination to patient list** — `GET /api/patients?limit=50&offset=0`.
21. **Add rate limiting to AI endpoints** — prevent API cost abuse.
22. **Add queue size cap and item expiry** — prevent unbounded queue growth.
