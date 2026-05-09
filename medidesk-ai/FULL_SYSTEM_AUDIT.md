# MediDesk AI — Full System Audit
> Date: April 9, 2026  
> Status: Pure analysis. No code changes. No fixes proposed.  
> Purpose: Build a complete mental model of the system before any refactor.

---

## 1. GLOBAL ARCHITECTURE

### How the system is structured

```
┌─────────────────────────────────────────────────────────────────┐
│                        ELECTRON SHELL                           │
│  main.js — app lifecycle, IPC, backend spawn, session inject    │
│  preload.js — exposes electronAPI bridge to React               │
│  googleAuth.js — OAuth flow via system browser                  │
│  userStore.js — users.json, session.json, clinic.json on disk   │
│  tokenStore.js — tokens.json on disk                            │
└────────────────────┬────────────────────────────────────────────┘
                     │ IPC (contextBridge)
┌────────────────────▼────────────────────────────────────────────┐
│                     REACT FRONTEND (port 3000 dev)              │
│  App.jsx — root, session init, routing                          │
│  JoinClinic.jsx — onboarding (doctor + secretary)               │
│  Dashboard-New.jsx — patient list + detail                      │
│  cloudApi.js — axios instance for port 8000 (JWT attached)      │
│  api.js — axios instance for port 5000 (X-User-ID attached)     │
│  patientSyncService.js — merge local + cloud patients           │
│  useClinicSession.js — localStorage read/write helpers          │
└──────────┬──────────────────────────────┬───────────────────────┘
           │ HTTP (localhost:5000)         │ HTTP (localhost:8000)
┌──────────▼──────────┐        ┌──────────▼──────────────────────┐
│  LOCAL BACKEND      │        │  CLOUD BACKEND                  │
│  Flask (port 5000)  │        │  Flask (port 8000)              │
│  SQLite per user    │        │  SQLite shared (cloud.db)        │
│  Whisper, Groq AI   │        │  JWT auth, clinic, patients,     │
│  Appointments       │        │  messages, secretary accounts    │
│  Attachments        │        │                                  │
└─────────────────────┘        └─────────────────────────────────┘
```

### Doctor flow (step by step)

1. Electron starts → checks `session.json` on disk
2. If session exists → starts local Flask backend with `MEDIDESK_USER_ID=googleId`
3. Loads login window → then immediately loads dashboard URL
4. `did-finish-load` fires → Electron injects `clinic_id`, `user_role`, `user_name` into `localStorage` via `executeJavaScript`
5. Electron sends `clinic-session-ready` IPC event
6. React `App.jsx` receives signal → `hasSession()` returns true → renders dashboard
7. Dashboard fetches patients from BOTH local (port 5000) and cloud (port 8000), merges them
8. Doctor can use all features: patients, appointments, AI, voice, analytics, medical reference

### Secretary flow (step by step)

1. Electron starts → no `session.json` (secretary has no Google login)
2. Login window shown → secretary picks "Secretary" role
3. Enters Name + Clinic ID + Password → POST to cloud `/api/auth/secretary/login`
4. Cloud returns JWT pair → saved to `tokens.json` on disk
5. `saveSession()` writes `clinic_id`, `user_role`, `user_name` to `localStorage` AND `clinic.json`
6. `onJoined()` callback fires → `clinicReady = true` → dashboard renders
7. Dashboard fetches patients from cloud ONLY (no local backend access)
8. Secretary cannot access: analytics, medical reference, voice transcription (local-only features)

---

## 2. LOCAL BACKEND (PORT 5000)

### What it handles

- Patient CRUD (SQLite, per-user database)
- Appointments (full calendar system)
- File attachments (upload, serve, delete)
- AI chat (via Groq API)
- Voice transcription (Whisper local model)
- Medical reference (via Groq/LLaMA)
- Analytics (patient stats, appointment stats)
- Custom columns (per-doctor schema)
- Settings (doctor name, clinic name, language)

### How it is started

`main.js` calls `spawn('python', ['app.py'], { env: { MEDIDESK_USER_ID: googleId } })`  
The backend is a child process of Electron. It dies when Electron dies.  
On user switch, the old process is killed and a new one is spawned with the new `googleId`.

### How it identifies the user

`MEDIDESK_USER_ID` environment variable is set at spawn time.  
The local backend uses this to determine which SQLite database file to use.  
The frontend also sends `X-User-ID: googleId` header on every request via `api.js` interceptor.  
**There is no JWT on the local backend. It trusts the header.**

### Local data storage

- Database: `../data/medidesk.db` (relative to backend folder)
- Attachments: `data/attachments/<patient_id>/<filename>`
- Temp audio: `backend/temp/` (cleaned after transcription)
- The database path is per-user because `MEDIDESK_USER_ID` controls which DB is loaded

### Which features depend ONLY on local backend

- Voice transcription (Whisper runs locally)
- Appointments
- File attachments
- AI chat (Groq key is in local `.env`)
- Medical reference
- Analytics
- Custom columns
- Patient notes (rich text)

### What breaks if local backend is OFF

- Doctor cannot see patients (local half of merge fails, only cloud patients shown)
- All appointments are inaccessible
- All attachments are inaccessible
- AI chat fails
- Voice transcription fails
- Analytics fail
- Medical reference fails
- Secretary is unaffected (uses cloud only)

---

## 3. CLOUD BACKEND (PORT 8000)

### What it handles

- Google OAuth verification (`/api/auth/google`)
- Secretary login with password (`/api/auth/secretary/login`)
- JWT generation (access token: 24h, refresh token: 30 days)
- JWT refresh (`/api/auth/refresh`)
- Clinic creation and lookup
- Secretary account creation and password management
- Patient CRUD (shared across doctor + secretary)
- Messaging between doctor and secretary

### Database structure (SQLite — cloud.db)

```
clinics
  id (MEDI-XXXXX), doctor_user_id, name, created_at

users
  id, name, role (doctor|secretary), clinic_id
  google_id (nullable), email (nullable)
  password_hash (nullable — secretaries only)

patients
  id, clinic_id, full_name, phone, email, notes
  appointment, status, updated_by, created_at, updated_at

messages
  id, clinic_id, sender_role, text, is_task, status, created_at
```

### Multi-user logic

- Doctor and secretary share the same `clinic_id`
- All patient reads/writes are scoped to `g.clinic_id` from the JWT
- `updated_by` field records which role last modified a patient
- Messages are scoped to clinic — both roles can read and write
- Only doctors can delete patients (`@require_role("doctor")`)
- Only doctors can set secretary passwords

### What breaks if cloud backend is OFF

- Secretary cannot log in at all
- Secretary cannot see any patients
- Doctor loses shared patient visibility (falls back to local only)
- Messaging system is completely unavailable
- New doctor registration fails (but existing session may still work locally)
- Patient sync fails silently (offline queue kicks in)

---

## 4. AUTHENTICATION SYSTEM (CURRENT STATE)

### Doctor login flow

```
1. User clicks "Continue with Google" in JoinClinic.jsx
2. electronAPI.startLogin() → IPC → main.js → googleAuth.js
3. googleAuth.js opens system browser with Google OAuth URL
4. Local HTTP server on port 9876 catches the redirect callback
5. Authorization code exchanged for tokens via Google's token endpoint
6. Google access token used to fetch user info (name, email, googleId)
7. User saved to users.json, googleId saved to session.json
8. googleAccessToken attached to user object and sent back to renderer
9. JoinClinic.jsx receives user via 'login-success' IPC event
10. POST /api/auth/google with googleAccessToken → cloud verifies with Google
11. Cloud returns JWT access_token + refresh_token + clinic_id
12. setCloudTokens() saves tokens to memory AND tokens.json on disk
13. saveSession() writes clinic_id, user_role, user_name to localStorage + clinic.json
14. onJoined() fires → App.jsx sets clinicReady = true → dashboard renders
```

### Secretary login flow

```
1. Secretary enters Name + Clinic ID + Password in JoinClinic.jsx
2. POST /api/auth/secretary/login to cloud
3. Cloud looks up User by clinic_id + name + role='secretary'
4. bcrypt password check
5. JWT pair returned
6. setCloudTokens() saves to memory + tokens.json
7. saveSession() writes to localStorage + clinic.json
8. onJoined() fires → dashboard renders
```

### JWT structure

```json
{
  "sub": "user_id",
  "role": "doctor|secretary",
  "clinic_id": "MEDI-XXXXX",
  "iat": <issued_at>,
  "exp": <expiry>,
  "type": "access|refresh"
}
```

Access token: 24 hours  
Refresh token: 30 days  
Secret: `JWT_SECRET` env var (defaults to `"change-me-in-production"` — **not changed**)

### Where tokens are stored

| Storage | What | Who writes | Who reads |
|---|---|---|---|
| `tokens.json` (disk) | access + refresh JWT | `tokenStore.js` via IPC | `initCloudAuth()` on startup |
| In-memory (`_accessToken`, `_refreshToken`) | JWT for current session | `setCloudTokens()` | `cloudApi.js` interceptor |
| `localStorage` | `clinic_id`, `user_role`, `user_name` | `saveSession()` / Electron injection | `getSession()`, `hasSession()` |
| `clinic.json` (disk) | `clinic_id`, `user_role`, `user_name` | `saveClinicSession()` via IPC | Electron `did-finish-load` injection |
| `session.json` (disk) | `googleId` | `googleAuth.js` | `main.js` on startup |
| `users.json` (disk) | full user profile | `googleAuth.js` | `main.js` on startup |

### How Authorization header is attached

`cloudApi.js` request interceptor:
```js
if (_accessToken) {
  config.headers['Authorization'] = `Bearer ${_accessToken}`;
}
```
If `_accessToken` is null (not yet loaded), the header is simply not sent → 401.

### How backend validates user

`@verify_jwt` decorator in `auth_service.py`:
- Reads `Authorization: Bearer <token>` header
- Decodes with `JWT_SECRET`
- Sets `g.user_id`, `g.role`, `g.clinic_id`
- Returns 401 if missing or invalid

### When user is considered "logged in"

The app considers the user logged in when `hasSession()` returns true, which checks only:
```js
!!localStorage.getItem('clinic_id')
```
**This is the root of the auto-logout bug.** `clinic_id` in localStorage is the only gate. If localStorage is cleared for any reason, the user is logged out — even if valid tokens exist on disk.

### What causes logout

1. `localStorage` is cleared (Electron clears it on logout via `clearStorageData`)
2. App reloads before Electron's `did-finish-load` injection completes
3. `clinic-session-ready` IPC event fires before `executeJavaScript` finishes (race condition)
4. The 5-second timeout in `App.jsx` expires before the signal arrives
5. `tokens.json` exists but `initCloudAuth()` hasn't run yet when the first cloud request fires → 401 → token refresh attempted → if refresh also fails → tokens cleared → session appears broken

---

## 5. SESSION MANAGEMENT

### All session storage mechanisms

#### `session.json` (Electron userData folder)
- Written by: `googleAuth.js` → `saveSession(googleId)`
- Read by: `main.js` on `app.whenReady()` to restore previous login
- Contains: `{ googleId: "..." }`
- Purpose: Remembers which Google user was last logged in so Electron can auto-start their backend

#### `users.json` (Electron userData folder)
- Written by: `googleAuth.js` → `upsertUser()`
- Read by: `main.js` → `loadSession()` → `getUser(googleId)`
- Contains: full user profile (name, email, picture, lastLogin)
- Purpose: Local user registry — avoids re-fetching from Google on every start

#### `clinic.json` (Electron userData folder)
- Written by: `saveClinicSession()` via IPC from React
- Read by: `main.js` `did-finish-load` handler → injected into localStorage
- Contains: `{ clinicId, userRole, userName }`
- Purpose: Persist clinic session across app restarts

#### `tokens.json` (Electron userData folder)
- Written by: `tokenStore.js` via IPC from React
- Read by: `initCloudAuth()` in `cloudApi.js` on app startup
- Contains: `{ accessToken, refreshToken }`
- Purpose: Persist JWT so cloud API works after restart without re-login

#### `localStorage` (Electron BrowserWindow)
- Written by: Electron injection (`executeJavaScript`) + `saveSession()` in React
- Read by: `hasSession()`, `getSession()` throughout the app
- Contains: `clinic_id`, `user_role`, `user_name`
- Purpose: Runtime session state for React components
- **Cleared on logout** by `clearStorageData()` in main.js

### What happens on app start

```
app.whenReady()
  → loadSession() reads session.json
  → if found: startBackend(googleId), waitForBackend(), createLoginWindow(), loadDashboard()
  → if not found: createLoginWindow() only (no backend started yet)

loadDashboard()
  → mainWindow.loadURL(reactApp)
  → did-finish-load fires
  → loadClinicSession() reads clinic.json
  → executeJavaScript injects clinic_id, user_role, user_name into localStorage
  → sends 'clinic-session-ready' IPC event

React App.jsx useEffect
  → initCloudAuth() loads tokens.json into memory
  → getCurrentUser() gets user from main.js memory
  → setUserId(googleId) sets X-User-ID for local API
  → hasSession() checks localStorage
  → if true: setClinicReady(true), setLoading(false) → dashboard renders
  → if false: waits for 'clinic-session-ready' event (5s timeout)
```

### What happens after login (doctor)

```
JoinClinic.jsx handleDoctorLogin()
  → startLogin() IPC → googleAuth.js → OAuth flow
  → 'login-success' event fires with user object
  → POST /api/auth/google → JWT returned
  → setCloudTokens() → tokens.json written
  → saveSession() → localStorage + clinic.json written
  → onJoined(user) → App.jsx sets clinicReady = true
  → Dashboard renders
```

### What happens on page refresh

```
Electron reloads the React app URL
  → localStorage is CLEARED (Electron BrowserWindow behavior on reload)
  → did-finish-load fires again
  → Electron reads clinic.json and re-injects into localStorage
  → 'clinic-session-ready' sent
  → React re-runs init, finds session, renders dashboard
```

This works IF the injection completes before React's `hasSession()` check.  
If there's a timing issue, `hasSession()` returns false → JoinClinic shown → user sees login screen.

### What causes session loss (the auto-logout bug)

There are multiple failure paths:

**Path A — Race condition (most likely)**
1. `did-finish-load` fires
2. `executeJavaScript` is called (async)
3. `clinic-session-ready` is sent immediately after `await executeJavaScript`
4. React receives the signal and calls `hasSession()`
5. BUT: `executeJavaScript` may not have committed to localStorage yet
6. `hasSession()` returns false → JoinClinic shown

**Path B — initCloudAuth timing**
1. App starts, `initCloudAuth()` is called
2. Tokens loaded from disk into memory
3. BUT: first cloud request fires before `initCloudAuth()` resolves (it's async)
4. Request goes out without Authorization header → 401
5. Refresh attempted → if refresh token also not loaded yet → fails
6. `clearCloudTokens()` called → tokens wiped from memory AND disk
7. Next request also fails → user appears logged out from cloud

**Path C — Electron storage clear on logout**
1. Previous user logs out
2. `clearStorageData()` wipes ALL localStorage
3. New user logs in
4. `clinic.json` is written
5. But `did-finish-load` injection may have already fired before new clinic.json was written
6. localStorage is empty → `hasSession()` false → JoinClinic shown again

**Path D — 5-second timeout**
1. Slow machine or slow disk
2. `clinic-session-ready` event takes > 5 seconds
3. Timeout fires first → `hasSession()` returns false → JoinClinic shown

---

## 6. DATA FLOW

### A. Doctor creates a patient

```
1. Doctor fills PatientForm.jsx → submit
2. POST /api/patients → local Flask (port 5000)
3. Local Flask saves to SQLite (medidesk.db)
4. Returns { patient_id }
5. patientSyncService.syncPatientToCloud(patient) called
6. POST /api/patients → cloud Flask (port 8000) with JWT
7. Cloud saves to cloud.db with clinic_id from JWT
8. Cloud returns { patient } with cloud id
9. Local patient gets cloud_id stored for future updates
10. Secretary can now see the patient via cloud
```

**Problem:** Step 5-9 is NOT called from PatientForm. `syncPatientToCloud` exists in the service but `PatientForm.jsx` only calls the local API. The sync to cloud is NOT automatic on patient creation.

### B. Secretary views patients

```
1. Dashboard.jsx fetchPatients() called
2. secretary = true → fetchCloudPatients() only
3. GET /api/patients → cloud (port 8000) with JWT
4. Cloud returns all patients for this clinic_id
5. Displayed in PatientList
```

If cloud is offline: empty array returned, `cloudOffline = true`, banner shown, no patients visible.  
Secretary has NO local fallback. Zero patients shown when cloud is down.

### C. Messaging system

```
Doctor sends message:
1. POST /api/messages → cloud with JWT
2. Cloud saves with sender_role = g.role (from JWT, not body)
3. Returns { message }

Secretary reads messages:
1. GET /api/messages → cloud with JWT
2. Cloud returns all messages for clinic_id ordered by created_at asc
3. Displayed in ClinicChat.jsx

Secretary sends message:
1. POST /api/messages → cloud with JWT
2. Same flow, sender_role = 'secretary'
```

Messages are cloud-only. No local storage. No real-time (polling or websocket not confirmed).

---

## 7. SYNC SYSTEM

### How patient sync works

`patientSyncService.js` provides these functions:

**`syncPatientToCloud(patient)`**  
Pushes a new patient to cloud. Returns cloud patient object or null on failure.  
Does NOT queue on failure — if cloud is down, the patient is never synced.

**`updateCloudPatient(patient)`**  
Updates existing cloud patient by `cloud_id`.  
On failure: enqueues to `localStorage` under key `medidesk_sync_queue`.

**`fetchCloudPatients()`**  
GET /api/patients from cloud. Returns array with `cloud_id` and `_fromCloud: true` markers.

**`mergePatients(local, cloud)`**  
Merges by phone number (preferred) or normalized name.  
Conflict resolution: latest `updated_at` wins.  
If cloud is newer: uses cloud data but keeps `local_id`.  
If local is newer: keeps local data but attaches `cloud_id`.

**`replayQueue()`**  
Iterates `medidesk_sync_queue` in localStorage.  
Retries each PUT to cloud. Stops on first failure (still offline).  
Called on dashboard mount.

### Offline behavior

- New patients created while offline: NOT queued (sync not called from PatientForm)
- Patient updates while offline: queued in localStorage
- Queue replayed on next dashboard load

### Source of truth

- Doctor: local SQLite is primary. Cloud is a mirror.
- Secretary: cloud is the only source.
- Conflict resolution is timestamp-based but `updated_at` is not always set correctly.

### When duplicates can happen

1. Doctor creates patient locally while cloud is down
2. Cloud comes back, sync is triggered
3. If the patient was already created on cloud by secretary in the meantime
4. `mergePatients` keys by phone or name — if phone is missing, name collision creates duplicate

### When data can be lost

1. Doctor creates patient locally, cloud is down
2. `syncPatientToCloud` is not called from PatientForm (it's not wired up)
3. Patient exists locally but never reaches cloud
4. Secretary never sees it
5. If doctor reinstalls or switches machine, local SQLite is gone

---

## 8. CURRENT PROBLEMS

### Problem 1 — Auto-logout (the main reported issue)

**Root cause:** `hasSession()` checks only `localStorage.getItem('clinic_id')`. localStorage is volatile in Electron — it's cleared on logout and must be re-injected on every load via `executeJavaScript`. There is a race condition between the injection completing and React reading the value.

**Where it happens:**
- `main.js` `did-finish-load` → `executeJavaScript` (async, not guaranteed to commit before signal)
- `App.jsx` `onClinicSessionReady` callback → `hasSession()` called immediately after signal
- If injection hasn't committed yet → false → JoinClinic shown

**Secondary cause:** `initCloudAuth()` is async. If any cloud request fires before it resolves, the Authorization header is missing → 401 → refresh attempted with null refresh token → `clearCloudTokens()` wipes tokens.json → permanent logout from cloud.

### Problem 2 — JWT secret is default

**Root cause:** `JWT_SECRET` defaults to `"change-me-in-production"` in `auth_service.py`.  
**Where:** `cloud-backend/auth_service.py` line 10.  
**Impact:** Anyone who knows the default can forge tokens for any user.

### Problem 3 — Patient sync not wired to PatientForm

**Root cause:** `syncPatientToCloud()` exists but is never called when a patient is created.  
**Where:** `PatientForm.jsx` only calls `POST /api/patients` (local). No cloud sync call.  
**Impact:** New patients created by doctor are invisible to secretary until manual refresh or some other trigger.

### Problem 4 — Secretary has no offline fallback

**Root cause:** `fetchPatients()` in Dashboard for secretary calls `fetchCloudPatients()` only.  
**Where:** `Dashboard-New.jsx` `fetchPatients()`.  
**Impact:** Cloud down = secretary sees zero patients. No cache, no fallback.

### Problem 5 — Race condition in session injection

**Root cause:** `main.js` sends `clinic-session-ready` immediately after `await executeJavaScript()`. But `executeJavaScript` resolving doesn't guarantee localStorage has been committed by the browser engine.  
**Where:** `main.js` `did-finish-load` handler.  
**Impact:** Intermittent — sometimes works, sometimes shows login screen on startup.

### Problem 6 — Double event listener registration

**Root cause:** In `JoinClinic.jsx`, `handleDoctorLogin` registers `onLoginSuccess` and `onLoginError` listeners every time the button is clicked. If the user clicks multiple times (or the function is called twice), multiple listeners stack up.  
**Where:** `JoinClinic.jsx` `handleDoctorLogin()`.  
**Impact:** Multiple `onJoined()` calls, multiple `saveSession()` calls, potential state corruption.

### Problem 7 — Fallback clinic_id = googleId

**Root cause:** When cloud is offline during doctor login, `clinicId = user.googleId` is used as a fallback.  
**Where:** `JoinClinic.jsx` handleDoctorLogin, last catch block.  
**Impact:** `clinic_id` in localStorage is a Google ID, not a `MEDI-XXXXX` format. `resolveClinicId()` in App.jsx tries to fix this silently, but if cloud is still down, the wrong ID persists. Secretary cannot join with a googleId as clinic ID.

### Problem 8 — Secretary can join without password

**Root cause:** `handleSecretaryJoin` in JoinClinic.jsx falls through to the old `POST /clinic/join` flow if no password is provided. This creates a secretary account with no authentication.  
**Where:** `JoinClinic.jsx` `handleSecretaryJoin()`.  
**Impact:** Anyone who knows a clinic ID and a secretary's name can join as that secretary with no password.

### Problem 9 — Local backend has no authentication

**Root cause:** Local Flask (port 5000) trusts `X-User-ID` header sent by the frontend. There is no JWT, no signature, no verification.  
**Where:** `api.js` interceptor, local `app.py`.  
**Impact:** Any process on localhost can call the local API with any user ID and read/write that user's data.

### Problem 10 — mergePatients key collision on missing phone

**Root cause:** `mergePatients` keys patients by `phone || normalized_name`. If phone is empty, two different patients with similar names can be merged into one.  
**Where:** `patientSyncService.js` `mergePatients()`.  
**Impact:** Patient data loss or corruption during sync.

### Problem 11 — Whisper model loaded on every transcription

**Root cause:** `whisper.load_model("base")` is called inside `transcribe_audio()` which runs on every request.  
**Where:** `whisper_service.py`.  
**Impact:** 2-5 second delay on every transcription. High memory churn.

### Problem 12 — API key exposed in .env committed to repo

**Root cause:** `medidesk-ai/backend/.env` contains live Groq API key and Google OAuth credentials.  
**Where:** `medidesk-ai/backend/.env`.  
**Impact:** If this repo is ever pushed to a public remote, credentials are compromised.

---

## 9. SYSTEM STATE SUMMARY

### What is stable

- Local backend feature set (patients, appointments, attachments, AI, voice) — works reliably when running
- Cloud backend JWT logic — well-structured, role-based, clinic-scoped
- Electron IPC bridge — clean, well-defined API surface
- Secretary login with password — correct flow when cloud is up
- Token refresh logic in cloudApi.js — handles 401 with queue and retry

### What is fragile

- Session restoration on app restart — depends on timing of Electron injection vs React read
- Patient sync — not wired to creation, only to updates
- Secretary offline experience — zero fallback
- The `resolveClinicId` fallback — silently patches a bad state, can fail silently
- The 5-second timeout in App.jsx — arbitrary, machine-dependent

### What is broken

- Auto-logout on restart (race condition — the main reported issue)
- Patient sync on creation (not called from PatientForm)
- Secretary can join without password (security hole)
- JWT secret is default value in production

### What is overcomplicated

- Session is stored in 5 different places: `session.json`, `users.json`, `clinic.json`, `tokens.json`, `localStorage`. They must all stay in sync manually.
- The Electron injection pattern (executeJavaScript to set localStorage) is fragile by design. localStorage is not the right place for persistent session state in Electron.
- Two separate axios instances (`api.js` and `cloudApi.js`) with different auth mechanisms that must both be initialized in the right order.
- `resolveClinicId()` in App.jsx is a silent background patch for a broken state that should never occur.
- The `onClinicSessionReady` event + 5-second timeout is a workaround for the injection race condition, not a solution.

---

## 10. BEFORE PRODUCTION — WHAT MUST BE ADDRESSED

### Must be simplified

- Session storage: consolidate from 5 locations to 2 (disk file + memory). Remove localStorage as the session gate.
- The `hasSession()` check: should not depend on localStorage alone.
- The Electron injection pattern: replace with a direct IPC call from React on startup.

### Must be unified

- Authentication: local backend should also validate JWT (or at minimum validate a signed session token), not trust raw headers.
- Patient sync: one clear trigger point for cloud sync (on save, not scattered).
- Session init: one linear async flow in App.jsx, not a mix of injection + event + timeout.

### Must be removed

- The `clinicId = user.googleId` fallback — it creates an invalid state that requires a background fix.
- The old secretary join-without-password flow — it's a security hole.
- The `resolveClinicId()` function — it exists only to fix a state that shouldn't be possible.
- The double event listener pattern in `handleDoctorLogin` — replace with a promise-based flow.
- The hardcoded `"change-me-in-production"` JWT secret default.
- The committed `.env` file with live credentials.
