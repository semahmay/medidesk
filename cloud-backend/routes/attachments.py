"""
routes/attachments.py — File attachment endpoints (S3 + local storage).
"""

from flask import Blueprint, request, jsonify, g, send_file
import os
import io

from core.db import get_db
from models import Patient
from services.auth_service import verify_jwt, require_role
from core.extensions import limiter
from services.storage_service import storage, MAX_FILE_SIZE

bp = Blueprint("attachments", __name__, url_prefix="/api")


@bp.route("/v2/attachments/<clinic_id_param>/<filename>", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def serve_cloud_attachment(clinic_id_param, filename):
    if g.clinic_id != clinic_id_param:
        return jsonify({"error": "Forbidden", "code": "FORBIDDEN"}), 403
    try:
        result = storage.serve(clinic_id_param, filename)
        return result
    except Exception as e:
        return jsonify({"error": str(e), "code": "NOT_FOUND"}), 404


@bp.route("/v2/attachments/<clinic_id_param>", methods=["POST"])
@verify_jwt
@limiter.limit("20 per minute")
def upload_cloud_attachment(clinic_id_param):
    if g.clinic_id != clinic_id_param:
        return jsonify({"error": "Forbidden", "code": "FORBIDDEN"}), 403

    if "file" not in request.files:
        return jsonify({"error": "No file provided", "code": "VALIDATION_ERROR"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "No file selected", "code": "VALIDATION_ERROR"}), 400

    filename = os.path.basename(file.filename)
    if not filename:
        return jsonify({"error": "Invalid filename", "code": "VALIDATION_ERROR"}), 400

    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)
    if file_size > MAX_FILE_SIZE:
        return jsonify({"error": f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB.", "code": "VALIDATION_ERROR"}), 400

    ALLOWED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg", "gif", "webp"}
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"error": f"File type '{ext}' is not allowed. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}", "code": "VALIDATION_ERROR"}), 400

    import uuid as _uuid
    patient_global_id = request.form.get("patient_global_id") or _uuid.uuid4().hex

    try:
        file_url = storage.save(clinic_id_param, filename, file, patient_global_id=patient_global_id)
        return jsonify({"success": True, "url": file_url}), 201
    except Exception as e:
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500


@bp.route("/v2/attachments/<clinic_id_param>/<filename>", methods=["DELETE"])
@verify_jwt
def delete_cloud_attachment(clinic_id_param, filename):
    if g.clinic_id != clinic_id_param:
        return jsonify({"error": "Forbidden", "code": "FORBIDDEN"}), 403
    deleted = storage.delete(clinic_id_param, filename)
    if not deleted:
        return jsonify({"error": "File not found", "code": "NOT_FOUND"}), 404
    return jsonify({"success": True})


@bp.route("/v2/attachments/<clinic_id_param>/usage", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def get_storage_usage(clinic_id_param):
    if g.clinic_id != clinic_id_param:
        return jsonify({"error": "Forbidden", "code": "FORBIDDEN"}), 403
    try:
        usage = storage.get_usage(clinic_id_param)
        return jsonify(usage)
    except Exception as e:
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500


@bp.route("/patients/<int:patient_id>/attachments", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def list_attachments(patient_id):
    db = get_db()
    try:
        patient = db.query(Patient).filter(
            Patient.id == patient_id,
            Patient.clinic_id == g.clinic_id,
        ).first()
        if not patient:
            return jsonify({"error": "Patient not found", "code": "NOT_FOUND"}), 404

        prefix = f"{g.clinic_id}/{patient.global_id}/"
        files = storage.list(prefix)
        return jsonify({"files": files})
    finally:
        db.close()


@bp.route("/patients/<int:patient_id>/attachments", methods=["POST"])
@verify_jwt
@limiter.limit("20 per minute")
def upload_attachment(patient_id):
    db = get_db()
    try:
        patient = db.query(Patient).filter(
            Patient.id == patient_id,
            Patient.clinic_id == g.clinic_id,
        ).first()
        if not patient:
            return jsonify({"error": "Patient not found", "code": "NOT_FOUND"}), 404

        if "file" not in request.files:
            return jsonify({"error": "No file provided", "code": "VALIDATION_ERROR"}), 400

        file = request.files["file"]
        if not file.filename:
            return jsonify({"error": "No file selected", "code": "VALIDATION_ERROR"}), 400

        filename = os.path.basename(file.filename)
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)

        if file_size > MAX_FILE_SIZE:
            return jsonify({"error": f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB.", "code": "VALIDATION_ERROR"}), 400

        file_url = storage.save(g.clinic_id, filename, file, patient_global_id=patient.global_id)
        return jsonify({"success": True, "url": file_url}), 201
    except Exception as e:
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        db.close()


@bp.route("/attachments/<path:file_id>", methods=["DELETE"])
@verify_jwt
@limiter.limit("30 per minute")
def delete_attachment(file_id):
    deleted = storage.delete(g.clinic_id, file_id)
    if not deleted:
        return jsonify({"error": "File not found", "code": "NOT_FOUND"}), 404
    return jsonify({"success": True})


@bp.route("/attachments/<path:file_id>/open", methods=["GET"])
@verify_jwt
@limiter.limit("60 per minute")
def open_attachment(file_id):
    data = storage.open(g.clinic_id, file_id)
    if data is None:
        return jsonify({"error": "File not found", "code": "NOT_FOUND"}), 404

    ext = file_id.rsplit(".", 1)[-1].lower() if "." in file_id else ""
    mime = {
        "pdf": "application/pdf",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
    }.get(ext, "application/octet-stream")

    return send_file(io.BytesIO(data), mimetype=mime)
