"""
core/db.py — Database engine, session management, and migrations.
"""

import contextlib
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import QueuePool
from core.config import DATABASE_URL

# Production-optimized connection pool configuration
# Pool sizing: 4 workers × (pool_size + max_overflow) = 4 × 20 = 80 max connections
# PostgreSQL max_connections=200 leaves 120 for backups, monitoring, future workers
# Health checks:
#   pool_pre_ping=True     - verify connection before every checkout
#   pool_recycle=3600      - recycle connections after 1 hour (matches PG's default tcp_timeout)
#   keepalives_idle=30     - send keepalive after 30s idle
#   keepalives_interval=10 - send keepalive every 10s
#   keepalives_count=5     - 5 missed keepalives = dead connection
engine = create_engine(
    DATABASE_URL,
    poolclass=QueuePool,
    pool_size=10,                    # 10 persistent connections per worker (4 workers = 40 baseline)
    max_overflow=20,                 # Allow 20 additional during spikes (4 workers × 20 = 80 peak)
    pool_timeout=30,                 # Wait up to 30s for a connection before raising error
    pool_pre_ping=True,              # Verify connection health before use (prevents stale connection errors)
    pool_recycle=3600,               # Recycle connections after 1 hour (prevents PG connection timeouts)
    pool_use_lifo=True,              # Reuse most recently used connections (better PostgreSQL cache locality)
    echo=False,
    connect_args={
        "connect_timeout": 10,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 5,
        "options": "-c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000",
    },
)

@event.listens_for(engine, "connect")
def _set_connect_timeout(dbapi_conn, connection_record):
    dbapi_conn.set_session(autocommit=False)


@event.listens_for(engine, "checkout")
def _checkout_listener(dbapi_conn, connection_record, connection_proxy):
    """Log connection checkout for debugging pool exhaustion issues."""
    import logging
    logger = logging.getLogger("db")
    try:
        pool = engine.pool
        if pool.checkedout() > pool.size() * 0.8:
            logger.warning(
                f"[DB] Pool at {pool.checkedout()}/{pool.size() + pool.overflow()} "
                f"checked out connections"
            )
    except Exception:
        pass

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Return a SQLAlchemy session. Caller MUST close() in finally."""
    db = SessionLocal()
    return db


@contextlib.contextmanager
def session_scope():
    """Context manager for safe session handling. Auto-closes on exit."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create all tables and run startup migrations."""
    from models import Clinic, User, Patient, Message, Appointment, AuditLog, Notification, RevokedToken, ClinicColumn
    Base.metadata.create_all(bind=engine)

    _ensure_global_ids()
    _run_migrations()
    _create_pg_indexes()


def _ensure_global_ids():
    """Backfill missing global_id for rows created before schema migration."""
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


def _run_migrations():
    """Run idempotent schema migrations for existing databases."""
    _migrations = [
        "ALTER TABLE patients ALTER COLUMN custom_fields TYPE JSONB "
        "USING CASE WHEN custom_fields IS NULL THEN NULL WHEN custom_fields = '' THEN NULL ELSE custom_fields::jsonb END",
        "ALTER TABLE patients      ALTER COLUMN global_id SET NOT NULL",
        "ALTER TABLE appointments  ALTER COLUMN global_id SET NOT NULL",
        "ALTER TABLE patients      ALTER COLUMN full_name TYPE VARCHAR(255)",
        "ALTER TABLE patients      ALTER COLUMN phone     TYPE VARCHAR(30)",
        "ALTER TABLE patients      ALTER COLUMN email     TYPE VARCHAR(255)",
        "ALTER TABLE appointments  ALTER COLUMN patient_name TYPE VARCHAR(255)",
        "ALTER TABLE users         ALTER COLUMN name      TYPE VARCHAR(255)",
        "ALTER TABLE users         ALTER COLUMN role      TYPE VARCHAR(10)",
        "ALTER TABLE users         ALTER COLUMN email     TYPE VARCHAR(255)",
        "ALTER TABLE users         ALTER COLUMN status    TYPE VARCHAR(10)",
        "ALTER TABLE clinic_columns ALTER COLUMN column_name TYPE VARCHAR(255)",
        "ALTER TABLE clinic_columns ALTER COLUMN column_type TYPE VARCHAR(10)",
        "ALTER TABLE appointments  ALTER COLUMN date       TYPE DATE    USING date::date",
        "ALTER TABLE appointments  ALTER COLUMN start_time TYPE TIME    USING start_time::time",
        "ALTER TABLE appointments  ALTER COLUMN end_time   TYPE TIME    USING end_time::time",
        "ALTER TABLE patients      ADD CONSTRAINT IF NOT EXISTS chk_patients_status "
            "CHECK (status IN ('Active', 'Inactive', 'Deleted'))",
        "ALTER TABLE appointments  ADD CONSTRAINT IF NOT EXISTS chk_appointments_status "
            "CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show'))",
        "ALTER TABLE users         ADD CONSTRAINT IF NOT EXISTS chk_users_role "
            "CHECK (role IN ('doctor', 'secretary'))",
        "ALTER TABLE users         ADD CONSTRAINT IF NOT EXISTS chk_users_status "
            "CHECK (status IS NULL OR status IN ('invited', 'active', 'disabled'))",
        "ALTER TABLE clinic_columns ADD CONSTRAINT IF NOT EXISTS chk_clinic_columns_type "
            "CHECK (column_type IN ('text', 'number', 'date', 'boolean'))",
        "ALTER TABLE appointments DROP CONSTRAINT IF EXISTS fk_appointments_patient_id",
        "ALTER TABLE appointments ADD CONSTRAINT fk_appointments_patient_id "
            "FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique "
            "ON users(email) WHERE email IS NOT NULL",
    ]
    with engine.connect() as conn:
        for stmt in _migrations:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass


def _create_pg_indexes():
    """Create performance indexes on PostgreSQL. Idempotent."""
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_patients_clinic_id           ON patients(clinic_id)",
        "CREATE INDEX IF NOT EXISTS idx_patients_global_id           ON patients(global_id)",
        "CREATE INDEX IF NOT EXISTS idx_patients_updated_at          ON patients(updated_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_patients_status              ON patients(clinic_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_patients_search_name         ON patients(clinic_id, full_name)",
        "CREATE INDEX IF NOT EXISTS idx_patients_search_contact      ON patients(clinic_id, phone, email)",
        "CREATE INDEX IF NOT EXISTS idx_patients_phone               ON patients(phone)",
        "CREATE INDEX IF NOT EXISTS idx_patients_search_notes        ON patients(clinic_id, notes)",
        "CREATE INDEX IF NOT EXISTS idx_patients_deleted_at          ON patients(clinic_id, deleted_at)",
        "CREATE INDEX IF NOT EXISTS idx_appointments_clinic_id       ON appointments(clinic_id)",
        "CREATE INDEX IF NOT EXISTS idx_appointments_date            ON appointments(clinic_id, date)",
        "CREATE INDEX IF NOT EXISTS idx_appointments_global_id       ON appointments(global_id)",
        "CREATE INDEX IF NOT EXISTS idx_appointments_patient_id      ON appointments(patient_id)",
        "CREATE INDEX IF NOT EXISTS idx_appointments_status          ON appointments(clinic_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_messages_clinic_id           ON messages(clinic_id)",
        "CREATE INDEX IF NOT EXISTS idx_messages_created_at          ON messages(clinic_id, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_clinic_id         ON audit_logs(clinic_id)",
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp         ON audit_logs(clinic_id, timestamp DESC)",
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_entity            ON audit_logs(entity_id)",
        "CREATE INDEX IF NOT EXISTS idx_notifications_clinic         ON notifications(clinic_id, is_read, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_users_clinic_id              ON users(clinic_id)",
        "CREATE INDEX IF NOT EXISTS idx_users_google_id              ON users(google_id)",
    ]
    with engine.connect() as conn:
        for stmt in indexes:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass
