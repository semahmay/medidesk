# PostgreSQL Migration - Day-of Checklist

## 📋 Pre-Migration (30 minutes before)

### Environment Preparation
- [ ] PostgreSQL 13+ installed and running
- [ ] Database created: `medidesk`
- [ ] Database user created with full permissions
- [ ] Test connection successful
- [ ] All users notified of maintenance window
- [ ] All users logged out

### Backup
- [ ] SQLite database backed up: `cp cloud.db cloud.db.backup.$(date +%Y%m%d_%H%M%S)`
- [ ] Backup verified (file exists and has size > 0)
- [ ] Backup location documented: `_______________`
- [ ] .env file backed up: `cp .env .env.backup`

### System State
- [ ] No active user sessions
- [ ] No pending sync operations
- [ ] Backend stopped: `docker-compose down`
- [ ] Disk space checked (>2GB free)

## 🔧 Migration Execution (10-15 minutes)

### Step 1: Dry Run
```bash
SQLITE_PATH=./cloud.db \
DATABASE_URL=postgresql://user:pass@host:5432/medidesk \
python migrate_to_postgres.py --dry-run
```

- [ ] Dry run completed successfully
- [ ] Row counts look correct
- [ ] No errors in output

### Step 2: Actual Migration
```bash
SQLITE_PATH=./cloud.db \
DATABASE_URL=postgresql://user:pass@host:5432/medidesk \
python migrate_to_postgres.py
```

- [ ] Migration completed successfully
- [ ] Output shows: `[SUCCESS] MIGRATION SUCCESSFUL`
- [ ] All tables show `[OK]` status
- [ ] Row counts match SQLite

### Step 3: Verification
```bash
DATABASE_URL=postgresql://user:pass@host:5432/medidesk \
python verify_migration.py
```

- [ ] Verification completed successfully
- [ ] Output shows: `[SUCCESS] ALL CHECKS PASSED`
- [ ] All tables exist
- [ ] All indexes created
- [ ] No orphaned records
- [ ] All global_ids present

### Step 4: Configuration Update
```bash
# Update .env
nano .env
# Change: DATABASE_URL=postgresql://user:pass@host:5432/medidesk
```

- [ ] .env file updated with PostgreSQL URL
- [ ] JWT_SECRET unchanged
- [ ] ALLOWED_ORIGINS unchanged
- [ ] Other settings unchanged

### Step 5: Restart Backend
```bash
docker-compose up -d
```

- [ ] Backend started successfully
- [ ] No errors in startup logs
- [ ] Logs show: `[DB] Connected to PostgreSQL @ ...`

## ✅ Post-Migration Verification (15 minutes)

### Automated Tests

#### Health Check
```bash
curl http://localhost:8000/api/health
```

- [ ] Returns 200 OK
- [ ] `"api": "ok"`
- [ ] `"db": "ok"`
- [ ] `"db_type": "postgresql"` ← CRITICAL
- [ ] `"redis": "ok"` (if configured)

#### System Tests
```bash
BASE_URL=http://localhost:8000 \
DATABASE_URL=postgresql://user:pass@host:5432/medidesk \
python test_postgres_system.py
```

- [ ] All tests passed
- [ ] Output shows: `✅ ALL TESTS PASSED (10/10)`

### Manual Tests

#### Authentication
- [ ] Doctor login works (Google OAuth)
- [ ] Secretary login works (password)
- [ ] JWT tokens issued correctly
- [ ] Logout works

#### Patients
- [ ] List patients loads
- [ ] Search patients works
- [ ] Create patient works
- [ ] Edit patient works
- [ ] Delete patient works
- [ ] Restore patient works
- [ ] Patient details load

#### Appointments
- [ ] List appointments loads
- [ ] Calendar view works
- [ ] Create appointment works
- [ ] Edit appointment works
- [ ] Delete appointment works
- [ ] Appointment details load

#### Attachments
- [ ] Upload attachment works
- [ ] Download attachment works
- [ ] Delete attachment works
- [ ] Attachments isolated by clinic

#### Real-time
- [ ] WebSocket connection established
- [ ] Real-time updates work
- [ ] Notifications appear
- [ ] Chat messages sync

#### Audit & Notifications
- [ ] Audit logs recorded
- [ ] Notifications created
- [ ] Notification read status updates

## 📊 Monitoring (First 24 hours)

### Immediate (First Hour)
- [ ] No errors in logs: `docker-compose logs -f backend | grep -i error`
- [ ] No SQL errors: `docker-compose logs -f backend | grep -i sql`
- [ ] Response times normal
- [ ] Memory usage normal
- [ ] CPU usage normal

### Short-term (First 24 Hours)
- [ ] No connection pool exhaustion
- [ ] No deadlocks
- [ ] No slow queries
- [ ] No data corruption reports
- [ ] User feedback positive

### Metrics to Watch
```bash
# Check PostgreSQL connections
psql -U medidesk_user -d medidesk -c "SELECT count(*) FROM pg_stat_activity WHERE datname='medidesk';"

# Check slow queries
psql -U medidesk_user -d medidesk -c "SELECT query, calls, total_time, mean_time FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;"

# Check table sizes
psql -U medidesk_user -d medidesk -c "SELECT tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size FROM pg_tables WHERE schemaname='public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"
```

## 🚨 Rollback Procedure (If Needed)

### Quick Rollback (< 2 minutes)
```bash
# 1. Stop backend
docker-compose down

# 2. Restore .env
cp .env.backup .env

# 3. Start backend
docker-compose up -d

# 4. Verify
curl http://localhost:8000/api/health
# Should show: "db_type": "sqlite"
```

- [ ] Rollback completed
- [ ] Health check shows SQLite
- [ ] Application functional
- [ ] Users notified

### When to Rollback

Rollback immediately if:
- ❌ Migration verification fails
- ❌ Critical functionality broken
- ❌ Data corruption detected
- ❌ Performance severely degraded
- ❌ Connection pool exhausted
- ❌ Frequent SQL errors

Do NOT rollback for:
- ✅ Minor UI glitches (unrelated to DB)
- ✅ Single user reports (investigate first)
- ✅ Slow queries (can be optimized)
- ✅ Missing indexes (created automatically)

## 📝 Post-Migration Tasks

### Immediate (Day 1)
- [ ] Notify users migration complete
- [ ] Monitor logs continuously
- [ ] Document any issues
- [ ] Update status page

### Short-term (Week 1)
- [ ] Monitor performance metrics
- [ ] Optimize slow queries if any
- [ ] Tune connection pool if needed
- [ ] Collect user feedback

### Long-term (Week 2+)
- [ ] Set up automated PostgreSQL backups
- [ ] Test backup restoration
- [ ] Delete SQLite backup (after 7-14 days)
- [ ] Update documentation
- [ ] Schedule performance review

## 📞 Emergency Contacts

**Database Admin:** _______________  
**Backend Developer:** _______________  
**DevOps:** _______________  
**On-call:** _______________  

## 📚 Reference Documents

- Quick Start: `MIGRATION_QUICK_START.md`
- Complete Guide: `POSTGRES_MIGRATION_GUIDE.md`
- Implementation: `POSTGRES_MIGRATION_COMPLETE.md`
- Summary: `MIGRATION_SUMMARY.md`

## ✅ Sign-off

**Migration Completed By:** _______________  
**Date:** _______________  
**Time:** _______________  
**Duration:** _______________  
**Issues Encountered:** _______________  
**Status:** ⬜ Success ⬜ Rollback ⬜ Partial  

**Verified By:** _______________  
**Date:** _______________  

---

**Notes:**
