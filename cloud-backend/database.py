"""
database.py — Database engine configuration.

Supports both SQLite (Electron / dev) and PostgreSQL (SaaS / production).
Switch by setting DATABASE_URL in .env:

  SQLite (default):    sqlite:///./cloud.db
  PostgreSQL (SaaS):   postgresql://user:pass@host:5432/dbname

Connection pool math (PostgreSQL):
  - Gunicorn workers: 4 (set in Dockerfile CMD)
  - pool_size per worker: 5  → 4 × 5  = 20 steady-state connections
  - max_overflow per worker: 5  → 4 × 5  = 20 burst connections
  - Total max: 40 connections
  - PostgreSQL max_connections: 200 (set in docker-compose command)
  - Headroom: 160 connections free for psql, migrations, monitoring
"""

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import NullPool, QueuePool
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./cloud.db")
_is_sqlite    = DATABASE_URL.startswith("sqlite")
_is_postgres  = DATABASE_URL.startswith("postgresql")

# Read worker count from env so pool math stays correct if workers change
_workers = int(os.getenv("GUNICORN_WORKERS", "4"))

if _is_sqlite:
    # SQLite: single-file, threading workaround required
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        echo=False,
    )
elif _is_postgres:
    # PostgreSQL: pool sized so total connections stay well under max_connections.
    # Formula: workers × (pool_size + max_overflow) must be < max_connections - 10
    # With 4 workers, pool_size=5, max_overflow=5: max = 4×10 = 40 (safe under 200)
    engine = create_engine(
        DATABASE_URL,
        poolclass=QueuePool,
        pool_size=5,           # steady-state connections per worker process
        max_overflow=5,        # burst connections per worker (short-lived)
        pool_timeout=30,       # wait up to 30s for a connection before raising
        pool_pre_ping=True,    # detect stale/dead connections before use
        pool_recycle=300,      # recycle connections every 5 minutes
        echo=False,
    )
else:
    # Generic fallback (MySQL, etc.)
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Dependency-style session provider — use in route handlers."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """
    Create all tables and run startup migrations.
    Safe to call on every startup — only creates missing tables.
    """
    from models import Clinic, User, Patient, Message, Appointment, AuditLog, Notification, RevokedToken  # noqa: F401
    Base.metadata.create_all(bind=engine)

    # ── Backfill global_id for rows that predate Phase 5 ──────────────────
    import uuid as _uuid
    with engine.connect() as conn:
        for table in ("patients", "appointments"):
            try:
                rows = conn.execute(
                    text(f"SELECT id FROM {table} WHERE global_id IS NULL")
                ).fetchall()
                for (row_id,) in rows:
                    conn.execute(
                        text(f"UPDATE {table} SET global_id = :gid WHERE id = :id"),
                        {"gid": str(_uuid.uuid4()), "id": row_id},
                    )
                if rows:
                    conn.commit()
            except Exception:
                pass  # column may not exist on very old DBs — create_all handles it

    # ── PostgreSQL: create indexes if not present ──────────────────────────
    if _is_postgres:
        _create_pg_indexes()


def _create_pg_indexes():
    """Create performance indexes on PostgreSQL. Idempotent (IF NOT EXISTS)."""
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_patients_clinic_id     ON patients(clinic_id)",
        "CREATE INDEX IF NOT EXISTS idx_patients_global_id     ON patients(global_id)",
        "CREATE INDEX IF NOT EXISTS idx_patients_updated_at    ON patients(updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_patients_status        ON patients(clinic_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_patients_search_name    ON patients(clinic_id, full_name)",
        "CREATE INDEX IF NOT EXISTS idx_patients_search_contact ON patients(clinic_id, phone, email)",
        "CREATE INDEX IF NOT EXISTS idx_patients_search_notes   ON patients(clinic_id, notes)",
        "CREATE INDEX IF NOT EXISTS idx_appointments_clinic_id ON appointments(clinic_id)",
        "CREATE INDEX IF NOT EXISTS idx_appointments_date      ON appointments(clinic_id, date)",
        "CREATE INDEX IF NOT EXISTS idx_appointments_global_id ON appointments(global_id)",
        "CREATE INDEX IF NOT EXISTS idx_messages_clinic_id     ON messages(clinic_id)",
        "CREATE INDEX IF NOT EXISTS idx_messages_created_at    ON messages(clinic_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_clinic_id   ON audit_logs(clinic_id)",
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp   ON audit_logs(clinic_id, timestamp DESC)",
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_entity      ON audit_logs(entity_id)",
        "CREATE INDEX IF NOT EXISTS idx_notifications_clinic   ON notifications(clinic_id, is_read, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_users_clinic_id        ON users(clinic_id)",
        "CREATE INDEX IF NOT EXISTS idx_users_google_id        ON users(google_id)",
    ]
    with engine.connect() as conn:
        for stmt in indexes:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass
