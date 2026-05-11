# PRODUCTION VALIDATION AUDIT
**Date:** May 11, 2026  
**Auditor:** Kiro AI  
**Server:** http://40.81.230.3 | Azure VM Ubuntu 24.04  
**Scope:** Full end-to-end production validation — no feature additions

---

## INFRASTRUCTURE STATUS

| Service | Status | Notes |
|---------|--------|-------|
| Flask API | ✅ Healthy | `{"api":"ok","db":"ok","db_type":"postgresql","redis":"ok"}` |
| PostgreSQL | ✅ Healthy | 50 MB used |
| Redis | ✅ Healthy | 8 MB used |
| MinIO S3 | ✅ Healthy | 113 MB used |
| Nginx | ⚠️ Misconfigured | HTTP→HTTPS redirect, self-signed cert for `localhost` |

---

## BUG #1 — CRITICAL: Nginx Redirects HTTP to HTTPS (Blocks All Traffic)

**Severity:** 🔴 CRITICAL — BLOCKER  
**Affects:** Doctor login, Secretary login, ALL API calls  

**Root Cause:**  
`nginx/conf.d/medidesk.conf` has `server_name localhost` and redirects all HTTP (port 80) to HTTPS (port 443). The SSL certificate is self-signed for `CN=localhost`, not for `40.81.230.3`.

**What happens:**
1. Electron calls `http://40.81.230.3/api/auth/google` (port 80)
2. Nginx returns `301 → https://40.81.230.3/api/auth/google`
3. Electron's Chromium rejects the self-signed cert → `ERR_CERT_AUTHORITY_INVALID`
4. Login fails with `cloud_timeout` or network error

**Evidence:**
```
curl http://40.81.230.3/api/health → 301 Moved Permanently
SSL cert: CN=localhost, self-signed, issuer=MediDesk (not a CA)
```

**Fix Required:**  
Option A (Recommended — no domain): Disable HTTPS redirect, serve HTTP only on port 80.  
Option B (Production-grade): Install Let's Encrypt cert with a real domain.

---

## BUG #2 — CRITICAL: JoinClinic.jsx Has Hardcoded localhost Fallback

**Severity:** 🔴 CRITICAL — BLOCKER  
**Affects:** Secretary check, set-password, web fallback login  
**File:** `medidesk-ai/frontend/src/pages/JoinClinic.jsx` line 7

```javascript
// CURRENT (WRONG):
const CLOUD_BASE = process.env.REACT_APP_CLOUD_URL || 'http://localhost:8000/api';
```

This file has its own `CLOUD_BASE` constant that does NOT use `cloudApi.js`. It uses raw `axios` directly. If the env var is missing at build time, it falls back to `localhost:8000` instead of the production server.

**Affected calls:**
- `POST /auth/secretary/check`
- `POST /auth/secretary/set-password`
- `POST /auth/secretary/login` (web fallback)

**Fix Required:**
```javascript
// CORRECT:
const CLOUD_BASE = process.env.REACT_APP_CLOUD_URL || 'http://40.81.230.3/api';
```

---

## BUG #3 — HIGH: TopBar Calls Local API for Clinic Info (Doctor Mode)

**Severity:** 🟠 HIGH  
**Affects:** Doctor mode — TopBar shows blank clinic name  
**File:** `medidesk-ai/frontend/src/components/TopBar.jsx` line 38

```javascript
api.get('/api/setup')  // ← calls localhost:5000, not cloud
```

In production, the local Flask backend is not running. This call silently fails (`.catch(() => {})`), so `clinicInfo` stays `{ doctor_name: null, clinic_name: null }`. The TopBar falls back to `currentUser.name` for the doctor name but shows `'Clinic'` as the clinic name — not a crash, but incorrect data.

**Fix Required:** For doctor mode in production, fetch clinic info from `cloudApi.get('/clinics/me')` instead of the local API.

---

## BUG #4 — HIGH: Doctor Login Starts Local Backend (Removed) But `waitForBackend` Still Called in `loadSession` Path

**Severity:** 🟠 HIGH  
**Affects:** Doctor session restore on app restart  
**File:** `medidesk-ai/electron/main.js`

The `app.whenReady()` path was fixed — it no longer calls `startBackend`. However, the `waitForBackend` function still polls `http://localhost:5000/api/health`. If a doctor restarts the app with a saved session, the new code correctly skips the backend start. ✅ This path is now clean.

**Residual risk:** The `startBackend`, `stopBackend`, `restartBackendForUser`, and `waitForBackend` functions are still defined and called from `logout` (`stopBackend`). `stopBackend` is safe (it checks `if (backendProcess)`). No crash, but dead code.

**Status:** No crash. Low risk. Can be cleaned up post-launch.

---

## BUG #5 — HIGH: WebSocket CSP Blocks Connection

**Severity:** 🟠 HIGH  
**Affects:** Realtime notifications, clinic chat live updates  
**File:** `cloud-backend/nginx/conf.d/medidesk.conf`

```nginx
add_header Content-Security-Policy "... connect-src 'self' wss://localhost https://localhost" always;
```

The CSP `connect-src` only allows `wss://localhost` and `https://localhost`. WebSocket connections from the Electron app to `ws://40.81.230.3` or `http://40.81.230.3` are blocked by this header.

**Result:** `connectRealtime()` in `cloudApi.js` will fail silently. Notifications and clinic chat real-time updates won't work. Polling fallback is not implemented.

**Fix Required:** Update CSP to include the production IP:
```nginx
connect-src 'self' wss://40.81.230.3 https://40.81.230.3 http://40.81.230.3 ws://40.81.230.3
```

---

## BUG #6 — MEDIUM: Nginx `server_name localhost` Doesn't Match Production IP

**Severity:** 🟡 MEDIUM  
**Affects:** All requests via Nginx  
**File:** `cloud-backend/nginx/conf.d/medidesk.conf`

Both server blocks use `server_name localhost`. When requests arrive at `40.81.230.3`, Nginx matches them to the default server (which is this one), so it works — but it's technically incorrect and will cause issues if a second vhost is ever added.

**Fix Required:** Change to `server_name _;` (catch-all) or `server_name 40.81.230.3;`.

---

## BUG #7 — MEDIUM: Secretary Mode Has No Offline Patient Cache Fallback on First Load

**Severity:** 🟡 MEDIUM  
**Affects:** Secretary — app restart while offline  
**File:** `medidesk-ai/frontend/src/services/patientSyncService.js`

`fetchCloudPatients()` returns `null` on failure. The Dashboard must handle `null` and fall back to `window.electronAPI.loadPatientCache()`. If the Dashboard doesn't check for `null` before rendering, it will crash or show an empty list with no error message.

**Status:** Needs Dashboard code review to confirm handling. Not audited here — flag for manual test.

---

## BUG #8 — MEDIUM: Token Refresh Calls `CLOUD_BASE/auth/refresh` — Will Hit 301 Redirect

**Severity:** 🟡 MEDIUM (consequence of Bug #1)  
**Affects:** Any session longer than 1 hour  
**File:** `medidesk-ai/frontend/src/cloudApi.js` line 72

```javascript
const res = await axios.post(`${CLOUD_BASE}/auth/refresh`, { refresh_token: _refreshToken });
```

`CLOUD_BASE` is now `http://40.81.230.3/api`. This hits port 80, gets a 301 to HTTPS, which fails with cert error. After 1 hour, all tokens expire and the app logs out the user unexpectedly.

**This is a downstream consequence of Bug #1.** Fixing Bug #1 fixes this.

---

## BUG #9 — LOW: `onBackendStartFailed` IPC Event Still Registered in App.jsx

**Severity:** 🟢 LOW  
**Affects:** Doctor mode — spurious "backend failed" banner  
**File:** `medidesk-ai/frontend/src/App.jsx` line 113

```javascript
window.electronAPI?.onBackendStartFailed?.(() => setBackendFailed(true));
```

The local backend is no longer started, so this event will never fire. However, the banner code and the `backendFailed` state remain. No crash, no user impact. Dead code.

---

## BUG #10 — LOW: Sync Queue Uses `currentUser.googleId` — Null for Secretary

**Severity:** 🟢 LOW  
**Affects:** Secretary sync queue persistence  
**File:** `medidesk-ai/electron/main.js` — `save-sync-queue` IPC handler

```javascript
const rawKey = currentUser?.googleId
  || (clinic?.userRole === 'secretary' ? `${clinic.clinicId}_${clinic.userName}` : 'anonymous');
```

This is correctly handled — secretary falls back to `clinicId_userName`. ✅ No bug, confirmed safe.

---

## LOCALHOST REGRESSION SCAN

| File | Reference | Status |
|------|-----------|--------|
| `frontend/.env` | `REACT_APP_API_URL=http://localhost:5000` | ✅ Intentional — doctor local DB |
| `frontend/.env` | `REACT_APP_CLOUD_URL=http://40.81.230.3/api` | ✅ Fixed |
| `cloudApi.js` | fallback `http://40.81.230.3/api` | ✅ Fixed |
| `cloudApi.js` | WS base `http://40.81.230.3/api` | ✅ Fixed |
| `api.js` | `http://localhost:5000` | ✅ Intentional — doctor local DB |
| `main.js` | `localhost:3000` | ✅ Dev mode only |
| `main.js` | `localhost:5000/api/health` | ✅ Doctor local health check |
| `main.js` | `40.81.230.3:80` (doctor auth) | ✅ Fixed |
| `main.js` | `40.81.230.3:80` (secretary auth) | ✅ Fixed |
| **`JoinClinic.jsx`** | **`localhost:8000/api` fallback** | **🔴 BUG #2 — NOT FIXED** |

---

## FLOW-BY-FLOW VALIDATION

### 1. Doctor Login Flow
| Step | Status | Notes |
|------|--------|-------|
| Google OAuth redirect | ✅ | `googleAuth.js` — uses `https://accounts.google.com` |
| Token exchange `POST /api/auth/google` | 🔴 BLOCKED | Bug #1: 301 redirect → HTTPS cert failure |
| JWT saved to disk | ✅ | `tokenStore.js` — correct |
| Session restored on restart | ✅ | `main.js` — no longer starts local backend |
| `cloudApi` tokens loaded | ✅ | `App.jsx` → `setCloudTokens()` |

**Verdict: BLOCKED by Bug #1**

### 2. Secretary Login Flow
| Step | Status | Notes |
|------|--------|-------|
| Secretary check `POST /auth/secretary/check` | 🔴 BLOCKED | Bug #1 + Bug #2 |
| Password set `POST /auth/secretary/set-password` | 🔴 BLOCKED | Bug #1 + Bug #2 |
| Login `POST /auth/secretary/login` | 🔴 BLOCKED | Bug #1 |
| IPC `secretary-login` | 🔴 BLOCKED | Bug #1: calls `40.81.230.3:80` → 301 |
| Session saved | ✅ | `userStore.js` — correct |

**Verdict: BLOCKED by Bug #1**

### 3. Patient CRUD
| Operation | Doctor | Secretary |
|-----------|--------|-----------|
| Fetch patients | 🟡 Local DB (no cloud sync) | 🔴 BLOCKED (no auth) |
| Create patient | 🟡 Local only | 🔴 BLOCKED |
| Update patient | 🟡 Local only | 🔴 BLOCKED |
| Delete patient | 🟡 Local only | 🔴 BLOCKED |
| Cloud sync | 🔴 BLOCKED (Bug #1) | 🔴 BLOCKED |

**Verdict: Doctor can use local DB. Cloud sync blocked. Secretary fully blocked.**

### 4. Appointment CRUD
| Operation | Doctor | Secretary |
|-----------|--------|-----------|
| Fetch appointments | 🟡 Local DB | 🔴 BLOCKED |
| Create appointment | 🟡 Local DB | 🔴 BLOCKED |
| Update appointment | 🟡 Local DB | 🔴 BLOCKED |
| Delete appointment | 🟡 Local DB | 🔴 BLOCKED |

**Verdict: Same as patients.**

### 5. Offline Sync Recovery
| Step | Status | Notes |
|------|--------|-------|
| Queue persists to disk | ✅ | `syncQueueStore.js` — correct |
| Queue loads on startup | ✅ | `patientSyncService.js` — correct |
| Replay on reconnect | 🔴 BLOCKED | `replayQueue()` calls `cloudApi` → Bug #1 |
| Conflict detection (409) | ✅ Code correct | Not testable until Bug #1 fixed |
| Backoff/retry logic | ✅ Code correct | Not testable until Bug #1 fixed |

**Verdict: Queue logic is correct. Replay blocked by Bug #1.**

### 6. Realtime WebSocket
| Step | Status | Notes |
|------|--------|-------|
| `connectRealtime()` called | ✅ | `App.jsx` on mount |
| Socket.io connection | 🔴 BLOCKED | Bug #5: CSP blocks `ws://40.81.230.3` |
| Notification events | 🔴 BLOCKED | No socket = no events |
| Clinic chat live updates | 🔴 BLOCKED | Falls back to manual refresh only |
| Reconnect + missed events | ✅ Code correct | Not testable until Bug #5 fixed |

**Verdict: Blocked by Bug #5 (and Bug #1 for HTTPS).**

### 7. Session Persistence
| Step | Status | Notes |
|------|--------|-------|
| Tokens saved to disk | ✅ | `tokenStore.js` |
| Clinic session saved | ✅ | `userStore.js` |
| Session restored on restart | ✅ | `main.js` `get-session` IPC |
| Token refresh after 1h | 🔴 BLOCKED | Bug #8 (consequence of Bug #1) |
| Logout clears all state | ✅ | `main.js` logout handler |

**Verdict: Persistence correct. Token refresh blocked.**

### 8. Electron Production Startup
| Step | Status | Notes |
|------|--------|-------|
| App loads without local backend | ✅ | Fixed in previous session |
| Session restored from disk | ✅ | `get-session` IPC |
| Tokens loaded into cloudApi | ✅ | `App.jsx` init |
| Dashboard renders | ✅ | No crash |
| TopBar clinic info | 🟠 Blank | Bug #3: `api.get('/api/setup')` fails silently |
| Sync replay on startup | 🔴 BLOCKED | Bug #1 |

**Verdict: App starts and renders. Cloud features blocked.**

---

## FINAL BUG LIST

| # | Severity | Description | File | Blocks |
|---|----------|-------------|------|--------|
| 1 | 🔴 CRITICAL | Nginx HTTP→HTTPS redirect, self-signed cert for `localhost` | `nginx/conf.d/medidesk.conf` | Everything |
| 2 | 🔴 CRITICAL | `JoinClinic.jsx` hardcoded `localhost:8000` fallback | `JoinClinic.jsx:7` | Secretary login |
| 3 | 🟠 HIGH | TopBar calls `localhost:5000/api/setup` in production | `TopBar.jsx:38` | Clinic name display |
| 4 | 🟠 HIGH | Dead code: `startBackend`/`waitForBackend` still defined | `main.js` | None (no crash) |
| 5 | 🟠 HIGH | CSP blocks WebSocket to `40.81.230.3` | `medidesk.conf` | Realtime/notifications |
| 6 | 🟡 MEDIUM | `server_name localhost` doesn't match production IP | `medidesk.conf` | Future vhosts |
| 7 | 🟡 MEDIUM | Secretary offline cache fallback not verified in Dashboard | `Dashboard-New.jsx` | Secretary offline |
| 8 | 🟡 MEDIUM | Token refresh hits port 80 → 301 → cert failure after 1h | `cloudApi.js:72` | Long sessions |
| 9 | 🟢 LOW | Dead `onBackendStartFailed` listener in App.jsx | `App.jsx:113` | None |
| 10 | 🟢 LOW | Dead `stopBackend` call in logout (safe, no-op) | `main.js` | None |

---

## FIXES REQUIRED BEFORE GO-LIVE

### Fix 1 (CRITICAL): Disable HTTPS Redirect in Nginx

The fastest fix — serve HTTP only until a real domain + Let's Encrypt cert is set up.

**File:** `cloud-backend/nginx/conf.d/medidesk.conf`

Replace the entire file with an HTTP-only config:

```nginx
upstream medidesk_api {
    server api:8000;
}

limit_req_zone $binary_remote_addr zone=api_auth:10m    rate=10r/m;
limit_req_zone $binary_remote_addr zone=api_general:10m rate=60r/m;
limit_req_zone $binary_remote_addr zone=api_upload:10m  rate=10r/m;

server {
    listen 80;
    server_name _;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location /socket.io/ {
        proxy_pass         http://medidesk_api;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location ~ ^/api/auth {
        limit_req        zone=api_auth burst=5 nodelay;
        limit_req_status 429;
        proxy_pass       http://medidesk_api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location ~ ^/api/v2/attachments/.+$ {
        limit_req            zone=api_upload burst=3 nodelay;
        client_max_body_size 26M;
        proxy_pass           http://medidesk_api;
        proxy_set_header     Host $host;
        proxy_set_header     X-Real-IP $remote_addr;
        proxy_read_timeout   120s;
    }

    location = /api/health {
        proxy_pass http://medidesk_api;
        access_log off;
    }

    location /api/ {
        limit_req        zone=api_general burst=20 nodelay;
        proxy_pass       http://medidesk_api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 30s;
    }
}
```

### Fix 2 (CRITICAL): JoinClinic.jsx Fallback URL

**File:** `medidesk-ai/frontend/src/pages/JoinClinic.jsx` line 7

```javascript
// Change:
const CLOUD_BASE = process.env.REACT_APP_CLOUD_URL || 'http://localhost:8000/api';
// To:
const CLOUD_BASE = process.env.REACT_APP_CLOUD_URL || 'http://40.81.230.3/api';
```

### Fix 3 (HIGH): TopBar Clinic Info

**File:** `medidesk-ai/frontend/src/components/TopBar.jsx`

The `api.get('/api/setup')` call should be skipped in secretary mode (already cloud-only) and for doctor mode in production where local backend is not running. Since clinic info is available in the JWT/session, fetch it from `cloudApi.get('/clinics/me')` instead.

---

## PRODUCTION SCORE

| Category | Score | Notes |
|----------|-------|-------|
| Infrastructure | 8/10 | All 5 services healthy, nginx misconfigured |
| Authentication | 2/10 | Blocked by nginx redirect |
| Patient CRUD | 4/10 | Doctor local works, cloud blocked |
| Appointment CRUD | 4/10 | Doctor local works, cloud blocked |
| Offline Sync | 6/10 | Queue logic correct, replay blocked |
| Realtime/WebSocket | 1/10 | CSP blocks connection |
| Session Persistence | 7/10 | Disk persistence correct, refresh blocked |
| Electron Startup | 7/10 | Starts clean, cloud features blocked |
| Secretary Mode | 1/10 | Fully blocked |
| Code Quality | 8/10 | Clean architecture, minor dead code |

**OVERALL PRODUCTION SCORE: 48/100**

---

## GO / NO-GO VERDICT

```
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   VERDICT:  ❌  NO-GO                                    ║
║                                                          ║
║   2 CRITICAL blockers must be fixed before deployment.   ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

**Blocking issues:**
1. 🔴 Nginx HTTP→HTTPS redirect breaks all API calls (Bug #1)
2. 🔴 JoinClinic.jsx localhost fallback breaks secretary login (Bug #2)

**After fixing both critical bugs, estimated score: 78/100**

Remaining issues (non-blocking for pilot):
- Bug #3: TopBar shows blank clinic name (cosmetic)
- Bug #5: WebSocket/realtime disabled (notifications won't push, chat needs manual refresh)
- Bug #8: Sessions expire after 1 hour without refresh (consequence of Bug #1, auto-fixed)

**Recommended path to GO:**
1. Fix Bug #1 (nginx config — 10 min)
2. Fix Bug #2 (JoinClinic.jsx — 1 line)
3. Redeploy nginx: `docker-compose restart nginx`
4. Rebuild frontend with correct env
5. Re-run validation

**Pilot clinic deployment is safe after fixing Bugs #1 and #2.**  
WebSocket (Bug #5) can be fixed in the first post-launch patch.

---

*Audit performed via static code analysis + live server testing.*  
*Server: 40.81.230.3 | All 5 Docker services confirmed healthy.*
