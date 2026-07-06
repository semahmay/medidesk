"""
storage_service.py — Backward-compatible wrapper.
Logic moved to services/storage_service.py. Re-exports for existing imports.
"""
from services.storage_service import ALLOWED_EXTENSIONS, MAX_FILE_SIZE, storage, LocalStorage, S3Storage
