#!/bin/bash
# setup_ssl.sh — Set up SSL certificates for production
#
# For PRODUCTION (real domain):
#   ./setup_ssl.sh --domain api.yourdomain.com --email admin@yourdomain.com
#
# For LOCAL DEV (self-signed, browser will warn):
#   ./setup_ssl.sh --self-signed
#
# After running, restart nginx:
#   docker-compose restart nginx

set -e

DOMAIN=""
EMAIL=""
SELF_SIGNED=false
CERTS_DIR="./nginx/certs"

# Parse args
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --domain)    DOMAIN="$2";    shift ;;
        --email)     EMAIL="$2";     shift ;;
        --self-signed) SELF_SIGNED=true ;;
        *) echo "Unknown: $1"; exit 1 ;;
    esac
    shift
done

mkdir -p "$CERTS_DIR"

if [ "$SELF_SIGNED" = true ]; then
    echo "Generating self-signed certificate for local dev..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$CERTS_DIR/privkey.pem" \
        -out    "$CERTS_DIR/fullchain.pem" \
        -subj "/C=US/ST=Dev/L=Local/O=MediDesk/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
    echo "Self-signed cert created in $CERTS_DIR"
    echo ""
    echo "To activate HTTPS:"
    echo "  1. Rename nginx/conf.d/medidesk-dev.conf -> medidesk-dev.conf.disabled"
    echo "  2. Rename nginx/conf.d/medidesk.conf.prod -> medidesk.conf"
    echo "     (update YOUR_DOMAIN to 'localhost' in the file first)"
    echo "  3. docker-compose restart nginx"
    exit 0
fi

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "Usage: $0 --domain api.yourdomain.com --email admin@yourdomain.com"
    echo "   or: $0 --self-signed"
    exit 1
fi

echo "Obtaining Let's Encrypt certificate for $DOMAIN..."

# Stop nginx temporarily to free port 80 for certbot standalone
docker-compose stop nginx 2>/dev/null || true

# Run certbot in standalone mode
docker run --rm \
    -v "$(pwd)/nginx/certs:/etc/letsencrypt/live/$DOMAIN" \
    -p 80:80 \
    certbot/certbot certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    -d "$DOMAIN" \
    --cert-path "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" \
    --key-path  "/etc/letsencrypt/live/$DOMAIN/privkey.pem"

echo ""
echo "Certificate obtained. Activating HTTPS config..."

# Activate production nginx config
if [ -f "nginx/conf.d/medidesk-dev.conf" ]; then
    mv nginx/conf.d/medidesk-dev.conf nginx/conf.d/medidesk-dev.conf.disabled
    echo "  Disabled dev config"
fi

if [ -f "nginx/conf.d/medidesk.conf.prod" ]; then
    # Replace YOUR_DOMAIN placeholder
    sed "s/YOUR_DOMAIN/$DOMAIN/g" nginx/conf.d/medidesk.conf.prod > nginx/conf.d/medidesk.conf
    echo "  Activated production config for $DOMAIN"
fi

# Restart nginx
docker-compose up -d nginx
echo ""
echo "HTTPS is now active at https://$DOMAIN"
echo ""
echo "Add this to your crontab for auto-renewal:"
echo "  0 3 * * * docker run --rm -v $(pwd)/nginx/certs:/etc/letsencrypt certbot/certbot renew --quiet && docker-compose restart nginx"
