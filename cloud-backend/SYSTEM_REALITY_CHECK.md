# MediDesk AI — System Reality Check
> Date: April 2026
> Method: Direct code inspection — no assumptions, no documentation taken at face value
> Purpose: Ground-truth audit of what actually runs when you start the system today

---

## 1. DATABASE STATE

### What is actually running right now

**Cloud backend:** SQLite. Period.

The file `cloud-backend/.env` contains exactly:
```
DATABASE_URL=sqlite:///./cloud.db
JWT_SECRET=353edb55e741dfe417c4dd067e30cb7bf4a7e84c59ca292fe5afebef10059cf1
```

Nothing else. No `REDIS_URL`. No `STORAGE_BACKEND`. No `ALLOWED_ORIGINS`.

`database.py` reads `DATABASE_URL` from env and defaults to `sqlite:///./cloud.db` if not set. Since the `.env` explicitly sets SQLite, the cloud backend runs on SQLite right now.

**Local backend (port 5000):** SQLite. Per-user file at `data/users/<googleId>/medidesk.db`. This is correct and intentional — the local backend is always SQLite.

**PostgreSQL:** Code exists in `database.py` to connect to PostgreSQL if `DATABASE_URL` starts with `postgresql://`. The connection pool, index creation, and migration script (`migrate_to_postgres.py`) are all written. But PostgreSQL is **not running** and **not configured** in the current `.env`. It exists only as code.

**Docker:** `docker-compose.yml` defines a PostgreSQL service. But Docker is not running. The compose file is a deployment artifact, not the current runtime.

**Tests:** `conftest.py` forces `DATABASE_URL=sqlite:///:memory:` via `os.environ`. Tests run against in-memory SQLite regardless of what `.env` says.

### Summary

| Component | Database | Status |
|-----------|----------|--------|
| Cloud backend (running now) | SQLite (`cloud.db`) | Active |
| Local backend (running now) | SQLite (per-user file) | Active |
| PostgreSQL | Not running | Code exists, not configured |
| Docker PostgreSQL | Not running | Compose file exists |
| Tests | SQLite in-memory | Active |

---

## 2. PRODUCTION READINESS TRUTH

### What is actually working in runtime right now

**Working end-to-end (code + wired + tested):**
- JWT authentication (Google OAuth + secretary password)
- Secretary lifecycle (INVITED → ACTIVE)
- Patient CRUD with soft delete
- Appointment CRUD with overlap detection
- Clinic chat (polling, 5s interval)
- Offline sync queue (Electron IPC, disk-persisted)
- Conflict detection (version-based, 409 responses)
- Multi-tenant isolation (clinic_id from JWT on all queries)
- Rate limiting on auth endpoints (Flask-Limiter, in-memory storage)
- Structured request logging (observability.py, wired via `setup_observability(app)`)
- Audit log (AuditLog model, written on every mutation)
- Notifications (Notification model, written on secretary patient create)
- Soft delete + restore endpoint (backend only — no frontend UI)
- Secretary password reset endpoint (backend only — no frontend UI)
- JWT revocation endpoint (backend only — **table may not exist**, see below)

### What is documented but NOT actually active in runtime

**Redis:** `REDIS_URL` is not set in `.env`. Every Redis-dependent feature degrades silently:
- Rate limiter falls back to in-memory (resets on restart, no cross-worker sharing)
- SocketIO `message_queue=None` → single-process mode (no pub/sub between workers)
- Event buffer for at-least-once delivery → disabled (no Redis = no buffer)
- Sync metrics (`track_sync_failure`, `track_sync_success`) → no-op (returns None)
- Observability metrics endpoint (`GET /api/metrics`) → returns `{"error": "Redis not available"}`

**S3/MinIO storage:** `STORAGE_BACKEND` not set in `.env`. Defaults to `local`. All file uploads go to `./data/attachments/` on the server filesystem. The S3Storage class exists but is never instantiated.

**CORS restriction:** `ALLOWED_ORIGINS` not set in `.env`. Defaults to `"*"`. The ENV-based CORS code is wired correctly, but since the env var is absent, it runs as `origins="*"` — same as before the fix.

**WebSocket (SocketIO):** The server-side SocketIO is initialized and `emit_to_clinic()` is called on patient mutations. However:
- `REDIS_URL` is not set → SocketIO runs in single-process threading mode
- The frontend `connectRealtime()` function uses `require('socket.io-client')` in a try/catch — if `socket.io-client` is not installed in `frontend/node_modules`, it silently skips. The Electron app uses polling, not WebSocket.
- Net result: SocketIO server is running but no web client connects to it. The Electron app does not use it.

**JWT Revocation (`revoked_tokens` table):** `RevokedToken` model exists in `models.py`. The `verify_jwt` decorator checks it. The `POST /api/auth/revoke` endpoint writes to it. **BUT:** `init_db()` in `database.py` imports only `Clinic, User, Patient, Message, Appointment, AuditLog, Notification` — `RevokedToken` is NOT imported. `Base.metadata.create_all()` will not create the `revoked_tokens` table. The `migrate.py` script does create it via raw SQL. If `migrate.py` has been run, the table exists. If not, every call to `verify_jwt` that tries to query `RevokedToken` will throw a `sqlalchemy.exc.OperationalError: no such table: revoked_tokens` and the request will fail.

**Eventlet monkey-patch appears twice:** Lines 5–6 of `app.py` show `eventlet.monkey_patch()` called twice (duplicate line). This is harmless but indicates a copy-paste artifact.

---

## 3. CRITICAL FEATURES CHECK

| Feature | Status | Evidence |
|---------|--------|----------|
| JWT authentication + refresh rotation | **IMPLEMENTED** | `auth_service.py` generates tokens with `jti`. Refresh returns both tokens. `cloudApi.js` saves rotated token. |
| JWT revocation (jti system) | **PARTIAL** | Code exists. `revoked_tokens` table created by `migrate.py` but NOT by `init_db()`. If `migrate.py` not run → table missing → `verify_jwt` crashes on revocation check. |
| Soft delete | **IMPLEMENTED** | `deleted_at` column on Patient. All queries filter `deleted_at IS NULL`. `DELETE` route sets `deleted_at`. |
| Patient restore | **PARTIAL** | Backend endpoint `POST /api/patients/:id/restore` exists and works. **No frontend UI.** Doctor cannot restore through the app. |
| Offline sync queue (patients) | **IMPLEMENTED** | `patientSyncService.js` — disk-persisted via Electron IPC, exponential backoff, dead-letter after 10 retries, dedup by entityId. |
| Offline sync queue (appointments) | **IMPLEMENTED** | `appointmentSyncService.js` — same pattern, separate queue namespace. |
| Conflict detection (version-based) | **IMPLEMENTED** | `version` column on Patient. `PUT /patients/by-global/<id>` checks `client_version != stored_version` → 409. Clock-skew immune. |
| Attachments upload (local) | **IMPLEMENTED** | Doctor uploads to local filesystem via local Flask backend. Works. |
| Attachments upload (cloud/S3) | **NOT USED** | `storage_service.py` S3Storage class exists. `STORAGE_BACKEND` not set → LocalStorage used. Cloud attachment routes exist in `app.py` but serve from local filesystem. |
| WebSocket realtime (server) | **IMPLEMENTED** | `realtime_service.py` wired into `app.py`. `emit_to_clinic()` called on mutations. |
| WebSocket realtime (client) | **NOT USED** | Electron app uses polling. `connectRealtime()` in `cloudApi.js` only runs if `window.electronAPI` is absent (web mode). No web client deployed. |
| Audit logs | **IMPLEMENTED** | `AuditLog` model. `audit()` called on all patient/appointment/auth mutations. Table created by `init_db()`. |
| Rate limiting | **PARTIAL** | Auth endpoints limited (5–20/min). Some data endpoints limited (30–60/min). No Redis → in-memory storage → resets on restart, not shared across workers. |
| CORS production configuration | **PARTIAL** | Code reads `ALLOWED_ORIGINS` from env. `ALLOWED_ORIGINS` not set in `.env` → defaults to `"*"`. Effectively unchanged from before the fix. |
| PostgreSQL migration layer | **IMPLEMENTED (not active)** | `database.py` supports PostgreSQL. `migrate_to_postgres.py` exists. Not configured. |
| Secretary password reset | **PARTIAL** | Backend endpoint exists. No frontend UI. |
| Observability / structured logging | **IMPLEMENTED** | `setup_observability(app)` called. Request logging active. Sentry: no-op (no `SENTRY_DSN`). Sync metrics: no-op (no Redis). |

---

## 4. SINGLE SOURCE OF TRUTH

**What database runs when you start the system today:**

Cloud backend: `sqlite:///./cloud.db` — a single file at `cloud-backend/cloud.db`.

Local backend: `data/users/<googleId>/medidesk.db` — per-doctor SQLite file.

**If you deploy tomorrow without changing `.env`:**

Same answer. SQLite. The PostgreSQL code path is never triggered because `DATABASE_URL` in `.env` is `sqlite:///./cloud.db`.

**The `revoked_tokens` table:**

Exists in `cloud.db` only if `python migrate.py` was run after the `RevokedToken` model was added. If it was run (the migration output showed "revoked_tokens table ready"), the table exists. If not, `verify_jwt` will crash on the first revocation check attempt.

---

## 5. DEPLOYMENT TRUTH

### Can you deploy 1 clinic today without breaking anything?

**YES — with these known states:**

- Database: SQLite (single file, no concurrent write protection)
- Redis: not running (rate limiting in-memory, no WebSocket pub/sub, no event buffer)
- S3: not running (attachments on local filesystem)
- CORS: `*` (any origin allowed)
- JWT revocation: works only if `migrate.py` was run
- Patient restore: backend works, no UI
- Secretary password reset: backend works, no UI
- WebSocket: server running, no client connected (Electron uses polling)

The system will start and function. Patients can be created, edited, deleted. Appointments work. Chat works (polling). Sync works. The gaps are operational, not crash-level.

### Can you deploy 5 clinics today without PostgreSQL?

**YES — but with a real ceiling.**

SQLite serializes writes. Under concurrent load (3+ users writing simultaneously across 5 clinics), writes queue up. At low traffic (1–2 users per clinic, not all active simultaneously), SQLite handles it fine. The first visible symptom will be slow saves (200–500ms instead of 50ms) when multiple users write at the same time.

### What will actually fail first in real usage?

**In order of likelihood:**

1. **Doctor deletes a patient and cannot restore them.** The restore endpoint exists. There is no button in the UI. This will happen within the first week.

2. **`revoked_tokens` table missing causes 500 errors on revocation.** If `migrate.py` was not run after the `RevokedToken` model was added, the first call to `POST /api/auth/revoke` will crash. More critically, if the revocation check in `verify_jwt` is reached (it only runs if `jti` is present in the token), it will throw `OperationalError: no such table`. The try/except in `verify_jwt` catches this and allows the request through (fail-open), so it won't crash the app — but revocation silently doesn't work.

3. **CORS `*` in production.** Not a crash, but a security gap that exists right now because `ALLOWED_ORIGINS` is not set.

---

## 6. CODE VS CLAIM GAP

These are features that were described as implemented but have gaps between the code and actual runtime behavior:

| Claim | Reality |
|-------|---------|
| "JWT revocation implemented" | Code exists. `revoked_tokens` table created by `migrate.py` but NOT by `init_db()`. If `migrate.py` not run, table is absent. `verify_jwt` fails open (allows request through) on DB error — revocation silently does nothing. |
| "CORS production configuration" | Code reads env var. Env var not set in `.env`. Runs as `*`. No change from before. |
| "Redis rate limiting" | Code uses Redis if `REDIS_URL` set. `REDIS_URL` not in `.env`. Runs in-memory. Resets on restart. Not shared across workers. |
| "WebSocket realtime" | Server-side SocketIO is running. No client connects to it. Electron uses polling. The realtime system is a server waiting for clients that don't exist yet. |
| "S3 storage" | S3Storage class exists. `STORAGE_BACKEND` not set. LocalStorage used. All files go to local filesystem. |
| "Observability / sync metrics" | Logging works. Sync metrics require Redis. Redis not running. `GET /api/metrics` returns `{"error": "Redis not available"}`. |
| "Patient restore" | Backend endpoint works. No frontend UI. Doctor cannot restore through the app. |
| "Secretary password reset" | Backend endpoint works. No frontend UI. |
| "eventlet monkey-patch" | Applied correctly. Also applied twice (duplicate line 6). Harmless but sloppy. |
| "PostgreSQL production-ready" | Code supports it. Not configured. Not running. |

---

## BOTTOM LINE

The system as it runs today is:

- A Flask app backed by SQLite
- With JWT auth that works
- With a sync queue that works
- With conflict detection that works
- With audit logging that works
- With rate limiting that works (in-memory, resets on restart)
- With WebSocket code that runs but has no connected clients
- With Redis/S3/PostgreSQL code that exists but is not active
- With JWT revocation that may or may not work depending on whether `migrate.py` was run
- With CORS that allows any origin because the env var is not set
- With a patient restore endpoint that has no UI

This is a functional, deployable system for 1 clinic. It is not the "production SaaS with Redis, PostgreSQL, and WebSocket" that the documentation describes. The documentation describes what the system *can* be when fully configured. The current `.env` configures it as a minimal single-server SQLite deployment.
