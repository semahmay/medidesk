"""
routes/medical.py — AI: Chat, Medical Reference, Transcription.
"""

from flask import Blueprint, request, jsonify, g
import os

from services.auth_service import verify_jwt, require_role
from core.extensions import limiter
from validation import validation_error, get_json_body, require_fields

bp = Blueprint("medical", __name__, url_prefix="/api")


@bp.route("/chat", methods=["POST"])
@verify_jwt
@require_role("doctor")
@limiter.limit("30 per minute")
def ai_chat():
    GROQ_API_KEY = os.getenv("GROQ_API_KEY")
    if not GROQ_API_KEY:
        return jsonify({"error": "AI features are not configured on this server. Set GROQ_API_KEY.", "code": "SERVICE_UNAVAILABLE"}), 503

    data, err = get_json_body()
    if err:
        return err

    message = data.get("message", "").strip()
    patient = data.get("patient_context") or {}

    if not message or not isinstance(message, str):
        return validation_error("message is required and must be a string")

    try:
        from groq import Groq
        client = Groq(api_key=GROQ_API_KEY)

        if patient:
            system_prompt = f"""You are a concise medical AI assistant helping a doctor.
Patient information:
- Name: {patient.get('full_name', '')}
- Status: {patient.get('status', '')}
- Appointment: {patient.get('appointment', '')}
- Notes: {patient.get('notes', '')}

Rules:
- Answer ONLY what the doctor asked — nothing more
- Keep responses to 3-5 sentences maximum
- Do not add sections the doctor didn't ask for
- Do not use headers or bullet points unless specifically asked
- Be direct and clinical
- You assist the doctor, you do not replace them"""
        else:
            system_prompt = (
                "You are a concise medical AI assistant helping a doctor. "
                "Be direct and clinical. Keep responses to 3-5 sentences maximum."
            )

        resp = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            max_tokens=1000,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "Doctor's Question: " + message},
            ],
        )
        return jsonify({"response": resp.choices[0].message.content})

    except Exception as e:
        return jsonify({"error": f"AI request failed: {str(e)}", "code": "INTERNAL_ERROR"}), 500


@bp.route("/medical-reference", methods=["POST"])
@verify_jwt
@require_role("doctor")
@limiter.limit("30 per minute")
def medical_reference():
    GROQ_API_KEY = os.getenv("GROQ_API_KEY")
    if not GROQ_API_KEY:
        return jsonify({"error": "AI features are not configured on this server. Set GROQ_API_KEY.", "code": "SERVICE_UNAVAILABLE"}), 503

    data, err = get_json_body()
    if err:
        return err

    question = data.get("question", "").strip()
    if not question or not isinstance(question, str):
        return validation_error("question is required and must be a string")

    category = data.get("category", "General")

    try:
        from groq import Groq
        client = Groq(api_key=GROQ_API_KEY)

        system_prompt = (
            "You are a medical reference AI assistant. "
            "Provide accurate, evidence-based medical information. "
            "Keep responses concise and clinical. "
            "Always note when a question requires immediate in-person consultation."
        )

        resp = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            max_tokens=1500,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Category: {category}\n\nQuestion: {question}"},
            ],
        )
        return jsonify({"response": resp.choices[0].message.content, "category": category})

    except Exception as e:
        return jsonify({"error": f"Medical reference request failed: {str(e)}", "code": "INTERNAL_ERROR"}), 500


@bp.route("/transcribe", methods=["POST"])
@verify_jwt
@require_role("doctor")
@limiter.limit("20 per minute")
def transcribe_audio():
    GROQ_API_KEY = os.getenv("GROQ_API_KEY")
    if not GROQ_API_KEY:
        return jsonify({"error": "AI features are not configured on this server. Set GROQ_API_KEY.", "code": "SERVICE_UNAVAILABLE"}), 503

    if "file" not in request.files:
        return jsonify({"error": "No audio file provided", "code": "VALIDATION_ERROR"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "No file selected", "code": "VALIDATION_ERROR"}), 400

    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)

    MAX_SIZE = 25 * 1024 * 1024
    if file_size > MAX_SIZE:
        return jsonify({"error": "File too large. Maximum size is 25MB.", "code": "VALIDATION_ERROR"}), 400

    if file_size == 0:
        return jsonify({"error": "Empty file", "code": "VALIDATION_ERROR"}), 400

    try:
        from groq import Groq
        client = Groq(api_key=GROQ_API_KEY)
        # Stream file content to avoid loading entire file into memory
        transcription = client.audio.transcriptions.create(
            model="whisper-large-v3",
            file=(file.filename, file.stream, file.content_type or "audio/webm"),
        )
        return jsonify({"text": transcription.text})
    except Exception as e:
        return jsonify({"error": f"Transcription failed: {str(e)}", "code": "INTERNAL_ERROR"}), 500
