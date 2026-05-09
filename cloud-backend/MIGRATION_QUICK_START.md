# PostgreSQL Migration - Quick Start

## 🚀 5-Minute Migration

### Prerequisites
```bash
# 1. PostgreSQL running
sudo systemctl status postgresql

# 2. Database created
psql -U postgres -c "CREATE DATABASE medidesk;"
psql -U postgres -c "CREATE USER medidesk_user WITH PASSWORD 'your_password';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE medidesk TO medidesk_user;"

# 3. Backup current data
cp cloud.db cloud.db.backup.$(date +%Y%m%d_%H%M%S)
```

### Migration Commands

```bash
# Step 1: Dry run (test only, no writes)
SQLITE_PATH=./cloud.db \
DATABASE_URL=postgresql://medidesk_user:your_password@localhost:5432/medidesk \
python migrate_to_postgres.py --dry-run

# Step 2: Actual migration
SQLITE_PATH=./cloud.db \
DATABASE_URL=postgresql://medidesk_user:your_password@localhost:5432/medidesk \
python migrate_to_postgres.py

# Step 3: Verify
DATABASE_URL=postgresql://medidesk_user:your_password@localhost:5432/medidesk \
python verify_migration.py

# Step 4: Update .env
echo "DATABASE_URL=postgresql://medidesk_user:your_password@localhost:5432/medidesk" > .env

# Step 5: Restart
docker-compose restart backend

# Step 6: Test
curl http://localhost:8000/api/health
# Should show: "db_type": "postgresql"
```

### Rollback (if needed)

```bash
# Stop backend
docker-compose down

# Restore SQLite in .env
echo "DATABASE_URL=sqlite:///./cloud.db" > .env

# Start backend
docker-compose up -d
```

## ✅ Success Indicators

- Migration script shows: `[SUCCESS] MIGRATION SUCCESSFUL`
- Verification script shows: `✅ ALL CHECKS PASSED`
- Health check returns: `"db_type": "postgresql"`
- Startup logs show: `[DB] Connected to PostgreSQL @ localhost:5432`
- All manual tests pass

## 📚 Full Documentation

- **Complete Guide:** `POSTGRES_MIGRATION_GUIDE.md`
- **Implementation Details:** `POSTGRES_MIGRATION_COMPLETE.md`
- **Scripts:**
  - `migrate_to_postgres.py` - Migration script
  - `verify_migration.py` - Verification script
  - `test_postgres_system.py` - System tests

## 🆘 Quick Troubleshooting

| Issue | Solution |
|-------|----------|
| "Cannot connect to PostgreSQL" | Check PostgreSQL is running: `sudo systemctl status postgresql` |
| "Row count mismatch" | Re-run with `--force` flag |
| "Some tables missing" | Run `DATABASE_URL=postgresql://... python -c "from database import init_db; init_db()"` |
| Health check shows "sqlite" | Check .env file has correct DATABASE_URL |

---

**Need help?** See `POSTGRES_MIGRATION_GUIDE.md` for detailed instructions.
