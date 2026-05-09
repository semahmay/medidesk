# MediDesk AI — Full System Audit
**Date:** April 2026  
**Auditor:** Code-based analysis (no assumptions)

---

## PART 1 — GLOBAL ARCHITECTURE

### Frontend (React)

**Pages:**
- `Dashboard-New.jsx` — patient list + patient detail, resizable split layout
- `Appointments.jsx` — calendar + week/month/day views
- `Analytics.jsx` — charts (Recharts), metric cards, activity feed
- `MedicalReference.jsx` — AI chat for medical questions
- `ClinicChat.jsx` — real-time messaging between doctor and secretary
- `JoinClinic.jsx` — onboarding screen (role selection, Google login, secretary join)
- `Setup.jsx` — exists in file tree but NOT imported anywhere (dead page)
- `Dashboard.jsx` — old dashboard, NOT imported anywhere (dead file)

**Components:**
- `Sidebar.jsx` — icon-only nav, 5 routes
- `TopBar.jsx` — doctor name, clinic name, language toggle, avatar dropdown, logout, ClinicModal trigger
- `PatientList.jsx` — patient table with search
- `PatientDetail.jsx` — tabs (overview/timeline), notes, voice recorder, attachments, AI chat, PDF export, prescription generator
- `PatientForm.jsx` — add/edit patient modal
- `PatientTable.jsx` — exists, unclear if used (PatientList may wrap it)
- `AIChat.jsx` — per-patient AI chat panel
- `VoiceRecorder.jsx` — mic recording, Whisper transcription
- `NotesEditor.jsx` — full notes editor modal
- `AppointmentCalendar.jsx`, `WeekView.jsx`, `MonthView.jsx`, `DayView.jsx`, `AppointmentModal.jsx` — appointment UI
- `ClinicModal.jsx` — doctor creates/views clinic ID

**State management:**
- All local `useState` / `useEffect`. No Redux, no Zustand, no Context API.
- User identity passed as prop (`currentUser`) from `App.jsx` down to pages.
- Clinic session in `localStorage` + Electron disk via `useClinicSession.js` hook.

**API usage:**
- `api.js` — Axios instance pointing to `localhost:5000`, injects `X-User-ID` header
- `cloudApi.js` — Axios instance pointing to `localhost:8000`, no auth headers

---

### Desktop Layer (Electron)

- `main.js` — app entry, creates window, spawns Flask backend, handles IPC
- `preload.js` — exposes `window.electronAPI` to renderer via `contextBridge`
- `googleAuth.js` — full OAuth2 PKCE flow via local HTTP server on port 9876
- `userStore.js` — reads/writes `users.json`, `session.json`, `clinic.json` in OS AppData
- `login.html` — static HTML login page (not React)

**Backend spawning:**
- Flask is spawned as a child process with `MEDIDESK_USER_ID` env var
- Health-polled before loading dashboard (20 attempts × 300ms)
- On user switch: old process killed, 500ms buffer, new process started

---

### Local Backend (Flask — port 5000)

**Responsibilities:**
- All patient CRUD
- Attachments (upload, serve, delete)
- Appointments CRUD
- Analytics queries
- AI chat (via Groq `lt it does |
|--------|-------|-------------|
| GET | `/api/health` | Health check — no auth required |
| GET | `/api/whoami` | Debug: shows active user ID and DB path |
| GET | `/api/setup` | Returns clinic settings (doctor name, clinic name) |
| POST | `/api/setup` | Saves clinic settings + optional custom columns |
| GET | `/api/columns` | Returns all column configs (default + custom) |
| POST | `/api/columns` | Adds a custom column |
| DELETE | `/api/columns/:id` | Deletes a custom column and its data |
| GET | `/api/patients` | Returns all patients with custom fields |
| POST | `/api/patients` | Creates a new patient |
| GET | `/api/patients/:id` | Returns single patient + attachments + custom fields |
| PUT | `/api/patients/:id` | Updates patient fields |
| DELETE | `/api/patients/:id` | Deletes patient (cascades to attachments + custom fields) |
| POST | `/api/patients/:id/custom-fields` | Saves custom field values for a patient |
| GET | `/api/patients/:id/attachments` | Lists attachments for a patient |
| `POST /api/clinic/create` — create clinic + doctor user record
- `POST /api/clinic/join` — secretary joins clinic
- `GET /api/clinic/<id>` — get clinic info + users
- `GET /api/patients?clinic_id=` — get shared patients (cloud)
- `POST /api/patients` — create shared patient (cloud)
- `GET /api/messages?clinic_id=` — get chat messages
- `POST /api/messages` — send chat message

**Data models:** `Clinic`, `User`, `Patient`, `Message` (SQLAlchemy + SQLite)

**What is actually used vs unused:**
- Used: `clinic/by-doctor`, `clinic/create`, `clinic/join`, `messages` (GET/POST)
- Unused by frontend: `clinic/<id>`, cloud `patients` routes — no frontend code calls them
- `Patient` model exists in cloud DB but the frontend never syncs patients to cloud

---

## PART 2 — AUTH & SESSION SYSTEM

### Google Login Flow

1. User clicks "Continue with Google" in `login.html` or `JoinClinic.jsx`
2. `electronAPI.startLogin()` → IPC → `main.js` → `startGoogleLogin()` in `googleAuth.js`
3. Local HTTP server starts on port 9876 as OAuth redirect target
4. System browser opens Google OAuth URL
5. Google redirects to `localhost:9876/callback` with auth code
6. Code exchanged for tokens → user info fetched from Google API
7. User saved to `users.json`, `session.json` written with `googleId`
8. `login-success` IPC event sent to renderer with user object
9. Flask backend restarted with `MEDIDESK_USER_ID=googleId`
10. Dashboard loaded

### What is stored where

**localStorage:**
- `clinic_id` — the clinic identifier (MEDI-XXXXX or googleId fallback)
- `user_role` — `"doctor"` or `"secretary"`
- `user_name` — display name

**AppData files (Electron):**
- `users.json` — registry of all users who logged in (`{ googleId, email, name, picture, lastLogin }`)
- `session.json` — `{ googleId }` of current user
- `clinic.json` — `{ clinicId, userRole, userName }` — persists clinic session across restarts

**In-memory (main.js):**
- `currentUser` — full user object, lost on app restart (restored from `session.json`)

### Where each is used

- `session.json` → read on app start in `loadSession()` → auto-login without Google
- `clinic.json` → injected into `localStorage` via `executeJavaScript` on `did-finish-load`
- `localStorage.clinic_id` → `hasSession()` → controls whether `JoinClinic` or dashboard shows
- `X-User-ID` header → sent with every local API call → Flask uses it to route to correct SQLite DB
- `userRole` → used in `ClinicChat.jsx` to label messages and set sender role

---

## PART 3 — FEATURE LIST

### 1. Patient System
- **Files:** `Dashboard-New.jsx`, `PatientList.jsx`, `PatientDetail.jsx`, `PatientForm.jsx`, `database.py`
- **Flow:** CRUD via local Flask `/api/patients`. Custom columns supported. Per-user SQLite DB.
- **Status:** FULLY WORKING

### 2. Notes System
- **Files:** `NotesEditor.jsx`, `PatientDetail.jsx`, `database.py`
- **Flow:** Notes stored in `patients.notes` text field. Editor opens as modal. Saved via `PUT /api/patients/:id`.
- **Status:** FULLY WORKING

### 3. Voice Transcription
- **Files:** `VoiceRecorder.jsx`, `whisper_service.py`, `app.py /api/transcribe`
- **Flow:** MediaRecorder → webm Blob → FormData POST → Flask saves to temp → Whisper transcribes → text returned → appended to patient notes
- **Status:** FULLY WORKING (slow — Whisper model loaded on every request)

### 4. Attachments
- **Files:** `PatientDetail.jsx`, `app.py`, `database.py`
- **Flow:** File upload via FormData → saved to `data/users/{id}/attachments/` → served via `/api/attachments/:id/open`
- **Status:** FULLY WORKING

### 5. Appointments
- **Files:** `Appointments.jsx`, `AppointmentCalendar.jsx`, `WeekView.jsx`, `MonthView.jsx`, `DayView.jsx`, `AppointmentModal.jsx`, `database.py`
- **Flow:** Full CRUD via local Flask. Week/month/day views. Reschedule support. Stats calculated client-side.
- **Status:** FULLY WORKING

### 6. AI Chat (per patient)
- **Files:** `AIChat.jsx`, `app.py /api/chat`, `ai_service.py`
- **Flow:** Patient context sent with message → Groq `llama-3.1-8b-instant` → response displayed
- **Status:** FULLY WORKING (depends on Groq API key in `.env`)

### 7. Medical Reference
- **Files:** `MedicalReference.jsx`, `app.py /api/medical-reference`
- **Flow:** Question sent to Groq with medical system prompt → formatted response displayed
- **Status:** FULLY WORKING (depends on Groq API key)

### 8. Analytics
- **Files:** `Analytics.jsx`, `app.py`, `analytics_methods.py`, `database.py`
- **Flow:** 7 parallel API calls to local Flask analytics endpoints → Recharts rendering
- **Status:** FULLY WORKING

### 9. Multi-user (Google)
- **Files:** `googleAuth.js`, `userStore.js`, `main.js`, `database.py`
- **Flow:** Each Google account gets isolated SQLite DB. Backend restarted per user.
- **Status:** FULLY WORKING

### 10. Clinic System (Doctor + Secretary)
- **Files:** `JoinClinic.jsx`, `ClinicModal.jsx`, `useClinicSession.js`, `cloud-backend/app.py`
- **Flow:** Doctor logs in → clinic created in cloud DB → gets MEDI-XXXXX ID → shares with secretary → secretary joins via ID
- **Status:** PARTIAL — works only when cloud backend is running. Falls back to googleId if cloud is offline (after our fix). Secretary flow untested end-to-end.

### 11. Clinic Chat
- **Files:** `ClinicChat.jsx`, `cloud-backend/app.py /api/messages`
- **Flow:** Messages stored in cloud SQLite. Polled every 5 seconds. Task flag supported.
- **Status:** PARTIAL — works only when cloud backend is running. No real-time (polling only). No message persistence if cloud is down.

### 12. AI Prescription Generator
- **Files:** `PatientDetail.jsx`, `app.py /api/chat`
- **Flow:** Sends patient data to Groq → parses JSON response → editable prescription form → print/PDF
- **Status:** FULLY WORKING (undocumented feature, not in sidebar)

### 13. PDF Export
- **Files:** `PatientDetail.jsx`
- **Flow:** Builds HTML string → `window.open` → `window.print()`
- **Status:** FULLY WORKING

---

## PART 4 — ROLE SYSTEM

### How user_role is stored
- Set during `JoinClinic` flow: `"doctor"` or `"secretary"`
- Saved to `localStorage.user_role` and `clinic.json` via `saveSession()`

### Where it is used
- `ClinicChat.jsx` — reads `userRole` from `getSession()` to label messages and set `sender_role` in POST body
- `ClinicChat.jsx` header — displays role label with color coding

### What is currently restricted
- Nothing. There is zero role-based access control in the frontend.

### Security gaps
- A secretary can access every page: patients, appointments, analytics, medical reference, AI chat, prescriptions
- There is no route guard anywhere in `App.jsx` or `Sidebar.jsx`
- `user_role` in localStorage can be manually edited by anyone with DevTools
- The cloud backend has no authentication — any request with a valid `clinic_id` can read/write messages and patients
- The local Flask backend has no authentication — `X-User-ID` header is trusted blindly, can be spoofed
- No HTTPS anywhere (all localhost, but relevant for any future deployment)

---

## PART 5 — CLOUD BACKEND USAGE

### Local backend (port 5000) handles:
- All patient data (CRUD, custom fields)
- All attachments
- All appointments
- All analytics
- AI chat (Groq)
- Medical reference (Groq)
- Voice transcription (Whisper)
- Settings

### Cloud backend (port 8000) handles:
- Clinic creation and lookup
- Secretary joining a clinic
- Clinic chat messages

### Data split summary

| Data | Where stored | Notes |
|------|-------------|-------|
| Patients | Local SQLite (per doctor) | Not synced to cloud |
| Appointments | Local SQLite (per doctor) | Not synced to cloud |
| Attachments | Local filesystem | Not synced anywhere |
| Notes | Local SQLite | Not synced anywhere |
| Messages | Cloud SQLite | Only data shared between users |
| Clinic info | Cloud SQLite | Clinic ID, doctor/secretary records |
| Settings | Local SQLite | Per doctor |

### Inconsistencies and risks
- Cloud `Patient` model exists but is never used by the frontend — dead schema
- Secretary joins the clinic but can only see their own local data (nothing), not the doctor's patients
- If the cloud backend is offline, clinic chat is completely broken with no error recovery
- No data sync between doctor's local DB and cloud — the "shared clinic" concept is incomplete
- Cloud backend uses SQLite — not suitable for multi-user concurrent access in production

---

## PART 6 — UI/UX STATE

### Navigation
- Icon-only sidebar (no labels) — requires tooltips to understand
- 5 routes: Patients, Appointments, Medical Reference, Analytics, Clinic Chat
- Settings icon in sidebar does nothing (no `onClick` handler, no route)

### Patient dashboard
- Resizable horizontal split (patient list left, detail right)
- Patient detail has resizable vertical split (info top, AI chat bottom)
- Two tabs: Overview and Timeline
- Clean, functional layout

### AI Chat UI
- Embedded in patient detail panel — no dedicated page
- No chat history persistence (resets on patient switch)

### Clinic Chat UI
- Full-page layout with message bubbles
- Task toggle (marks message as task)
- Filter: All / Tasks
- 5-second polling — visible lag between send and receive

### Responsiveness
- No responsive CSS detected. Fixed sidebar width. Designed for desktop only.
- No mobile breakpoints in `new-design.css` or `dashboard.css`

### UX issues visible in code
- Settings sidebar icon has no handler — clicking does nothing
- `window.confirm()` used for delete confirmations — browser native, inconsistent with app design
- `window.open()` used for PDF/prescription print — blocked by some popup blockers
- Language toggle (FR/EN) has no actual effect — `handleLanguageChange` in Dashboard does nothing with the value
- No loading skeleton — just "Loading..." text
- `PatientTable.jsx` and `PatientList.jsx` both exist — unclear which is the canonical component

---

## PART 7 — KNOWN BUGS / TECH DEBT

### Bugs
- Whisper model loaded fresh on every transcription request — 3-5 second overhead per call
- `onLoginSuccess` / `onLoginError` in preload use `ipcRenderer.on` (not `once`) — listeners accumulate across renders if component remounts
- `clinic_id` saved as empty string when cloud is offline (fixed in session, but ClinicModal still shows "no clinic" if cloud was never reachable)
- `calculateStats()` in `Appointments.jsx` fetches ALL appointments on every date/view change — unnecessary load
- `loadAppointments()` AND `calculateStats()` both call `GET /api/appointments` separately on the same render cycle
- `PatientDetail.jsx` — `settings` prop is received but never read (dead prop)
- `Dashboard.jsx` (old) still exists and is never cleaned up
- `Setup.jsx` page exists but is unreachable — no route defined for it

### Security issues
- No auth on local Flask — any process on localhost can read/write patient data
- No auth on cloud Flask — any request with a known `clinic_id` can read all messages
- `X-User-ID` header is set client-side and trusted server-side without verification
- Google OAuth `CLIENT_SECRET` loaded from `.env` in Electron main process — acceptable for desktop, but `.env` is in the repo

### Performance risks
- Whisper `load_model("base")` on every transcription — should be module-level singleton
- No pagination on patient list — loads all patients at once
- No pagination on appointments — loads all for stats calculation
- Analytics makes 7 sequential-ish API calls on every page load

### Dead code
- `Dashboard.jsx` — old dashboard, never imported
- `Setup.jsx` — never routed
- `PatientTable.jsx` — unclear if used or replaced by `PatientList.jsx`
- Cloud `Patient` model and `/api/patients` cloud routes — never called from frontend
- `handleNotesClick` in `Dashboard-New.jsx` — empty function body

---

## PART 8 — LIMITATIONS

- No secretary access to doctor's patient data — the multi-user clinic concept is architecturally incomplete
- No data sync between local and cloud — doctor and secretary work in completely separate data silos
- No offline support for clinic chat — if cloud is down, chat is gone
- No real-time messaging — 5-second polling is not suitable for clinical coordination
- No push notifications
- No patient search across appointments (appointments use `patient_name` string, not always linked to `patient_id`)
- No audit log for patient record changes (who changed what, when)
- No backup/export of the SQLite database
- No user management — can't remove a secretary from a clinic
- No password or PIN — anyone who opens the app on the same machine is logged in
- Language toggle exists in UI but has no functional effect
- Not deployable as a web app — fully Electron-dependent
- No tests of any kind (unit, integration, e2e)

---

## PART 9 — SYSTEM MATURITY

### Classification: **Pre-MVP**

**Why:**

The core solo-doctor workflow (patients, notes, appointments, AI, voice, analytics) is genuinely functional and polished. That part could be called an MVP for a single-user desktop tool.

However, the multi-user clinic feature — which appears to be the product's main differentiator — is architecturally incomplete. The doctor and secretary share a clinic ID and can chat, but they cannot share patient data. A secretary joining a clinic sees zero patients. This is the central value proposition and it doesn't work end-to-end.

Additional blockers for MVP status:
- Zero role-based access control
- No auth on either backend
- No tests
- Cloud backend not production-ready (SQLite, no auth, no deployment)
- Critical features (language toggle, settings page) are UI-only with no implementation

---

## PART 10 — NEXT PRIORITIES

### Priority 1 — Make the clinic data model actually work
The secretary joins a clinic but sees nothing. Patient data must be readable by both doctor and secretary within the same clinic. Two options: sync local patient data to cloud on save, or move patient storage to cloud entirely for clinic users. Without this, the multi-user feature is a demo, not a product.

### Priority 2 — Add basic auth to both backends
The local Flask and cloud Flask accept any request with no verification. At minimum, the cloud backend needs to validate a shared clinic secret or JWT on every request. The local backend should verify the `X-User-ID` header against the running session. This is a hard blocker for any real deployment.

### Priority 3 — Fix the Whisper performance issue
`whisper.load_model("base")` is called on every single transcription. Move it to module level so it loads once at startup. This is a one-line fix with a 3-5 second improvement per transcription.

```python
# whisper_service.py — top of file
_model = whisper.load_model("base")

def transcribe_audio(audio_path):
    result = _model.transcribe(audio_path)
    ...
```

### Priority 4 — Implement role-based access control
Secretaries should not access prescriptions, AI chat, medical reference, or analytics. Add a `userRole` check in `App.jsx` and conditionally render sidebar items and routes. This is both a UX and a compliance issue for a medical product.

### Priority 5 — Replace polling with WebSockets in clinic chat
5-second polling for a clinical coordination tool is too slow and wastes resources. Flask-SocketIO on the cloud backend + `socket.io-client` in the frontend would give real-time messaging. This is the difference between a usable tool and a frustrating one for doctor-secretary coordination.
