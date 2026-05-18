import re
import random
from models import Clinic

MAX_STRING_LENGTH = 10000
MAX_NAME_LENGTH = 255

def generate_clinic_id(db) -> str:
    """
    Generate a unique clinic ID in the format MEDI-XXXXX.
    Retries until a non-colliding ID is found.
    """
    while True:
        digits = str(random.randint(10000, 99999))
        clinic_id = f"MEDI-{digits}"
        exists = db.query(Clinic).filter_by(id=clinic_id).first()
        if not exists:
            return clinic_id


def sanitize_string(value, max_length=MAX_STRING_LENGTH):
    """Sanitize string input to prevent injection attacks."""
    if value is None:
        return None
    if not isinstance(value, str):
        return str(value)
    # Remove null bytes and control characters
    sanitized = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', value)
    return sanitized[:max_length]


def validate_name(name, required=True, max_length=MAX_NAME_LENGTH):
    """Validate and sanitize name input."""
    if not name:
        if required:
            raise ValueError("Name is required")
        return None
    if not isinstance(name, str):
        raise ValueError("Name must be a string")
    name = name.strip()
    if len(name) > max_length:
        raise ValueError(f"Name exceeds maximum length of {max_length}")
    # Allow only letters, numbers, spaces, hyphens, apostrophes, and dots
    if not re.match(r"^[\w\s\-\.\']+$", name):
        raise ValueError("Name contains invalid characters")
    return name


def validate_clinic_id(clinic_id):
    """Validate clinic ID format."""
    if not clinic_id or not isinstance(clinic_id, str):
        raise ValueError("Invalid clinic ID")
    clinic_id = clinic_id.strip().upper()
    if not re.match(r'^MEDI-\d{5}$', clinic_id):
        raise ValueError("Invalid clinic ID format")
    return clinic_id


def validate_email(email):
    """Validate email format."""
    if not email:
        return None
    email = email.strip().lower()
    if not re.match(r'^[\w\.\-]+@[\w\.\-]+\.\w+$', email):
        raise ValueError("Invalid email format")
    return email[:255]


def validate_phone(phone):
    """Validate phone number format."""
    if not phone:
        return None
    # Remove common formatting characters
    phone = re.sub(r'[\s\-\(\)\.]', '', phone)
    if not re.match(r'^\+?[\d\s]{7,20}$', phone):
        raise ValueError("Invalid phone number format")
    return phone[:20]
