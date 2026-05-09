# MediDesk AI — Security & Production Readiness Audit
> Date: April 2026 | Auditor: Senior SaaS Security Review
> Basis: Full static analysis of current source files
> Context: Medical SaaS product handling patient data

---

## 1. OVERALL READINESS SCORE

### 🟡 78% — Pilot-Ready (1–3 clinics, controlled deployment)

This score reflects a system that has solid architectural security foundations but carries specific gaps that prevent confident multi-clinic SaaS deployment with sensitive medical data. The JWT system, clinic isolation model, and token storage are production-grade. The gaps are in refresh token lifecycle, rate limiting coverage, input validation depth, and the absence of a data deletion/right-to-erasure mechanism.

---

## 2. CATEGORY SCORES

| Category | Score | Verdict |
|----------|-------|---------|
| Authentication | 8/10 | Strong — Google OAuth + secretary lifecycle correct |
| JWT Security | 7/10 | Good — rotation added, but no revocation |
| Authorization / Roles | 9/10 | Very strong — JWT-enforced, never client-trusted |
| Multi-tenant Isolation | 9/10 | Very strong — structural isolation at query level |
| API Security | 6/10 | Partial — rate limiting incomplete, validation gaps |
| Sync / Data Integrity | 7/10 | Good — conflict detection works, clock skew resolved |
| File Handling Security | 8/10 | Strong — path traversal blocked, public access disabled |
| Audit & Traceability | 7/10 | Good — audit log exists, no soft delete or erasure |

---

## 3. 🔴 CRITICAL RISKS

### RISK-1: No JWT Revocation Mechanism
**Severity: CRITICAL for medical data**

**What it is:** When a secretary is deactivated, fired, or their account is compromised, their JWT remains valid until natural expiry (1 hour access, 30 days refresh). There is no token blacklist, no session invalidation endpoint, and no way to force-logout a specific user.

**Real-world scenario:** A clinic fires a secretary on Monday. She still has a valid refresh token. She can continue accessing all patient data for up to 30 days by refreshing her access token. The clinic has no way to stop this.

**Evidence in code:**
```python
# auth_service.py — refresh_access_token()
# Issues new access token from refresh token.
# No check against a revocation list.
# No "is this user still active?" check.
```

**Fix required:**
- Add a `revoked_tokens` table or Redis set keyed by `jti` (JWT ID)
- Add `jti` claim to all tokens
- Check `jti` against revocation list on every request in `verify_jwt`
- Add `POST /api/auth/revoke` endpoint (doctor-only)
- Alternatively: reduce refresh token TTL to 24 hours and add a `last_active` check

---

### RISK-2: Secretary Password Reset Has No Endpoint
**Severity: HIGH**

**What it is:** If a secretary forgets their password, there is no reset mechanism. The only way to reset is direct database manipulation. More critically, if a secretary account is compromised (password leaked), the doctor has no way to force a password reset through the application.

**Evidence in code:**
```python
# No POST /api/clinic/secretaries/:id/reset-password endpoint exists in app.py
# The only way to change a secretary password is to set status back to "invited"
# which requires direct DB access.
```

**Fix required:**
- Add `POST /api/clinic/secretaries/:id/reset-password` (doctor JWT required)
- Sets `status = "invited"`, clears `password_hash`, sends notification
- Secretary must re-activate via the existing set-password flow

---

### RISK-3: Local Backend Has No Authentication
**Severity: HIGH in networked environments**

**What it is:** The local Flask backend (port 5000) trusts the `X-User-ID` header with no verification. Any process on the same machine that can make HTTP requests to `localhost:5000` can read or write any patient data by setting an arbitrary `X-User-ID` header.

**Evidence in code:**
```python
# backend/app.py — no authentication decorator on any route
# api.js sets X-User-ID from _googleId in memory
# No signature, no token, no verification
```

**Acceptable in Electron (trusted process):** Yes — the local backend is only accessible from the Electron process on the same machine.

**Not acceptable if:** The local backend is ever exposed to a network interface, or if the machine runs other software that could make localhost requests.

**Fix required:**
- Bind local backend to `127.0.0.1` only (not `0.0.0.0`) — verify in `app.run()`
- Add a shared secret between Electron and local backend (set via env var, verified on each request)

**Current status:** `app.run(host='0.0.0.0', port=5000)` — binds to ALL interfaces. This means the local backend is accessible from the local network, not just localhost.

---

### RISK-4: `POST /api/clinic/join` Returns 410 But Still Exists
**Severity: MEDIUM**

**What it is:** The legacy unauthenticated secretary creation endpoint returns 410 Gone. However, it still exists as a route. If a future code change accidentally removes the 410 response (e.g., a merge conflict), the endpoint becomes live again and allows unauthenticated account creation in any clinic.

**Fix required:** Remove the route entirely, not just return 410.

---

### RISK-5: No Input Sanitization on Patient Text Fields
**Severity: MEDIUM for web deployment**

**What it is:** Patient `notes`, `full_name`, `phone`, `email` fields are stored and returned without sanitization. In the Electron app this is acceptable (no XSS vector). In a web SaaS deployment, if these fields are ever rendered as HTML (e.g., in a future web dashboard), stored XSS is possible.

**Evidence in code:**
```python
# app.py — create_patient()
notes = data.get("notes")  # stored directly, no sanitization
```

**Current mitigation:** `AIChat.jsx` uses `DOMPurify` on AI output. Patient fields are rendered as text in React (not `dangerouslySetInnerHTML`). Safe for current Electron deployment.

**Fix required for web SaaS:** Add server-side sanitization (bleach library) on all text fields before storage.

---

## 4. 🟠 IMPORTANT IMPROVEMENTS

### IMP-1: Rate Limiting Gaps
Rate limiting exists on auth endpoints (5–20/min) and some data endpoints (30–60/min). Missing on:
- `GET /api/patients/by-global/<id>` — no limit
- `DELETE /api/patients/by-global/<id>` — no limit
- `GET /api/audit-logs` — no limit
- `GET /api/notifications` — no limit
- `PATCH /api/notifications/*` — no limit

A malicious actor with a valid JWT could enumerate all patients via the `by-global` endpoint or flood the audit log endpoint.

**Fix:** Apply `@limiter.limit("60 per minute")` to all remaining unprotected routes.

---

### IMP-2: Refresh Token Rotation — Electron Client Not Updated
Refresh token rotation was implemented on the server (`auth_service.py` now returns both tokens). The `cloudApi.js` interceptor correctly saves the new refresh token. However, the Electron IPC `secretary-login` and `start-login` handlers save tokens to disk via `saveTokens()` — but the refresh flow in `cloudApi.js` calls `setCloudTokens()` which calls `window.electronAPI.saveTokens()`. This chain is correct.

**Verify:** Confirm that after a token refresh, the new refresh token is persisted to `tokens.json` on disk. If the app restarts between refresh calls, the old refresh token on disk would be invalid.

---

### IMP-3: No HTTPS Enforcement on Local Backend
The local backend runs on plain HTTP (`http://localhost:5000`). In the Electron context this is acceptable. However, the cloud backend also runs on plain HTTP in development (`http://localhost:8000`). The Nginx config enforces HTTPS in production, but there is no HSTS header or redirect enforcement at the application level — only at the Nginx level. If Nginx is misconfigured or bypassed, the API is accessible over HTTP.

**Fix:** Add `Strict-Transport-Security` header in Flask for production mode.

---

### IMP-4: `password_hash` Exclusion Only in `serialize()`
The `_SENSITIVE_FIELDS = frozenset({"password_hash"})` exclusion in `serialize()` is correct. However, if any route ever returns a `User` object via a different serialization path (e.g., a future endpoint that uses `user.__dict__`), the hash would be exposed. The exclusion is not enforced at the model level.

**Fix:** Add a `@property` on the `User` model that raises `AttributeError` on direct access to `password_hash`, or use a dedicated `UserPublic` schema.

---

### IMP-5: Audit Log Has No Integrity Protection
The `audit_logs` table records all actions. However, any user with database access can modify or delete audit log entries. For a medical product, audit logs should be append-only and tamper-evident.

**Fix:** Add a PostgreSQL trigger that prevents `UPDATE` and `DELETE` on `audit_logs`. Or use a separate append-only log service.

---

### IMP-6: No Data Retention / Right-to-Erasure Policy
GDPR Article 17 requires the ability to delete a patient's personal data on request. Currently:
- Patient delete is a hard delete (no soft delete)
- No `deleted_at` column
- No way to export all data for a patient (GDPR Article 20)
- No data retention policy enforcement

**Fix:** Add `deleted_at` column to `patients`. Implement `GET /api/patients/:id/export` for data portability.

---

### IMP-7: Secretary Name Stored Lowercase — PII Normalization Risk
Secretary names are stored as `.strip().lower()` for matching. This means the stored name is "sara" not "Sara". For a medical product where names are PII, storing a normalized version that differs from the actual name could cause issues in audit logs and compliance reports.

**Fix:** Store both `name` (normalized, for matching) and `display_name` (original casing, for display).

---

### IMP-8: No CORS Restriction
```python
CORS(app, resources={r"/api/*": {"origins": "*"}, r"/ws/*": {"origins": "*"}})
```
`origins: "*"` allows any domain to make cross-origin requests to the API. In production, this should be restricted to the specific domain(s) serving the web app.

**Fix:** Set `origins` to the production domain(s) in the `.env` file.

---

### IMP-9: File Upload — No Virus Scanning
Files uploaded as attachments (PDFs, images) are stored without malware scanning. A malicious actor could upload a PDF containing embedded malware. While the files are served with `as_attachment=False` (inline), the risk exists for future features.

**Fix for production:** Integrate ClamAV or a cloud scanning service before storing uploaded files.

---

### IMP-10: `FLASK_ENV=test` Enables Seed Endpoint
```python
@app.route("/api/internal/seed-test-clinic", methods=["POST"])
def seed_test_clinic():
    if os.getenv("FLASK_ENV") != "test":
        return jsonify({"error": "Not found"}), 404
```
If `FLASK_ENV=test` is accidentally set in production (e.g., a misconfigured `.env`), this endpoint creates arbitrary clinic accounts with no authentication. The check is correct but the risk of misconfiguration is real.

**Fix:** Remove this endpoint from `app.py` entirely. Move it to a separate `test_helpers.py` that is never imported in production.

---

## 5. 🟢 WHAT IS STRONG

### JWT Architecture — Production Grade
- `g.clinic_id`, `g.role`, `g.user_id` always come from the verified JWT payload
- No route accepts `clinic_id` or `role` from the request body for authorization decisions
- `require_role()` decorator enforces role after `verify_jwt()` — correct order
- Access token: 1 hour. Refresh token: 30 days. Both are reasonable for a medical app.
- Refresh token rotation implemented — old token invalidated on use

### Multi-Tenant Isolation — Structurally Sound
Every query that touches patient, appointment, message, or notification data filters by `clinic_id = g.clinic_id`. This is enforced at the query level, not the application level. A bug in one route cannot accidentally expose another clinic's data unless the JWT itself is compromised.

Verified in tests: `test_clinic_isolation.py` covers patient list, update, messages, and appointments across clinics.

### Secretary Lifecycle — Correct
The INVITED → ACTIVE flow is enforced server-side. `set-password` strictly checks `status == "invited"`. Login blocked for non-active accounts. Name normalization prevents case-sensitivity attacks. The lifecycle cannot be bypassed from the client.

### Token Storage — Correct for Electron
Access tokens are stored in memory only (`cloudApi.js` module variable). Refresh tokens are persisted to `tokens.json` via Electron IPC — not in `localStorage` or `sessionStorage`. This is the correct approach for an Electron app. Tokens are cleared on logout including all browser storage.

### bcrypt Password Hashing — Correct
Secretary passwords are hashed with bcrypt using `bcrypt.gensalt()` (auto-generates salt). `check_password` uses `bcrypt.checkpw`. No MD5, no SHA1, no plain text.

### Path Traversal Prevention — Verified
`storage_service.py` uses `Path(filename).name` to strip directory components, `re.sub(r'[/\\:\x00]', '_', filename)` to remove dangerous characters, and a resolved path check to prevent traversal. S3 bucket has public access blocked.

### DOMPurify on AI Output
`AIChat.jsx` sanitizes all AI-generated HTML with `DOMPurify` before rendering. This prevents XSS from AI-generated content.

### Rate Limiting on Auth Endpoints
- `POST /api/auth/google`: 20/min
- `POST /api/auth/secretary/login`: 5/min
- `POST /api/auth/secretary/set-password`: 10/min
- `POST /api/auth/refresh`: 30/min

These limits prevent brute-force attacks on secretary passwords and token refresh abuse.

### Audit Log — Exists and Is Used
`AuditLog` model records all patient creates, updates, deletes, appointment operations, and auth events. Every mutation route calls `audit()`. The log includes `user_id`, `user_role`, `clinic_id`, `entity_id` (global_id), and a metadata JSON field.

### Conflict Detection — Clock-Skew Safe
Version-based conflict detection (`version` integer field) replaced timestamp-based detection. Client timestamps are ignored for conflict resolution. The server always stamps `updated_at = datetime.utcnow()`. This is immune to client clock manipulation.

---

## 6. FINAL VERDICT

### 🟡 PILOT READY (1–3 clinics, controlled deployment)

The system has production-grade JWT security, solid multi-tenant isolation, and correct authentication flows. It is safe to deploy for a small number of trusted clinics where the operator can monitor usage.

It is **not yet ready for open multi-clinic SaaS** because: (1) there is no JWT revocation — a compromised or terminated secretary account cannot be locked out for up to 30 days; (2) the local backend binds to `0.0.0.0` making it accessible on the local network; (3) there is no GDPR-compliant data erasure mechanism. Fix these three issues and the system reaches production-ready status for a medical SaaS product.
