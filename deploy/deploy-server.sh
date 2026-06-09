#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_USER="${DEPLOY_REMOTE_USER:-ubuntu}"
REMOTE_HOST="${DEPLOY_REMOTE_HOST:-130.61.45.35}"
REMOTE_PATH="${DEPLOY_REMOTE_PATH:-/opt/spd-app}"
SSH_KEY="${DEPLOY_SSH_KEY:-/Users/johannesbt/.ssh/id_ed25519}"
REMOTE_DEPLOY_DIR="$REMOTE_PATH/deploy"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Fehlt: $1"
    exit 1
  fi
}

run_ssh() {
  ssh \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=accept-new \
    -i "$SSH_KEY" \
    "$REMOTE_USER@$REMOTE_HOST" \
    "$@"
}

sync_dir() {
  local source_dir="$1"
  local remote_dir="$2"

  rsync -az --delete \
    --exclude '.git/' \
    --exclude 'node_modules/' \
    --exclude '.next/' \
    --exclude '.venv/' \
    --exclude '__pycache__/' \
    --exclude '*.pyc' \
    --exclude '.DS_Store' \
    --exclude 'uploads/' \
    --exclude '.env' \
    --exclude '.env.*' \
    --exclude 'secrets/' \
    --exclude 'build/' \
    --exclude '.dart_tool/' \
    -e "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i $SSH_KEY" \
    "$source_dir/" \
    "$REMOTE_USER@$REMOTE_HOST:$remote_dir/"
}

require_cmd ssh
require_cmd rsync

echo "Pruefe Serverzugriff ..."
run_ssh "test -d '$REMOTE_PATH' && test -f '$REMOTE_DEPLOY_DIR/.env' && test -f '$REMOTE_DEPLOY_DIR/secrets/firebase-adminsdk.json'"

echo "Synchronisiere API ..."
sync_dir "$ROOT_DIR/api" "$REMOTE_PATH/api"

echo "Synchronisiere Admin-Web ..."
sync_dir "$ROOT_DIR/admin_web" "$REMOTE_PATH/admin_web"

echo "Synchronisiere Deploy-Dateien ..."
sync_dir "$ROOT_DIR/deploy" "$REMOTE_PATH/deploy"

echo "Starte produktiven Compose-Deploy ..."
run_ssh "
  cd '$REMOTE_DEPLOY_DIR' &&
  docker compose --env-file .env -f docker-compose.oracle.yml up -d --build --remove-orphans &&
  printf '\n---\n' &&
  docker compose --env-file .env -f docker-compose.oracle.yml ps &&
  printf '\n---\n' &&
  curl -fsS https://api.spdfraktion-intern.de/docs >/dev/null &&
  echo 'API erreichbar: https://api.spdfraktion-intern.de/docs' &&
  curl -fsS https://spdfraktion-intern.de >/dev/null &&
  echo 'Admin erreichbar: https://spdfraktion-intern.de'
"

echo
echo "Deploy abgeschlossen."
