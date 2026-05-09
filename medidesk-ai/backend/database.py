import sqlite3
import os
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()  # loads .env but never overwrites vars already set by the process (e.g. MEDIDESK_USER_ID from Electron)

class Database:
    def __init__(self):
        # Always resolve paths relative to this file — never relative to CWD
        _here = os.path.dirname(os.path.abspath(__file__))
        _data_root = os.path.normpath(os.path.join(_here, '..', 'data'))

        user_id = os.getenv('MEDIDESK_USER_ID')
        if user_id:
            user_data_dir = os.path.join(_data_root, 'users', user_id)
            os.makedirs(user_data_dir, exist_ok=True)
            self.db_path = os.path.join(user_data_dir, 'medidesk.db')
            self.attachments_dir = os.path.join(user_data_dir, 'attachments')
        else:
            # Fallback for dev/web mode (no Electron)
            self.db_path = os.path.join(_data_root, 'medidesk.db')
            self.attachments_dir = os.path.join(_data_root, 'attachments')

        os.makedirs(self.attachments_dir, exist_ok=True)
        print(f"[db] user_id={user_id or '(none)'}")
        print(f"[db] db_path={self.db_path}")
        self.init_database()
    
    def get_connection(self):
        return sqlite3.connect(self.db_path)
    
    def init_database(self):
        """Initialize all database tables"""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # Settings table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doctor_name TEXT NOT NULL,
                clinic_name TEXT NOT NULL,
                language TEXT DEFAULT 'en',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Columns configuration table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS columns_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                column_name TEXT NOT NULL,
                column_type TEXT NOT NULL CHECK (column_type IN ('text', 'date', 'select', 'number', 'boolean')),
                column_order INTEGER NOT NULL,
                is_default BOOLEAN DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Patients table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS patients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                phone TEXT,
                email TEXT,
                appointment DATE,
                status TEXT DEFAULT 'Active' CHECK (status IN ('Active', 'Follow-up', 'Urgent', 'Closed', 'scheduled', 'arrived', 'in_consultation', 'completed')),
                notes TEXT,
                cloud_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Migrate existing DBs — add cloud_id column if it doesn't exist yet
        try:
            cursor.execute('ALTER TABLE patients ADD COLUMN cloud_id TEXT')
        except Exception:
            pass  # column already exists

        # Migrate existing DBs — add global_id to patients (Phase 5)
        try:
            cursor.execute('ALTER TABLE patients ADD COLUMN global_id TEXT')
        except Exception:
            pass  # already exists
        # Backfill any rows missing a global_id
        try:
            import uuid as _uuid
            cursor.execute('SELECT id FROM patients WHERE global_id IS NULL')
            for (row_id,) in cursor.fetchall():
                cursor.execute('UPDATE patients SET global_id = ? WHERE id = ?', (str(_uuid.uuid4()), row_id))
        except Exception:
            pass

        # Migrate existing DBs — add global_id to appointments (Phase 5)
        try:
            cursor.execute('ALTER TABLE appointments ADD COLUMN global_id TEXT')
        except Exception:
            pass  # already exists
        try:
            import uuid as _uuid
            cursor.execute('SELECT id FROM appointments WHERE global_id IS NULL')
            for (row_id,) in cursor.fetchall():
                cursor.execute('UPDATE appointments SET global_id = ? WHERE id = ?', (str(_uuid.uuid4()), row_id))
        except Exception:
            pass

        # Migrate existing DBs — relax columns_config CHECK constraint to include number/boolean.
        # SQLite does not support ALTER COLUMN, so we recreate the table if the old constraint exists.
        try:
            cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='columns_config'")
            row = cursor.fetchone()
            if row and "'text', 'date', 'select'" in row[0] and 'number' not in row[0]:
                cursor.execute('ALTER TABLE columns_config RENAME TO columns_config_old')
                cursor.execute('''
                    CREATE TABLE columns_config (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        column_name TEXT NOT NULL,
                        column_type TEXT NOT NULL CHECK (column_type IN ('text', 'date', 'select', 'number', 'boolean')),
                        column_order INTEGER NOT NULL,
                        is_default BOOLEAN DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
                cursor.execute('INSERT INTO columns_config SELECT * FROM columns_config_old')
                cursor.execute('DROP TABLE columns_config_old')
        except Exception:
            pass  # already migrated or table doesn't exist yet
        
        # Attachments table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id INTEGER NOT NULL,
                file_name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_type TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE
            )
        ''')
        
        # Appointments table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS appointments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id INTEGER,
                patient_name TEXT,
                appointment_date TEXT,
                start_time TEXT,
                end_time TEXT,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients(id)
            )
        ''')
        
        # Custom column data table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS patient_custom_fields (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id INTEGER NOT NULL,
                column_id INTEGER NOT NULL,
                field_value TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
                FOREIGN KEY (column_id) REFERENCES columns_config (id) ON DELETE CASCADE,
                UNIQUE(patient_id, column_id)
            )
        ''')
        
        # Insert default columns if they don't exist
        default_columns = [
            ('Full Name', 'text', 1, 1),
            ('Phone', 'text', 2, 1),
            ('Email', 'text', 3, 1),
            ('Appointment', 'date', 4, 1),
            ('Status', 'select', 5, 1),
            ('Notes', 'text', 6, 1),
            ('Attachments', 'text', 7, 1)
        ]
        
        for col_name, col_type, col_order, is_default in default_columns:
            cursor.execute('''
                INSERT OR IGNORE INTO columns_config 
                (column_name, column_type, column_order, is_default)
                VALUES (?, ?, ?, ?)
            ''', (col_name, col_type, col_order, is_default))
        
        
        # Phase 3 Migrations
        for table in ['patients', 'appointments', 'attachments']:
            try:
                cursor.execute(f'ALTER TABLE {table} ADD COLUMN deleted_at TIMESTAMP NULL')
            except Exception:
                pass

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_type TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                user_id TEXT DEFAULT 'local',
                user_role TEXT DEFAULT 'doctor',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def get_settings(self):
        """Get application settings"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM settings ORDER BY id DESC LIMIT 1')
        result = cursor.fetchone()
        conn.close()
        
        if result:
            columns = [desc[0] for desc in cursor.description]
            return dict(zip(columns, result))
        return None
    
    def save_settings(self, doctor_name, clinic_name, language='en'):
        """Save application settings"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO settings (doctor_name, clinic_name, language)
            VALUES (?, ?, ?)
        ''', (doctor_name, clinic_name, language))
        conn.commit()
        conn.close()
    
    def get_columns_config(self):
        """Get columns configuration"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM columns_config ORDER BY column_order')
        results = cursor.fetchall()
        conn.close()
        
        columns = [desc[0] for desc in cursor.description]
        return [dict(zip(columns, row)) for row in results]
    
    def add_custom_column(self, column_name, column_type):
        """Add a custom column"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # Get the next order number
        cursor.execute('SELECT MAX(column_order) FROM columns_config')
        max_order = cursor.fetchone()[0] or 0
        
        cursor.execute('''
            INSERT INTO columns_config (column_name, column_type, column_order, is_default)
            VALUES (?, ?, ?, 0)
        ''', (column_name, column_type, max_order + 1))
        
        conn.commit()
        conn.close()
    
    def get_patients(self, page=1, limit=5000, search=None):
        """Get all patients with custom fields"""
        conn = self.get_connection()
        cursor = conn.cursor()
        offset = (page - 1) * limit
        
        if search:
            search_param = f"%{search}%"
            cursor.execute('''
                SELECT * FROM patients 
                WHERE deleted_at IS NULL 
                AND (full_name LIKE ? OR phone LIKE ? OR email LIKE ?)
                ORDER BY created_at DESC LIMIT ? OFFSET ?
            ''', (search_param, search_param, search_param, limit, offset))
        else:
            cursor.execute('SELECT * FROM patients WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?', (limit, offset))
            
        results = cursor.fetchall()
        
        patient_columns = [desc[0] for desc in cursor.description]
        patients = [dict(zip(patient_columns, row)) for row in results]
        
        # Get custom columns
        cursor.execute('SELECT * FROM columns_config WHERE is_default = 0 ORDER BY column_order')
        custom_columns = cursor.fetchall()
        custom_column_names = [row[1] for row in custom_columns]  # column_name is at index 1
        
        # Add custom fields to each patient
        for patient in patients:
            cursor.execute('''
                SELECT cc.column_name, pcf.field_value
                FROM columns_config cc
                LEFT JOIN patient_custom_fields pcf ON cc.id = pcf.column_id AND pcf.patient_id = ?
                WHERE cc.is_default = 0
                ORDER BY cc.column_order
            ''', (patient['id'],))
            custom_fields = cursor.fetchall()
            
            for field_name, field_value in custom_fields:
                patient[field_name] = field_value
        
        conn.close()
        return patients
    
    def search_all_patients(self, query, limit=200):
        """
        Full-text search across ALL patients — no pagination, no offset.
        Searches: full_name, phone, email, notes.
        Returns up to `limit` matches ordered by relevance (name match first,
        then phone, then email, then notes).

        This is used by GET /api/patients/search?q=... and guarantees that
        a patient on page 50 is still findable even if only page 1 is loaded.
        """
        conn = self.get_connection()
        cursor = conn.cursor()

        p = f'%{query}%'

        # Priority ordering: full_name match gets CASE score 0 (first),
        # then phone/email, then notes.
        cursor.execute('''
            SELECT *,
                CASE
                    WHEN full_name LIKE ? THEN 0
                    WHEN phone     LIKE ? THEN 1
                    WHEN email     LIKE ? THEN 2
                    WHEN notes     LIKE ? THEN 3
                    ELSE 4
                END AS _rank
            FROM patients
            WHERE deleted_at IS NULL
              AND (full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR notes LIKE ?)
            ORDER BY _rank ASC, created_at DESC
            LIMIT ?
        ''', (p, p, p, p, p, p, p, p, limit))

        results = cursor.fetchall()
        patient_columns = [desc[0] for desc in cursor.description]
        patients = [dict(zip(patient_columns, row)) for row in results]

        # Strip internal sort column from response
        for patient in patients:
            patient.pop('_rank', None)

        # Add custom fields to each patient
        for patient in patients:
            cursor.execute('''
                SELECT cc.column_name, pcf.field_value
                FROM columns_config cc
                LEFT JOIN patient_custom_fields pcf ON cc.id = pcf.column_id AND pcf.patient_id = ?
                WHERE cc.is_default = 0
                ORDER BY cc.column_order
            ''', (patient['id'],))
            for field_name, field_value in cursor.fetchall():
                patient[field_name] = field_value

        conn.close()
        return patients

    def add_patient(self, patient_data):
        """Add a new patient — always generates a global_id on creation."""
        import uuid as _uuid
        conn = self.get_connection()
        cursor = conn.cursor()

        global_id = patient_data.get('global_id') or str(_uuid.uuid4())

        cursor.execute('''
            INSERT INTO patients (full_name, phone, email, appointment, status, notes, global_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            patient_data.get('full_name'),
            patient_data.get('phone'),
            patient_data.get('email'),
            patient_data.get('appointment'),
            patient_data.get('status', 'Active'),
            patient_data.get('notes'),
            global_id,
        ))

        patient_id = cursor.lastrowid
        conn.commit()
        self.add_audit_log('CREATE', 'patient', patient_id)
        self.add_audit_log('CREATE', 'patient', patient_id)
        conn.close()
        return patient_id
    
    def update_patient(self, patient_id, patient_data):
        """Update patient information"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # Build dynamic update query based on provided fields
        update_fields = []
        update_values = []
        
        # Only update fields that are provided
        if 'full_name' in patient_data:
            update_fields.append('full_name=?')
            update_values.append(patient_data.get('full_name'))
        if 'phone' in patient_data:
            update_fields.append('phone=?')
            update_values.append(patient_data.get('phone'))
        if 'email' in patient_data:
            update_fields.append('email=?')
            update_values.append(patient_data.get('email'))
        if 'appointment' in patient_data:
            update_fields.append('appointment=?')
            update_values.append(patient_data.get('appointment'))
        if 'status' in patient_data:
            update_fields.append('status=?')
            update_values.append(patient_data.get('status'))
        if 'notes' in patient_data:
            update_fields.append('notes=?')
            update_values.append(patient_data.get('notes'))
        if 'cloud_id' in patient_data:
            update_fields.append('cloud_id=?')
            update_values.append(patient_data.get('cloud_id'))
        if 'global_id' in patient_data:
            update_fields.append('global_id=?')
            update_values.append(patient_data.get('global_id'))
        
        if not update_fields:
            conn.close()
            return
        
        update_fields.append('updated_at=?')
        update_values.append(datetime.now().isoformat())
        update_values.append(patient_id)
        
        query = f'''
            UPDATE patients 
            SET {', '.join(update_fields)}
            WHERE id=?
        '''
        
        cursor.execute(query, update_values)
        conn.commit()
        self.add_audit_log('UPDATE', 'patient', patient_id)
        self.add_audit_log('UPDATE', 'patient', patient_id)
        conn.close()
    
    def delete_patient(self, patient_id):
        """Delete a patient"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('UPDATE patients SET deleted_at = CURRENT_TIMESTAMP WHERE id=?', (patient_id,))
        self.add_audit_log('DELETE', 'patient', patient_id)
        conn.commit()
        conn.close()
    
    def add_attachment(self, patient_id, file_name, file_path, file_type):
        """Add an attachment to a patient"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO attachments (patient_id, file_name, file_path, file_type)
            VALUES (?, ?, ?, ?)
        ''', (patient_id, file_name, file_path, file_type))
        
        attachment_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return attachment_id
    
    def get_attachments(self, patient_id):
        """Get all attachments for a patient"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM attachments WHERE patient_id=? AND deleted_at IS NULL ORDER BY created_at DESC', (patient_id,))
        results = cursor.fetchall()
        conn.close()
        
        columns = [desc[0] for desc in cursor.description]
        return [dict(zip(columns, row)) for row in results]
    
    def get_attachment(self, attachment_id):
        """Get a single attachment by ID"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM attachments WHERE id=?', (attachment_id,))
        result = cursor.fetchone()
        
        if result:
            columns = [desc[0] for desc in cursor.description]
            attachment = dict(zip(columns, result))
        else:
            attachment = None
            
        conn.close()
        return attachment
    
    def delete_attachment(self, attachment_id):
        """Delete an attachment by ID"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('UPDATE attachments SET deleted_at = CURRENT_TIMESTAMP WHERE id=?', (attachment_id,))
        self.add_audit_log('DELETE', 'attachment', attachment_id)
        conn.commit()
        conn.close()
    
    def add_appointment(self, patient_id, patient_name, appointment_date, start_time, end_time, status='pending'):
        """Add a new appointment — always generates a global_id on creation."""
        import uuid as _uuid
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO appointments (patient_id, patient_name, appointment_date, start_time, end_time, status, global_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (patient_id, patient_name, appointment_date, start_time, end_time, status, str(_uuid.uuid4())))

        appointment_id = cursor.lastrowid
        conn.commit()
        self.add_audit_log('CREATE', 'appointment', appointment_id)
        self.add_audit_log('CREATE', 'appointment', appointment_id)
        conn.close()
        return appointment_id
    
    def get_all_appointments(self, date_filter=None):
        """Get all appointments, optionally filtered by date"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        if date_filter:
            cursor.execute('SELECT * FROM appointments WHERE appointment_date = ? AND deleted_at IS NULL ORDER BY start_time', (date_filter,))
        else:
            cursor.execute('SELECT * FROM appointments WHERE deleted_at IS NULL ORDER BY appointment_date, start_time')
        
        results = cursor.fetchall()
        conn.close()
        
        columns = [desc[0] for desc in cursor.description]
        return [dict(zip(columns, row)) for row in results]
    
    def get_week_appointments(self, date):
        """Get appointments for a week starting from the given date"""
        from datetime import datetime, timedelta
        
        # Parse the input date
        start_date = datetime.strptime(date, '%Y-%m-%d')
        
        # Get the start of the week (Monday)
        week_start = start_date - timedelta(days=start_date.weekday())
        
        # Get the end of the week (Sunday)
        week_end = week_start + timedelta(days=6)
        
        conn = self.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM appointments 
            WHERE appointment_date BETWEEN ? AND ? AND deleted_at IS NULL
            ORDER BY appointment_date, start_time
        ''', (week_start.strftime('%Y-%m-%d'), week_end.strftime('%Y-%m-%d')))
        
        results = cursor.fetchall()
        conn.close()
        
        columns = [desc[0] for desc in cursor.description]
        return [dict(zip(columns, row)) for row in results]
    
    def get_appointment(self, appointment_id):
        """Get a single appointment by ID"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM appointments WHERE id=?', (appointment_id,))
        result = cursor.fetchone()
        
        if result:
            columns = [desc[0] for desc in cursor.description]
            appointment = dict(zip(columns, result))
        else:
            appointment = None
            
        conn.close()
        return appointment
    
    def update_appointment(self, appointment_id, updates):
        """Update an appointment"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        set_clauses = []
        values = []
        
        for field, value in updates.items():
            if field in ['patient_id', 'patient_name', 'appointment_date', 'start_time', 'end_time', 'status']:
                set_clauses.append(f"{field} = ?")
                values.append(value)
        
        if set_clauses:
            values.append(appointment_id)
            cursor.execute(f"UPDATE appointments SET {', '.join(set_clauses)} WHERE id = ?", tuple(values))
            conn.commit()
            self.add_audit_log('UPDATE', 'appointment', appointment_id)
            self.add_audit_log('UPDATE', 'appointment', appointment_id)
        
        conn.close()
    
    def delete_appointment(self, appointment_id):
        """Delete an appointment"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('UPDATE appointments SET deleted_at = CURRENT_TIMESTAMP WHERE id=?', (appointment_id,))
        self.add_audit_log('DELETE', 'appointment', appointment_id)
        conn.commit()
        conn.close()
    
    def get_custom_columns(self):
        """Get all custom columns (non-default)"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM columns_config WHERE is_default = 0 ORDER BY column_order')
        results = cursor.fetchall()
        conn.close()
        
        columns = [desc[0] for desc in cursor.description]
        return [dict(zip(columns, row)) for row in results]
    
    def get_custom_columns_for_patient(self, patient_id):
        """Get custom columns with their values for a specific patient"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT cc.*, pcf.field_value
            FROM columns_config cc
            LEFT JOIN patient_custom_fields pcf ON cc.id = pcf.column_id AND pcf.patient_id = ?
            WHERE cc.is_default = 0
            ORDER BY cc.column_order
        ''', (patient_id,))
        results = cursor.fetchall()
        conn.close()
        
        columns = [desc[0] for desc in cursor.description]
        return [dict(zip(columns, row)) for row in results]
    
    def save_custom_field_data(self, patient_id, column_id, field_value):
        """Save or update custom field data for a patient"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT OR REPLACE INTO patient_custom_fields (patient_id, column_id, field_value, updated_at)
            VALUES (?, ?, ?, ?)
        ''', (patient_id, column_id, field_value, datetime.now().isoformat()))
        conn.commit()
        conn.close()
    
    def delete_custom_column(self, column_id):
        """Delete a custom column and all its data"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM patient_custom_fields WHERE column_id = ?', (column_id,))
        cursor.execute('DELETE FROM columns_config WHERE id = ? AND is_default = 0', (column_id,))
        conn.commit()
        conn.close()
    
    def get_patient_with_custom_fields(self, patient_id):
        """Get patient with all their custom field data"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM patients WHERE id = ?', (patient_id,))
        patient_result = cursor.fetchone()
        
        if not patient_result:
            conn.close()
            return None
        
        patient_columns = [desc[0] for desc in cursor.description]
        patient = dict(zip(patient_columns, patient_result))
        
        # Get custom fields
        cursor.execute('''
            SELECT cc.column_name, pcf.field_value
            FROM columns_config cc
            LEFT JOIN patient_custom_fields pcf ON cc.id = pcf.column_id AND pcf.patient_id = ?
            WHERE cc.is_default = 0
            ORDER BY cc.column_order
        ''', (patient_id,))
        custom_fields = cursor.fetchall()
        
        for field_name, field_value in custom_fields:
            patient[field_name] = field_value
        
        conn.close()
        return patient

    def get_total_patients_count(self):
        """Get total number of patients"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM patients')
        result = cursor.fetchone()[0]
        conn.close()
        return result

    def get_appointments_this_month_count(self):
        """Get number of appointments this month"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT COUNT(*) FROM appointments 
            WHERE strftime('%Y-%m', appointment_date) = strftime('%Y-%m', 'now')
        ''')
        result = cursor.fetchone()[0]
        conn.close()
        return result

    def get_new_patients_this_month_count(self):
        """Get number of new patients this month"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT COUNT(*) FROM patients 
            WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
        ''')
        result = cursor.fetchone()[0]
        conn.close()
        return result

    def get_cancelled_appointments_count(self):
        """Get total number of cancelled appointments"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM appointments WHERE status = 'cancelled'")
        result = cursor.fetchone()[0]
        conn.close()
        return result

    def get_patient_growth_last_6_months(self):
        """Get patient growth data for last 6 months"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT 
                strftime('%Y-%m', created_at) as month,
                COUNT(*) as count
            FROM patients 
            WHERE created_at >= date('now', '-6 months')
            GROUP BY strftime('%Y-%m', created_at)
            ORDER BY month
        ''')
        results = cursor.fetchall()
        conn.close()
        
        # Format month names
        month_names = {
            '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr',
            '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug',
            '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec'
        }
        
        formatted_data = []
        for month, count in results:
            month_key = month.split('-')[1]
            month_name = month_names.get(month_key, month)
            year = month.split('-')[0]
            formatted_data.append({
                'month': f"{month_name} {year}",
                'count': count
            })
        
        return formatted_data

    def get_appointments_by_month_last_6_months(self):
        """Get appointments data for last 6 months"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT 
                strftime('%Y-%m', appointment_date) as month,
                COUNT(*) as count
            FROM appointments 
            WHERE appointment_date >= date('now', '-6 months')
            GROUP BY strftime('%Y-%m', appointment_date)
            ORDER BY month
        ''')
        results = cursor.fetchall()
        conn.close()
        
        # Format month names
        month_names = {
            '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr',
            '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug',
            '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec'
        }
        
        formatted_data = []
        for month, count in results:
            month_key = month.split('-')[1]
            month_name = month_names.get(month_key, month)
            year = month.split('-')[0]
            formatted_data.append({
                'month': f"{month_name} {year}",
                'count': count
            })
        
        return formatted_data

    def get_patient_status_distribution(self):
        """Get patient status distribution"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT status, COUNT(*) as count
            FROM patients 
            GROUP BY status
        ''')
        results = cursor.fetchall()
        conn.close()
        
        # Initialize all statuses with 0
        distribution = {'active': 0, 'followup': 0, 'urgent': 0, 'closed': 0}
        
        for status, count in results:
            status_key = status.lower() if status.lower() != 'follow-up' else 'followup'
            if status_key in distribution:
                distribution[status_key] = count
        
        return distribution

    def get_appointment_status_distribution(self):
        """Get appointment status distribution"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT status, COUNT(*) as count
            FROM appointments 
            GROUP BY status
        ''')
        results = cursor.fetchall()
        conn.close()
        
        # Initialize all statuses with 0
        distribution = {'confirmed': 0, 'pending': 0, 'cancelled': 0, 'urgent': 0}
        
        for status, count in results:
            status_key = status.lower()
            if status_key in distribution:
                distribution[status_key] = count
        
        return distribution

    def get_busiest_days_of_week(self):
        """Get busiest days of week based on appointments"""
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT 
                CASE CAST(strftime('%w', appointment_date) AS INTEGER)
                    WHEN 0 THEN 'Sunday'
                    WHEN 1 THEN 'Monday'
                    WHEN 2 THEN 'Tuesday'
                    WHEN 3 THEN 'Wednesday'
                    WHEN 4 THEN 'Thursday'
                    WHEN 5 THEN 'Friday'
                    WHEN 6 THEN 'Saturday'
                END as day_name,
                COUNT(*) as appointments
            FROM appointments 
            WHERE appointment_date >= date('now', '-3 months')
            GROUP BY day_name
            ORDER BY appointments DESC
        ''')
        results = cursor.fetchall()
        conn.close()
        
        # Convert to dict and ensure all days are present
        busiest_days = {
            'Monday': 0, 'Tuesday': 0, 'Wednesday': 0, 'Thursday': 0,
            'Friday': 0, 'Saturday': 0, 'Sunday': 0
        }
        
        for day, count in results:
            busiest_days[day] = count
        
        return busiest_days

    def get_recent_activity(self):
        """Get recent activity from patients and appointments"""
        conn = self.get_connection()
        cursor = conn.cursor()

        # Get recent patient activities
        cursor.execute('''
            SELECT 
                'new_patient' as type,
                full_name,
                created_at,
                'New patient added — ' || full_name as description
            FROM patients 
            ORDER BY created_at DESC 
            LIMIT 5
        ''')
        patient_activities = cursor.fetchall()

        # Get recent appointment activities
        cursor.execute('''
            SELECT 
                'appointment' as type,
                patient_name,
                created_at,
                'Appointment ' || 
                CASE 
                    WHEN status = 'confirmed' THEN 'confirmed — '
                    WHEN status = 'pending'   THEN 'scheduled — '
                    WHEN status = 'cancelled' THEN 'cancelled — '
                    ELSE status || ' — '
                END || patient_name as description
            FROM appointments 
            ORDER BY created_at DESC 
            LIMIT 5
        ''')
        appointment_activities = cursor.fetchall()

        conn.close()

        all_activities = []
        for activity in patient_activities + appointment_activities:
            # activity = (type, name, created_at, description)
            created_at_str = activity[2] or ''
            try:
                from datetime import datetime, timezone
                created_dt = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
                now = datetime.now(timezone.utc) if created_dt.tzinfo else datetime.now()
                days_ago = (now - created_dt).days
            except Exception:
                days_ago = 999

            if days_ago == 0:
                time_ago = 'Today'
            elif days_ago == 1:
                time_ago = 'Yesterday'
            elif days_ago < 7:
                time_ago = f"{days_ago} days ago"
            else:
                time_ago = created_at_str[:10]  # YYYY-MM-DD

            all_activities.append({
                'type':        activity[0],
                'description': activity[3],
                'time_ago':    time_ago,
                'created_at':  created_at_str,
            })

        # Sort by created_at descending (most recent first)
        all_activities.sort(key=lambda x: x['created_at'], reverse=True)

        # Remove internal field before returning
        for a in all_activities:
            del a['created_at']

        return all_activities[:10]

    def add_audit_log(self, action_type, entity_type, entity_id, user_id='local', user_role='doctor'):
        conn = self.get_connection()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO audit_logs (action_type, entity_type, entity_id, user_id, user_role)
            VALUES (?, ?, ?, ?, ?)
        ''', (action_type, entity_type, str(entity_id), user_id, user_role))
        conn.commit()
        conn.close()

    def check_double_booking(self, appointment_date, start_time, end_time, exclude_id=None):
        conn = self.get_connection()
        cursor = conn.cursor()
        query = '''
            SELECT id FROM appointments 
            WHERE appointment_date = ? 
            AND deleted_at IS NULL
            AND (
                (start_time < ? AND end_time > ?) OR
                (start_time < ? AND end_time > ?) OR
                (start_time >= ? AND end_time <= ?)
            )
        '''
        params = [appointment_date, end_time, start_time, end_time, end_time, start_time, end_time]
        
        if exclude_id:
            query += " AND id != ?"
            params.append(exclude_id)
            
        cursor.execute(query, params)
        result = cursor.fetchone()
        conn.close()
        return result is not None
