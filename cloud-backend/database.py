"""
database.py — Database engine configuration.

Production mode: PostgreSQL only.
SQLite is NOT supported in SaaS deployment.

Connection pool math (PostgreSQL):
  - Gunicorn workers: 4 (set in Dockerfile CMD)
  - pool_size per worker: 5  -> 4 x 5  = 20 steady-state connections
  - max_overflow per worker: 5  -> 4 x 5  = 20 burst connections
  - Total max: 40 connections
  - PostgreSQL max_connections: 200 (set in docker-compose command)
  - Headroom: 160 connections free for psql, migrations, monitoring
"""

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import NullPool, QueuePool
import os

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL or not DATABASE_URL.startswith("postgresql"):
    raise RuntimeError(
        "Production requires PostgreSQL. Set DATABASE_URL to a PostgreSQL connection string. "
        "SQLite is not supported in SaaS mode."
    )

_is_postgres = True

_workers = int(os.getenv("GUNICORN_WORKERS", "4"))

engine = create_engine(
    DATABASE_URL,
    poolclass=QueuePool,
    pool_size=5,
    max_overflow=5,
    pool_timeout=30,
    pool_pre_ping=True,
    pool_recycle=300,
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Dependency-style session provider - use in route handlers."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """
    Create all tables and run startup migrations.
    Safe to call on every startup - only creates missing tables.
    """
    from models import Clinic, User, Patient, Message, Appointment, AuditLog, Notification, RevokedToken
    Base.metadata.create_all(bind=engine)

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
                pass

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
