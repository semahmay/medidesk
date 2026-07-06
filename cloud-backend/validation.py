"""
validation.py — Backward-compatible wrapper.
Logic moved to core/validation.py. Re-exports for existing imports.
"""
from core.validation import (
    validation_error, get_json_body, require_fields,
    validate_string, validate_integer, validate_version,
    validate_custom_fields, validate_enum, validate_time_string,
    sanitize_update_dict,
)
