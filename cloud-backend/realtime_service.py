"""
realtime_service.py — Backward-compatible wrapper.
Logic moved to services/realtime_service.py. Re-exports for existing imports.
"""
from services.realtime_service import socketio, emit_to_clinic, on_connect, on_disconnect, on_rejoin, on_ping
