FROM python:3.11-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Non-root user for security
RUN useradd -m appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

# Production-optimized Gunicorn configuration
# Workers: 4 (matches DB pool sizing: 4 workers × 20 = 80 max connections)
# worker-connections: 1000 (eventlet can handle many concurrent connections)
# timeout: 120s (allow slow queries + statement_timeout=30s)
# graceful-timeout: 30s (time to finish in-flight requests during deploy)
# keep-alive: 5s (reduce connection overhead for repeated requests)
# max-requests: 1000 (restart workers periodically to prevent memory leaks)
# max-requests-jitter: 50 (stagger worker restarts to avoid thundering herd)
CMD ["gunicorn", "app:app", \
     "--worker-class", "eventlet", \
     "--workers", "4", \
     "--threads", "1", \
     "--worker-connections", "1000", \
     "--backlog", "2048", \
     "--timeout", "120", \
     "--graceful-timeout", "30", \
     "--keep-alive", "5", \
     "--max-requests", "1000", \
     "--max-requests-jitter", "50", \
     "--bind", "0.0.0.0:8000"]
