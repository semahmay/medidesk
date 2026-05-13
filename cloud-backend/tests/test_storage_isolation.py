"""
test_storage_isolation.py — Verify file storage clinic isolation and security.
"""

import pytest
import uuid
import os
import tempfile
from pathlib import Path
from storage_service import LocalStorage, _sanitize_filename, _clinic_key, _validate_extension


# ── Unit tests for sanitization ───────────────────────────────────────────────

def test_path_traversal_blocked():
    """Path traversal attempts must be neutralized."""
    assert _sanitize_filename("../../etc/passwd") == "passwd"
    assert _sanitize_filename("../other_clinic/file.pdf") == "file.pdf"
    assert _sanitize_filename("/absolute/path/file.pdf") == "file.pdf"


def test_null_byte_removed():
    assert "\x00" not in _sanitize_filename("file\x00.pdf")


def test_extension_allowlist():
    assert _validate_extension("report.pdf") is True
    assert _validate_extension("photo.jpg") is True
    assert _validate_extension("script.exe") is False
    assert _validate_extension("shell.sh") is False
    assert _validate_extension("noextension") is False


def test_clinic_key_isolation():
    """Keys for different clinics must never overlap."""
    key_a = _clinic_key("MEDI-00001", "file.pdf")
    key_b = _clinic_key("MEDI-00002", "file.pdf")
    assert key_a != key_b
    assert key_a.startswith("MEDI-00001/")
    assert key_b.startswith("MEDI-00002/")


def test_clinic_id_injection_blocked():
    """Malicious clinic_id must be sanitized in the key."""
    key = _clinic_key("../other_clinic", "file.pdf")
    assert ".." not in key
    assert "/" not in key.split("/")[0]  # prefix must be safe


# ── Integration tests for LocalStorage ───────────────────────────────────────

@pytest.fixture
def local_storage(tmp_path):
    os.environ["LOCAL_STORAGE_PATH"] = str(tmp_path)
    return LocalStorage()


def test_save_and_retrieve(local_storage):
    data = b"test file content"
    local_storage.save("CLINIC-A", "test.pdf", data, "application/pdf")
    retrieved = local_storage.get("CLINIC-A", "test.pdf")
    assert retrieved == data


def test_cross_clinic_access_blocked(local_storage):
    """Clinic A's file must not be accessible via clinic B's path."""
    local_storage.save("CLINIC-A", "secret.pdf", b"secret data", "application/pdf")
    # Clinic B tries to access clinic A's file
    result = local_storage.get("CLINIC-B", "secret.pdf")
    assert result is None


def test_file_too_large_rejected(local_storage):
    large_data = b"x" * (26 * 1024 * 1024)  # 26MB
    with pytest.raises(ValueError, match="too large"):
        local_storage.save("CLINIC-A", "huge.pdf", large_data)


def test_invalid_extension_rejected(local_storage):
    with pytest.raises(ValueError, match="not allowed"):
        local_storage.save("CLINIC-A", "malware.exe", b"bad", "application/octet-stream")


def test_delete_removes_file(local_storage):
    local_storage.save("CLINIC-A", "todelete.pdf", b"data", "application/pdf")
    assert local_storage.get("CLINIC-A", "todelete.pdf") is not None
    local_storage.delete("CLINIC-A", "todelete.pdf")
    assert local_storage.get("CLINIC-A", "todelete.pdf") is None


def test_list_files_scoped(local_storage):
    local_storage.save("CLINIC-X", "file1.pdf", b"a", "application/pdf")
    local_storage.save("CLINIC-X", "file2.jpg", b"b", "image/jpeg")
    local_storage.save("CLINIC-Y", "other.pdf", b"c", "application/pdf")

    files_x = local_storage.list_files("CLINIC-X")
    assert "file1.pdf" in files_x
    assert "file2.jpg" in files_x
    assert "other.pdf" not in files_x
