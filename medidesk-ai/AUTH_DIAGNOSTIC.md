# MediDesk AI — Authentication & Session Diagnostic Report
**Date:** April 2026  
**Type:** Analysis only — no code changes

---

## 1. AUTH FLOW

### Doctor Login — Step by Step

```
1. App starts → Electron main.js runs
2. loadSession() reads AppData/session.json
   → If googleId found: auto-login (skip to step 9)
   → If not found: show login.html

3. User clicks "Continue with Google" in login.html
4. login.html calls window.electronAPI.startLogin()
5. IPC → main.js → ipcMain.handle('start-login') → startGoogleLogin()

6. googleAuth.js:
   a. Starts local HTTP server on port 9876
   b. Opens system browser to Google OAuth URL
   c. Google redirects to http://localhost:9876/callback?code=...
   d. Code exchanged for access_token via POST to oauth2.googleapis.com/token
   e. access_token used to GET https://www.googleapis.com/oauth2/v2/userinfo
   f. Returns: { name, email, picture, googleId }

7. upsertUser() → writes to AppData/users.json
   saveSession(googleId) → writes AppData/session.json

8. main.js:
   a. Sends 'login-success' IPC event to renderer with user object
   b. Calls restartBackendForUser(googleId)
      → Spawns Flask with env var MEDIDESK_USER_ID=googleId
   c. Polls http://localhost:5000/api/health until ready
   d. Calls loadDashboard()

9. loadDashboard():
   a. Loads React app (localhost:3000 in dev)
   b. On did-finish-load: reads clinic.json via loadClinicSession()
   c. Injects clinic_id, user_role, user_name into localStorage via executeJavaScript()
   d. Sends 'clinic-session-ready' IPC event to React

10. React App.jsx:
    a. Calls window.electronAPI.getCurrentUser() → gets user object
    b. Calls setUserId(googleId) → sets X-User-ID header on all API calls
    c. Calls resolveClinicId(googleId):
       → If clinic_id in localStorage starts with 'MEDI-': skip
       → Else: GET /api/clinic/by-doctor/{googleId} from cloud
       → If not found: POST /api/clinic/create
       → Saves real MEDI-XXXXX to localStorage + clinic.json
    d. hasSession() checks localStorage.clinic_id → if truthy: show dashboard
    e. If no session: show JoinClinic screen

11. JoinClinic (doctor path):
    → User selects "Doctor" → clicks "Continue with Google"
    → Same OAuth flow as above (steps 3–8)
    → After login: GET /api/clinic/by-doctor or POST /api/clinic/create
    → saveSession({ clinicId: 'MEDI-XXXXX', userRole: 'doctor', userName })
    → onJoined(user) → App sets clinicReady = true → dashboard renders
```

---

### Secretary Login — Step by Step

```
1. App starts → loadSession() finds no session.json (secretary has no Google account)
2. login.html shown → user clicks nothing (no Google login for secretary)
   OR: clinic.json exists from previous session → auto-restored

3. If no clinic.json: React shows JoinClinic screen
4. User selects "Secretary" role
5. Enters: Name + Clinic ID (MEDI-XXXXX)
6. handleSecretaryJoin():
   a. Validates format: must start with 'MEDI-'
   b. POST http://localhost:8000/api/clinic/join { clinic_id, name }
   c. Cloud backend verifies clinic exists in cloud DB
   d. Creates User record with role='secretary' in cloud DB
   e. saveSession({ clinicId: 'MEDI-XXXXX', userRole: 'secretary', userName: name })
      → Writes to localStorage
      → Writes to AppData/clinic.json via IPC
7. onJoined(null) → App sets clinicReady = true → dashboard renders

NOTE: Secretary has NO Google account, NO session.json, NO googleId.
      Their identity is purely: name + clinic_id stored in clinic.json.
```

---

### Where clinic_id is stored

| Location | Format | Who writes it | Who reads it |
|----------|--------|--------------|-------------|
| `localStorage.clinic_id` | `MEDI-XXXXX` or googleId | `saveSession()` in useClinicSession.js | Every component via `getSession()` |
| `AppData/clinic.json` | `{ clinicId, userRole, userName }` | `saveClinicSession()` in userStore.js | `loadClinicSession()` in main.js on startup |
| `cloud DB (clinics table)` | `MEDI-XXXXX` | Cloud backend on clinic create | Cloud backend on all patient/message queries |

---

### How role is determined

- Role is set **only once** during the JoinClinic flow:
  - Doctor path → hardcoded `userRole: 'doctor'`
  - Secretary path → hardcoded `userRole: 'secretary'`
- Stored in `localStorage.user_role` and `clinic.json`
- Read everywhere via `getSession().userRole`
- **Never verified by any backend** — it is purely client-side trust

---

### What happens on refresh

**Doctor:**
1. Electron restarts → `loadSession()` reads `session.json` → finds googleId
2. `loadClinicSession()` reads `clinic.json` → finds `{ clinicId, userRole, userName }`
3. Flask backend spawned with `MEDIDESK_USER_ID=googleId`
4. `loadDashboard()` injects clinic session into localStorage
5. React renders dashboard directly — no re-login required

**Secretary:**
1. Electron restarts → `loadSession()` returns null (no session.json)
2. `loadClinicSession()` reads `clinic.json` → finds `{ clinicId, userRole, userName }`
3. `loadDashboard()` injects clinic session into localStorage
4. React renders dashboard directly — no re-login required
5. BUT: Flask backend is NOT started (no googleId) → local API calls fail
   → Secretary has no local backend, so all local API calls return connection refused

---

## 2. SESSION MANAGEMENT

### Storage mechanisms used

| Mechanism | What is stored | Persistence |
|-----------|---------------|-------------|
| `localStorage` | `clinic_id`, `user_role`, `user_name` | Survives page reload, cleared on logout |
| `AppData/session.json` | `{ googleId }` | Survives app restart, deleted on logout |
| `AppData/users.json` | `{ googleId, email, name, picture, lastLogin }` | Permanent registry, never deleted |
| `AppData/clinic.json` | `{ clinicId, userRole, userName }` | Survives app restart, deleted on logout |
| In-memory (`main.js`) | `currentUser` object | Lost on app restart, restored from session.json |

### Is there JWT?
**No.** There is no JWT anywhere in the system. No token-based authentication exists.

### Is there cookie-based auth?
**No.** No cookies are used for authentication.

### Is session persistent?
- **Doctor:** Yes — `session.json` + `clinic.json` survive app restarts. Auto-login on next open.
- **Secretary:** Partially — `clinic.json` survives restarts. But no Google identity, so no Flask backend starts for them.

### How is role restored after reload?
1. `main.js` reads `clinic.json` on startup
2. Injects `user_role` into `localStorage` via `executeJavaScript()`
3. React reads it via `getSession().userRole`
4. Role is never re-verified — it is restored from disk as-is

---

## 3. LOGIN COMPONENTS

### `electron/login.html`
- Static HTML page (not React)
- Shown only for doctors who have no saved session
- Single button: "Continue with Google"
- Calls `window.electronAPI.startLogin()`
- Listens for `login-success` / `login-error` IPC events
- Does NOT handle secretary login — secretary goes through React's JoinClinic

### `frontend/src/pages/JoinClinic.jsx`
- React component shown when `hasSession()` returns false
- Three steps: role selection → doctor login OR secretary join
- **Doctor path:** triggers `electronAPI.startLogin()`, then cloud clinic lookup/create
- **Secretary path:** form with Name + Clinic ID, calls `POST /api/clinic/join`
- On success: calls `saveSession()` → sets localStorage + clinic.json

### `frontend/src/App.jsx`
- Orchestrates the session restoration flow on startup
- Calls `resolveClinicId()` to upgrade googleId fallback → real MEDI-XXXXX
- Decides: show loading → show JoinClinic → show dashboard

### `frontend/src/hooks/useClinicSession.js`
- Pure localStorage wrapper: `getSession()`, `saveSession()`, `clearSession()`, `hasSession()`
- `saveSession()` also calls `electronAPI.saveClinicSession()` to persist to disk

### `electron/googleAuth.js`
- Full OAuth2 Authorization Code flow
- Local HTTP server on port 9876 as redirect target
- No PKCE (code_verifier/code_challenge) — uses plain Authorization Code
- Tokens are NOT stored — only user info is kept

---

## 4. CURRENT WEAKNESSES

### What breaks on refresh
- **Secretary's patient list** — depends on cloud backend being online. If cloud is down on refresh, secretary sees 0 patients with no recovery path.
- **Doctor's clinic_id** — if doctor logged in while cloud was offline, `clinic_id` is their googleId, not `MEDI-XXXXX`. `resolveClinicId()` fixes this silently on next load IF cloud is up, but if cloud stays down, the mismatch persists indefinitely.

### What requires re-login
- Nothing requires re-login under normal conditions — both session.json and clinic.json persist.
- Re-login IS required if: user manually clears AppData, or logout is called, or a different machine is used.

### Security issues

1. **Role is client-side only.** `user_role` is stored in `localStorage` and `clinic.json`. Any user can open DevTools and change `localStorage.user_role` from `'secretary'` to `'doctor'` and gain full access. The backend never validates role.

2. **No auth on local Flask.** The `X-User-ID` header is set by the frontend and trusted blindly by Flask. Any process on localhost can send any `X-User-ID` and read/write any doctor's patient data.

3. **No auth on cloud Flask.** Any HTTP request with a valid `clinic_id` can read all messages and patients for that clinic. There is no token, no signature, no verification.

4. **Secretary identity is unverified.** A secretary is identified only by a name string they type themselves. There is no password, no token, no verification that they are who they say they are.

5. **OAuth tokens not stored.** The Google `access_token` and `refresh_token` are discarded after fetching user info. This means the app cannot verify the Google session is still valid — it trusts `session.json` forever until manually deleted.

6. **`CLIENT_SECRET` in `.env` in repo.** The Google OAuth client secret is loaded from `backend/.env`. If this file is committed to version control, the secret is exposed.

7. **No HTTPS.** All communication is over plain HTTP (localhost). Acceptable for desktop, but a hard blocker for any web deployment.

8. **Clinic ID is guessable.** Format is `MEDI-XXXXX` where XXXXX is a 5-digit number (10000–99999). That's only 90,000 possible values. A brute-force attack could enumerate all clinics.

### Missing authentication layer
- No JWT or session token on any API endpoint
- No server-side role verification
- No rate limiting on login or clinic join
- No audit log of who accessed what

---

## 5. DATA FLOW AFTER LOGIN

### How clinic_id flows into API calls

```
Login → saveSession({ clinicId }) → localStorage.clinic_id
                                  → clinic.json (disk)

React component → getSession().clinicId → passed to:
  - fetchCloudPatients(clinicId) → GET /api/patients?clinic_id=MEDI-XXXXX
  - syncPatientToCloud(patient, clinicId) → POST /api/patients { clinic_id }
  - updateCloudPatient(patient, clinicId) → PUT /api/patients/:id { clinic_id }
  - ClinicChat → GET/POST /api/messages?clinic_id=MEDI-XXXXX
```

### How role is passed

- Role is **never sent to the local Flask backend** — Flask doesn't know or care about role
- Role is **never sent to the cloud Flask backend** — cloud doesn't validate it either
- Role is used **only in the frontend** to:
  - Show/hide sidebar items (Sidebar.jsx)
  - Block routes (App.jsx Navigate redirect)
  - Hide AI Chat and Prescription buttons (PatientDetail.jsx)
  - Label messages in ClinicChat (ClinicChat.jsx)
  - Set `sender_role` in message POST body (ClinicChat.jsx) — this IS sent to cloud but not verified

### Where it is stored globally

- `localStorage.user_role` — read by every component via `getSession()`
- `clinic.json` on disk — restored on app restart
- React state: `currentUser` in `App.jsx` — passed as prop to pages, contains Google profile only (no role)
- Role is NOT in React Context, NOT in Redux, NOT in any global state manager

---

## 6. FINAL SUMMARY

### Architecture diagram

```
DOCTOR:
  Google OAuth → googleAuth.js → users.json + session.json
       ↓
  main.js → spawn Flask(MEDIDESK_USER_ID=googleId)
       ↓
  loadDashboard() → inject clinic.json → localStorage
       ↓
  App.jsx → resolveClinicId() → MEDI-XXXXX in localStorage
       ↓
  api.js (X-User-ID header) → Flask port 5000 (local data)
  cloudApi.js (clinic_id param) → Flask port 8000 (shared data)

SECRETARY:
  JoinClinic form → POST /api/clinic/join → clinic.json + localStorage
       ↓
  App.jsx → hasSession() = true → dashboard
       ↓
  cloudApi.js (clinic_id param) → Flask port 8000 (shared data only)
  [NO local Flask — secretary has no googleId, no backend spawned]
```

---

### What is solid

- **Doctor auto-login** — `session.json` + `clinic.json` survive restarts cleanly
- **Google OAuth flow** — properly implemented Authorization Code flow with local redirect server
- **Per-user data isolation** — each doctor gets their own SQLite DB via `MEDIDESK_USER_ID`
- **Clinic ID persistence** — `clinic.json` written to disk and injected into localStorage on every load
- **Logout** — clears all storage (localStorage, session.json, clinic.json, Electron session cache)
- **Role-based UI** — sidebar, routes, and component-level restrictions are in place

### What is weak

- **Role is client-side only** — trivially bypassable via DevTools
- **No backend auth** — both Flask servers accept any request with no verification
- **Secretary has no real identity** — name + clinic ID is not authentication
- **clinic_id fallback** — if cloud is offline at first login, doctor gets googleId as clinic_id, causing sync mismatch
- **OAuth tokens discarded** — cannot verify Google session validity after initial login
- **Clinic ID is guessable** — 90,000 possible values, no rate limiting

### What is missing for production

1. JWT or session token on all API endpoints (both Flask servers)
2. Server-side role verification on every protected endpoint
3. Secretary authentication (password, PIN, or invite token)
4. HTTPS for all communication
5. Rate limiting on login and clinic join endpoints
6. Token refresh mechanism for Google OAuth
7. Clinic ID entropy increase (alphanumeric, not just 5 digits)
8. Audit logging (who accessed/modified what patient record)
9. Session expiry (sessions currently never expire)
10. `.env` file excluded from version control (CLIENT_SECRET exposure)
