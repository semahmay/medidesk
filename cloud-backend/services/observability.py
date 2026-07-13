"""
observability.py — Request logging, Sentry error tracking, and metrics.

Provides:
  1. Per-request structured JSON logging (clinic_id, user_id, latency, status)
  2. Sentry error tracking — active when SENTRY_DSN env var is set
  3. Sync failure/success metrics stored in Redis
  4. /api/metrics endpoint (doctor-only) for sync dashboard
  5. /api/admin/metrics endpoint (doctor-only) for system health dashboard

Sentry setup:
  Set SENTRY_DSN=https://xxx@sentry.io/yyy in .env to enable.
  Leave unset to disable (no-op, no import errors).
"""

import os
import time
import json
import logging
import traceback
from datetime import datetime, timezone
from flask import Flask, request, g, jsonify

logger = logging.getLogger("medidesk")

# ── Sentry initialization ─────────────────────────────────────────────────────
# Initialised once at module load. Safe to call even if sentry_sdk is not
# installed — the try/except handles it gracefully.

_sentry_enabled = False

def _init_sentry():
    global _sentry_enabled
    dsn = os.getenv("SENTRY_DSN", "").strip()
    if not dsn:
        return  # Sentry disabled — no DSN configured

    try:
        import sentry_sdk
        from sentry_sdk.integrations.flask import FlaskIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

        sentry_sdk.init(
            dsn=dsn,
            integrations=[
                FlaskIntegration(transaction_style="url"),
                SqlalchemyIntegration(),
            ],
            # Capture 10% of transactions for performance monitoring
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
            # Never send PII (patient data) to Sentry
            send_default_pii=False,
            environment=os.getenv("FLASK_ENV", "production"),
            release=os.getenv("APP_VERSION", "1.0.0"),
            # Scrub sensitive fields from breadcrumbs
            before_send=_scrub_sentry_event,
        )
        _sentry_enabled = True
        logger.info("[observability] Sentry error tracking enabled")
    except ImportError:
        logger.warning("[observability] sentry-sdk not installed — error tracking disabled")
    except Exception as e:
        logger.warning(f"[observability] Sentry init failed: {e}")


def _scrub_sentry_event(event, hint):
    """Remove sensitive fields before sending to Sentry."""
    _SCRUB = {"password", "password_hash", "token", "access_token",
              "refresh_token", "jwt", "authorization", "cookie"}
    def scrub(obj):
        if isinstance(obj, dict):
            return {k: ("***" if k.lower() in _SCRUB else scrub(v))
                    for k, v in obj.items()}
        if isinstance(obj, list):
            return [scrub(i) for i in obj]
        return obj
    return scrub(event)


_init_sentry()


# ── Structured logging ────────────────────────────────────────────────────────

def setup_observability(app: Flask) -> None:
    """Attach request logging and error handlers to the Flask app."""

    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, log_level, logging.INFO),
        format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":%(message)s}',
        datefmt="%Y-%m-%dT%H:%M:%SZ",
    )

    @app.before_request
    def _before():
        g._req_start = time.monotonic()

    @app.after_request
    def _after(response):
        duration_ms = round(
            (time.monotonic() - getattr(g, "_req_start", time.monotonic())) * 1000, 1
        )
        clinic_id = getattr(g, "clinic_id", None)
        user_id   = getattr(g, "user_id",   None)
        role      = getattr(g, "role",       None)

        log_entry = {
            "method":      request.method,
            "path":        request.path,
            "status":      response.status_code,
            "duration_ms": duration_ms,
            "clinic_id":   clinic_id,
            "user_id":     user_id,
            "role":        role,
            "ip":          request.remote_addr,
        }

        if response.status_code >= 500:
            logger.error(json.dumps(log_entry))
            _track_request_metric("5xx", duration_ms, clinic_id)
        elif response.status_code >= 400:
            logger.warning(json.dumps(log_entry))
            _track_request_metric("4xx", duration_ms, clinic_id)
        elif request.path != "/api/health":
            logger.info(json.dumps(log_entry))
            _track_request_metric("2xx", duration_ms, clinic_id)

        return response

    @app.errorhandler(Exception)
    def _unhandled(e):
        clinic_id = getattr(g, "clinic_id", "unknown")
        logger.error(json.dumps({
            "event":     "unhandled_exception",
            "clinic_id": clinic_id,
            "path":      request.path,
            "error":     str(e),
            "traceback": traceback.format_exc()[-500:],
        }))
        _report_to_sentry(e)
        return jsonify({"error": "Internal server error"}), 500

    @app.errorhandler(429)
    def _rate_limited(e):
        clinic_id = getattr(g, "clinic_id", "unknown")
        logger.warning(json.dumps({
            "event":     "rate_limited",
            "clinic_id": clinic_id,
            "path":      request.path,
            "ip":        request.remote_addr,
        }))
        return jsonify({"error": "Too many requests. Please slow down."}), 429


def _report_to_sentry(exc: Exception) -> None:
    """Send exception to Sentry if enabled."""
    if not _sentry_enabled:
        return
    try:
        import sentry_sdk
        sentry_sdk.capture_exception(exc)
    except Exception:
        pass


# ── Request metrics (stored in Redis) ─────────────────────────────────────────

# Shared Redis connection - reuse across metric calls to avoid connection churn
_metrics_redis = None

def _get_redis():
    global _metrics_redis
    if _metrics_redis is not None:
        return _metrics_redis
    redis_url = os.getenv("REDIS_URL")
    if not redis_url:
        return None
    try:
        import redis
        _metrics_redis = redis.from_url(redis_url, decode_responses=True, socket_connect_timeout=1)
        return _metrics_redis
    except Exception:
        return None


def _track_request_metric(status_class: str, duration_ms: float, clinic_id: str = None) -> None:
    """Track request counts and latency in Redis for the metrics dashboard."""
    r = _get_redis()
    if not r:
        return
    try:
        pipe = r.pipeline(transaction=False)
        # Global counters
        pipe.incr(f"req:{status_class}:total")
        pipe.expire(f"req:{status_class}:total", 86400 * 7)
        # Latency histogram bucket (rough)
        bucket = "fast" if duration_ms < 100 else "medium" if duration_ms < 500 else "slow"
        pipe.incr(f"req:latency:{bucket}")
        pipe.expire(f"req:latency:{bucket}", 86400 * 7)
        # Per-clinic counters
        if clinic_id:
            pipe.incr(f"req:clinic:{clinic_id}:{status_class}")
            pipe.expire(f"req:clinic:{clinic_id}:{status_class}", 86400 * 7)
        pipe.execute()
    except Exception:
        pass


# ── Sync metrics ──────────────────────────────────────────────────────────────

def track_sync_failure(clinic_id: str, action: str, global_id: str, error: str) -> None:
    r = _get_redis()
    if not r:
        return
    try:
        entry = json.dumps({
            "ts":        datetime.now(timezone.utc).isoformat(),
            "action":    action,
            "global_id": global_id,
            "error":     error[:200],
        })
        key = f"sync_failures:{clinic_id}"
        r.zadd(key, {entry: time.time()})
        r.zremrangebyrank(key, 0, -101)
        r.expire(key, 86400 * 7)
        r.incr(f"sync_failure_count:{clinic_id}")
    except Exception:
        pass


def track_sync_success(clinic_id: str, action: str) -> None:
    r = _get_redis()
    if not r:
        return
    try:
        r.incr(f"sync_success_count:{clinic_id}")
        r.expire(f"sync_success_count:{clinic_id}", 86400 * 7)
    except Exception:
        pass


def get_sync_metrics(clinic_id: str) -> dict:
    r = _get_redis()
    if not r:
        return {"error": "Redis not available"}
    try:
        failures_raw  = r.zrange(f"sync_failures:{clinic_id}", 0, -1)
        failures      = [json.loads(f) for f in failures_raw]
        failure_count = int(r.get(f"sync_failure_count:{clinic_id}") or 0)
        success_count = int(r.get(f"sync_success_count:{clinic_id}") or 0)
        total         = failure_count + success_count
        success_rate  = round((success_count / total * 100), 1) if total > 0 else 100.0
        return {
            "clinic_id":       clinic_id,
            "success_count":   success_count,
            "failure_count":   failure_count,
            "success_rate":    success_rate,
            "recent_failures": failures[-10:],
        }
    except Exception as e:
        return {"error": str(e)}


def get_system_metrics() -> dict:
    """
    Return system-wide metrics for the admin dashboard.
    Includes request counts, latency distribution, DB connections, Redis info.
    """
    r = _get_redis()
    metrics = {
        "sentry_enabled": _sentry_enabled,
        "requests":       {},
        "latency":        {},
        "db":             {},
        "redis":          {},
    }

    if r:
        try:
            metrics["requests"] = {
                "2xx": int(r.get("req:2xx:total") or 0),
                "4xx": int(r.get("req:4xx:total") or 0),
                "5xx": int(r.get("req:5xx:total") or 0),
            }
            metrics["latency"] = {
                "fast_under_100ms":   int(r.get("req:latency:fast")   or 0),
                "medium_100_500ms":   int(r.get("req:latency:medium") or 0),
                "slow_over_500ms":    int(r.get("req:latency:slow")   or 0),
            }
            info = r.info("memory")
            metrics["redis"] = {
                "used_memory_human": info.get("used_memory_human"),
                "connected_clients": r.info("clients").get("connected_clients"),
            }
        except Exception as e:
            metrics["redis"]["error"] = str(e)

    # DB connection count
    try:
        from core.db import engine
        from sqlalchemy import text
        with engine.connect() as conn:
            count = conn.execute(text(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()"
            )).scalar()
            metrics["db"]["active_connections"] = count
            metrics["db"]["pool_size"]          = engine.pool.size()
            metrics["db"]["pool_checked_out"]   = engine.pool.checkedout()
    except Exception as e:
        metrics["db"]["error"] = str(e)

    return metrics
