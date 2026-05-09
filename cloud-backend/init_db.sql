-- PostgreSQL initialization script
-- Run automatically by Docker on first start

-- Performance indexes — all queries are clinic-scoped
CREATE INDEX IF NOT EXISTS idx_patients_clinic_id     ON patients(clinic_id);
CREATE INDEX IF NOT EXISTS idx_patients_global_id     ON patients(global_id);
CREATE INDEX IF NOT EXISTS idx_patients_updated_at    ON patients(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_patients_status        ON patients(clinic_id, status);

CREATE INDEX IF NOT EXISTS idx_appointments_clinic_id ON appointments(clinic_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date      ON appointments(clinic_id, date);
CREATE INDEX IF NOT EXISTS idx_appointments_global_id ON appointments(global_id);

CREATE INDEX IF NOT EXISTS idx_messages_clinic_id     ON messages(clinic_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at    ON messages(clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_clinic_id   ON audit_logs(clinic_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp   ON audit_logs(clinic_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity      ON audit_logs(entity_id);

CREATE INDEX IF NOT EXISTS idx_notifications_clinic   ON notifications(clinic_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_clinic_id        ON users(clinic_id);
CREATE INDEX IF NOT EXISTS idx_users_google_id        ON users(google_id);
