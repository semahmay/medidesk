"""
whisper_service.py — cross-platform Whisper transcription.

No hardcoded paths. Works on Windows, macOS, and Linux.
ffmpeg must be installed and available on the system PATH.
"""

import os
import shutil
import tempfile
import whisper

# ── ffmpeg check ──────────────────────────────────────────────────────────────

def _ffmpeg_available() -> bool:
    """Return True if ffmpeg is reachable on the system PATH."""
    return shutil.which("ffmpeg") is not None


# ── model (loaded once at startup) ───────────────────────────────────────────

print("[whisper] Loading model at startup...")
_model = whisper.load_model("base")
print("[whisper] Model loaded.")


# ── public API ────────────────────────────────────────────────────────────────

def transcribe_audio(audio_path: str) -> str:
    """
    Transcribe an audio file at `audio_path`.

    Copies the file to a guaranteed ASCII-safe temp path before processing
    to avoid encoding issues on Windows with non-ASCII usernames.

    Raises RuntimeError if ffmpeg is not found.
    Raises any exception from Whisper on transcription failure.
    """
    if not _ffmpeg_available():
        raise RuntimeError(
            "ffmpeg not found on PATH. "
            "Install ffmpeg and make sure it is accessible from the command line. "
            "See https://ffmpeg.org/download.html"
        )

    # Use a temp file with a plain ASCII name to avoid charmap issues on Windows
    suffix = os.path.splitext(audio_path)[1] or ".webm"
    tmp_fd, safe_path = tempfile.mkstemp(suffix=suffix, prefix="whisper_")
    os.close(tmp_fd)

    try:
        shutil.copy2(audio_path, safe_path)

        print(f"[whisper] Transcribing: {safe_path}")
        print(f"[whisper] File size: {os.path.getsize(safe_path)} bytes")

        result = _model.transcribe(safe_path)
        text = result["text"].strip()
        print(f"[whisper] Result: {text[:100]}")
        return text

    except Exception as e:
        print(f"[whisper] ERROR: {e}")
        import traceback
        traceback.print_exc()
        raise

    finally:
        try:
            if os.path.exists(safe_path):
                os.remove(safe_path)
        except Exception:
            pass
