import random
from models import Clinic


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
