# MediDesk AI — Complete Production Feature Audit
> Audit Date: April 11, 2026 | Auditor: Senior Architecture Review
> Methodology: Full static analysis of all source files across frontend, backend, Electron, and sync layers.

---

## 1. GLOBAL SUMMARY

### Overall System Health: **62% Production-Ready**

### Biggest Strengths
- JWT architecture is solid: no client-trusted role/clinic_id, tokens are short-lived, refresh logic is correct
- Electron IPC is clean: single `get-session` call on startup, no race conditions, no event listeners
- Secretary onboarding lifecycle (INVITED → ACTIVE) is well-designed
- Cloud backend clinic isolation is enforced at the JWT level
- Offline queue concept is correct (disk-based, survives restarts)
- AI/Voice features are functional and well-integrated

### Biggest Weaknesses
- Secretary has NO access to local backend (port 5000) — attachments, appointments, analytics, voice transcription all broken for secretary
- Sync conflict resolution does not exist — last-write-wins with no detection
- PatientDetail loads attachments/appointments from local API only — secretary sees nothing
- Analytics page is doctor-only by architecture but has no role guard
- No global error boundary in React — one crash kills the entire app
- `replayQueue` stops on first failure — queued items can be permanently lost
- GROQ_API_KEY printed to console on every backend start (security leak)

---

## 2. FEATURE-BY-FEATURE BREAKDOWN

---

### SECTION A: AUTHENTICATION

---

#### A1. Doctor Authentication (Google OAuth)
**STATUS: ⚠️ Working but risky**

**What Works:**
- Full OAuth PKCE flow via system browser
- Code exchange → Google access token → cloud JWT exchange
- Tokens saved atomically to disk (tokens.json)
- Session restored on restart via `get-session` IPC
- Window resizes correctly after login

**What's Wrong:**
- `googleAuth.js` reads `.env` from `backend/.env` — if that file is missing, CLIENT_ID/SECRET are undefined and the error message is cryptic
- Google access token is passed to cloud backend and then discarded — if the cloud is offline at login time, the doctor cannot log in at all (no offline doctor login)
- `startGoogleLogin()` has a 5-minute timeout but no UI countdown — user sees a frozen button
- `session.json` is written by `googleAuth.js` BEFORE the cloud JWT exchange succeeds — if cloud fails, session.json exists but tokens.json does not, causing a broken state on next restart

**Risk Level: Medium**
- In a real clinic, if the cloud backend is down during doctor login, the doctor is completely locked out even though their Google credentials are valid

**Fix:**
- Write `session.json` only after successful cloud JWT exchange (move `saveSession()` call to after `cloudRes` resolves in `main.js`)
- Add a visible countdown or cancel button during OAuth wait
- Cache last known doctor JWT with a longer expiry for offline-first doctor login

---

#### A2. Secretary Authentication (Password-based)
**STATUS: ✅ Working correctly**

**What Works:**
- Full INVITED → ACTIVE lifecycle enforced on backend
- Name normalization (`.lower()`) prevents case mismatch
- `set-password` endpoint strictly checks `status == "invited"` — no overwrite possible
- Login blocked if `status != "active"`
- JoinClinic.jsx correctly branches: check → set-password (invited) or login (active)
- Auto-login after activation works
- Error messages are user-friendly and specific
- Inputs clear error on change

**What's Wrong:**
- Secretary login goes through Electron IPC (`secretaryLogin`) which hits `127.0.0.1:8000` — if cloud is offline, secretary cannot log in and sees a generic timeout error
- No "forgot password" flow — if a secretary forgets their password, a doctor must manually reset it via DB (no endpoint exists)
- Secretary name is stored lowercase in DB but displayed lowercase in UI (e.g. "sara" instead of "Sara")

**Risk Level: Low-Medium**

**Fix:**
- Add `POST /api/clinic/secretaries/:id/reset-password` (doctor JWT required) to allow password reset
- Store a `display_name` field alongside the normalized `name` for UI display

---

#### A3. Session Persistence & Restoration
**STATUS: ⚠️ Working but risky**

**What Works:**
- `get-session` IPC returns tokens + clinic + googleUser in one call
- `App.jsx` loads everything into memory before any component renders
- No race conditions — sequential async init
- Logout clears all storage (localStorage, IndexedDB, cookies, cache)

**What's Wrong:**
- If `tokens.json` exists but the access token is expired AND the refresh token is also expired (after 30 days of inactivity), `cloudApi` will attempt a refresh, fail, and call `electronAPI.logout()` — but this happens silently on the first API call, not on startup. The user sees the dashboard briefly then gets kicked out
- Secretary session stores `name` (lowercase) in `clinic.json` but the TopBar displays `currentUser?.name` which is null for secretaries (only set for doctors via Google). Secretary name never appears in TopBar
- `useClinicSession.js` still writes to `localStorage` as fallback — this means stale data can persist across user switches in dev mode

**Risk Level: Medium**

**Fix:**
- On startup, proactively validate the access token expiry from the JWT payload before loading the dashboard. If expired, attempt refresh immediately and show a loading state
- In `secretary-login` IPC handler, set `currentUser = { name, role: 'secretary', clinicId }` so TopBar has a user object to display

---

### SECTION B: DASHBOARD & PATIENT MANAGEMENT

---

#### B1. Patient List (Doctor)
**STATUS: ✅ Working correctly**

**What Works:**
- Loads local patients + cloud patients merged by `cloud_id`
- Search filters by name, status, phone, email
- Stats bar (total, active, follow-up, urgent) calculated correctly
- Resizable left/right split panel with drag divider
- Offline banner shown when cloud is unreachable
- Stale cache shown when offline

**What's Wrong:**
- `mergePatients()` appends cloud-only patients but does NOT update local records with cloud data — if a secretary edits a patient on cloud, the doctor sees the old local version
- Patient list re-fetches on every `currentUser?.googleId` change but not on window focus — data can be stale after long idle periods
- No pagination — if a clinic has 500+ patients, the entire list loads at once

**Risk Level: Medium**

**Fix:**
- Add `window.addEventListener('focus', fetchPatients)` in Dashboard useEffect
- Implement merge-by-cloud_id that updates local records when cloud version is newer (compare `updated_at`)

---

#### B2. Patient List (Secretary)
**STATUS: ⚠️ Working but risky**

**What Works:**
- Secretary fetches from cloud only (`fetchCloudPatients`)
- Offline mode shows cached data with warning banner
- Add Patient button is disabled when offline

**What's Wrong:**
- `handlePatientSelect` calls `api.get('/api/patients/${patient.id}')` — this hits the LOCAL backend (port 5000) which does NOT exist for a secretary. Clicking a patient in the list will silently fail and `selectedPatient` stays null
- Secretary sees patient list but cannot open any patient detail

**Risk Level: HIGH**
- In a real clinic, a secretary cannot view any patient details — the core workflow is broken

**Fix:**
- In `Dashboard-New.jsx`, branch `handlePatientSelect` by role:
  - Secretary: use `cloudApi.get('/patients/${patient.id}')` (or use the already-loaded cloud patient object directly since it has all fields)
  - Doctor: keep existing local API call

---

#### B3. Patient Creation (Secretary)
**STATUS: ✅ Fixed (recent fix applied)**

**What Works:**
- Secretary now posts directly to `cloudApi.post('/patients')` bypassing local backend
- Duplicate detection uses cloud patient list
- Error surfaces via `alert()` on failure

**What's Wrong:**
- `alert()` for errors is poor UX — should be inline error state
- After successful creation, `fetchPatients()` re-fetches from cloud — correct, but there is a brief moment where the new patient is not visible (no optimistic update)
- `existingPatients` for duplicate detection is fetched once on mount — if another secretary adds a patient concurrently, the duplicate check misses it

**Risk Level: Low**

**Fix:**
- Replace `alert()` with inline error state in PatientForm
- Add optimistic update: append new patient to list immediately, then confirm with server response

---

#### B4. Patient Creation (Doctor)
**STATUS: ⚠️ Working but risky**

**What Works:**
- Saves to local DB first, then syncs to cloud
- If cloud sync fails, queues for later replay
- `cloud_id` written back to local record after successful sync

**What's Wrong:**
- If `api.post('/api/patients')` succeeds but `syncPatientToCloud` throws an unhandled exception (not a network error), the patient exists locally but is never queued — it will never reach the cloud
- `catch (error)` in `handleSubmit` only logs to console — no user feedback on failure
- Notes field is mandatory (`if (!formData.notes.trim()) alert(...)`) but the submit button is also disabled when notes is empty — double validation creates confusion

**Risk Level: Medium**

**Fix:**
- Wrap `syncPatientToCloud` in a try/catch that always enqueues on any failure, not just network errors
- Show inline error message instead of `alert()`

---

#### B5. Patient Edit
**STATUS: 🟡 Partial**

**What Works:**
- Doctor: local PUT + cloud update via `updateCloudPatient`
- Secretary: cloud PUT directly (recent fix)

**What's Wrong:**
- Secretary edit uses `patient.cloud_id || patient.id` — for cloud-fetched patients, `cloud_id` is set to `p.id` in `fetchCloudPatients` (via `{ ...p, cloud_id: p.id }`), so this works. But if a patient was created locally by a doctor and never synced, `cloud_id` is null and the secretary edit will hit `/patients/undefined` — a 404
- No optimistic update — UI freezes during save
- `updated_at` is sent in the cloud PUT body but the cloud backend ignores body fields for `updated_at` (it uses `onupdate=datetime.utcnow`) — harmless but misleading

**Risk Level: Medium**

**Fix:**
- Guard against null `cloud_id` in secretary edit path and show "Patient not synced to cloud yet" message

---

#### B6. Patient Delete
**STATUS: ⚠️ Working but risky**

**What Works:**
- Doctor: local DELETE works
- Confirmation dialog before delete

**What's Wrong:**
- Doctor delete only removes from local DB — the patient remains in cloud. Next sync will re-add the patient to the local list via `mergePatients`
- Secretary has no delete button (correct by design) but there is no explicit role guard — if a secretary somehow triggers delete, it calls `api.delete('/api/patients/...')` which hits local backend (fails silently)
- Cloud backend has a DELETE endpoint but it is never called from the frontend

**Risk Level: HIGH**
- Deleted patients reappear after next cloud sync — data integrity issue

**Fix:**
- Doctor delete must call both `api.delete('/api/patients/${id}')` AND `cloudApi.delete('/patients/${cloud_id}')` if `cloud_id` exists


---

### SECTION C: PATIENT DETAIL

---

#### C1. Patient Detail — Doctor
**STATUS: ⚠️ Working but risky**

**What Works:**
- Notes preview, full notes editor (NotesEditor modal)
- Attachments: upload, download, delete — all functional
- Voice recorder → Whisper transcription → appended to notes
- AI Chat panel with localStorage history per patient
- Timeline tab (patient events, attachments, appointments)
- PDF export via `window.open()` + `print()`
- Prescription generation (AI → editable → print)
- Resizable top/bottom split panel

**What's Wrong:**
- `loadAttachments()` and `loadAppointments()` call local `api` — if the selected patient is cloud-only (no local record), both return empty silently. Doctor sees "0 files" and no appointments for cloud-synced patients
- `handleTranscriptionComplete` calls `api.put('/api/patients/:id')` — fails for cloud-only patients
- `loadAppointments` fetches ALL appointments then filters by `patient_id === selectedPatient.id` — cloud patients have a different `id` than local, so this filter always returns empty for cloud-only patients
- AI Chat history stored in `localStorage` keyed by `patient.id` — cloud-only patients have a different id than local, so history is lost after sync

**Risk Level: Medium**

**Fix:**
- Detect cloud-only patients (`patient._fromCloud && !patient.local_id`) and route detail API calls through `cloudApi`
- Key AI Chat history by `cloud_id` when available

---

#### C2. Patient Detail — Secretary
**STATUS: ❌ Broken**

**What Works:**
- Empty state renders correctly
- AI Chat correctly hidden for secretary
- Prescription button correctly hidden for secretary

**What's Wrong:**
- Secretary can never reach this panel because `handlePatientSelect` in Dashboard calls local `api` (see B2)
- Even if selection worked: attachments, appointments, notes save, voice transcription all call local `api`
- Voice recorder is shown but transcription would fail (no local backend)
- "Open editor" button shown but save fails silently

**Risk Level: High**

**Fix:** Fix `handlePatientSelect` first (B2). Then audit every `api.*` call in `PatientDetail.jsx` and route through `cloudApi` for secretary.

---

### SECTION D: APPOINTMENTS

---

#### D1. Appointments — Doctor
**STATUS: ✅ Working correctly**

**What Works:**
- Week/Month/Day view switching
- Calendar date selection
- Create/edit/delete/confirm/reschedule
- Stats bar (this week, today, pending, urgent)
- Error state shown on load failure
- AppointmentModal pre-fills for reschedule

**What's Wrong:**
- `calculateStats` makes a redundant `GET /api/appointments` call on every view change — data already loaded
- No overlap/conflict detection when creating appointments at the same time slot
- `useEffect` re-runs on `currentUser?.googleId` change — unnecessary for local-only data

**Risk Level: Low**

**Fix:** Derive stats from already-loaded `weekAppointments` state instead of a separate API call.

---

#### D2. Appointments — Secretary
**STATUS: ❌ Broken**

**What Works:** Page renders without crashing.

**What's Wrong:**
- All appointment API calls target local backend (port 5000) — secretary has no local backend
- Page immediately shows "Failed to load appointments" error
- No cloud appointments endpoint exists in `cloud-backend/app.py`
- Secretary cannot create, view, or manage any appointments

**Risk Level: High** — Core secretary workflow (scheduling) is completely non-functional.

**Fix:**
- Add appointment CRUD endpoints to `cloud-backend/app.py`
- In `Appointments.jsx`, branch API calls by role: secretary uses `cloudApi`, doctor uses `api`

---

### SECTION E: ANALYTICS

---

#### E1. Analytics — Doctor
**STATUS: ✅ Working correctly**

**What Works:**
- All 7 endpoints called with `Promise.allSettled` — one failure doesn't break the page
- Charts render with empty states when no data
- `fillLast6Months` ensures 6 data points always shown
- Retry button on error

**What's Wrong:**
- Analytics reflects local data only — cloud patients and cloud appointments not included
- `recentActivity` sort is broken: sorts by formatted string ("2 hours ago", "Yesterday") alphabetically, not chronologically
- No date range filter

**Risk Level: Low**

**Fix:** Fix sort in `analytics_methods.py:get_recent_activity` — sort by raw `days_ago` float, not formatted string.

---

#### E2. Analytics — Secretary
**STATUS: ❌ Broken**

**What Works:** Page is accessible (no route guard).

**What's Wrong:**
- All API calls target local backend — secretary sees only errors
- No route guard — secretary can navigate to `/analytics`

**Risk Level: Medium**

**Fix:** Add route guard in `App.jsx` for `/analytics` (same pattern as `/medical-reference`).

---

### SECTION F: CLINIC CHAT

---

#### F1. Clinic Chat (Both Roles)
**STATUS: ⚠️ Working but risky**

**What Works:**
- Messages fetched from cloud every 5 seconds
- Send works for both roles
- Task toggle and task filter work
- Message bubbles differentiate own vs other
- Auto-scroll to latest message
- JWT auth via cloudApi interceptor

**What's Wrong:**
- 5-second polling creates constant network traffic — 12 requests/minute per user
- Send errors silently swallowed (`console.error` only) — user gets no feedback if message fails
- No message pagination — 1000+ messages loaded at once
- No optimistic update — message appears only after next poll (up to 5 seconds)
- No read receipts or online presence indicators
- Task "done" toggle exists in the data model but no UI to mark tasks done in ClinicChat

**Risk Level: Medium**

**Fix:**
- Add error state when `handleSend` fails
- Add optimistic message insertion before API call
- Replace polling with WebSocket or SSE for production

---

### SECTION G: ELECTRON IPC & BACKEND LIFECYCLE

---

#### G1. IPC Flows
**STATUS: ✅ Working correctly**

**What Works:**
- All handlers use `ipcMain.handle` (promise-based)
- `contextBridge` with `contextIsolation: true`
- Single `get-session` call on startup — no race conditions
- Logout clears all storage atomically

**What's Wrong:**
- `currentUser` is null for secretary — `ipcMain.handle('get-current-user')` returns null
- `ipcMain.handle('load-tokens')` exposed in preload but never called from React — dead code
- Secretary queue stored under `'anonymous'` key — collision risk between secretaries on same machine

**Risk Level: Low-Medium**

**Fix:**
- Set `currentUser = { name, role: 'secretary', clinicId }` in `secretary-login` handler
- Remove unused `load-tokens` IPC exposure
- Key secretary queue by `clinicId + '_' + name`

---

#### G2. Local Backend Lifecycle
**STATUS: ⚠️ Working but risky**

**What Works:**
- Backend starts with correct `MEDIDESK_USER_ID`
- Health polling before showing dashboard
- `restartBackendForUser` kills old process before starting new
- 5-second safety timeout prevents hanging

**What's Wrong:**
- `backendStarting` flag released immediately after `spawn()` — process may not be running yet
- If health check times out, dashboard loads with broken local API — no error shown
- On Windows, `process.kill()` may not free port 5000 immediately — new process gets "Address already in use"
- Backend logs go to `stdio: 'inherit'` — invisible in production build

**Risk Level: Medium**

**Fix:**
- Show visible error banner if health check times out: "Local backend failed to start"
- On Windows, use `taskkill /F /PID` for reliable process termination

---

### SECTION H: AI & VOICE

---

#### H1. AI Chat (Groq)
**STATUS: ✅ Working correctly**

**What Works:**
- Groq API with llama-3.1-8b-instant
- Patient context in system prompt
- DOMPurify sanitization on AI response output
- Chat history persisted in localStorage per patient
- Quick action buttons (summarize, next steps, risks, drug interactions)
- Clear chat button

**What's Wrong:**
- `GROQ_API_KEY` printed to console on every backend start — security leak in logs
- No rate limiting on `/api/chat`
- Chat history keyed by local `patient.id` — history lost when patient is cloud-only or after re-sync
- No conversation history sent to backend — AI has no memory within a session (each message is independent)

**Risk Level: Medium** (API key leak is High)

**Fix:** Remove `print("GROQ KEY:", os.getenv('GROQ_API_KEY'))` from `backend/app.py` immediately.

---

#### H2. Voice Transcription (Whisper)
**STATUS: ⚠️ Working but risky**

**What Works:**
- Whisper base model loaded once at startup
- ASCII-safe temp file path (fixes Windows non-ASCII username bug)
- ffmpeg availability checked before transcription
- 25MB file size limit enforced
- 60-second frontend timeout
- Temp file cleaned up in `finally` block

**What's Wrong:**
- Whisper model loads at startup — adds ~2-3 seconds startup time, uses ~150MB RAM permanently
- No maximum recording duration — doctor could record for hours
- `VoiceRecorder` calls local `/api/transcribe` — completely broken for secretary
- No language configuration — auto-detect may produce wrong language for French clinics
- ffmpeg missing produces a 500 error with a technical message — not user-friendly

**Risk Level: Medium**

**Fix:**
- Add max recording duration (10 minutes) in `VoiceRecorder.jsx`
- Pass `language` setting from clinic settings to transcription endpoint
- Hide voice recorder for secretary or add a cloud transcription endpoint

---

### SECTION I: SECURITY

---

#### I1. Critical Security Issues

| Issue | Location | Severity |
|-------|----------|----------|
| `password_hash` in API responses | `cloud-backend/app.py:serialize()` | HIGH |
| Legacy unauthenticated secretary creation | `POST /api/clinic/join` | HIGH |
| GROQ_API_KEY printed to stdout | `backend/app.py` | HIGH |
| Refresh token not rotated | `cloud-backend/auth_service.py` | MEDIUM |
| No token revocation | `cloud-backend/auth_service.py` | MEDIUM |
| No rate limiting on any endpoint | Both backends | MEDIUM |

#### I2. What's Correct
- JWT role/clinic_id never trusted from client
- bcrypt for password hashing
- DOMPurify on AI output
- contextIsolation in Electron
- Tokens in memory only (not localStorage)
- Logout clears all storage

---

## 3. TOP 10 PRIORITY FIXES (Ordered by Impact)

| # | Fix | File | Impact |
|---|-----|------|--------|
| 1 | Fix secretary patient detail — branch `handlePatientSelect` by role | `Dashboard-New.jsx` | Unblocks entire secretary workflow |
| 2 | Fix `replayQueue` — replace `break` with `continue` | `patientSyncService.js` | Prevents permanent data loss |
| 3 | Fix patient delete — also delete from cloud | `Dashboard-New.jsx` | Prevents ghost patients reappearing |
| 4 | Remove `password_hash` from `serialize()` | `cloud-backend/app.py` | Security: stops credential exposure |
| 5 | Remove legacy `POST /api/clinic/join` | `cloud-backend/app.py` | Security: closes unauthenticated account creation |
| 6 | Remove GROQ_API_KEY console print | `backend/app.py` | Security: stops API key leaking to logs |
| 7 | Add React Error Boundary | `App.jsx` | Prevents full app crash on component error |
| 8 | Add cloud appointments endpoints + secretary routing | `cloud-backend/app.py` + `Appointments.jsx` | Unblocks secretary appointment workflow |
| 9 | Add analytics route guard for secretary | `App.jsx` | Prevents broken page access |
| 10 | Set `currentUser` for secretary in IPC handler | `electron/main.js` | Fixes secretary name in TopBar |

---

## 4. HIDDEN RISKS

These are non-obvious issues that will cause serious problems in production:

**1. Ghost patients after delete**
Doctor deletes a patient locally. Cloud record remains. Next `fetchPatients()` call re-adds the patient via `mergePatients`. The patient is effectively undeletable from the doctor's perspective.

**2. Offline queue dead-lock for creates without cloud_id**
A doctor creates a patient offline. Queue item has `cloud_id: null`. On replay, `create` action is attempted. If it fails (still offline), the item stays in queue. If it succeeds but the `api.put` to write back `cloud_id` fails, the local record never gets a `cloud_id`. Future edits to this patient queue as `update` with `cloud_id: null` — the update path checks `if (!patient.cloud_id) return false` and silently does nothing.

**3. Secretary queue collision**
Two secretaries on the same machine (different logins) both have their offline queue stored as `sync_queue_anonymous.json`. Their queued operations overwrite each other.

**4. Broken state on partial login**
`googleAuth.js` writes `session.json` before the cloud JWT exchange. If the cloud is offline, `session.json` exists but `tokens.json` does not. On next app start, `loadSession()` returns the doctor user, `loadTokens()` returns null. `App.jsx` sets `clinicReady = false` (no tokens) and shows JoinClinic. But `session.json` still exists — next Google login will try to `restartBackendForUser` even though no backend was running. This is handled correctly by the guard, but the UX is confusing.

**5. AI chat history orphaned after sync**
AI chat history is stored in `localStorage` keyed by `patient.id` (local integer). After a patient is synced to cloud and the doctor switches machines, the new machine has a different local `id` for the same patient. All chat history is lost.

**6. Whisper model blocks backend startup**
`whisper.load_model("base")` is called at module import time in `whisper_service.py`. If the model file is missing or corrupted, the entire local backend fails to start with a cryptic error. The health check times out and the doctor sees an empty patient list with no explanation.

**7. Token expiry on long idle sessions**
Access token expires after 1 hour. If a doctor leaves the app open overnight without making any API calls, the access token expires. The next morning, the first API call triggers a refresh. If the refresh also fails (network issue), `electronAPI.logout()` is called — the doctor is logged out mid-session with no warning.

---

## 5. PRODUCTION READINESS VERDICT

### **READY WITH WARNINGS — for doctor-only usage**
### **NOT READY — for secretary usage**

**Doctor workflow** is approximately 75% production-ready. The core patient management, appointments, AI, and voice features work correctly. The main gaps are data integrity (delete not propagated to cloud, sync conflicts) and some edge cases in offline mode.

**Secretary workflow** is approximately 30% production-ready. Authentication and patient creation work. But patient detail, appointments, analytics, voice, and attachments are all broken. A secretary cannot perform their core job function of viewing and managing patient details.

**Before any real clinic deployment:**
- Fix the 5 P0 items (secretary detail, queue replay, delete sync, password_hash exposure, legacy endpoint)
- Add cloud appointments for secretary
- Add React Error Boundary
- Remove API key from logs
- Test offline → online transition thoroughly

