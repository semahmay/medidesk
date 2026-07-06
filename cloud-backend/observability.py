"""
observability.py — Backward-compatible wrapper.
Logic moved to services/observability.py. Re-exports for existing imports.
"""
from services.observability import (
    setup_observability, _report_to_sentry,
    track_sync_failure, track_sync_success, get_sync_metrics, get_system_metrics,
)
