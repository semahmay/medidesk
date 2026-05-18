#!/bin/bash
# MediDesk AI - Restore Script
# Usage: ./restore.sh <backup_date> [dry-run]

set -e

BACKUP_DATE=$1
DRY_RUN=$2
S3_BUCKET="medidesk-backups"

if [ -z "$BACKUP_DATE" ]; then
    echo "Usage: $0 <backup_date> [dry-run]"
    echo "Example: $0 20240514_020000"
    echo ""
    echo "Available backups:"
    aws s3 ls "s3://${S3_BUCKET}/postgres/" | tail -10
    exit 1
fi

BACKUP_FILE="postgres_${BACKUP_DATE}.sql.gz.gpg"
SOURCE_URL="s3://${S3_BUCKET}/postgres/${BACKUP_FILE}"
TEMP_DIR="/tmp/medidesk_restore_$$"

echo "[$(date)] Starting restore from backup: $BACKUP_DATE"

mkdir -p "$TEMP_DIR"

# 1. Download encrypted backup
echo "[$(date)] Downloading backup..."
aws s3 cp "$SOURCE_URL" "$TEMP_DIR/" || {
    echo "ERROR: Backup file not found: $SOURCE_URL"
    exit 1
}

# 2. Decrypt
echo "[$(date)] Decrypting backup..."
gpg --decrypt --passphrase "${BACKUP_ENCRYPTION_KEY}" \
    "$TEMP_DIR/${BACKUP_FILE}" > "$TEMP_DIR/restore.sql.gz"

# 3. Decompress
echo "[$(date)] Decompressing..."
gunzip -d "$TEMP_DIR/restore.sql.gz"

if [ "$DRY_RUN" = "dry-run" ]; then
    echo "[DRY RUN] Would restore:"
    head -20 "$TEMP_DIR/restore.sql"
    echo "..."
    rm -rf "$TEMP_DIR"
    exit 0
fi

# 4. Stop services
echo "[$(date)] Stopping services..."
systemctl stop medidesk-api || true
systemctl stop medidesk-worker || true

# 5. Drop and recreate database (WARNING: destructive!)
echo "[$(date)] Restoring database..."
psql -h "${DATABASE_URL#*@}" -U medidesk -c "DROP DATABASE IF EXISTS medidesk;"
psql -h "${DATABASE_URL#*@}" -U medidesk -c "CREATE DATABASE medidesk;"
psql -h "${DATABASE_URL#*@}" -U medidesk -d medidesk < "$TEMP_DIR/restore.sql"

# 6. Restart services
echo "[$(date)] Restarting services..."
systemctl start medidesk-api || true
systemctl start medidesk-worker || true

# 7. Verify
echo "[$(date)] Verifying restore..."
USER_COUNT=$(psql -h "${DATABASE_URL#*@}" -U medidesk -d medidesk -t -c "SELECT COUNT(*) FROM users;")
echo "[$(date)] Restored with $USER_COUNT users"

# Cleanup
rm -rf "$TEMP_DIR"

echo "[$(date)] Restore completed successfully!"

# Send notification
if [ -n "${SLACK_WEBHOOK}" ]; then
    curl -X POST -H 'Content-type: application/json' \
        --data '{"text":"⚠️ MediDesk restored from backup: '$BACKUP_DATE' ('$USER_COUNT' users)"}' \
        "${SLACK_WEBHOOK}"
fi