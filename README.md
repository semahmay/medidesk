# MediDesk AI

AI-powered patient management system for medical clinics with Electron desktop app and cloud SaaS backend.

## Architecture

- **Desktop App** (`medidesk-ai/`) - Electron + React desktop application
- **Cloud Backend** (`cloud-backend/`) - Multi-tenant Flask API (PostgreSQL + Redis + MinIO)
- **Deployment** - Docker Compose on Azure VM behind Nginx

## Quick Start

### Desktop App (Electron)
```bash
cd medidesk-ai
npm install
cd frontend && npm install && cd ..
npm start
```

### Cloud Backend (Docker)
```bash
cd cloud-backend
cp .env.example .env
# Edit .env with your configuration
docker-compose up -d
```

## Tech Stack

**Frontend:** React 18, Axios, Socket.IO Client  
**Backend:** Flask, SQLAlchemy, PostgreSQL, Redis, MinIO  
**Desktop:** Electron, safeStorage (encrypted tokens)  
**Deployment:** Docker, Nginx, Gunicorn, Azure VM

## Features

- JWT authentication with Google OAuth (doctor) + password (secretary)
- Role-based access (doctor/secretary)
- Multi-tenant data isolation
- Offline-sync queue with automatic replay
- Real-time WebSocket updates
- MinIO S3-compatible file storage
- Automated PostgreSQL backups
- Encrypted token storage (Electron safeStorage)

## License

MIT License
