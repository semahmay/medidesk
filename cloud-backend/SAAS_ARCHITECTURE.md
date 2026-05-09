# MediDesk AI — SaaS Architecture Design
> Role: Principal Cloud Architect | Date: April 2026
> Goal: Hybrid Offline-First + Cloud SaaS Medical Platform

---

## 1. SaaS Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                                  │
│                                                                      │
│  ┌─────────────────────────┐    ┌──────────────────────────────┐    │
│  │   MODE 1: Electron App  │    │   MODE 2: Web Browser (SaaS) │    │
│  │  (offline-first)        │    │  (cloud-first)               │    │
│  │                         │    │                              │    │
│  │  React UI               │    │  React UI (same codebase)    │    │
│  │  Local Flask :5000      │    │  No local backend            │    │
│  │  Electron IPC           │    │  Direct cloudApi calls       │    │
│  │  Disk queue             │    │  WebSocket for real-time     │    │
│  └────────────┬────────────┘    └──────────────┬───────────────┘    │
└───────────────┼──────────────────────────────────┼───────────────────┘
                │                                  │
                └──────────────┬───────────────────┘
                               │ HTTPS + WSS
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      API GATEWAY LAYER                               │
│                                                                      │
│   Nginx / Caddy                                                      │
│   - TLS termination                                                  │
│   - /api/v1/* → Flask (current, backward compat)                    │
│   - /api/v2/* → Flask (new SaaS endpoints)                          │
│   - /ws/*     → Flask-SocketIO                                       │
│   - Rate limiting per IP + per clinic_id                             │
└─────────────────────────────┬───────────────────────────────────────┘
                               │
┌─────────────────────────────▼───────────────────────────────────────┐
│                    APPLICATION LAYER                                  │
│                                                                      │
│   Flask + Gunicorn (4 workers)                                       │
│   Flask-SocketIO (eventlet/gevent)                                   │
│                                                                      │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│   │  Auth Service│  │ Tenant Guard │  │  Storage Abstraction     │  │
│   │  JWT + RBAC  │  │ clinic_id    │  │  Local FS | S3-compat    │  │
│   │  Refresh rot.│  │ middleware   │  │  (boto3 / minio)         │  │
│   └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────────────┘
                               │
┌─────────────────────────────▼───────────────────────────────────────┐
│                      DATA LAYER                                       │
│                                                                      │
│   ┌─────────────────────┐    ┌──────────────────────────────────┐   │
│   │   PostgreSQL 16      │    │   Redis 7                        │   │
│   │                      │    │                                  │   │
│   │  - clinics           │    │  - Rate limit counters           │   │
│   │  - users             │    │  - WebSocket pub/sub             │   │
│   │  - patients          │    │  - Sync queue overflow           │   │
│   │  - appointments      │    │  - Session cache                 │   │
│   │  - messages          │    │  - Notification fan-out          │   │
│   │  - audit_logs        │    └──────────────────────────────────┘   │
│   │  - notifications     │                                           │
│   │  - attachments       │    ┌──────────────────────────────────┐   │
│   │                      │    │   Object Storage (S3/MinIO)      │   │
│   │  Indexes on:         │    │                                  │   │
│   │  clinic_id (all)     │    │  - attachments/<clinic_id>/      │   │
│   │  global_id (unique)  │    │  - voice/<clinic_id>/            │   │
│   │  updated_at          │    │  - exports/<clinic_id>/          │   │
│   └─────────────────────┘    └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Dual-Mode Strategy

### Mode 1: Electron (unchanged)
- Local Flask on port 5000 — doctor's private data
- Cloud Flask on port 8000 — shared clinic data
- Sync V2 queue — offline-first
- `DATABASE_URL=sqlite:///./cloud.db` in `.env`
- All existing IPC flows preserved

### Mode 2: SaaS Web
- No local backend
- All calls go to cloud API (`/api/v2/`)
- WebSocket connection for real-time
- `DATABASE_URL=postgresql://...` in `.env`
- Object storage for attachments
- Same JWT auth, same clinic isolation

### Coexistence Rule
The cloud backend is **mode-agnostic** — it detects its database from `DATABASE_URL`. The same Flask app serves both modes. The frontend detects mode via `window.electronAPI` presence.
