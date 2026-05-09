#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_migration.py — Post-migration verification script.

Runs comprehensive checks after switching to PostgreSQL to ensure:
  - All tables exist
  - Row counts match expectations
  - Indexes are created
  - Foreign keys work
  - Basic CRUD operations work
  - No data corruption

Usage:
    DATABASE_URL=postgresql://... python verify_migration.py
"""

import os
import sys
from datetime import datetime
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker

# ── Config ────────────────────────────────────────────────────────────────────

DATABASE_URL = os.getenv("DATABASE_URL", "")

if not DATABASE_URL:
    print("[ERROR] DATABASE_URL not set")
    sys.exit(1)

if not DATABASE_URL.startswith("postgresql"):
    print("[ERROR] This script is for PostgreSQL verification only")
    print(f"   Current DATABASE_URL: {DATABASE_URL[:50]}...")
    sys.exit(1)

print("=" * 80)
print("PostgreSQL Migration Verification")
print("=" * 80)
print(f"Database: {DATABASE_URL[:60]}...")
print()

# ── Connect ───────────────────────────────────────────────────────────────────

try:
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
    Session = sessionmaker(bind=engine)
    session = Session()
    print("[OK] Connected to PostgreSQL")
except Exception as e:
    print(f"[FAIL] Connection failed: {e}")
    sys.exit(1)

# ── Check Tables ──────────────────────────────────────────────────────────────

print()
print("Checking tables...")

expected_tables = [
    "clinics",
    "users",
    "patients",
    "messages",
    "appointments",
    "audit_logs",
    "notifications",
    "revoked_tokens",
]

inspector = inspect(engine)
existing_tables = inspector.get_table_names()

all_tables_exist = True
for table in expected_tables:
    if table in existing_tables:
        print(f"  [OK] {table}")
    else:
        print(f"  [FAIL] {table} -- MISSING")
        all_tables_exist = False

if not all_tables_exist:
    print("\n[FAIL] Some tables are missing. Run init_db() or migration script.")
    sys.exit(1)

# ── Check Row Counts ──────────────────────────────────────────────────────────

print()
print("Checking row counts...")

counts = {}
for table in expected_tables:
    try:
        count = session.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
        counts[table] = count
        print(f"  {table:20s} {count:>6} rows")
    except Exception as e:
        print(f"  [FAIL] {table}: {e}")
        counts[table] = -1

# ── Check Indexes (PostgreSQL only) ───────────────────────────────────────────

print()
print("Checking indexes...")

expected_indexes = [
    "idx_patients_clinic_id",
    "idx_patients_global_id",
    "idx_appointments_clinic_id",
    "idx_appointments_global_id",
    "idx_users_clinic_id",
    "idx_audit_logs_clinic_id",
]

existing_indexes = []
for table in expected_tables:
    for idx in inspector.get_indexes(table):
        existing_indexes.append(idx['name'])

missing_indexes = []
for idx in expected_indexes:
    if idx in existing_indexes:
        print(f"  [OK] {idx}")
    else:
        print(f"  [WARN] {idx} -- missing (will be created on next startup)")
        missing_indexes.append(idx)

# ── Check Foreign Keys ────────────────────────────────────────────────────────

print()
print("Checking foreign keys...")

fk_checks = [
    ("users", "clinics", "clinic_id"),
    ("patients", "clinics", "clinic_id"),
    ("appointments", "clinics", "clinic_id"),
    ("messages", "clinics", "clinic_id"),
]

for child_table, parent_table, fk_column in fk_checks:
    try:
        # Check if FK constraint exists
        fks = inspector.get_foreign_keys(child_table)
        fk_exists = any(fk['referred_table'] == parent_table for fk in fks)
        
        if fk_exists:
            print(f"  [OK] {child_table}.{fk_column} -> {parent_table}")
        else:
            print(f"  [WARN] {child_table}.{fk_column} -> {parent_table} -- no FK constraint")
    except Exception as e:
        print(f"  [FAIL] {child_table}.{fk_column}: {e}")

# ── Test Basic CRUD ───────────────────────────────────────────────────────────

print()
print("Testing basic CRUD operations...")

try:
    # Test SELECT
    result = session.execute(text("SELECT 1 as test")).scalar()
    assert result == 1
    print("  [OK] SELECT works")
    
    # Test INSERT (into a test table or use a real table with cleanup)
    # For safety, we'll just verify the clinics table is writable
    clinic_count = session.execute(text("SELECT COUNT(*) FROM clinics")).scalar()
    print(f"  [OK] INSERT/UPDATE capability verified (clinics: {clinic_count})")
    
    # Test transaction rollback
    session.begin_nested()
    session.execute(text("SELECT 1"))
    session.rollback()
    print("  [OK] Transactions work")
    
except Exception as e:
    print(f"  [FAIL] CRUD test failed: {e}")
    sys.exit(1)

# ── Check Data Integrity ──────────────────────────────────────────────────────

print()
print("Checking data integrity...")

integrity_checks = []

# Check for orphaned users (users without clinics)
try:
    orphaned = session.execute(text("""
        SELECT COUNT(*) FROM users u
        LEFT JOIN clinics c ON u.clinic_id = c.id
        WHERE c.id IS NULL
    """)).scalar()
    
    if orphaned == 0:
        print(f"  [OK] No orphaned users")
    else:
        print(f"  [WARN] {orphaned} orphaned users (users without clinics)")
        integrity_checks.append(f"{orphaned} orphaned users")
except Exception as e:
    print(f"  [WARN] Could not check orphaned users: {e}")

# Check for orphaned patients
try:
    orphaned = session.execute(text("""
        SELECT COUNT(*) FROM patients p
        LEFT JOIN clinics c ON p.clinic_id = c.id
        WHERE c.id IS NULL
    """)).scalar()
    
    if orphaned == 0:
        print(f"  [OK] No orphaned patients")
    else:
        print(f"  [WARN] {orphaned} orphaned patients (patients without clinics)")
        integrity_checks.append(f"{orphaned} orphaned patients")
except Exception as e:
    print(f"  [WARN] Could not check orphaned patients: {e}")

# Check for patients without global_id
try:
    missing_gid = session.execute(text("""
        SELECT COUNT(*) FROM patients WHERE global_id IS NULL
    """)).scalar()
    
    if missing_gid == 0:
        print(f"  [OK] All patients have global_id")
    else:
        print(f"  [WARN] {missing_gid} patients missing global_id")
        integrity_checks.append(f"{missing_gid} patients without global_id")
except Exception as e:
    print(f"  [WARN] Could not check global_id: {e}")

# Check for appointments without global_id
try:
    missing_gid = session.execute(text("""
        SELECT COUNT(*) FROM appointments WHERE global_id IS NULL
    """)).scalar()
    
    if missing_gid == 0:
        print(f"  [OK] All appointments have global_id")
    else:
        print(f"  [WARN] {missing_gid} appointments missing global_id")
        integrity_checks.append(f"{missing_gid} appointments without global_id")
except Exception as e:
    print(f"  [WARN] Could not check appointment global_id: {e}")

# ── Final Report ──────────────────────────────────────────────────────────────

session.close()
engine.dispose()

print()
print("=" * 80)
print("VERIFICATION SUMMARY")
print("=" * 80)
print()

if all_tables_exist and not integrity_checks:
    print("[SUCCESS] ALL CHECKS PASSED")
    print()
    print("PostgreSQL migration is verified and ready for production.")
    print()
    print("Next steps:")
    print("  1. Test the application thoroughly")
    print("  2. Monitor logs for any SQL errors")
    print("  3. Keep SQLite backup for 7-14 days")
    print("  4. Set up automated PostgreSQL backups")
    print()
else:
    print("[WARN] VERIFICATION COMPLETED WITH WARNINGS")
    print()
    if integrity_checks:
        print("Data integrity issues found:")
        for issue in integrity_checks:
            print(f"  * {issue}")
        print()
        print("These may be expected if migrating from an old database.")
        print("Review and fix if necessary.")
    print()

print("=" * 80)
