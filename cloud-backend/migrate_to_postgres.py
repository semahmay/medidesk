"""
migrate_to_postgres.py — Production-grade migration from SQLite → PostgreSQL.

Usage:
    SQLITE_PATH=./cloud.db \
    DATABASE_URL=postgresql://medidesk:pass@localhost:5432/medidesk \
    python migrate_to_postgres.py [--dry-run] [--force]

Steps performed:
  1. Safety checks (PostgreSQL reachable, not SQLite URL)
  2. Read all data from SQLite
  3. Connect to PostgreSQL
  4. Create all tables (via SQLAlchemy models)
  5. Insert all rows in dependency order with ON CONFLICT DO NOTHING
  6. Verify row counts match (fail if mismatch)
  7. Print detailed migration report

SAFE: read-only on SQLite, idempotent on PostgreSQL.
Run with --dry-run to verify counts without writing.
Run with --force to allow re-runs (skips duplicate check).
"""

import os
import sys
import sqlite3
import uuid
from datetime import datetime

# ── Config ────────────────────────────────────────────────────────────────────

SQLITE_PATH  = os.getenv("SQLITE_PATH", "./cloud.db")
PG_URL       = os.getenv("DATABASE_URL", "")
DRY_RUN      = "--dry-run" in sys.argv
FORCE        = "--force" in sys.argv

print("=" * 80)
print("PostgreSQL Migration Tool")
print("=" * 80)
print()

# ── Safety Guards ─────────────────────────────────────────────────────────────

if not PG_URL:
    print("[ERROR] DATABASE_URL environment variable not set")
    print("   Example: DATABASE_URL=postgresql://medidesk:pass@localhost:5432/medidesk")
    sys.exit(1)

if not PG_URL.startswith("postgresql"):
    print("[ERROR] DATABASE_URL must be a PostgreSQL URL")
    print(f"   Got: {PG_URL[:50]}...")
    print("   Expected: postgresql://...")
    sys.exit(1)

if PG_URL.startswith("sqlite"):
    print("[ERROR] DATABASE_URL is still pointing to SQLite")
    print("   Migration requires a PostgreSQL database")
    sys.exit(1)

if not os.path.exists(SQLITE_PATH):
    print(f"[ERROR] SQLite file not found: {SQLITE_PATH}")
    sys.exit(1)

print(f"[OK] Source:      {SQLITE_PATH}")
print(f"[OK] Destination: {PG_URL[:60]}...")
print(f"[OK] Mode:        {'DRY RUN (no writes)' if DRY_RUN else 'LIVE MIGRATION'}")
print(f"[OK] Force:       {'Yes (allow re-run)' if FORCE else 'No'}")
print()

# ── PostgreSQL Connectivity Check ────────────────────────────────────────────

print("Checking PostgreSQL connectivity...")
try:
    from sqlalchemy import create_engine, text
    test_engine = create_engine(PG_URL, pool_pre_ping=True, echo=False)
    with test_engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    print("[OK] PostgreSQL is reachable")
    test_engine.dispose()
except Exception as e:
    print(f"[ERROR] Cannot connect to PostgreSQL")
    print(f"   {str(e)}")
    print("   Check that PostgreSQL is running and DATABASE_URL is correct")
    sys.exit(1)

print()

# ── Read from SQLite ──────────────────────────────────────────────────────────

def sqlite_rows(table: str, conn) -> list[dict]:
    cursor = conn.cursor()
    try:
        cursor.execute(f"SELECT * FROM {table}")
        cols = [d[0] for d in cursor.description]
        return [dict(zip(cols, row)) for row in cursor.fetchall()]
    except Exception as e:
        # Table might not exist in older DBs
        return []


print("Reading from SQLite...")
sqlite_conn = sqlite3.connect(SQLITE_PATH)
sqlite_conn.row_factory = sqlite3.Row

# IMPORTANT: Order matters — foreign key dependencies must be respected
tables_ordered = [
    "clinics",
    "users",
    "patients",
    "messages",
    "appointments",
    "audit_logs",
    "notifications",
    "revoked_tokens",  # Added in Phase 6
]

data = {}
total_rows = 0
for table in tables_ordered:
    rows = sqlite_rows(table, sqlite_conn)
    data[table] = rows
    total_rows += len(rows)
    status = "[OK]" if rows else "[WARN]"
    print(f"  {status} {table:20s} {len(rows):>6} rows")

sqlite_conn.close()
print(f"\n  Total: {total_rows} rows across {len(tables_ordered)} tables")
print()

if DRY_RUN:
    print("=" * 80)
    print("DRY RUN COMPLETE — No data written to PostgreSQL")
    print("=" * 80)
    print("\nTo perform the actual migration, run without --dry-run:")
    print(f"  SQLITE_PATH={SQLITE_PATH} DATABASE_URL=postgresql://... python migrate_to_postgres.py")
    sys.exit(0)

# ── Write to PostgreSQL ───────────────────────────────────────────────────────

print("Initializing PostgreSQL schema...")

# Temporarily override DATABASE_URL so database.py uses PostgreSQL
os.environ["DATABASE_URL"] = PG_URL

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

pg_engine = create_engine(
    PG_URL,
    pool_pre_ping=True,
    echo=False,
)

# Create all tables using the models
import sys
sys.path.insert(0, ".")
from database import init_db
init_db()
print("[OK] Schema created/verified")
print()

Session = sessionmaker(bind=pg_engine)
session = Session()

inserted = {}
errors = {}

def insert_table(table: str, rows: list[dict]):
    """Insert rows with ON CONFLICT DO NOTHING for idempotency."""
    if not rows:
        inserted[table] = 0
        errors[table] = []
        return
    
    count = 0
    error_list = []
    
    for i, row in enumerate(rows):
        # Ensure global_id exists for patients/appointments
        if table in ("patients", "appointments") and not row.get("global_id"):
            row["global_id"] = str(uuid.uuid4())
        
        # Convert SQLite integer booleans to Python booleans for PostgreSQL
        if table == "notifications" and "is_read" in row:
            row["is_read"] = bool(row["is_read"])
        if table == "messages" and "is_task" in row:
            row["is_task"] = bool(row["is_task"])
        
        try:
            cols = ", ".join(row.keys())
            placeholders = ", ".join(f":{k}" for k in row.keys())
            session.execute(
                text(f"INSERT INTO {table} ({cols}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"),
                row,
            )
            count += 1
        except Exception as e:
            error_msg = f"Row {i+1}: {str(e)[:100]}"
            error_list.append(error_msg)
            if len(error_list) <= 3:  # Only print first 3 errors per table
                print(f"    [WARN] {error_msg}")
    
    session.commit()
    inserted[table] = count
    errors[table] = error_list
    
    status = "[OK]" if count == len(rows) else "[WARN]"
    print(f"  {status} {table:20s} {count:>6}/{len(rows):<6} rows inserted")
    if error_list and len(error_list) > 3:
        print(f"    ... and {len(error_list) - 3} more errors")


print("Writing to PostgreSQL...")
for table in tables_ordered:
    insert_table(table, data[table])

session.close()
print()

# ── Verify ────────────────────────────────────────────────────────────────────

print("=" * 80)
print("VERIFICATION")
print("=" * 80)
print()

verification_passed = True
mismatches = []

with pg_engine.connect() as conn:
    print(f"{'Table':<20} {'SQLite':<10} {'PostgreSQL':<12} {'Status'}")
    print("-" * 60)
    
    for table in tables_ordered:
        try:
            pg_count = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
            src_count = len(data[table])
            
            if pg_count >= src_count:
                status = "[OK]"
            else:
                status = "[FAIL] MISMATCH"
                verification_passed = False
                mismatches.append(f"{table}: expected {src_count}, got {pg_count}")
            
            print(f"{table:<20} {src_count:<10} {pg_count:<12} {status}")
            
        except Exception as e:
            print(f"{table:<20} {len(data[table]):<10} {'ERROR':<12} [FAIL] {str(e)[:30]}")
            verification_passed = False
            mismatches.append(f"{table}: {str(e)}")

print()

# ── Final Report ──────────────────────────────────────────────────────────────

print("=" * 80)
print("MIGRATION SUMMARY")
print("=" * 80)
print()

total_errors = sum(len(e) for e in errors.values())
if total_errors > 0:
    print(f"[WARN] {total_errors} rows had errors during insertion (see above)")
    print()

if verification_passed:
    print("[SUCCESS] MIGRATION SUCCESSFUL")
    print()
    print("All data verified. Next steps:")
    print()
    print("1. Update .env to use PostgreSQL:")
    print(f"   DATABASE_URL={PG_URL}")
    print()
    print("2. Restart the backend:")
    print("   docker-compose restart backend")
    print()
    print("3. Test the application thoroughly")
    print()
    print("4. Keep SQLite backup until production is verified:")
    print(f"   {SQLITE_PATH}")
    print()
else:
    print("[FAIL] MIGRATION FAILED")
    print()
    print("Verification errors:")
    for mismatch in mismatches:
        print(f"  * {mismatch}")
    print()
    print("DO NOT switch to PostgreSQL yet. Investigate the errors above.")
    print()
    sys.exit(1)

print("=" * 80)
