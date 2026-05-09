# MediDesk AI

AI-powered patient management system for medical clinics with offline-first Electron desktop app and cloud backend.

## 🏗️ Architecture

- **Electron Desktop App** (`medidesk-ai/`) - Offline-first patient management for doctors
- **Cloud Backend** (`cloud-backend/`) - Multi-tenant SaaS API with PostgreSQL, Redis, MinIO
- **Frontend** (`medidesk-ai/frontend/`) - React-based UI for both desktop and web

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Python 3.11+
- Docker & Docker Compose (for cloud backend)

### Local Development

#### 1. Electron Desktop App
```bash
cd medidesk-ai
npm install
cd frontend && npm install && cd ..
cd backend && pip install -r requirements.txt && cd ..
npm run dev
```

#### 2. Cloud Backend
```bash
cd cloud-backend
cp .env.example .env
# Edit .env with your configuration
docker-compose up -d
```

## 📦 Project Structure

```
medidesk-ai/
├── backend/          # Flask local backend (doctor-only features)
├── frontend/         # React UI
├── electron/         # Electron main process
└── data/            # Local SQLite databases

cloud-backend/
├── app.py           # Flask SaaS API
├── models.py        # SQLAlchemy models
├── docker-compose.yml
├── nginx/           # Reverse proxy config
└── backup/          # Automated backup service
```

## 🔐 Security Features

- JWT authentication with refresh token rotation
- Role-based access control (doctor/secretary)
- Multi-tenant data isolation
- Rate limiting on all endpoints
- Encrypted file storage with MinIO
- Audit logging for compliance

## 🌐 Deployment

See [DEPLOYMENT_READINESS_REPORT.md](DEPLOYMENT_READINESS_REPORT.md) for production deployment guide.

### Cloud Backend (Azure/AWS)
```bash
cd cloud-backend
docker-compose up -d
```

### Electron App Distribution
```bash
cd medidesk-ai
npm run build  # Creates .exe for Windows
```

## 📝 License

MIT License - See LICENSE file for details

## 🤝 Contributing

This is a private medical software project. Contact the maintainer for contribution guidelines.

---

**Status:** Production-ready with fixes from DEPLOYMENT_READINESS_REPORT.md
