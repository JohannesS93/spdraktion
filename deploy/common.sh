#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_USER="${DEPLOY_REMOTE_USER:-root}"
REMOTE_HOST="${DEPLOY_REMOTE_HOST:-147.93.126.127}"
REMOTE_PATH="${DEPLOY_REMOTE_PATH:-/opt/spd-app}"
SSH_KEY="${DEPLOY_SSH_KEY:-/Users/johannesbt/.ssh/id_ed25519}"
REMOTE_DEPLOY_DIR="$REMOTE_PATH/deploy"
COMPOSE_FILE="docker-compose.oracle.yml"
COMPOSE_ENV_FILE=".env"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Fehlt: $1" >&2
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

sync_file() {
  local source_file="$1"
  local remote_file="$2"

  rsync -az \
    -e "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i $SSH_KEY" \
    "$source_file" \
    "$REMOTE_USER@$REMOTE_HOST:$remote_file"
}

sync_optional_file() {
  local source_file="$1"
  local remote_file="$2"

  if [[ ! -f "$source_file" ]]; then
    return 0
  fi

  sync_file "$source_file" "$remote_file"
}

ensure_requirements() {
  require_cmd ssh
  require_cmd rsync
}

check_remote_ready() {
  echo "Pruefe Serverzugriff ..."
  run_ssh "test -d '$REMOTE_PATH' && test -f '$REMOTE_DEPLOY_DIR/$COMPOSE_ENV_FILE' && test -f '$REMOTE_DEPLOY_DIR/secrets/firebase-adminsdk.json'"
}

sync_api() {
  echo "Synchronisiere API ..."
  sync_dir "$ROOT_DIR/api" "$REMOTE_PATH/api"
}

sync_admin_web() {
  echo "Synchronisiere Admin-Web ..."
  sync_dir "$ROOT_DIR/admin_web" "$REMOTE_PATH/admin_web"
}

sync_deploy_files() {
  echo "Synchronisiere Deploy-Dateien ..."
  sync_file "$ROOT_DIR/deploy/$COMPOSE_FILE" "$REMOTE_DEPLOY_DIR/$COMPOSE_FILE"
  sync_file "$ROOT_DIR/deploy/Caddyfile" "$REMOTE_DEPLOY_DIR/Caddyfile"
  sync_optional_file "$ROOT_DIR/deploy/check-env.sh" "$REMOTE_DEPLOY_DIR/check-env.sh"
  sync_optional_file "$ROOT_DIR/deploy/mail-import.env.example" "$REMOTE_DEPLOY_DIR/mail-import.env.example"
  sync_optional_file "$ROOT_DIR/deploy/MAIL_IMPORT.md" "$REMOTE_DEPLOY_DIR/MAIL_IMPORT.md"
  sync_optional_file "$ROOT_DIR/deploy/SECRETS.md" "$REMOTE_DEPLOY_DIR/SECRETS.md"
  sync_optional_file "$ROOT_DIR/deploy/secrets/webmaster-imap.env" "$REMOTE_DEPLOY_DIR/secrets/webmaster-imap.env"
}

full_deploy() {
  echo "Starte vollen Produktiv-Deploy ..."
  run_ssh "
    cd '$REMOTE_DEPLOY_DIR' &&
    docker compose --env-file $COMPOSE_ENV_FILE -f $COMPOSE_FILE up -d --build --remove-orphans &&
    printf '\n---\n' &&
    docker compose --env-file $COMPOSE_ENV_FILE -f $COMPOSE_FILE ps &&
    printf '\n---\n' &&
    for url in https://api.spdfraktion-intern.de/docs https://spdfraktion-intern.de; do
      ok=0
      for attempt in 1 2 3 4 5; do
        if curl -fsS \"\$url\" >/dev/null; then
          echo \"Erreichbar: \$url\"
          ok=1
          break
        fi
        sleep 3
      done
      if [ \"\$ok\" -ne 1 ]; then
        echo \"Nicht erreichbar nach Retries: \$url\" >&2
        exit 1
      fi
    done
  "
}

backend_only_deploy() {
  echo "Starte Backend-Only-Deploy ..."
  run_ssh "
    cd '$REMOTE_DEPLOY_DIR' &&
    docker compose --env-file $COMPOSE_ENV_FILE -f $COMPOSE_FILE up -d --build --no-deps api &&
    printf '\n---\n' &&
    docker compose --env-file $COMPOSE_ENV_FILE -f $COMPOSE_FILE ps api &&
    printf '\n---\n' &&
    ok=0
    for attempt in 1 2 3 4 5; do
      if curl -fsS https://api.spdfraktion-intern.de/docs >/dev/null; then
        echo 'Erreichbar: https://api.spdfraktion-intern.de/docs'
        ok=1
        break
      fi
      sleep 3
    done
    if [ \"\$ok\" -ne 1 ]; then
      echo 'API nicht erreichbar nach Retries' >&2
      exit 1
    fi
  "
}
