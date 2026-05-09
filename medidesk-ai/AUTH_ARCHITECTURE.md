# MediDesk AI — Production Auth Architecture Design
**Date:** April 2026  
**Type:** Design document — no code changes

---

## 1. NEW AUTH ARCHITECTURE

### Core decision: Custom JWT on cloud backend

We do NOT use Firebase Auth or Auth0. Reasons:
- This is a desktop Electron app — no browser-based auth redirects needed for secretary
- We already own the cloud backend — adding JWT is 50 lines of Python
- No vendor lock-in, no monthly cost per user, full control over token claims
- Google OAuth stays for doctors (already working) — we just issue our own JWT after it

### What replaces what

| Current | Replaced by |
|---------|------------|
| `session.json` (googleId only) | JWT access token + refresh token stored in Electron secure storage |
| `localStorage.user_role` | Role embedded in JWT payload, verified server-side |
| `localStorage.clinic_id` | Clinic ID embedded in JWT payload |
| `X-User-ID` header (trusted blindly) | `Authorization: Bearer <JWT>` header, verified on every request |
| Secretary name + clinic_id (no auth) | Secretary account with hashed password or invite token |
| `clinic.json` on disk | Refresh token in Electron `safeStorage` (encrypted) |

### Token structure (JWT payload)

```json
{
  "sub": "user_id",
  "email": "doctor@example.com",
  "name": "Dr. Smith",
  "role": "doctor",
  "clinic_id": "MEDI-48291",
  "iat": 1712000000,
  "exp": 1712086400
}
```

- `sub` — unique user ID (googleId for doctor, UUID for secretary)
- `role` — `"doctor"` or `"secretary"` — set by server, never by client
- `clinic_id` — the clinic this user belongs to — set by server
- `exp` — 24 hours for access token, 30 days for refresh token
- Signed with `HS256` using a secret key stored only on the cloud backend

---

## 2. SECURE SESSION FLOW

### Doctor login flow (new)

```
1. Electron opens Google OAuth (same as today)
2. Google returns access_token
3. Electron sends access_token to cloud backend:
   POST /api/auth/google { google_token }

4. Cloud backend:
   a. Verifies google_token with Google's tokeninfo endpoint
   b. Extracts googleId, email, name
   c. Finds or creates User record in cloud DB
   d. Finds or creates Clinic record for this doctor
   e. Issues JWT access token (24h) + refresh token (30d)
   f. Returns: { access_token, refresh_token, user, clinic_id }

5. Electron stores:
   - access_token → Electron safeStorage (encrypted on disk)
   - refresh_token → Electron safeStorage (encrypted on disk)
   - user profile → memory only (currentUser in main.js)

6. All API calls: Authorization: Bearer <access_token>

7. Token expiry handling:
   - On 401 response: use refresh_token to call POST /api/auth/refresh
   - Cloud issues new access_token
   - If refresh_token expired: force re-login
```

### Secretary login flow (new)

```
1. Secretary opens app → JoinClinic screen
2. Enters: Name + Clinic ID + Password (new field)
3. POST /api/auth/secretary/login { clinic_id, name, password }

4. Cloud backend:
   a. Finds User record by clinic_id + name (or email)
   b. Verifies bcrypt password hash
   c. Issues JWT with role='secretary', clinic_id embedded
   d. Returns: { access_token, refresh_token }

5. Electron stores tokens in safeStorage (same as doctor)
6. All API calls use Bearer token — same flow as doctor
```

### Session lifecycle

```
Login → JWT issued (24h access + 30d refresh)
     → Stored in Electron safeStorage (encrypted)
     → Injected into API headers on every request
     → Backend verifies signature + expiry on every call

On 401 → Auto-refresh using refresh_token
       → New access_token stored

On refresh_token expiry → Clear storage → Force re-login

Logout → DELETE /api/auth/logout (invalidates refresh token server-side)
       → Clear safeStorage
       → Clear localStorage
       → Redirect to login
```

### Why Electron safeStorage instead of localStorage

`safeStorage` uses OS-level encryption (Windows DPAPI, macOS Keychain). A token stored there cannot be read by another process or extracted from disk without the user's OS credentials. `localStorage` is plain text on disk — anyone with file system access can read it.

---

## 3. CLINIC SECURITY MODEL

### Problem with current MEDI-XXXXX

- 5-digit number = 90,000 possible values
- No rate limiting = enumerable in minutes
- No ownership verification = anyone who guesses an ID can join

### New clinic ID design

Replace `MEDI-XXXXX` with a **cryptographically random invite token**:

```
Format: MEDI-[8 random alphanumeric chars]
Example: MEDI-K7X2P9QR
Entropy: 36^8 = ~2.8 trillion combinations
```

Generated server-side using `secrets.token_urlsafe(6)` (Python).

### Invite-based join system

Instead of a permanent shareable ID, the doctor generates a **one-time or time-limited invite link**:

```
Doctor clicks "Invite Secretary" in app
→ POST /api/clinic/invite { clinic_id }
→ Server generates: invite_token (UUID, expires in 48h)
→ Returns invite link: medidesk://join?token=<invite_token>
→ Doctor shares link with secretary (copy/paste or QR code)

Secretary opens app → pastes invite link
→ POST /api/auth/secretary/register { invite_token, name, password }
→ Server: validates token not expired, not used
→ Creates secretary User record with hashed password
→ Marks invite token as used
→ Issues JWT
```

### Multi-tenant isolation

Every cloud DB query is scoped by `clinic_id` extracted from the JWT — never from the request body:

```python
# CURRENT (unsafe):
clinic_id = request.json.get('clinic_id')  # client can send anything

# NEW (safe):
clinic_id = get_jwt_claims()['clinic_id']  # extracted from verified token
```

This means even if a client sends a different `clinic_id` in the body, the server ignores it and uses the one from the token.

---

## 4. ROLE SYSTEM (SERVER-SIDE)

### Current problem

Role is stored in `localStorage`. Frontend reads it and decides what to show. Backend never checks it. A secretary can change `localStorage.user_role` to `'doctor'` and access everything.

### New design: role in JWT, enforced by backend

```
JWT payload contains: { "role": "doctor" }

Backend decorator (Python):
@require_role('doctor')
def generate_prescription():
    ...

@require_role(['doctor', 'secretary'])
def get_patients():
    ...
```

The decorator:
1. Reads `Authorization: Bearer <token>` header
2. Verifies JWT signature
3. Extracts `role` from payload
4. Rejects with 403 if role not in allowed list

### Permission matrix

| Endpoint | Doctor | Secretary |
|----------|--------|-----------|
| GET /api/patients | ✓ | ✓ |
| POST /api/patients | ✓ | ✓ |
| PUT /api/patients/:id | ✓ | ✓ |
| DELETE /api/patients/:id | ✓ | ✗ 403 |
| POST /api/transcribe | ✓ | ✗ 403 |
| POST /api/chat | ✓ | ✗ 403 |
| POST /api/medical-reference | ✓ | ✗ 403 |
| GET /api/analytics/* | ✓ | ✗ 403 |
| POST /api/clinic/invite | ✓ | ✗ 403 |
| GET /api/messages | ✓ | ✓ |
| POST /api/messages | ✓ | ✓ |

Frontend role checks remain as UX convenience (hide buttons, redirect routes) but are no longer the security layer — backend is.

---

## 5. API SECURITY MODEL

### Replace X-User-ID with Bearer JWT

```
CURRENT:
  GET /api/patients
  Headers: { X-User-ID: 106814099451528844065 }
  → Flask trusts this header blindly

NEW:
  GET /api/patients
  Headers: { Authorization: Bearer eyJhbGciOiJIUzI1NiJ9... }
  → Flask verifies signature, extracts user_id + role + clinic_id from token
```

### Flask middleware (design, not code)

Every protected endpoint goes through a `@require_auth` decorator that:
1. Reads `Authorization` header
2. Strips `Bearer ` prefix
3. Verifies JWT with `PyJWT` using the server's secret key
4. Checks `exp` claim — rejects if expired
5. Injects `g.user_id`, `g.role`, `g.clinic_id` into Flask's request context
6. Returns 401 if token missing/invalid, 403 if role insufficient

### Local Flask (port 5000) auth

The local Flask currently has no auth at all. Two options:

**Option A (recommended for desktop):** Local Flask trusts a short-lived session token issued by Electron main process at startup. The token is a random UUID generated fresh each app launch, stored only in memory, passed to Flask as an env var. Frontend includes it as a header. This prevents other processes on localhost from accessing the API.

**Option B:** Full JWT on local Flask too. More secure but adds complexity for a local-only server.

### cloudApi.js changes needed

```javascript
// Current:
const cloudApi = axios.create({ baseURL: 'http://localhost:8000/api' });

// New:
cloudApi.interceptors.request.use(config => {
  const token = getAccessToken(); // from safeStorage via IPC
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});

// Auto-refresh on 401:
cloudApi.interceptors.response.use(null, async (error) => {
  if (error.response?.status === 401) {
    const newToken = await refreshAccessToken();
    error.config.headers['Authorization'] = `Bearer ${newToken}`;
    return cloudApi.request(error.config);
  }
  throw error;
});
```

---

## 6. SECRETARY AUTH FIX

### Current problem

Secretary = name they typed + clinic ID they were given. No password. No verification. Anyone who knows a clinic ID can join as any name.

### New design: password-based account

```
Secretary registration (first time):
  1. Doctor generates invite link (time-limited, one-use)
  2. Secretary opens app → pastes invite link
  3. Enters: Name + Password (min 8 chars)
  4. POST /api/auth/secretary/register { invite_token, name, password }
  5. Server: hashes password with bcrypt, creates User record
  6. Issues JWT

Secretary login (subsequent times):
  1. App starts → no valid token in safeStorage
  2. JoinClinic screen shows secretary login form
  3. Enters: Clinic ID + Name + Password
  4. POST /api/auth/secretary/login { clinic_id, name, password }
  5. Server verifies bcrypt hash → issues JWT
  6. Token stored in safeStorage
```

### Why not invite-only (no password)?

An invite-only system (one-time token, no password) means if the secretary's device is lost or the token is intercepted, there's no way to verify identity on subsequent logins. A password gives the secretary a persistent credential that only they know.

### Alternative: PIN-based (simpler)

If password UX is too heavy for a clinic secretary:
- 6-digit PIN instead of password
- Same bcrypt hashing
- Simpler to type, still verified server-side

---

## 7. MIGRATION PLAN

### Guiding principle: parallel systems, gradual cutover

Never break existing users. Run old and new auth side by side during transition.

### Phase 1 — Add JWT to cloud backend (no frontend changes)

1. Add `PyJWT` + `bcrypt` to `cloud-backend/requirements.txt`
2. Add `POST /api/auth/google` endpoint — accepts Google token, issues JWT
3. Add `POST /api/auth/secretary/login` endpoint
4. Add `POST /api/auth/refresh` endpoint
5. Add `@require_auth` decorator — but make it **optional** (log warnings, don't reject yet)
6. Deploy and test — existing app still works, new endpoints available

### Phase 2 — Add JWT to frontend (Electron)

1. After Google OAuth, call `POST /api/auth/google` to get JWT
2. Store JWT in `safeStorage` instead of just `session.json`
3. Add JWT to `cloudApi` interceptor
4. Keep `session.json` as fallback during transition
5. Test: doctor login works with JWT, old sessions still work

### Phase 3 — Make JWT required on cloud backend

1. Change `@require_auth` from optional to enforced
2. Old requests without JWT get 401
3. Frontend already sends JWT (Phase 2) — no breakage
4. Remove `clinic_id` from request bodies — read from JWT instead

### Phase 4 — Secretary password system

1. Add `POST /api/clinic/invite` endpoint
2. Add `POST /api/auth/secretary/register` endpoint
3. Update JoinClinic UI to show password field
4. Existing secretaries: force re-registration via invite link
5. Old `clinic_id` + name login: disabled

### Phase 5 — Secure local Flask

1. Generate session token in `main.js` at startup
2. Pass to Flask via env var
3. Add `X-Local-Token` header to `api.js`
4. Flask validates it on every request

### Phase 6 — Cleanup

1. Remove `X-User-ID` header from `api.js`
2. Remove `session.json` (replaced by safeStorage)
3. Remove `clinic.json` (replaced by JWT claims)
4. Remove `localStorage.user_role` as security layer (keep as UX cache only)
5. Increase clinic ID entropy

### Timeline estimate

| Phase | Effort | Risk |
|-------|--------|------|
| 1 — JWT on cloud backend | 1 day | Low |
| 2 — JWT in frontend | 1 day | Low |
| 3 — Enforce JWT | 0.5 day | Medium (test thoroughly) |
| 4 — Secretary passwords | 1.5 days | Medium |
| 5 — Local Flask security | 0.5 day | Low |
| 6 — Cleanup | 0.5 day | Low |
| **Total** | **~5 days** | |

---

## 8. FINAL ARCHITECTURE DIAGRAM

### Doctor flow

```
[Electron App]
     │
     ▼
[Google OAuth] ──────────────────────────────────────────────────────┐
     │                                                               │
     │ google_access_token                                           │
     ▼                                                               │
[Cloud Backend /api/auth/google]                                     │
     │                                                               │
     │ Verify with Google → Find/Create User + Clinic                │
     │                                                               │
     │ Issue: access_token (JWT, 24h) + refresh_token (30d)          │
     ▼                                                               │
[Electron safeStorage] ← encrypted on disk                          │
     │                                                               │
     │ Authorization: Bearer <JWT>                                   │
     ▼                                                               │
[Cloud Backend] ── verify JWT ── extract role + clinic_id           │
     │                                                               │
     ├── role='doctor' → full access                                 │
     └── role='secretary' → restricted access                        │
                                                                     │
[Local Flask /api/*]                                                 │
     │                                                               │
     │ X-Local-Token (startup secret)                                │
     ▼                                                               │
[SQLite per doctor] ← MEDIDESK_USER_ID from JWT sub claim ──────────┘
```

### Secretary flow

```
[Doctor generates invite]
     │
     ▼
[Cloud Backend /api/clinic/invite]
     │ Returns: invite_token (UUID, 48h TTL)
     ▼
[Doctor shares link with secretary]
     │
     ▼
[Secretary opens app → JoinClinic]
     │ Enters: invite_token + name + password
     ▼
[Cloud Backend /api/auth/secretary/register]
     │ Validates invite → creates User → bcrypt(password)
     │ Issues: access_token (JWT) + refresh_token
     ▼
[Electron safeStorage]
     │
     │ Authorization: Bearer <JWT>
     ▼
[Cloud Backend] ── verify JWT ── role='secretary' ── clinic_id from token
     │
     └── Access: patients, appointments, messages (clinic-scoped)
     └── Blocked: analytics, AI chat, prescriptions, delete patient
```

### Token refresh flow

```
API call → 401 Unauthorized
     │
     ▼
POST /api/auth/refresh { refresh_token }
     │
     ├── Valid → new access_token issued → retry original request
     └── Expired → clear safeStorage → show login screen
```

---

## Summary

### What becomes solid after upgrade

- JWT signed server-side — role cannot be faked by client
- Every API endpoint verifies token — no blind trust
- Secretary has real credentials — not just a name
- Clinic ID is cryptographically random — not guessable
- Multi-tenant isolation enforced by JWT claims, not request body
- Sessions expire — no permanent access from stolen tokens
- Electron safeStorage — tokens encrypted on disk

### What remains a known limitation

- Local Flask still runs on localhost — network-level isolation only
- No 2FA for doctors or secretaries
- No audit log of data access
- SQLite on cloud backend — needs PostgreSQL for production scale
- No HIPAA/GDPR compliance layer (consent, data deletion, audit trail)

### What this is NOT

This design does not make MediDesk AI HIPAA-compliant. Medical data compliance requires additional layers: encryption at rest, audit logging, data retention policies, BAA agreements with cloud providers. This design addresses authentication and authorization only.
