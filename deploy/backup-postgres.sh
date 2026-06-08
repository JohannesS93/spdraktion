#!/usr/bin/env bash
set -euo pipefail

mkdir -p backups
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

docker compose --env-file .env -f docker-compose.oracle.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "backups/spd-db-${timestamp}.sql.gz"

find backups -type f -name "spd-db-*.sql.gz" -mtime +14 -delete
