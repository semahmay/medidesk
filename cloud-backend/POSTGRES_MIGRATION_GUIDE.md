# PostgreSQL Migration Guide

## 🎯 Overview

This guide walks you through migrating from SQLite to PostgreSQL safely, with zero data loss and full rollback capability.

## ⚠️ Prerequisites

Before starting:

- [ ] PostgreSQL 13+ installed and running
- [ ] Database created: `CREATE DATABASE medidesk;`
- [ ] Database user created with full permissions
- [ ] Current SQLite database backed up
- [ ] Application downtime scheduled (recommended: 5-10 minutes)
- [ ] All users logged out

## 📋 Migration Steps

### Step 1: Backup Current Data

```bash
# Backup SQLite database
cp cloud.db cloud.db.backup.$(date +%Y%m%d_%H%M%S)

# Verify backup
ls -lh cloud.db.backup.*
```

### Step 2: Prepare PostgreSQL

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database and user
CREATE DATABASE medidesk;
CREATE USER medidesk_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE medidesk TO medidesk_user;

# Exit psql
\q
```

### Step 3: Test Connection

```bash
# Test PostgreSQL connection
DATABASE_URL=postgresql://medidesk_user:your_secure_password@localhost:5432/medidesk \
python -c "from sqlalchemy import create_engine; engine = create_engine('postgresql://medidesk_user:your_secure_password@localhost:5432/medidesk'); engine.connect(); print('✓ Connection successful')"
```

### Step 4: Dry Run Migration

```bash
# Run migration in dry-run mode (no writes)
SQLITE_PATH=./cloud.db \
DATABASE_URL=postgresql://medidesk_user:your_secure_password@localhost:5432/medidesk \
python migrate_to_postgres.py --dry-run
```

**Expected output:**
```
================================================================================
PostgreSQL Migration Tool
================================================================================

✓ Source:      ./cloud.db
✓ Destination: postgresql://medidesk_user:***@localhost:5432/medidesk...
✓ Mode:        DRY RUN (no writes)
✓ Force:       No

✓ PostgreSQL is reachable

Reading from SQLite...
  ✓ clinics                    5 rows
  ✓ users                     12 rows
  ✓ patients                 120 rows
  ✓ messages                  45 rows
  ✓ appointments              89 rows
  ✓ audit_logs               234 rows
  ✓ notifications             18 rows
  ✓ revoked_tokens             2 rows

  Total: 525 rows across 8 tables

================================================================================
DRY RUN COMPLETE — No data written to PostgreSQL
================================================================================
```

### Step 5: Run Actual Migration

```bash
# Stop the application (if running)
docker-compose down

# Run migration (LIVE)
SQLITE_PATH=./cloud.db \
DATABASE_URL=postgresql://medidesk_user:your_secure_password@localhost:5432/medidesk \
python migrate_to_postgres.py
```

**Expected output:**
```
================================================================================
PostgreSQL Migration Tool
================================================================================

✓ Source:      ./cloud.db
✓ Destination: postgresql://medidesk_user:***@localhost:5432/medidesk...
✓ Mode:        LIVE MIGRATION
✓ Force:       No

✓ PostgreSQL is reachable

Reading from SQLite...
  ✓ clinics                    5 rows
  ✓ users                     12 rows
  ✓ patients                 120 rows
  ...

Initializing PostgreSQL schema...
✓ Schema created/verified

Writing to PostgreSQL...
  ✓ clinics                    5/5      rows inserted
  ✓ users                     12/12     rows inserted
  ✓ patients                 120/120    rows inserted
  ...

================================================================================
VERIFICATION
================================================================================

Table                SQLite     PostgreSQL   Status
------------------------------------------------------------
clinics              5          5            ✅ OK
users                12         12           ✅ OK
patients             120        120          ✅ OK
...

================================================================================
MIGRATION SUMMARY
================================================================================

✅ MIGRATION SUCCESSFUL

All data verified. Next steps:

1. Update .env to use PostgreSQL:
   DATABASE_URL=postgresql://medidesk_user:your_secure_password@localhost:5432/medidesk

2. Restart the backend:
   docker-compose restart backend

3. Test the application thoroughly

4. Keep SQLite backup until production is verified:
   ./cloud.db.backup.20260419_143022

================================================================================
```

### Step 6: Update Configuration

```bash
# Update .env file
nano .env

# Change DATABASE_URL from:
# DATABASE_URL=sqlite:///./cloud.db

# To:
DATABASE_URL=postgresql://medidesk_user:your_secure_password@localhost:5432/medidesk
```

### Step 7: Verify Migration

```bash
# Run verification script
DATABASE_URL=postgresql://medidesk_user:your_secure_password@localhost:5432/medidesk \
python verify_migration.py
```

**Expected output:**
```
================================================================================
PostgreSQL Migration Verification
================================================================================

✓ Connected to PostgreSQL

Checking tables...
  ✓ clinics
  ✓ users
  ✓ patients
  ...

Checking row counts...
  clinics                    5 rows
  users                     12 rows
  patients                 120 rows
  ...

Checking indexes...
  ✓ idx_patients_clinic_id
  ✓ idx_patients_global_id
  ...

Checking foreign keys...
  ✓ users.clinic_id → clinics
  ✓ patients.clinic_id → clinics
  ...

Testing basic CRUD operations...
  ✓ SELECT works
  ✓ INSERT/UPDATE capability verified
  ✓ Transactions work

Checking data integrity...
  ✓ No orphaned users
  ✓ No orphaned patients
  ✓ All patients have global_id
  ✓ All appointments have global_id

================================================================================
VERIFICATION SUMMARY
================================================================================

✅ ALL CHECKS PASSED

PostgreSQL migration is verified and ready for production.
```

### Step 8: Start Application

```bash
# Start the backend
docker-compose up -d

# Check logs
docker-compose logs -f backend
```

**Expected log output:**
```
[INFO] [DB] Connected to PostgreSQL @ localhost:5432
[INFO] [DB] Schema initialized
 * Running on http://0.0.0.0:8000
```

### Step 9: Test Application

```bash
# Run system tests
BASE_URL=http://localhost:8000 \
DATABASE_URL=postgresql://medidesk_user:your_secure_password@localhost:5432/medidesk \
python test_postgres_system.py
```

**Expected output:**
```
================================================================================
PostgreSQL System Validation
================================================================================

Running system validation tests...

Testing: Health check... ✅
Testing: Create test clinic (internal endpoint)... ✅
Testing: Patient creation (idempotent)... ✅
Testing: Patient retrieval by global_id... ✅
Testing: Patient update (version-based conflict detection)... ✅
Testing: Patient conflict detection (stale version)... ✅
Testing: Patient soft delete... ✅
Testing: Patient restore... ✅
Testing: Appointment creation... ✅
Testing: Database connection pool (concurrent requests)... ✅

================================================================================
TEST SUMMARY
================================================================================

✅ ALL TESTS PASSED (10/10)

PostgreSQL system is fully functional and ready for production.
```

### Step 10: Manual Testing

Test these workflows manually:

- [ ] Doctor login (Google OAuth)
- [ ] Secretary login (password)
- [ ] Create patient
- [ ] Edit patient
- [ ] Delete patient
- [ ] Restore patient
- [ ] Create appointment
- [ ] Edit appointment
- [ ] Delete appointment
- [ ] Search patients
- [ ] Upload attachment
- [ ] Download attachment
- [ ] Real-time updates (WebSocket)
- [ ] Logout and re-login

### Step 11: Monitor Production

```bash
# Check health endpoint
curl http://localhost:8000/api/health

# Expected response:
{
  "api": "ok",
  "db": "ok",
  "db_type": "postgresql",
  "redis": "ok"
}

# Monitor logs for errors
docker-compose logs -f backend | grep -i error
```

## 🔄 Rollback Procedure

If something goes wrong:

### Option 1: Quick Rollback (Recommended)

```bash
# Stop application
docker-compose down

# Restore SQLite in .env
nano .env
# Change back to: DATABASE_URL=sqlite:///./cloud.db

# Start application
docker-compose up -d

# Verify
curl http://localhost:8000/api/health
```

### Option 2: Restore from Backup

```bash
# Stop application
docker-compose down

# Restore backup
cp cloud.db.backup.20260419_143022 cloud.db

# Update .env to SQLite
nano .env
# DATABASE_URL=sqlite:///./cloud.db

# Start application
docker-compose up -d
```

## ⚠️ Common Issues

### Issue: "Cannot connect to PostgreSQL"

**Solution:**
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Check connection
psql -U medidesk_user -d medidesk -h localhost

# Check firewall
sudo ufw status
```

### Issue: "Row count mismatch"

**Solution:**
```bash
# Re-run migration with --force
SQLITE_PATH=./cloud.db \
DATABASE_URL=postgresql://... \
python migrate_to_postgres.py --force
```

### Issue: "Some tables missing"

**Solution:**
```bash
# Initialize schema manually
DATABASE_URL=postgresql://... python -c "from database import init_db; init_db()"

# Re-run migration
SQLITE_PATH=./cloud.db DATABASE_URL=postgresql://... python migrate_to_postgres.py
```

### Issue: "Orphaned records"

**Solution:**
```bash
# Check data integrity
DATABASE_URL=postgresql://... python verify_migration.py

# If orphaned records exist, they may be from old data
# Review and clean up manually if needed
```

## 📊 Performance Tuning

After migration, optimize PostgreSQL:

```sql
-- Connect to database
psql -U medidesk_user -d medidesk

-- Analyze tables for query planner
ANALYZE;

-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;

-- Vacuum to reclaim space
VACUUM ANALYZE;
```

## 🔒 Security Checklist

- [ ] PostgreSQL password is strong (16+ characters)
- [ ] PostgreSQL only accepts connections from localhost (or VPN)
- [ ] Firewall rules restrict PostgreSQL port (5432)
- [ ] SSL/TLS enabled for PostgreSQL connections
- [ ] Database backups configured (daily)
- [ ] Backup restoration tested
- [ ] .env file not committed to git
- [ ] DATABASE_URL not logged or exposed

## 📅 Post-Migration

### Keep SQLite Backup

Keep the SQLite backup for 7-14 days:

```bash
# After 7-14 days of stable production
rm cloud.db.backup.*
```

### Set Up Automated Backups

```bash
# Add to crontab
crontab -e

# Daily backup at 2 AM
0 2 * * * pg_dump -U medidesk_user medidesk | gzip > /backups/medidesk_$(date +\%Y\%m\%d).sql.gz

# Keep last 30 days
0 3 * * * find /backups -name "medidesk_*.sql.gz" -mtime +30 -delete
```

### Monitor Performance

```bash
# Check slow queries
psql -U medidesk_user -d medidesk -c "
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
"

# Check connection pool usage
docker-compose logs backend | grep "pool"
```

## ✅ Success Criteria

Migration is successful when:

- ✅ All tables exist in PostgreSQL
- ✅ Row counts match SQLite
- ✅ All indexes created
- ✅ Foreign keys enforced
- ✅ Health check returns `db_type: postgresql`
- ✅ All manual tests pass
- ✅ No errors in logs for 24 hours
- ✅ Performance is equal or better than SQLite

## 🆘 Support

If you encounter issues:

1. Check logs: `docker-compose logs -f backend`
2. Run verification: `python verify_migration.py`
3. Check PostgreSQL logs: `sudo tail -f /var/log/postgresql/postgresql-*.log`
4. Rollback if critical: See "Rollback Procedure" above

---

**Last Updated:** April 19, 2026  
**Version:** 1.0  
**Status:** Production Ready
