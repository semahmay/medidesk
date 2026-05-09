# Analytics Methods to Add to database.py

# Add these methods to the Database class in database.py:

class Database:
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
                'New patient added — ' || full_name || ' — ' || 
                CASE 
                    WHEN julianday('now') - julianday(created_at) = 0 THEN 'Today'
                    WHEN julianday('now') - julianday(created_at) = 1 THEN 'Yesterday'
                    WHEN julianday('now') - julianday(created_at) < 7 THEN strftime('%d %b', created_at)
                    ELSE strftime('%d %b %Y', created_at)
                END as description,
                julianday('now') - julianday(created_at) as days_ago
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
                status,
                'Appointment ' || 
                CASE 
                    WHEN status = 'confirmed' THEN 'confirmed — '
                    WHEN status = 'pending' THEN 'scheduled — '
                    WHEN status = 'cancelled' THEN 'cancelled — '
                    ELSE status || ' — '
                END || patient_name || ' — ' ||
                CASE 
                    WHEN julianday('now') - julianday(created_at) = 0 THEN 'Today'
                    WHEN julianday('now') - julianday(created_at) = 1 THEN 'Yesterday'
                    WHEN julianday('now') - julianday(created_at) < 7 THEN strftime('%d %b', created_at)
                    ELSE strftime('%d %b %Y', created_at)
                END as description,
                julianday('now') - julianday(created_at) as days_ago
            FROM appointments 
            ORDER BY created_at DESC 
            LIMIT 5
        ''')
        
        appointment_activities = cursor.fetchall()
        
        conn.close()
        
        # Combine and format activities
        all_activities = []
        
        for activity in patient_activities + appointment_activities:
            days_ago = activity[4]  # days_ago is at index 4
            if days_ago == 0:
                time_ago = '2 hours ago'
            elif days_ago == 1:
                time_ago = 'Yesterday'
            elif days_ago < 7:
                time_ago = f"{days_ago} days ago"
            else:
                time_ago = activity[2][:11]  # created_at formatted date
                
            all_activities.append({
                'type': activity[0],
                'description': activity[3],
                'time_ago': time_ago
            })
        
        # Sort by time (most recent first) and limit to 10
        all_activities.sort(key=lambda x: x['time_ago'], reverse=True)
        
        return all_activities[:10]
