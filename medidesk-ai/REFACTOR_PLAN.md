# MediDesk AI — System Refactor Plan
> Date: April 9, 2026
> Status: Architecture design only. No code written.
> Prerequisite: Read FULL_SYSTEM_AUDIT.md first.

---

## GUIDING PRINCIPLE

Every problem in this system comes from one root cause:
**session state lives in the wrong place (localStorage) and is populated through an unreliable mechanism (Electron injection).**

Fix the session foundation → everything else becomes straightforward.

---

## 1. FINAL ARCHITECTURE DIAGRAM

```
┌──────────────────────────────────────────────────────────────────────┐
│                          ELECTRON SHELL                              │
│                                                                      │
│  main.js          — lifecycle, backend spawn, IPC handlers           │
│  googleAuth.js    — OAuth flow (unchanged)                           │
│  userStore.js     — session.json, users.json (Google user only)      │
│  tokenStore.js    — tokens.json (JWT pair)                           │
│                                                                      │
│  REMOVED: clinic.json injection via executeJavaScript                │
│  REMOVED: clinic-session-ready IPC event                             │
│  REMOVED: did-finish-load localStorage injection                     │
│                                                                      │
│  NEW: get-session IPC handler                                        │
│       → React calls this ONCE on startup                             │
│       → Returns { tokens, clinicId, userRole, userName, googleUser } │
│       → Single synchronous source of truth                           │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ IPC (contextBridge)
                           │ ONE call: electronAPI.getSession()
                           │ Returns complete session object
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       REACT FRONTEND                                 │
│                                                                      │
│  App.jsx          — linear init: getSession → set state → render     │
│  session.js       — in-memory session store (NO localStorage)        │
│  cloudApi.js      — axios + JWT interceptor (tokens from memory)     │
│  api.js           — axios + googleId header (from memory)            │
│  JoinClinic.jsx   — onboarding (doctor + secretary, clean flows)     │
│  patientSyncService.js — sync called from save, not scattered        │
│                                                                      │
│  REMOVED: useClinicSession.js (localStorage-based)                   │
│  REMOVED: initCloudAuth() async init                                 │
│  REMOVED: resolveClinicId()                                          │
│  REMOVED: onClinicSessionReady listener                              │
│  REMOVED: 5-second timeout                                           │
└──────────┬───────────────────────────────┬───────────────────────────┘
           │ HTTP localhost:5000            │ HTTP localhost:8000
           │ Header: X-Session-Token        │ Header: Authorization: Bearer JWT
           │ (signed by Electron at spawn)  │
           ▼                               ▼
┌──────────────────────┐       ┌───────────────────────────────────────┐
│   LOCAL BACKEND      │       │   CLOUD BACKEND                       │
│   Flask port 5000    │       │   Flask port 8000                     │
│                      │       │                                        │
│   Responsibilities:  │       │   Responsibilities:                    │
│   - Appointments     │       │   - Auth (doctor + secretary)          │
│   - Attachments      │       │   - Clinic management                  │
│   - AI chat          │       │   - Shared patients (doctor+secretary) │
│   - Voice/Whisper    │       │   - Messaging                          │
│   - Medical ref      │       │   - Secretary accounts                 │
│   - Analytics        │       │                                        │
│   - Custom columns   │       │   NO overlap with local backend        │
│   - Local patients   │       │                                        │
│                      │       │   Auth: JWT only                       │
│   Auth: session      │       │   Secret: real env var (not default)   │
│   token (not header) │       │                                        │
└──────────────────────┘       └───────────────────────────────────────┘
```

### Backend responsibility split (clear, no overlap)

| Feature | Local (5000) | Cloud (8000) |
|---|---|---|
| Doctor auth | — | Google OAuth → JWT |
| Secretary auth | — | Password → JWT |
| Token refresh | — | /auth/refresh |
| Appointments | ✓ | — |
| Attachments | ✓ | — |
| AI chat | ✓ | — |
| Voice transcription | ✓ | — |
| Medical reference | ✓ | — |
| Analytics | ✓ | — |
| Custom columns | ✓ | — |
| Local patients (doctor) | ✓ | — |
| Shared patients (clinic) | — | ✓ |
| Messaging | — | ✓ |
| Secretary accounts | — | ✓ |

The two backends never call each other. Sync is done by the frontend only.

---

## 2. CLEAN LOGIN FLOW

### The core principle

`startLogin()` IPC call must return a COMPLETE session object.
React does not assemble the session — Electron does.
React just receives it and stores it in memory.

---

### Doctor login (new clean flow)

```
Step 1 — User clicks "Continue with Google"
  JoinClinic.jsx calls: electronAPI.startLogin()
  This is a single awaited IPC call. No event listeners. No callbacks.

Step 2 — Electron handles everything
  main.js → googleAuth.js
  Opens system browser → OAuth flow → gets googleAccessToken + user info
  Saves user to users.json
  Saves googleId to session.json
  Returns { googleUser, googleAccessToken } to main.js

Step 3 — main.js calls cloud backend
  POST /api/auth/google with googleAccessToken
  Cloud verifies with Google, creates/finds user+clinic
  Returns { access_token, refresh_token, clinic_id, user }
  main.js saves tokens to tokens.json
  main.js saves { clinicId, userRole, userName } to clinic.json
  main.js starts local backend with MEDIDESK_USER_ID = googleId
  main.js waits for backend health check

Step 4 — main.js returns complete session to React
  startLogin() IPC resolves with:
  {
    success: true,
    session: {
      googleId, name, email,
      clinicId, userRole, userName,
      accessToken, refreshToken
    }
  }

Step 5 — React receives session
  JoinClinic.jsx gets the session object from the resolved promise
  Calls setSession(session) → stores in memory
  Calls onJoined() → App.jsx sets clinicReady = true → dashboard renders

NO event listeners. NO fallbacks. NO race conditions.
If cloud is offline at step 3 → startLogin() returns { success: false, error: 'cloud_offline' }
React shows a clear error: "Cloud unavailable. Try again when connected."
NO fallback clinic_id = googleId. Either it works or it shows an error.
```

---

### Secretary login (new clean flow)

```
Step 1 — Secretary enters Name + Clinic ID + Password
  JoinClinic.jsx calls: electronAPI.secretaryLogin({ clinicId, name, password })
  Single awaited IPC call.

Step 2 — main.js calls cloud backend
  POST /api/auth/secretary/login
  Cloud verifies password, returns JWT pair
  main.js saves tokens to tokens.json
  main.js saves { clinicId, userRole, userName } to clinic.json
  Returns complete session to React

Step 3 — React receives session
  Same as doctor step 5.
  setSession(session) → onJoined() → dashboard renders

Password is REQUIRED. No fallback to passwordless join.
If wrong password → IPC returns { success: false, error: 'invalid_password' }
React shows error. Nothing else happens.
```

---

### Why this is better

| Old | New |
|---|---|
| startLogin() fires event, React listens | startLogin() returns a promise, React awaits |
| Double listener risk on re-click | Single await, disabled button during loading |
| Cloud offline → fallback to googleId | Cloud offline → clear error, no bad state |
| Session assembled in 3 places | Session assembled in main.js only |
| React calls cloud directly during login | main.js calls cloud, React gets result |

---

## 3. CLEAN APP START FLOW

### The core principle

App.jsx init must be a single linear async function.
No events. No timeouts. No "wait for signal".
One IPC call returns everything needed to render.

---

### New startup sequence

```
app.whenReady() in main.js
  → loadSession() — reads session.json (googleId)
  → if found:
      loadTokens() — reads tokens.json
      loadClinicSession() — reads clinic.json
      startBackend(googleId)
      waitForBackend()
      createWindow() and loadDashboard()
  → if not found:
      createWindow() and loadLogin()

─────────────────────────────────────────────────

React App.jsx mounts
  → calls electronAPI.getSession() — single IPC call
  → main.js returns:
    {
      googleUser: { googleId, name, email } | null,
      tokens: { accessToken, refreshToken } | null,
      clinic: { clinicId, userRole, userName } | null
    }

  → App.jsx processes the result synchronously:
    if tokens exist → setCloudTokens(tokens) — loads into cloudApi memory
    if googleUser exists → setUserId(googleId) — loads into api.js memory
    if clinic exists → setSession(clinic) — stores in memory
      → setClinicReady(true)
    else
      → setClinicReady(false) — show JoinClinic

  → setLoading(false)
  → render dashboard OR JoinClinic

Total: ONE async operation (the IPC call).
No injection. No events. No timeouts. No race conditions.
```

---

### New IPC handler in main.js

```
ipcMain.handle('get-session', () => {
  return {
    googleUser: currentUser || null,
    tokens: loadTokens(),
    clinic: loadClinicSession()
  }
})
```

This is synchronous on the main process side.
It reads from disk files that were written before the window loaded.
The data is always ready when React asks for it.

---

### Why this eliminates the auto-logout bug

The old flow:
```
Electron injects into localStorage (async, timing unknown)
  → sends event
  → React reads localStorage (may be empty if injection not committed)
  → shows login screen
```

The new flow:
```
React asks Electron for session via IPC
  → Electron reads from disk files (always ready)
  → returns complete object
  → React stores in memory
  → renders dashboard
```

localStorage is never used for session state.
There is no injection. There is no event. There is no timing issue.

---

## 4. CLEAN DATA FLOW (PATIENTS)

### Source of truth decision

```
Doctor:    local SQLite = primary source of truth
           cloud = shared mirror for secretary visibility
           
Secretary: cloud = only source of truth
           no local backend access
```

This is the same as today, but the sync must be explicit and reliable.

---

### New patient save flow (doctor)

```
Doctor fills PatientForm → clicks Save

1. POST /api/patients → local backend (port 5000)
   → saved to local SQLite
   → returns { patient_id, patient }

2. Immediately after local save succeeds:
   POST /api/patients → cloud backend (port 8000) with JWT
   → saved to cloud.db
   → returns { cloud_id }

3. PATCH /api/patients/:local_id → local backend
   → stores cloud_id on the local record
   → links local ↔ cloud

4. UI refreshes from local (fast, no wait for cloud)

If step 2 fails (cloud offline):
   → enqueue { action: 'create', patient } to sync queue
   → show subtle "sync pending" indicator
   → do NOT block the UI
   → do NOT use googleId as clinic_id fallback

On next app start or cloud reconnect:
   → replayQueue() processes pending creates AND updates
```

---

### New patient update flow (doctor)

```
Doctor edits patient → clicks Save

1. PUT /api/patients/:local_id → local backend
2. PUT /api/patients/:cloud_id → cloud backend (if cloud_id exists)
   → if fails: enqueue update
```

---

### Secretary patient flow

```
Secretary opens dashboard
  → GET /api/patients → cloud only
  → displayed directly, no merge needed

Secretary edits patient
  → PUT /api/patients/:cloud_id → cloud only
  → no local backend involved

If cloud offline:
  → show cached patients from last successful fetch
  → store in memory (not localStorage)
  → show "offline — showing last known data" banner
  → disable edit/create buttons
```

---

### Merge logic (simplified)

The current `mergePatients` function keys by phone or name — this causes duplicates.

New rule: **key by cloud_id only**.

```
Doctor patient list = local patients
  → each has a cloud_id field (or null if not yet synced)
  → cloud patients with no matching cloud_id in local = new from secretary
  → merge: local list + cloud-only patients (no dedup by name/phone)

This means:
  - No false merges
  - No data loss
  - Duplicates only happen if the same patient is created twice intentionally
```

---

### Offline queue (simplified)

Current queue is in localStorage — this is wrong. Queue can be lost when localStorage is cleared.

New queue location: `sync_queue.json` in Electron userData folder.

```
Queue item: { action: 'create'|'update'|'delete', patient, timestamp }

Written by: patientSyncService.js via electronAPI.saveSyncQueue(items)
Read by: patientSyncService.js via electronAPI.loadSyncQueue()
Cleared by: patientSyncService.js after successful replay

This queue survives:
  - App restarts
  - localStorage clears
  - Logout/login cycles (queue is per-user, keyed by googleId)
```

---

## 5. LIST OF THINGS TO DELETE

### From Electron (main.js + userStore.js)

| What | Why |
|---|---|
| `clinic.json` injection via `executeJavaScript` | Root cause of race condition. Replaced by `get-session` IPC call. |
| `clinic-session-ready` IPC event | No longer needed. React doesn't wait for events. |
| `did-finish-load` handler that injects localStorage | Entire pattern removed. |
| `ipcMain.handle('get-clinic-session')` | Merged into `get-session`. |
| `ipcMain.handle('save-clinic-session')` | main.js writes clinic.json directly after login. React doesn't write it. |

### From React (App.jsx + hooks)

| What | Why |
|---|---|
| `useClinicSession.js` (entire file) | localStorage-based session. Replaced by in-memory session store. |
| `hasSession()` function | Checked localStorage. No longer the session gate. |
| `getSession()` / `saveSession()` from localStorage | Replaced by in-memory getters. |
| `initCloudAuth()` async function | Tokens now loaded synchronously as part of `get-session` IPC response. |
| `onClinicSessionReady` listener in App.jsx | Replaced by awaited IPC call. |
| `5-second timeout` in App.jsx | No longer needed. No async waiting. |
| `resolveClinicId()` function | Exists only to fix a bad state that won't exist anymore. |
| `window.electronAPI.onLoginSuccess` / `onLoginError` listeners | Replaced by promise-based `startLogin()` return value. |

### From JoinClinic.jsx

| What | Why |
|---|---|
| Event listener pattern (`onLoginSuccess`, `onLoginError`) | Replaced by `await electronAPI.startLogin()` |
| `clinicId = user.googleId` fallback | Removed entirely. Cloud offline = error shown, not silent fallback. |
| Passwordless secretary join (`POST /clinic/join` fallback) | Security hole. Password is now required. |
| `resolveClinicId` call | Deleted with the function. |

### From patientSyncService.js

| What | Why |
|---|---|
| `localStorage` queue (`medidesk_sync_queue`) | Volatile. Replaced by `sync_queue.json` on disk. |
| `mergePatients` key-by-phone/name logic | Causes false merges. Replaced by cloud_id keying. |

### From preload.js

| What | Why |
|---|---|
| `onClinicSessionReady` | Event removed. |
| `saveClinicSession` / `getClinicSession` | React no longer manages clinic.json. |
| `onLoginSuccess` / `onLoginError` | Replaced by promise return from `startLogin`. |

---

## 6. LIST OF THINGS TO REWRITE

### Electron

| File | What changes |
|---|---|
| `main.js` | Add `get-session` IPC handler. Move cloud JWT call into `start-login` handler. Remove injection logic. `logout` handler stays but simplified. |
| `preload.js` | Remove deleted IPC channels. Add `getSession`, `secretaryLogin`. |
| `userStore.js` | Keep `session.json` and `users.json`. Remove `clinic.json` write (now written by main.js directly after login). |
| `tokenStore.js` | Keep as-is. |
| New: `syncQueueStore.js` | Manages `sync_queue.json` per user. Read/write/clear. |

### React

| File | What changes |
|---|---|
| `App.jsx` | Rewrite init: single `await electronAPI.getSession()` call. No events, no timeouts. Linear flow. |
| New: `session.js` | In-memory session store. `setSession()`, `getSession()`, `clearSession()`. No localStorage. |
| `cloudApi.js` | Remove `initCloudAuth()`. Tokens set directly from `getSession()` result in App.jsx. Keep interceptors. |
| `api.js` | Keep as-is. `setUserId()` called from App.jsx after `getSession()`. |
| `JoinClinic.jsx` | Rewrite doctor flow: `await electronAPI.startLogin()`. Rewrite secretary flow: `await electronAPI.secretaryLogin()`. Remove all event listeners and fallbacks. |
| `patientSyncService.js` | Replace localStorage queue with IPC-based disk queue. Fix merge to use cloud_id. Wire `syncPatientToCloud` into PatientForm save. |
| `PatientForm.jsx` | After local save succeeds, call `syncPatientToCloud()`. |
| `Dashboard-New.jsx` | Secretary offline: show cached patients from memory, not empty list. |

### Cloud backend

| File | What changes |
|---|---|
| `auth_service.py` | Set real `JWT_SECRET` from env. Remove default value. App refuses to start if not set. |
| `.env.example` | Document `JWT_SECRET` as required. |

### Local backend

| File | What changes |
|---|---|
| `whisper_service.py` | Load model once at module level, not per request. |
| `app.py` | Add simple session token validation (not full JWT — just verify the token Electron signed at spawn time). Removes trust of raw `X-User-ID` header. |

---

## SUMMARY: WHAT THE REFACTOR ACHIEVES

### Session (the main bug)

```
Before: localStorage → injection → event → timeout → hasSession()
After:  IPC call → disk read → memory → render
```

One call. No timing. No race. No logout.

### Login

```
Before: startLogin() fires event → React listens → assembles session in 3 places
After:  await startLogin() → returns complete session → React stores in memory
```

One await. No listeners. No fallbacks.

### Data flow

```
Before: sync not wired to create, queue in volatile localStorage, merge by name/phone
After:  sync called on every save, queue on disk, merge by cloud_id
```

Reliable. No silent data loss. No false merges.

### Complexity removed

```
Before: 5 session storage locations, 2 auth mechanisms, injection hack, 5-second timeout,
        resolveClinicId background patch, passwordless secretary join, googleId fallback
        
After:  2 storage locations (disk files + memory), 1 auth mechanism (JWT everywhere),
        1 IPC call for session, no fallbacks, no background patches
```
