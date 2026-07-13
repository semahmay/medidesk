# Gunicorn Configuration for MediDesk Production Deployment
# Usage: gunicorn app:app -c gunicorn.conf.py

import multiprocessing
import os

# ── Worker Configuration ─────────────────────────────────────────────────────
# For eventlet workers, use fewer workers than CPU cores since each worker
# can handle many concurrent connections via green threads
# Production SaaS clinic workload: 4-8 workers handles 4000-8000 clinic clients
workers = int(os.getenv("GUNICORN_WORKERS", "4"))
worker_class = "eventlet"
threads = 1  # Eventlet uses green threads, not OS threads

# Max concurrent connections per worker (eventlet-specific)
# Each connection = 1 green thread (very lightweight)
# For clinic SaaS: 1000 connections per worker supports ~200 clinics/worker
worker_connections = 1000

# Listen backlog - max pending connections
backlog = 4096

# ── Timeouts ──────────────────────────────────────────────────────────────────
# Worker timeout (seconds) - kill worker if no response in this time
# Set slightly above DB statement_timeout (30s) + buffer for network latency
timeout = 60

# Graceful timeout (seconds) - time to finish in-flight requests during shutdown
# Lower value = faster rolling restarts
graceful_timeout = 15

# Keep-alive (seconds) - time to keep HTTP connection open for next request
# Higher values reduce connection overhead but keep resources tied up
# 10s is a good balance for clinic API with frequent client requests
keepalive = 10

# ── Memory Management ─────────────────────────────────────────────────────────
# Restart workers after N requests to prevent memory leaks
# This is critical for long-running Python processes
# 1000 was too aggressive - caused unnecessary restarts during peak hours
# 10000 with jitter provides stable long-running workers
max_requests = 10000

# Add jitter (randomness) to max_requests to stagger worker restarts
# Prevents all workers restarting at the same time (thundering herd)
# 20% jitter spreads restarts evenly
max_requests_jitter = 2000

# ── Process Naming ────────────────────────────────────────────────────────────
# Makes it easier to identify workers in process list
proc_name = "medidesk-api"

# ── Daemon Mode ───────────────────────────────────────────────────────────────
# Don't daemonize - let Docker handle process management
daemon = False

# ── PID File ──────────────────────────────────────────────────────────────────
pidfile = None  # Docker handles this

# ── User/Group ────────────────────────────────────────────────────────────────
# Run as non-root user (security best practice)
# Dockerfile already sets USER appuser, but we set here for non-Docker runs
user = None
group = None

# ── Temporary Directory ───────────────────────────────────────────────────────
# Use /tmp for temporary files
tmp_upload_dir = "/tmp"

# ── Logging ───────────────────────────────────────────────────────────────────
# Access log format (JSON for structured logging)
accesslog = "-"  # stdout
errorlog = "-"   # stderr
loglevel = os.getenv("LOG_LEVEL", "info").lower()

# ── Server Socket ─────────────────────────────────────────────────────────────
bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"

# ── SSL (optional) ────────────────────────────────────────────────────────────
# Usually handled by Nginx reverse proxy, but can enable here for direct SSL
# keyfile = "/path/to/key.pem"
# certfile = "/path/to/cert.pem"

# ── Pre-fork Hook ─────────────────────────────────────────────────────────────
def on_starting(server):
    """Called just before the master process is initialized."""
    server.log.info(f"[Gunicorn] Starting MediDesk API with {workers} eventlet workers")
    server.log.info(f"[Gunicorn] Max connections per worker: {worker_connections}")
    server.log.info(f"[Gunicorn] Worker timeout: {timeout}s, graceful timeout: {graceful_timeout}s")

def when_ready(server):
    """Called just after the master process is initialized."""
    server.log.info("[Gunicorn] Server is ready. Accepting connections.")

def on_exit(server):
    """Called just before the master process exits."""
    server.log.info("[Gunicorn] Server is shutting down.")
