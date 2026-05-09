FROM alpine:3.19

# Install PostgreSQL client and MinIO client
RUN apk add --no-cache \
    postgresql16-client \
    curl \
    bash \
    gzip

# Install supercronic (cron that works without root/setpgid)
ENV SUPERCRONIC_URL=https://github.com/aptible/supercronic/releases/download/v0.2.29/supercronic-linux-amd64
RUN curl -fsSL "${SUPERCRONIC_URL}" -o /usr/local/bin/supercronic \
    && chmod +x /usr/local/bin/supercronic

# Install MinIO client
RUN curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc \
    -o /usr/local/bin/mc \
    && chmod +x /usr/local/bin/mc

# Copy scripts
COPY backup.sh /backup.sh
COPY restore.sh /restore.sh
RUN chmod +x /backup.sh /restore.sh

# Crontab file: run backup daily at 02:00 UTC
RUN echo "0 2 * * * /backup.sh >> /var/log/backup.log 2>&1" > /crontab

# Ensure backup directory exists
RUN mkdir -p /backups /var/log

VOLUME ["/backups"]

# supercronic reads the crontab file and runs without root privileges
CMD ["/usr/local/bin/supercronic", "/crontab"]
