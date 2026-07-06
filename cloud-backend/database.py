"""
database.py — Backward-compatible wrapper.
All logic moved to core/db.py. This file re-exports for existing imports.
"""
from core.db import engine, SessionLocal, Base, get_db, init_db
