"""
core/serializer.py — SQLAlchemy model serialisation helper.
"""
from datetime import datetime, date as Date, time as Time

_SENSITIVE_FIELDS = frozenset({"password_hash"})


def serialize(obj):
    result = {}
    for col in obj.__table__.columns:
        if col.name in _SENSITIVE_FIELDS:
            continue
        val = getattr(obj, col.name)
        if col.name == "custom_fields" and val is None:
            val = {}
        if isinstance(val, (datetime, Date, Time)):
            val = val.isoformat()
        result[col.name] = val
    return result
