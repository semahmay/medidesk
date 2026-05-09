#!/bin/sh
# backup.sh — PostgreSQL daily backup script
# Runs inside the backup container. Called by cron every day at 02:00 UTC.
# Keeps last 7 daily backups locally. Optionally uploads to MinIO.

set -e

BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="medidesk_${TIMESTAMP}.sql.gz"
FILEPATH="${BACKUP_DIR}/${FILENAME}"

echo "[backup] Starting backup at $(date)"

# ── Dump ──────────────────────────────────────────────────────────────────────
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  -h "${POSTGRES_HOST:-db}" \
  -U "${POSTGRES_USER:-medidesk}" \
  -d "${POSTGRES_DB:-medidesk}" \
  --no-password \
  --format=plain \
  --no-owner \
  --no-acl \
  | gzip > "${FILEPATH}"

SIZE=$(du -sh "${FILEPATH}" | cut -f1)
echo "[backup] Dump complete: ${FILENAME} (${SIZE})"

# ── Upload to MinIO (optional) ────────────────────────────────────────────────
if [ -n "${MINIO_ENDPOINT}" ] && [ -n "${MINIO_ACCESS_KEY}" ]; then
  mc alias set minio "${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" --quiet 2>/dev/null || true
  mc mb --ignore-existing "minio/${BACKUP_BUCKET:-medidesk-backups}" --quiet 2>/dev/null || true
  mc cp "${FILEPATH}" "minio/${BACKUP_BUCKET:-medidesk-backups}/${FILENAME}" --quiet
  echo "[backup] Uploaded to MinIO: ${BACKUP_BUCKET:-medidesk-backups}/${FILENAME}"
fi

# ── Rotate: keep last 7 local backups ─────────────────────────────────────────
cd "${BACKUP_DIR}"
ls -t medidesk_*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm --
REMAINING=$(ls medidesk_*.sql.gz 2>/dev/null | wc -l)
echo "[backup] Local backups retained: ${REMAINING}"

echo "[backup] Done at $(date)"
