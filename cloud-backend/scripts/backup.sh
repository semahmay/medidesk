#!/bin/bash
# MediDesk AI - Automated Backup Script
# Run daily via cron: 0 2 * * * /path/to/backup.sh

set -e

# Configuration
BACKUP_DIR="/var/backups/medidesk"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30
S3_BUCKET="medidesk-backups"

# Load environment
source /etc/medidesk.env

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting MediDesk backup..."

# 1. PostgreSQL backup
echo "[$(date)] Backing up PostgreSQL..."
pg_dump -h "${DATABASE_URL#*@}" -U medidesk -d medidesk > "$BACKUP_DIR/postgres_$DATE.sql"
gzip "$BACKUP_DIR/postgres_$DATE.sql"

# 2. MinIO backup (upload attachments to S3)
echo "[$(date)] Backing up MinIO storage..."
if command -v mc &> /dev/null; then
    mc mirror local/attachments "s3/${S3_BUCKET}/attachments" --exclude "*.tmp"
fi

# 3. Encrypt backup
echo "[$(date)] Encrypting backup..."
gpg --symmetric --cipher-algo AES256 --passphrase "${BACKUP_ENCRYPTION_KEY}" "$BACKUP_DIR/postgres_$DATE.sql.gz"

# 4. Upload to cloud storage
echo "[$(date)] Uploading to S3..."
aws s3 cp "$BACKUP_DIR/postgres_$DATE.sql.gz.gpg" "s3://${S3_BUCKET}/postgres/postgres_$DATE.sql.gz.gPG"

# 5. Cleanup old backups (keep last 30 days)
echo "[$(date)] Cleaning up old backups..."
find "$BACKUP_DIR" -name "postgres_*.sql.gz" -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR" -name "postgres_*.gpg" -mtime +$RETENTION_DAYS -delete

# 6. Remove old S3 backups
aws s3 ls "s3://${S3_BUCKET}/postgres/" | head -n -30 | while read -r line; do
    filename=$(echo "$line" | awk '{print $4}')
    aws s3 rm "s3://${S3_BUCKET}/postgres/$filename"
done

echo "[$(date)] Backup completed successfully!"

# Send notification (optional - integrate with your monitoring)
if [ -n "${SLACK_WEBHOOK}" ]; then
    curl -X POST -H 'Content-type: application/json' \
        --data '{"text":"✅ MediDesk backup completed: postgres_'$DATE'.sql.gz"}' \
        "${SLACK_WEBHOOK}"
fi