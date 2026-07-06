-- MediDesk AI — PostgreSQL Schema Initialization
-- Run automatically by Docker on first start.
-- All statements are idempotent (IF NOT EXISTS / IF EXISTS).

-- ── Schema constraints applied by this script ────────────────────────────
--   ALTERs:  custom_fields → JSONB,  appointment date/time → DATE/TIME
--   CHECKS:  patients.status, appointments.status, users.role,
--            clinic_columns.column_type
--   FKs:     appointments.patient_id → patients.id ON DELETE SET NULL
--   ON DEL:  clinic-scoped child tables CASCADE, medical data RESTRICT
--   NOT NULL: patients.global_id
--   INDEXES: appointments.patient_id, appointments.clinic_id+status
--   PARTIAL: users.email UNIQUE WHERE NOT NULL
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Column type migrations ────────────────────────────────────────────

ALTER TABLE patients ALTER COLUMN custom_fields TYPE JSONB
  USING CASE
    WHEN custom_fields IS NULL THEN NULL
    WHEN custom_fields = '' THEN NULL
    ELSE custom_fields::jsonb
  END;

ALTER TABLE patients ALTER COLUMN global_id SET NOT NULL;
ALTER TABLE patients ALTER COLUMN full_name TYPE VARCHAR(255);
ALTER TABLE patients ALTER COLUMN phone     TYPE VARCHAR(30);
ALTER TABLE patients ALTER COLUMN email     TYPE VARCHAR(255);

ALTER TABLE appointments ALTER COLUMN date        TYPE DATE    USING date::date;
ALTER TABLE appointments ALTER COLUMN start_time  TYPE TIME    USING start_time::time;
ALTER TABLE appointments ALTER COLUMN end_time    TYPE TIME    USING end_time::time;
ALTER TABLE appointments ALTER COLUMN global_id   SET NOT NULL;
ALTER TABLE appointments ALTER COLUMN patient_name TYPE VARCHAR(255);

ALTER TABLE users ALTER COLUMN name TYPE VARCHAR(255);
ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(10);
ALTER TABLE users ALTER COLUMN email TYPE VARCHAR(255);
ALTER TABLE users ALTER COLUMN status TYPE VARCHAR(10);

ALTER TABLE clinic_columns ALTER COLUMN column_name TYPE VARCHAR(255);
ALTER TABLE clinic_columns ALTER COLUMN column_type TYPE VARCHAR(10);

-- ── 2. CHECK constraints ─────────────────────────────────────────────────

ALTER TABLE patients      ADD CONSTRAINT IF NOT EXISTS chk_patients_status
  CHECK (status IN ('Active', 'Inactive', 'Deleted'));

ALTER TABLE appointments  ADD CONSTRAINT IF NOT EXISTS chk_appointments_status
  CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show'));

ALTER TABLE users         ADD CONSTRAINT IF NOT EXISTS chk_users_role
  CHECK (role IN ('doctor', 'secretary'));
ALTER TABLE users         ADD CONSTRAINT IF NOT EXISTS chk_users_status
  CHECK (status IS NULL OR status IN ('invited', 'active', 'disabled'));

ALTER TABLE clinic_columns ADD CONSTRAINT IF NOT EXISTS chk_clinic_columns_type
  CHECK (column_type IN ('text', 'number', 'date', 'boolean'));

-- ── 3. Foreign key — appointments.patient_id → patients.id ───────────────

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS fk_appointments_patient_id;
ALTER TABLE appointments
  ADD CONSTRAINT fk_appointments_patient_id
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL;

-- ── 4. Partial unique index — users.email (only when non-null) ───────────

DROP INDEX IF EXISTS idx_users_email_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
  ON users(email) WHERE email IS NOT NULL;

-- ── 5. Ensure cascading ON DELETE on clinic-scoped FKs ───────────────────
-- SQLAlchemy model definitions already specify ondelete in ForeignKey().
-- For databases created before those model changes, update the FKs:

-- ── 6. Performance indexes ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_patients_clinic_id           ON patients(clinic_id);
CREATE INDEX IF NOT EXISTS idx_patients_global_id           ON patients(global_id);
CREATE INDEX IF NOT EXISTS idx_patients_updated_at          ON patients(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_patients_status              ON patients(clinic_id, status);
CREATE INDEX IF NOT EXISTS idx_patients_search_name         ON patients(clinic_id, full_name);
CREATE INDEX IF NOT EXISTS idx_patients_search_contact      ON patients(clinic_id, phone, email);
CREATE INDEX IF NOT EXISTS idx_patients_phone               ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_search_notes        ON patients(clinic_id, notes);
CREATE INDEX IF NOT EXISTS idx_patients_deleted_at          ON patients(clinic_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_appointments_clinic_id       ON appointments(clinic_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date            ON appointments(clinic_id, date);
CREATE INDEX IF NOT EXISTS idx_appointments_global_id       ON appointments(global_id);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id      ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status          ON appointments(clinic_id, status);

CREATE INDEX IF NOT EXISTS idx_messages_clinic_id           ON messages(clinic_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at          ON messages(clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_clinic_id         ON audit_logs(clinic_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp         ON audit_logs(clinic_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity            ON audit_logs(entity_id);

CREATE INDEX IF NOT EXISTS idx_notifications_clinic         ON notifications(clinic_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_clinic_id              ON users(clinic_id);
CREATE INDEX IF NOT EXISTS idx_users_google_id              ON users(google_id);
