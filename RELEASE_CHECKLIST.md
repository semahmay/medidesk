# MediDesk AI - Release Engineering Documentation

## Production Release Checklist

### Pre-Release Verification
- [ ] All tests pass (unit + integration)
- [ ] No security vulnerabilities (npm audit)
- [ ] Build completes without errors
- [ ] Version number updated in package.json
- [ ] Changelog updated

### Build Commands
```bash
# Development
npm run start

# Production build (NSIS installer)
npm run build

# Portable build
npm run build:portable

# Both installers
npm run build:all

# Unpacked build (for testing)
npm run build:dir
```

### Build Artifacts
After build, artifacts are located in `dist/`:
- `MediDesk AI-1.0.0-x64-setup.exe` - NSIS installer
- `MediDesk AI-1.0.0-portable.exe` - Portable version

### Deployment Checklist
- [ ] Backend services running (Flask API, PostgreSQL, Redis, MinIO)
- [ ] Environment variables configured in .env
- [ ] JWT_SECRET generated and set
- [ ] ALLOWED_ORIGINS configured for production
- [ ] SENTRY_DSN configured (optional, for error tracking)
- [ ] Database migrations run
- [ ] Health check endpoint returns 200

### Update Workflow
1. Developer pushes new release to GitHub
2. CI builds and uploads to release server
3. Auto-updater checks for updates on app start
4. User sees "Update available" notification
5. App downloads update in background
6. On next restart, new version installs automatically

### Rollback Workflow
1. Stop the app
2. Revert to previous version (git checkout)
3. Rebuild: `npm run build`
4. Reinstall previous installer
5. Database remains compatible (no migrations needed for patch releases)

### Support Workflow
1. Collect diagnostics: App → Operations → Export Diagnostics
2. Check logs in `/var/log/medidesk/` (backend)
3. Check Sentry dashboard for frontend errors
4. Database: `psql -c "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 50"`

### Incident Response
**If app won't start:**
1. Check backend is running: `curl http://<your-backend>/api/health`
2. Check PostgreSQL: `pg_isready`
3. Check Redis: `redis-cli ping`
4. Check MinIO: `mc ls local/`

**If login fails:**
1. Check JWT_SECRET is set in .env
2. Check tokens.enc file exists in Electron userData
3. Try clearing tokens via logout and re-login

**If sync issues:**
1. Check network connectivity
2. Open Sync Center (bottom-right icon)
3. Check queue count and failed items
4. Click "Retry" to replay failed items

---

## Environment Configuration

### Required Environment Variables

**Backend (.env):**
```
DATABASE_URL=postgresql://user:pass@host:5432/medidesk
REDIS_URL=redis://host:6379
JWT_SECRET=<generate-with: python -c "import secrets; print(secrets.token_hex(32))">
MINIO_ACCESS_KEY=<your-key>
MINIO_SECRET_KEY=<your-secret>
S3_BUCKET=medidesk-attachments
S3_ENDPOINT_URL=http://minio:9000
ALLOWED_ORIGINS=file://
```

**Frontend (.env for build):**
```
REACT_APP_CLOUD_URL=http://<your-backend>/api
REACT_APP_SENTRY_DSN=https://...@sentry.io/...
REACT_APP_VERSION=1.0.0
```

---

## Backup & Recovery

### Automated Backups
Run daily via cron: `0 2 * * * /path/to/backup.sh`

### Manual Backup
```bash
pg_dump -h localhost -U medidesk -d medidesk > backup.sql
```

### Restore
```bash
./restore.sh 20240514_020000
```

---

## Monitoring

### Health Checks
- Frontend: `/api/health` (returns {api: "ok", db: "ok", redis: "ok"})
- Backend: Docker health check

### Metrics
- Access Operations Dashboard at `/operations` (doctor only)
- View sync queue status, storage usage, recent errors

### Logs
- Frontend: Browser console + Sentry
- Backend: `/var/log/medidesk/app.log`
- Nginx: `/var/log/nginx/`

---

## Version History

### v1.0.0 (Initial Release)
- Patient management (create, edit, delete, search)
- Appointment scheduling with conflict detection
- Real-time sync between doctor and secretary
- Offline support with queue replay
- JWT + Google OAuth authentication
- File attachments via MinIO
- AI chat and medical reference (doctor only)
- Operations dashboard (doctor only)
- Auto-update system
- Sentry error tracking