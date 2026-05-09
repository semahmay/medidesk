from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import os
from dotenv import load_dotenv
from database import Database
from werkzeug.utils import secure_filename
from groq import Groq
from datetime import datetime, timedelta
from whisper_service import transcribe_audio as whisper_transcribe

load_dotenv()  # loads .env but never overwrites vars already set by the process (e.g. MEDIDESK_USER_ID from Electron)

_user_id = os.getenv('MEDIDESK_USER_ID')
if _user_id:
    print(f"[startup] MEDIDESK_USER_ID = {_user_id}")
else:
    print("WARNING: MEDIDESK_USER_ID not set - running in global DB mode (dev only)")

# Initialize Groq client
groq_client = Groq(api_key=os.getenv('GROQ_API_KEY'))

app = Flask(__name__)
CORS(app)

# Initialize database
db = Database()

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'message': 'MediDesk AI Backend is running'})

@app.route('/api/whoami', methods=['GET'])
def whoami():
    """Debug endpoint — shows which user DB is active"""
    return jsonify({
        'user_id': os.getenv('MEDIDESK_USER_ID', '(none — shared DB)'),
        'db_path': db.db_path,
        'attachments_dir': db.attachments_dir,
    })

@app.route('/api/setup', methods=['GET', 'POST'])
def setup():
    """Handle initial setup"""
    if request.method == 'GET':
        settings = db.get_settings()
        if settings:
            return jsonify({'setup_complete': True, 'settings': settings})
        else:
            columns = db.get_columns_config()
            return jsonify({'setup_complete': False, 'columns': columns})
    
    elif request.method == 'POST':
        data = request.get_json()
        doctor_name = data.get('doctor_name')
        clinic_name = data.get('clinic_name')
        language = data.get('language', 'en')
        
        if not doctor_name or not clinic_name:
            return jsonify({'error': 'Doctor name and clinic name are required'}), 400
        
        # Add custom columns if provided
        custom_columns = data.get('custom_columns', [])
        for column in custom_columns:
            db.add_custom_column(column['name'], column['type'])
        
        # Save settings
        db.save_settings(doctor_name, clinic_name, language)
        
        return jsonify({'success': True, 'message': 'Setup completed successfully'})

@app.route('/api/columns', methods=['GET', 'POST'])
def columns():
    """Handle columns configuration"""
    if request.method == 'GET':
        columns = db.get_columns_config()
        return jsonify({'columns': columns})
    
    elif request.method == 'POST':
        data = request.get_json()
        column_name = data.get('name')
        column_type = data.get('type')
        
        if not column_name or not column_type:
            return jsonify({'error': 'Column name and type are required'}), 400
        
        db.add_custom_column(column_name, column_type)
        return jsonify({'success': True, 'message': 'Column added successfully'})

@app.route('/api/columns/<int:column_id>', methods=['DELETE'])
def delete_column(column_id):
    """Delete a custom column"""
    try:
        db.delete_custom_column(column_id)
        return jsonify({'success': True, 'message': 'Column deleted successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/patients/<int:patient_id>/custom-fields', methods=['POST'])
def save_custom_fields(patient_id):
    """Save custom field data for a patient"""
    try:
        data = request.get_json()
        custom_fields = data.get('custom_fields', {})
        
        for column_name, field_value in custom_fields.items():
            # Get column ID by name
            columns = db.get_columns_config()
            column = next((c for c in columns if c['column_name'] == column_name), None)
            
            if column and not column['is_default']:
                db.save_custom_field_data(patient_id, column['id'], field_value)
        
        return jsonify({'success': True, 'message': 'Custom fields saved successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/patients', methods=['GET', 'POST'])
def patients():
    """Handle patients CRUD operations"""
    if request.method == 'GET':
        page = request.args.get('page', 1, type=int)
        limit = request.args.get('limit', 50, type=int)
        search = request.args.get('search', None)
        patients = db.get_patients(page=page, limit=limit, search=search)
        return jsonify({'patients': patients})
    
    elif request.method == 'POST':
        data = request.get_json()
        
        if not data.get('full_name'):
            return jsonify({'error': 'Full name is required'}), 400
        
        patient_id = db.add_patient(data)
        
        # Save custom fields if provided
        custom_fields = data.get('custom_fields', {})
        if custom_fields:
            columns = db.get_columns_config()
            for column_name, field_value in custom_fields.items():
                column = next((c for c in columns if c['column_name'] == column_name), None)
                if column and not column['is_default']:
                    db.save_custom_field_data(patient_id, column['id'], field_value)
        
        return jsonify({'success': True, 'patient_id': patient_id, 'message': 'Patient added successfully'})

@app.route('/api/patients/search', methods=['GET'])
def search_patients():
    """
    Server-side full-text patient search across ALL patients (no pagination limit).
    Searches: full_name, phone, email, notes.
    Returns up to 200 results ordered by relevance (name match first).
    
    GET /api/patients/search?q=<term>
    """
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify({'patients': [], 'total': 0, 'query': ''})
    
    patients = db.search_all_patients(q)
    return jsonify({
        'patients': patients,
        'total': len(patients),
        'query': q,
    })

@app.route('/api/patients/<int:patient_id>', methods=['GET', 'PUT', 'DELETE'])
def patient(patient_id):
    """Handle individual patient operations"""
    if request.method == 'GET':
        # Get patient details with attachments and custom fields
        patient = db.get_patient_with_custom_fields(patient_id)
        
        if not patient:
            return jsonify({'error': 'Patient not found'}), 404
        
        attachments = db.get_attachments(patient_id)
        patient['attachments'] = attachments
        
        return jsonify({'patient': patient})
    
    elif request.method == 'PUT':
        data = request.get_json()
        db.update_patient(patient_id, data)
        
        # Save custom fields if provided
        custom_fields = data.get('custom_fields', {})
        if custom_fields:
            columns = db.get_columns_config()
            for column_name, field_value in custom_fields.items():
                column = next((c for c in columns if c['column_name'] == column_name), None)
                if column and not column['is_default']:
                    db.save_custom_field_data(patient_id, column['id'], field_value)
        
        return jsonify({'success': True, 'message': 'Patient updated successfully'})
    
    elif request.method == 'DELETE':
        db.delete_patient(patient_id)
        return jsonify({'success': True, 'message': 'Patient deleted successfully'})

@app.route('/api/patients/<int:patient_id>/attachments', methods=['GET', 'POST'])
def patient_attachments(patient_id):
    """Handle patient attachments (GET all, POST new)"""
    try:
        if request.method == 'GET':
            # Get all attachments for a patient
            attachments = db.get_attachments(patient_id)
            # Ensure all attachments have required fields
            valid_attachments = [att for att in attachments if att and att.get('file_name')]
            return jsonify({'attachments': valid_attachments})
        
        elif request.method == 'POST':
            print(f"POST request received for patient {patient_id}")
            print(f"Files in request: {list(request.files.keys())}")
            
            # Upload a new attachment
            if 'file' not in request.files:
                print("No file in request.files")
                return jsonify({'error': 'No file provided'}), 400
            
            file = request.files['file']
            print(f"File object: {file}")
            print(f"Filename: {file.filename}")
            
            if file.filename == '':
                print("Empty filename")
                return jsonify({'error': 'No file selected'}), 400
            
            # Check file type
            allowed_extensions = {'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp'}
            filename = secure_filename(file.filename)
            file_extension = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
            
            print(f"Secure filename: {filename}")
            print(f"File extension: {file_extension}")
            
            if file_extension not in allowed_extensions:
                print(f"Invalid file extension: {file_extension}")
                return jsonify({'error': 'File type not allowed. Allowed types: PDF, PNG, JPG, JPEG, GIF, WebP'}), 400
            
            # Create patient directory inside this user's attachments folder
            patient_dir = os.path.join(db.attachments_dir, str(patient_id))
            os.makedirs(patient_dir, exist_ok=True)
            print(f"Patient directory: {patient_dir}")
            
            # Save file with ABSOLUTE path
            file_path = os.path.abspath(os.path.join(patient_dir, filename))
            print(f"Saving file to: {file_path}")
            file.save(file_path)
            
            # Verify file was saved
            if not os.path.exists(file_path):
                print("File was not saved successfully")
                return jsonify({'error': 'Failed to save file'}), 500
            
            print("File saved successfully")
            
            # Save to database
            attachment_id = db.add_attachment(patient_id, filename, file_path, file_extension)
            print(f"Attachment ID: {attachment_id}")
            
            # Get the created attachment
            attachment = db.get_attachment(attachment_id)
            print(f"Retrieved attachment: {attachment}")
            
            if attachment and attachment.get('file_name'):
                print("Returning success response")
                return jsonify({'success': True, 'attachment': attachment})
            else:
                print("Invalid attachment data from database")
                return jsonify({'error': 'Failed to save attachment record'}), 500
    
    except Exception as e:
        print(f"Error in patient_attachments: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/chat', methods=['POST'])
def ai_chat():
    """Handle AI chat with Claude"""
    try:
        from ai_service import chat_with_claude
        data = request.get_json()
        message = data.get('message')
        patient_context = data.get('patient_context', {})
        
        if not message:
            return jsonify({'error': 'Message is required'}), 400
        
        response = chat_with_claude(message, patient_context)
        return jsonify({'response': response})
    
    except ImportError:
        return jsonify({'error': 'AI service not available'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/transcribe', methods=['POST'])
def transcribe_audio():
    """Handle audio transcription using Whisper"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400

        file = request.files['file']

        if file.filename == '':
            return jsonify({'error': 'No audio file selected'}), 400

        # Read and size-check
        audio_data = file.read()
        if len(audio_data) > 25 * 1024 * 1024:
            return jsonify({'error': 'Audio file too large (max 25MB)'}), 400

        # Preserve original extension (.webm, .wav, .mp3, etc.)
        filename = secure_filename(file.filename) or 'audio.webm'
        ext = os.path.splitext(filename)[1] or '.webm'

        temp_dir = os.path.join(os.path.dirname(__file__), 'temp')
        os.makedirs(temp_dir, exist_ok=True)
        filepath = os.path.join(temp_dir, filename)

        print(f"[transcribe] filename: {filename}")
        print(f"[transcribe] filepath: {filepath}")
        print(f"[transcribe] size: {len(audio_data)} bytes")

        with open(filepath, 'wb') as f:
            f.write(audio_data)

        if not os.path.exists(filepath):
            return jsonify({'error': 'Failed to save audio file'}), 500

        try:
            transcription = whisper_transcribe(filepath)
        except Exception as whisper_err:
            print(f"[transcribe] Whisper error: {whisper_err}")
            return jsonify({'error': f'Whisper failed: {str(whisper_err)}'}), 500
        finally:
            try:
                os.remove(filepath)
            except Exception:
                pass

        return jsonify({'text': transcription, 'success': True})

    except Exception as e:
        print(f"[transcribe] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Transcription failed: ' + str(e)}), 500

@app.route('/api/attachments/<int:attachment_id>', methods=['DELETE'])
def delete_attachment(attachment_id):
    """Delete an attachment"""
    try:
        # Get attachment info
        attachment = db.get_attachment(attachment_id)
        if not attachment:
            return jsonify({'error': 'Attachment not found'}), 404
        
        # Delete file from filesystem
        if os.path.exists(attachment['file_path']):
            os.remove(attachment['file_path'])
        
        # Delete from database
        db.delete_attachment(attachment_id)
        
        return jsonify({'success': True, 'message': 'Attachment deleted successfully'})
    
    except Exception as e:
        print(f"Error in delete_attachment: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/attachments/<int:attachment_id>/open', methods=['GET'])
def open_attachment(attachment_id):
    """Open an attachment file"""
    try:
        attachment = db.get_attachment(attachment_id)
        
        if not attachment:
            return jsonify({'error': 'Attachment not found'}), 404
            
        file_path = attachment['file_path']
        
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found on disk', 'path': file_path}), 404
            
        return send_file(file_path, as_attachment=False)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/appointments', methods=['GET', 'POST'])
def appointments():
    """Handle appointments CRUD operations"""
    try:
        if request.method == 'GET':
            # Get appointments, optionally filtered by date
            date_filter = request.args.get('date')
            appointments = db.get_all_appointments(date_filter)
            return jsonify({'appointments': appointments})
        
        elif request.method == 'POST':
            # Create new appointment
            data = request.get_json()
            
            required_fields = ['patient_name', 'appointment_date', 'start_time', 'end_time']
            for field in required_fields:
                if not data.get(field):
                    return jsonify({'error': f'{field} is required'}), 400
            
            patient_id = data.get('patient_id')
            patient_name = data['patient_name']
            appointment_date = data['appointment_date']
            start_time = data['start_time']
            end_time = data['end_time']
            status = data.get('status', 'pending')
            
            force = data.get('force', False)
            if not force:
                if db.check_double_booking(appointment_date, start_time, end_time):
                    return jsonify({'error': 'This time slot is already booked'}), 409
                    
            appointment_id = db.add_appointment(
                patient_id, patient_name, appointment_date, 
                start_time, end_time, status
            )
            
            return jsonify({
                'success': True, 
                'appointment_id': appointment_id,
                'message': 'Appointment created successfully'
            })
    
    except Exception as e:
        print(f"Error in appointments: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/appointments/week', methods=['GET'])
def week_appointments():
    """Get appointments for a specific week"""
    try:
        date = request.args.get('date')
        if not date:
            return jsonify({'error': 'Date parameter is required'}), 400
        
        appointments = db.get_week_appointments(date)
        return jsonify({'appointments': appointments})
    
    except Exception as e:
        print(f"Error in week_appointments: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/appointments/<int:appointment_id>', methods=['GET', 'PUT', 'DELETE'])
def appointment_detail(appointment_id):
    """Handle individual appointment operations"""
    try:
        if request.method == 'GET':
            # Get appointment details
            appointment = db.get_appointment(appointment_id)
            if not appointment:
                return jsonify({'error': 'Appointment not found'}), 404
            return jsonify({'appointment': appointment})
        
        elif request.method == 'PUT':
            # Update appointment
            data = request.get_json()
            db.update_appointment(appointment_id, data)
            return jsonify({'success': True, 'message': 'Appointment updated successfully'})
        
        elif request.method == 'DELETE':
            # Delete appointment
            db.delete_appointment(appointment_id)
            return jsonify({'success': True, 'message': 'Appointment deleted successfully'})
    
    except Exception as e:
        print(f"Error in appointment_detail: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/medical-reference', methods=['POST'])
def medical_reference():
    try:
        data = request.get_json()
        question = data.get('question', '')
        category = data.get('category', 'General')
        
        if not question:
            return jsonify({'error': 'No question provided'}), 400
        
        system_prompt = """You are a professional medical reference assistant for doctors.
You provide accurate, concise, and clinically relevant medical information.

Rules:
- Answer only medical and clinical questions
- Be concise but complete
- Use bullet points for lists
- Include dosages, contraindications, and interactions when relevant
- Always mention when something requires clinical judgment
- Never give advice to patients — you assist doctors only
- Respond in the same language the doctor writes in (French or English)"""

        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Category: {category}\n\nQuestion: {question}"}
            ],
            max_tokens=1000
        )
        
        answer = response.choices[0].message.content
        return jsonify({'success': True, 'answer': answer}), 200
        
    except Exception as e:
        print(f"Medical reference error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/data/attachments/<path:filename>')
def serve_attachment(filename):
    """Serve attachment files from the user's data folder"""
    try:
        return send_from_directory(db.attachments_dir, filename)
    except Exception as e:
        print(f"Error serving file: {e}")
        return jsonify({'error': 'File not found'}), 404

# Analytics Endpoints
@app.route('/api/analytics/overview', methods=['GET'])
def analytics_overview():
    """Get overview statistics"""
    try:
        total_patients = db.get_total_patients_count()
        appointments_this_month = db.get_appointments_this_month_count()
        new_patients_this_month = db.get_new_patients_this_month_count()
        cancelled_appointments = db.get_cancelled_appointments_count()
        
        return jsonify({
            'total_patients': total_patients,
            'appointments_this_month': appointments_this_month,
            'new_patients_this_month': new_patients_this_month,
            'cancelled_appointments': cancelled_appointments
        })
    except Exception as e:
        print(f"Error in analytics_overview: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/analytics/patient-growth', methods=['GET'])
def patient_growth():
    """Get patient growth data for last 6 months"""
    try:
        growth_data = db.get_patient_growth_last_6_months()
        return jsonify(growth_data)
    except Exception as e:
        print(f"Error in patient_growth: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/analytics/appointments-by-month', methods=['GET'])
def appointments_by_month():
    """Get appointments data for last 6 months"""
    try:
        appointments_data = db.get_appointments_by_month_last_6_months()
        return jsonify(appointments_data)
    except Exception as e:
        print(f"Error in appointments_by_month: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/analytics/status-distribution', methods=['GET'])
def status_distribution():
    """Get patient status distribution"""
    try:
        status_data = db.get_patient_status_distribution()
        return jsonify(status_data)
    except Exception as e:
        print(f"Error in status_distribution: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/analytics/appointment-status', methods=['GET'])
def appointment_status():
    """Get appointment status distribution"""
    try:
        appointment_status_data = db.get_appointment_status_distribution()
        return jsonify(appointment_status_data)
    except Exception as e:
        print(f"Error in appointment_status: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/analytics/busiest-days', methods=['GET'])
def busiest_days():
    """Get busiest days of week"""
    try:
        busiest_days_data = db.get_busiest_days_of_week()
        return jsonify(busiest_days_data)
    except Exception as e:
        print(f"Error in busiest_days: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/analytics/recent-activity', methods=['GET'])
def recent_activity():
    """Get recent activity from patients and appointments"""
    try:
        activity_data = db.get_recent_activity()
        return jsonify(activity_data)
    except Exception as e:
        print(f"Error in recent_activity: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=False, host='127.0.0.1', port=5000, use_reloader=False)
