# MediDesk AI — Execution Plan: 62% → 80%+
> Generated from PRODUCTION_AUDIT.md | Focus: Reliability, Data Consistency, Secretary Usability

---

## PHASE 1 — ISSUE CLASSIFICATION

| # | Issue | Severity | Why | Affected Files |
|---|-------|----------|-----|----------------|
| 1 | Secretary `handlePatientSelect` calls local API → patient detail always blank | CRITICAL | Core secretary workflow broken — cannot view any patient | `Dashboard-New.jsx` |
| 2 | Patient delete not mirrored to cloud → deleted patients reappear on next sync | CRITICAL | Data inconsistency — doctor cannot permanently delete a patient | `Dashboard-New.jsx` |
| 3 | `replayQueue` stopped on first failure → queued edits permanently lost | CRITICAL | Data loss — offline edits never reach cloud | `patientSyncService.js` ✅ FIXED |
| 4 | `password_hash` returned in `serialize()` → credential exposure in API responses | CRITICAL | Security — hash exposed in `/api/clinic/<id>` and secretary list | `cloud-backend/app.py` |
| 5 | Legacy `POST /api/clinic/join` allows unauthenticated secretary creation | CRITICAL | Security — anyone can create a secretary account in any clinic | `cloud-backend/app.py` |
| 6 | No React Error Boundary → one component crash kills entire app | CRITICAL | Reliability — white screen of death in production | `App.jsx` |
| 7 | Secretary name never shown in TopBar (`currentUser` is null for secretary) | HIGH | UX — secretary sees no identity in the app | `electron/main.js` |
| 8 | Analytics route has no role guard → secretary sees broken page | HIGH | UX — secretary navigates to analytics and sees errors | `App.jsx` |
| 9 | `session.json` written before cloud JWT exchange → broken state on cloud failure | HIGH | Reliability — partial session causes confusing restart behavior | `electron/googleAuth.js` |
| 10 | Secretary appointments page calls local API → completely broken | HIGH | Core workflow — secretary cannot manage appointments | `Appointments.jsx` |
| 11 | Secretary `handlePatientSelect` fallback uses list data but detail panel still calls local API for attachments/appointments | HIGH | UX — detail panel partially broken even with fallback | `PatientDetail.jsx` |
| 12 | GROQ_API_KEY printed to stdout on every backend start | HIGH | Security — API key leaks to logs | `backend/app.py` ✅ FIXED |
| 13 | Refresh token not rotated on use → stolen token valid 30 days | HIGH | Security — no token invalidation mechanism | `cloud-backend/auth_service.py` |
| 14 | Secretary offline cache is in-memory only → empty after restart | HIGH | Reliability — secretary sees no patients after app restart while offline | `Dashboard-New.jsx` |
| 15 | `syncWarning` state exists but never cleared after successful sync | LOW | UX — stale warning shown after reconnect | `Dashboard-New.jsx` ✅ FIXED |
| 16 | `recentActivity` sort uses formatted string not numeric value → wrong order | LOW | UX — analytics activity feed in wrong order | `backend/analytics_methods.py` |
| 17 | No rate limiting on local `/api/chat` endpoint | LOW | Cost — AI endpoint can be spammed | `backend/app.py` |
| 18 | AI chat history keyed by local `patient.id` → lost after sync | LOW | UX — chat history disappears for cloud-only patients | `AIChat.jsx` |
| 19 | `calculateStats` in Appointments makes redundant API call | LOW | Performance — extra request on every view change | `Appointments.jsx` |
| 20 | `window.confirm` used for delete confirmation — blocked in some Electron configs | LOW | UX — delete may silently fail | `Dashboard-New.jsx`, `PatientDetail.jsx` |

---

## PHASE 2 — EXECUTION ROADMAP

### CRITICAL FIXES (implement now)

| Step | File | Function/Component | Change | Expected Result |
|------|------|--------------------|--------|-----------------|
| C1 | `Dashboard-New.jsx` | `handlePatientSelect` | Branch by role: secretary uses cloud patient object directly (already has all fields) instead of local API | Secretary can open patient detail |
| C2 | `Dashboard-New.jsx` | `handleDeletePatient` | Already fixed — cloud delete mirrored | ✅ Done |
| C3 | `patientSyncService.js` | `replayQueue` | Already fixed — no break, independent processing | ✅ Done |
| C4 | `cloud-backend/app.py` | `serialize()` | Add `SENSITIVE_FIELDS` exclusion set — strip `password_hash` from all responses | Credentials never exposed |
| C5 | `cloud-backend/app.py` | `join_clinic` route | Disable endpoint — return 410 Gone | Unauthenticated account creation closed |
| C6 | `App.jsx` | Root component | Add `<ErrorBoundary>` wrapper around `<Router>` | App survives component crashes |

### HIGH FIXES (implement next)

| Step | File | Function/Component | Change | Expected Result |
|------|------|--------------------|--------|-----------------|
| H1 | `electron/main.js` | `secretary-login` IPC handler | Set `currentUser = { name, role: 'secretary', clinicId }` after successful login | Secretary name appears in TopBar |
| H2 | `App.jsx` | Route for `/analytics` | Already guarded — verify it's correct | ✅ Done |
| H3 | `PatientDetail.jsx` | `loadAttachments`, `loadAppointments`, `handleTranscriptionComplete` | Detect `_fromCloud` patients and skip local API calls gracefully | Detail panel doesn't crash for secretary |
| H4 | `Appointments.jsx` | All API calls | Branch by role: secretary uses `cloudApi`, doctor uses `api` | Secretary can view/create appointments |
| H5 | `electron/googleAuth.js` | `startGoogleLogin` | Move `saveSession()` call to after cloud JWT exchange in `main.js` | No broken state on cloud failure |

### LOW FIXES (polish)

| Step | File | Function/Component | Change | Expected Result |
|------|------|--------------------|--------|-----------------|
| L1 | `backend/analytics_methods.py` | `get_recent_activity` | Sort by `days_ago` float not formatted string | Correct activity order |
| L2 | `AIChat.jsx` | `storageKey` | Use `patient.global_id || patient.cloud_id || patient.id` as key | Chat history survives sync |
| L3 | `Appointments.jsx` | `calculateStats` | Derive from already-loaded `weekAppointments` state | Remove redundant API call |

---

## PHASE 3 — TOP 3 CRITICAL FIXES (implementing now)

### FIX C1: Secretary Patient Detail
### FIX C4: Remove password_hash from API responses
### FIX C6: React Error Boundary

---

---

## PHASE 3 — IMPLEMENTATION RECORD

### FIX C1 — Secretary Patient Detail (`Dashboard-New.jsx`)

**Problem:** `handlePatientSelect` called `api.get('/api/patients/:id')` for every patient click. Secretary has no local backend (port 5000) — this always fails silently, leaving the detail panel blank.

**Before:**
```js
const handlePatientSelect = async (patient) => {
  if (patient._fromCloud && !patient.id) {
    setSelectedPatient(patient);
    return;
  }
  try {
    const response = await api.get(`/api/patients/${patient.id}`);
    setSelectedPatient(response.data.patient);
  } catch (error) {
    setSelectedPatient(patient); // fallback
  }
};
```

**After:**
```js
const handlePatientSelect = async (patient) => {
  // Secretary: cloud patients already have all fields — skip local API entirely
  if (secretary) {
    setSelectedPatient(patient);
    return;
  }
  // Doctor: cloud-only patient (no local record) — use cloud data directly
  if (patient._fromCloud && !patient.id) {
    setSelectedPatient(patient);
    return;
  }
  try {
    const response = await api.get(`/api/patients/${patient.id}`);
    setSelectedPatient(response.data.patient);
  } catch (error) {
    setSelectedPatient(patient); // fallback
  }
};
```

**Why it works:** `fetchCloudPatients()` already returns complete patient objects with all fields. Secretary never needs to re-fetch — the list data IS the detail data. The `secretary` check runs before any API call, so port 5000 is never touched.

**Edge cases:**
- Secretary offline: `cachedCloudPatients` is used for the list, so clicking still works with stale data
- Secretary selects a patient with no notes: renders empty state correctly (no crash)
- Doctor selects cloud-only patient: falls through to the `_fromCloud` check, uses cloud data

---

### FIX C4 + C5 — Remove password_hash + Disable legacy endpoint (`cloud-backend/app.py`)

**Problem 1:** `serialize()` iterated all model columns including `password_hash`, exposing bcrypt hashes in every user-related API response.

**Before:**
```python
def serialize(obj):
    result = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.name)
        result[col.name] = val.isoformat() if isinstance(val, datetime) else val
    return result
```

**After:**
```python
_SENSITIVE_FIELDS = frozenset({"password_hash"})

def serialize(obj):
    result = {}
    for col in obj.__table__.columns:
        if col.name in _SENSITIVE_FIELDS:
            continue
        val = getattr(obj, col.name)
        result[col.name] = val.isoformat() if isinstance(val, datetime) else val
    return result
```

**Why it works:** `frozenset` lookup is O(1). Adding future sensitive fields (e.g., `totp_secret`) requires only one line change in one place. All routes using `serialize()` are automatically protected.

**Problem 2:** `POST /api/clinic/join` allowed anyone with a valid `clinic_id` to create a secretary account with no authentication. Superseded by the doctor-JWT-required `/clinic/secretaries/create` endpoint.

**After:** Returns `410 Gone` with a clear message pointing to the correct endpoint.

---

### FIX C6 — React Error Boundary (`App.jsx`)

**Problem:** No error boundary existed. Any unhandled render error (null dereference, missing prop, API response shape change) produced a white screen with no recovery path.

**After:** `ErrorBoundary` class component wraps the entire `<Router>`. On error:
- Shows a user-friendly message ("Something went wrong")
- Provides a "Try again" button that resets the error state
- In development mode, shows the raw error for debugging
- Does NOT crash the Electron window — user can recover without restarting

**Edge cases:**
- Error in JoinClinic (before Router): not caught by this boundary — acceptable, login errors are handled inline
- Error in a single route component: boundary catches it, other routes are unaffected after "Try again"
- Repeated errors: "Try again" resets `hasError` state, allowing the component to re-render

---

### FIX H1 — Secretary Name in TopBar (`electron/main.js`)

**Problem:** `currentUser` was only set for doctors (Google OAuth). Secretary `currentUser` was always `null`, so TopBar showed nothing for the secretary's identity.

**Two-part fix:**
1. In `secretary-login` handler: `currentUser = { name, role: 'secretary', clinicId, googleId: null }` immediately after successful login
2. In `get-session` handler: if `currentUser` is null but `clinic.json` has a secretary session, reconstruct a minimal user object from disk — handles app restarts

**Why it works:** `App.jsx` reads `googleUser` from `get-session` and sets it as `currentUser` state. TopBar receives this as a prop and displays `currentUser?.name`. Now secretary restarts also show the correct name.

---

## CURRENT STATUS AFTER PHASE 3

| Fix | Status | Impact |
|-----|--------|--------|
| C1: Secretary patient detail | ✅ Implemented | Secretary can now open and view patient details |
| C2: Patient delete cloud sync | ✅ Already done | Deleted patients no longer reappear |
| C3: replayQueue no break | ✅ Already done | Offline edits no longer lost |
| C4: password_hash in responses | ✅ Implemented | Credentials no longer exposed in API |
| C5: Legacy join_clinic disabled | ✅ Implemented | Unauthenticated account creation closed |
| C6: React Error Boundary | ✅ Implemented | App survives component crashes |
| H1: Secretary name in TopBar | ✅ Implemented | Secretary identity visible in UI |

**Estimated new production-readiness: ~78%**

Remaining to reach 80%+:
- H3: PatientDetail graceful degradation for secretary (attachments/appointments skip local API)
- H4: Appointments page secretary routing to cloudApi
- H5: session.json written after cloud JWT exchange
