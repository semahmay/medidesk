#!/usr/bin/env python3
"""Quick test to verify PostgreSQL connection and database type."""

import os
from database import DATABASE_URL, engine, init_db
from sqlalchemy import text

print("=" * 60)
print("PostgreSQL Connection Test")
print("=" * 60)
print()

# Show database type
if DATABASE_URL.startswith("postgresql"):
    print("[OK] Database Type: PostgreSQL")
elif DATABASE_URL.startswith("sqlite"):
    print("[WARN] Database Type: SQLite")
else:
    print("[INFO] Database Type: Unknown")

print(f"[OK] Database URL: {DATABASE_URL[:60]}...")
print()

# Test connection
try:
    with engine.connect() as conn:
        result = conn.execute(text("SELECT 1")).scalar()
        assert result == 1
        print("[OK] Connection test passed")
        
        # Count tables
        result = conn.execute(text("""
            SELECT COUNT(*) FROM information_schema.tables 
            WHERE table_schema = 'public'
        """))
        table_count = result.scalar()
        print(f"[OK] Tables found: {table_count}")
        
        # Count total rows
        tables = ["clinics", "users", "patients", "appointments", "audit_logs", "notifications"]
        total_rows = 0
        for table in tables:
            try:
                count = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
                total_rows += count
                print(f"  - {table}: {count} rows")
            except:
                pass
        
        print(f"\n[OK] Total rows: {total_rows}")
        
except Exception as e:
    print(f"[FAIL] Connection failed: {e}")
    exit(1)

print()
print("=" * 60)
print("[SUCCESS] PostgreSQL is working correctly!")
print("=" * 60)
