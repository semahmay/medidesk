# MediDesk AI

AI-powered patient management system for medical clinics with offline-first desktop app and cloud backend.

## 🏗️ Architecture

- **Desktop App** (`medidesk-ai/`) - Offline-first Electron app for doctors
- **Cloud Backend** (`cloud-backend/`) - Multi-tenant SaaS API
- **Frontend** (`medidesk-ai/frontend/`) - React UI

## 🚀 Quick Start

### Desktop App (Electron)
```bash
cd medidesk-ai
npm install
cd frontend && npm install && cd ..
cd backend && pip install -r requirements.txt && cd ..
npm run dev
```

### Cloud Backend (Docker)
```bash
cd cloud-backend
cp .env.example .env
# Edit .env with your configuration
docker-compose up -d
```

## 📦 Tech Stack

**Frontend:** React 18, Axios, Socket.IO  
**Backend:** Flask, SQLAlchemy, PostgreSQL, Redis, MinIO  
**Desktop:** Electron, Node.js  
**Deployment:** Docker, Nginx, Gunicorn

## 🔐 Features

- JWT authentication with refresh tokens
- Role-based access (doctor/secretary)
- Multi-tenant data isolation
- Offline-first sync
- Real-time WebSocket updates
- File storage with MinIO
- Automated backups

## 📝 License

MIT License

## 🤝 Contributing

Private medical software project. Contact maintainer for details.
