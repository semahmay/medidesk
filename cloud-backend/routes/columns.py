"""
routes/columns.py — Custom column management endpoints.
"""

from flask import Blueprint, request, jsonify, g
from datetime import datetime
import uuid

from core.db import get_db
from models import ClinicColumn
from services.auth_service import verify_jwt, require_role
from core.extensions import limiter
from validation import validation_error, get_json_body, require_fields

bp = Blueprint("columns", __name__, url_prefix="/api/columns")


@bp.route("", methods=["GET"])
@verify_jwt
@require_role("doctor")
@limiter.limit("60 per minute")
def get_columns():
    db = get_db()
    try:
        cols = db.query(ClinicColumn).filter_by(clinic_id=g.clinic_id).order_by(ClinicColumn.created_at).all()
        defaults = [
            {"id": "default_full_name",   "column_name": "full_name",   "column_type": "text",   "is_default": True},
            {"id": "default_phone",       "column_name": "phone",       "column_type": "text",   "is_default": True},
            {"id": "default_appointment", "column_name": "appointment", "column_type": "text",   "is_default": True},
            {"id": "default_status",      "column_name": "status",      "column_type": "text",   "is_default": True},
            {"id": "default_notes",       "column_name": "notes",       "column_type": "text",   "is_default": True},
        ]
        custom = [{"id": c.id, "column_name": c.column_name, "column_type": c.column_type, "is_default": False} for c in cols]
        return jsonify({"columns": defaults + custom})
    finally:
        db.close()


@bp.route("", methods=["POST"])
@verify_jwt
@require_role("doctor")
@limiter.limit("20 per minute")
def create_column():
    data, err = get_json_body()
    if err:
        return err

    missing = require_fields(data, "name", "type")
    if missing:
        return validation_error(f"{missing} is required")

    name = data.get("name", "").strip()
    col_type = data.get("type", "").strip()

    if not isinstance(name, str):
        return validation_error("name must be a string")
    if not isinstance(col_type, str):
        return validation_error("type must be a string")
    if col_type not in ("text", "number", "date", "boolean"):
        return validation_error("type must be text, number, date, or boolean")

    db = get_db()
    try:
        existing = db.query(ClinicColumn).filter_by(clinic_id=g.clinic_id, column_name=name).first()
        if existing:
            return jsonify({"error": f"Column '{name}' already exists", "code": "CONFLICT"}), 409

        col = ClinicColumn(
            id=str(uuid.uuid4()),
            clinic_id=g.clinic_id,
            column_name=name,
            column_type=col_type,
        )
        db.add(col)
        db.commit()
        return jsonify({"success": True, "column": {
            "id": col.id, "column_name": col.column_name,
            "column_type": col.column_type, "is_default": False,
        }}), 201

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()


@bp.route("/<column_id>", methods=["DELETE"])
@verify_jwt
@require_role("doctor")
@limiter.limit("20 per minute")
def delete_column(column_id):
    db = get_db()
    try:
        col = db.query(ClinicColumn).filter_by(id=column_id, clinic_id=g.clinic_id).first()
        if not col:
            return jsonify({"error": "Column not found", "code": "NOT_FOUND"}), 404
        db.delete(col)
        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()
