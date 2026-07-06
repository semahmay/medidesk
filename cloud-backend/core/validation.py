"""
core/validation.py — Request body validation helpers for all routes.
"""
from flask import jsonify, request
from datetime import datetime


def validation_error(detail=None):
    body = {"error": "Validation failed", "code": "INVALID_PAYLOAD"}
    if detail is not None:
        body["detail"] = detail
    return jsonify(body), 400


def get_json_body(required=True):
    data = request.get_json(silent=True)
    if required and data is None:
        return None, validation_error("Request body must be valid JSON")
    return (data if data is not None else {}), None


def require_fields(data, *fields):
    for field in fields:
        val = data.get(field)
        if val is None:
            return field
        if isinstance(val, str) and not val.strip():
            return field
    return None


def validate_string(value, field_name, max_length=10000, allow_empty=False):
    if value is None:
        return None
    if not isinstance(value, str):
        return f"{field_name} must be a string"
    if not allow_empty and not value.strip():
        return f"{field_name} must not be empty"
    if len(value) > max_length:
        return f"{field_name} exceeds maximum length of {max_length}"
    return None


def validate_integer(value, field_name, minimum=None):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        return f"{field_name} must be an integer"
    if minimum is not None and value < minimum:
        return f"{field_name} must be >= {minimum}"
    return None


def validate_version(version):
    if version is None:
        return None
    err = validate_integer(version, "version", minimum=0)
    if err:
        return err
    return None


def validate_custom_fields(cf):
    if cf is None:
        return None
    if not isinstance(cf, dict):
        return "custom_fields must be a JSON object"
    for key, value in cf.items():
        if not isinstance(key, str):
            return f"custom_fields key must be a string, got {type(key).__name__}"
        if value is not None and not isinstance(value, (str, int, float, bool)):
            return f"custom_fields.{key} contains unsupported type {type(value).__name__}"
    return None


def validate_enum(value, field_name, allowed_values):
    if value is None:
        return None
    if value not in allowed_values:
        return f"{field_name} must be one of: {', '.join(allowed_values)}"
    return None


def validate_time_string(value, field_name):
    if value is None:
        return None
    if not isinstance(value, str):
        return f"{field_name} must be a string"
    if not value.strip():
        return f"{field_name} must not be empty"
    return None


def sanitize_update_dict(data, allowed_fields):
    result = {}
    for field in allowed_fields:
        if field in data:
            if data[field] is not None:
                result[field] = data[field]
    return result
