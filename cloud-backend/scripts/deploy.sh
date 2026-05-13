#!/bin/bash
set -e

# ── MediDesk AI — Safe Production Redeploy ────────────────────────────────────
# Usage: bash scripts/deploy.sh
# Pulls latest code, rebuilds containers WITHOUT deleting volumes.

echo "=== MediDesk AI — Safe Production Redeploy ==="

cd ~/medidesk

# 1. Backup .env
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
cp cloud-backend/.env "cloud-backend/.env.backup.${TIMESTAMP}"
echo "[1/5] .env backed up to .env.backup.${TIMESTAMP}"

# 2. Pull latest code
git pull origin main
echo "[2/5] Git pull complete"

# 3. Verify docker-compose.yml
docker-compose -f cloud-backend/docker-compose.yml config > /dev/null
echo "[3/5] docker-compose.yml valid"

# 4. Rebuild and restart (NO -v flag — preserves volumes)
docker-compose -f cloud-backend/docker-compose.yml up -d --build --remove-orphans
echo "[4/5] Containers rebuilt and restarted"

# 5. Wait for health
echo "[5/5] Waiting for services to become healthy..."
sleep 10
docker ps --format 'table {{.Names}}\t{{.Status}}'

# 6. Verify API health
echo ""
echo "=== Health Check ==="
curl -s http://localhost:8000/api/health | python3 -m json.tool

echo ""
echo "=== Deploy Complete ==="
