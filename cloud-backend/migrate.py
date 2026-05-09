"""
migrate.py — adds missing columns to the users table.
Run once: python migrate.py
Safe to run multiple times (checks before adding).
"""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'cloud.db')

def get_columns(cursor, table):
    cursor.execute(f'PRAGMA table_info({table})')
    return [row[1] for row in cursor.fetchall()]

def migrate():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # Create tables if they don't exist yet
    c.execute('''
        CREATE TABLE IF NOT EXISTS clinics (
            id TEXT PRIMARY KEY,
            doctor_user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            clinic_id TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (clinic_id) REFERENCES clinics(id)
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS patients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clinic_id TEXT NOT NULL,
            full_name TEXT NOT NULL,
            phone TEXT,
            email TEXT,
            notes TEXT,
            appointment TEXT,
            status TEXT DEFAULT "Active",
            updated_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (clinic_id) REFERENCES clinics(id)
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clinic_id TEXT NOT NULL,
            sender_role TEXT NOT NULL,
            text TEXT NOT NULL,
            is_task BOOLEAN DEFAULT 0,
            status TEXT DEFAULT "pending",
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (clinic_id) REFERENCES clinics(id)
        )
    ''')

    # Add missing columns to users table
    existing = get_columns(c, 'users')
    print(f'Current users columns: {existing}')

    migrations = [
        ('google_id',      'TEXT'),
        ('email',          'TEXT'),
        ('password_hash',  'TEXT'),
        ('status',         "TEXT DEFAULT 'invited'"),
        ('invited_at',     'TIMESTAMP'),
        ('activated_at',   'TIMESTAMP'),
    ]

    for col_name, col_type in migrations:
        if col_name not in existing:
            c.execute(f'ALTER TABLE users ADD COLUMN {col_name} {col_type}')
            print(f'  Added column: {col_name}')
        else:
            print(f'  Already exists: {col_name}')

    # Add global_id to patients table
    existing_patients = get_columns(c, 'patients')
    print(f'\nCurrent patients columns: {existing_patients}')

    patient_migrations = [
        ('global_id',  'TEXT'),
        ('updated_at', 'TIMESTAMP'),
        ('version',    'INTEGER DEFAULT 0'),
        ('deleted_at', 'TIMESTAMP'),
    ]
    for col_name, col_type in patient_migrations:
        if col_name not in existing_patients:
            c.execute(f'ALTER TABLE patients ADD COLUMN {col_name} {col_type}')
            print(f'  Added column: {col_name} to patients')
        else:
            print(f'  Already exists: {col_name} in patients')

    # Create revoked_tokens table for JWT revocation
    c.execute('''
        CREATE TABLE IF NOT EXISTS revoked_tokens (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            jti        TEXT UNIQUE NOT NULL,
            user_id    TEXT NOT NULL,
            revoked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP NOT NULL
        )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_revoked_tokens_jti     ON revoked_tokens(jti)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user_id ON revoked_tokens(user_id)')
    print('  revoked_tokens table ready')

    # Backfill updated_at from created_at where missing
    c.execute("UPDATE patients SET updated_at = created_at WHERE updated_at IS NULL")
    if c.rowcount:
        print(f'  Back-filled updated_at for {c.rowcount} patient(s)')

    conn.commit()
    conn.close()

    # Backfill global_id for existing patients that don't have one
    import uuid as _uuid
    conn_bf = sqlite3.connect(DB_PATH)
    c_bf = conn_bf.cursor()
    c_bf.execute('SELECT id FROM patients WHERE global_id IS NULL')
    rows = c_bf.fetchall()
    for (row_id,) in rows:
        c_bf.execute('UPDATE patients SET global_id = ? WHERE id = ?', (str(_uuid.uuid4()), row_id))
    if rows:
        print(f'  Back-filled global_id for {len(rows)} patient(s)')
    conn_bf.commit()
    conn_bf.close()

    # Back-fill: secretaries with a password but no status → mark as "active"
    conn3 = sqlite3.connect(DB_PATH)
    c3 = conn3.cursor()
    c3.execute("""
        UPDATE users
        SET status = 'active'
        WHERE role = 'secretary'
          AND password_hash IS NOT NULL
          AND (status IS NULL OR status = 'invited')
    """)
    updated = c3.rowcount
    conn3.commit()
    conn3.close()
    if updated:
        print(f'  Back-filled {updated} existing secretary(ies) to status=active')

    # Verify
    conn2 = sqlite3.connect(DB_PATH)
    c2 = conn2.cursor()
    final_users = get_columns(c2, 'users')
    final_patients = get_columns(c2, 'patients')
    conn2.close()
    print(f'\nFinal users columns:    {final_users}')
    print(f'Final patients columns: {final_patients}')
    print('\nMigration complete.')

if __name__ == '__main__':
    migrate()
