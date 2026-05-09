#!/bin/sh
# restore.sh — PostgreSQL restore from a backup file
#
# Usage (from host):
#   docker exec cloud-backend-backup-1 /restore.sh medidesk_20260419_020000.sql.gz
#
# Or restore from MinIO:
#   docker exec cloud-backend-backup-1 /restore.sh medidesk_20260419_020000.sql.gz --from-minio

set -e

BACKUP_FILE="${1}"
FROM_MINIO="${2}"
BACKUP_DIR="/backups"

if [ -z "${BACKUP_FILE}" ]; then
  echo "Usage: restore.sh <filename.sql.gz> [--from-minio]"
  echo ""
  echo "Available local backups:"
  ls -lh "${BACKUP_DIR}"/medidesk_*.sql.gz 2>/dev/null || echo "  (none)"
  exit 1
fi

# ── Download from MinIO if requested ─────────────────────────────────────────
if [ "${FROM_MINIO}" = "--from-minio" ]; then
  echo "[restore] Downloading ${BACKUP_FILE} from MinIO..."
  mc alias set minio "${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" --quiet
  mc cp "minio/${BACKUP_BUCKET:-medidesk-backups}/${BACKUP_FILE}" "${BACKUP_DIR}/${BACKUP_FILE}"
  echo "[restore] Downloaded."
fi

FILEPATH="${BACKUP_DIR}/${BACKUP_FILE}"

if [ ! -f "${FILEPATH}" ]; then
  echo "[restore] ERROR: File not found: ${FILEPATH}"
  echo ""
  echo "Available local backups:"
  ls -lh "${BACKUP_DIR}"/medidesk_*.sql.gz 2>/dev/null || echo "  (none)"
  exit 1
fi

echo "[restore] WARNING: This will DROP and recreate the medidesk database."
echo "[restore] File: ${FILEPATH}"
echo "[restore] Press Ctrl+C within 5 seconds to cancel..."
sleep 5

echo "[restore] Dropping existing database..."
PGPASSWORD="${POSTGRES_PASSWORD}" psql \
  -h "${POSTGRES_HOST:-db}" \
  -U "${POSTGRES_USER:-medidesk}" \
  -d postgres \
  --no-password \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${POSTGRES_DB:-medidesk}' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS ${POSTGRES_DB:-medidesk};" \
  -c "CREATE DATABASE ${POSTGRES_DB:-medidesk} OWNER ${POSTGRES_USER:-medidesk};"

echo "[restore] Restoring from ${BACKUP_FILE}..."
gunzip -c "${FILEPATH}" | PGPASSWORD="${POSTGRES_PASSWORD}" psql \
  -h "${POSTGRES_HOST:-db}" \
  -U "${POSTGRES_USER:-medidesk}" \
  -d "${POSTGRES_DB:-medidesk}" \
  --no-password \
  -q

echo "[restore] Restore complete at $(date)"
echo "[restore] Restart the API: docker-compose restart api"
