#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

REMOTE_USER="ubuntu"
REMOTE_HOST="130.61.45.35"
SSH_KEY="/Users/johannesbt/.ssh/id_ed25519"
REMOTE_DB_CONTAINER="deploy-db-1"
REMOTE_DB_NAME="spd_prod"
REMOTE_DB_USER="spd_app"
LOCAL_DB_NAME="spd_prod"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Fehlt: $1"
    exit 1
  fi
}

require_cmd ssh
require_cmd psql

echo "Setze lokale Datenbank $LOCAL_DB_NAME neu auf ..."
psql postgres -c "DROP DATABASE IF EXISTS $LOCAL_DB_NAME;" >/dev/null
psql postgres -c "CREATE DATABASE $LOCAL_DB_NAME;" >/dev/null

echo "Importiere aktuellen Stand von $REMOTE_HOST ..."
ssh -i "$SSH_KEY" "$REMOTE_USER@$REMOTE_HOST" \
  "docker exec $REMOTE_DB_CONTAINER pg_dump --no-owner --no-acl -U $REMOTE_DB_USER $REMOTE_DB_NAME" \
  | psql "$LOCAL_DB_NAME" >/dev/null

echo "Lokale Datenbank $LOCAL_DB_NAME ist aktualisiert."
