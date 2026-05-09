import os
import shutil
from datetime import datetime

def get_patient_attachments_dir(patient_id):
    """Get the attachments directory for a patient"""
    base_dir = "../data/attachments"
    patient_dir = os.path.join(base_dir, str(patient_id))
    os.makedirs(patient_dir, exist_ok=True)
    return patient_dir

def save_attachment(patient_id, file, filename=None):
    """
    Save an attachment for a patient
    """
    try:
        if filename is None:
            filename = file.filename
        
        patient_dir = get_patient_attachments_dir(patient_id)
        
        # Generate unique filename to avoid conflicts
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        name, ext = os.path.splitext(filename)
        unique_filename = f"{name}_{timestamp}{ext}"
        
        file_path = os.path.join(patient_dir, unique_filename)
        
        # Save the file
        with open(file_path, 'wb') as f:
            shutil.copy2obj(file, f)
        
        return {
            'file_name': unique_filename,
            'file_path': file_path,
            'file_type': ext[1:] if ext else 'unknown'
        }
    
    except Exception as e:
        print(f"Error saving attachment: {e}")
        raise e

def delete_attachment(patient_id, file_path):
    """
    Delete an attachment
    """
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            return True
        return False
    except Exception as e:
        print(f"Error deleting attachment: {e}")
        raise e

def get_file_type(filename):
    """
    Determine file type from filename
    """
    ext = os.path.splitext(filename)[1].lower()
    
    if ext in ['.jpg', '.jpeg', '.png', '.gif', '.bmp']:
        return 'image'
    elif ext == '.pdf':
        return 'pdf'
    elif ext in ['.doc', '.docx']:
        return 'document'
    elif ext in ['.txt', '.md']:
        return 'text'
    else:
        return 'other'
