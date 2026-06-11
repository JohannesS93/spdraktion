#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADMIN_DIR="$ROOT_DIR/admin_web"
TMP_DIR="$ROOT_DIR/.tmp/local-dev"

FRONTEND_HOST="127.0.0.1"
FRONTEND_PORT="3000"
API_HOST="127.0.0.1"
API_PORT="8000"
DB_HOST="127.0.0.1"
DB_PORT="15432"

REMOTE_USER="ubuntu"
REMOTE_HOST="130.61.45.35"
SSH_KEY="/Users/johannesbt/.ssh/id_ed25519"
REMOTE_API_HOST="127.0.0.1"
REMOTE_API_PORT="8000"
REMOTE_DB_HOST="127.0.0.1"
REMOTE_DB_PORT="5432"

FRONTEND_LOG="$TMP_DIR/frontend.log"
API_TUNNEL_LOG="$TMP_DIR/api-tunnel.log"
DB_TUNNEL_LOG="$TMP_DIR/db-tunnel.log"
FRONTEND_PID_FILE="$TMP_DIR/frontend.pid"
API_TUNNEL_PID_FILE="$TMP_DIR/api-tunnel.pid"
DB_TUNNEL_PID_FILE="$TMP_DIR/db-tunnel.pid"

mkdir -p "$TMP_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Fehlt: $1"
    exit 1
  fi
}

port_is_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

ensure_port_free() {
  local port="$1"
  local label="$2"

  if port_is_listening "$port"; then
    echo "$label-Port $port ist bereits belegt."
    echo "Bitte erst laufende Prozesse beenden oder /Users/johannesbt/spd-app/scripts/stop-localhost.sh ausfuehren."
    exit 1
  fi
}

cleanup_stale_pid_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    return
  fi

  local pid
  pid="$(cat "$file")"
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    rm -f "$file"
  fi
}

start_tunnel() {
  local name="$1"
  local local_host="$2"
  local local_port="$3"
  local remote_host="$4"
  local remote_port="$5"
  local pid_file="$6"
  local log_file="$7"

  cleanup_stale_pid_file "$pid_file"

  if [[ -f "$pid_file" ]]; then
    local existing_pid
    existing_pid="$(cat "$pid_file")"
    if kill -0 "$existing_pid" >/dev/null 2>&1; then
      echo "$name-Tunnel laeuft bereits auf $local_host:$local_port"
      return
    fi
    rm -f "$pid_file"
  fi

  ensure_port_free "$local_port" "$name"

  echo "Starte $name-Tunnel auf $local_host:$local_port ..."
  local match_pattern="$local_host:$local_port:$remote_host:$remote_port"

  ssh \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -o StrictHostKeyChecking=accept-new \
    -i "$SSH_KEY" \
    -f \
    -N \
    -L "$local_host:$local_port:$remote_host:$remote_port" \
    "$REMOTE_USER@$REMOTE_HOST" \
    < /dev/null \
    >"$log_file" 2>&1

  local tunnel_pid=""
  for _ in {1..20}; do
    tunnel_pid="$(pgrep -f "ssh .*${match_pattern}" | head -n 1 || true)"
    if [[ -n "$tunnel_pid" ]]; then
      echo "$tunnel_pid" >"$pid_file"
      break
    fi
    sleep 1
  done

  if [[ -z "$tunnel_pid" ]]; then
    echo "$name-Tunnel konnte nicht gestartet werden."
    echo "Log: $log_file"
    exit 1
  fi

  for _ in {1..20}; do
    if port_is_listening "$local_port"; then
      echo "$name-Tunnel ist bereit."
      return
    fi
    if ! kill -0 "$tunnel_pid" >/dev/null 2>&1; then
      echo "$name-Tunnel konnte nicht gestartet werden."
      echo "Log: $log_file"
      exit 1
    fi
    sleep 1
  done

  echo "$name-Tunnel wurde nicht rechtzeitig erreichbar."
  echo "Log: $log_file"
  exit 1
}

start_frontend() {
  cleanup_stale_pid_file "$FRONTEND_PID_FILE"

  if [[ -f "$FRONTEND_PID_FILE" ]]; then
    local existing_pid
    existing_pid="$(cat "$FRONTEND_PID_FILE")"
    if kill -0 "$existing_pid" >/dev/null 2>&1; then
      echo "Frontend laeuft bereits auf http://$FRONTEND_HOST:$FRONTEND_PORT"
      return
    fi
    rm -f "$FRONTEND_PID_FILE"
  fi

  if port_is_listening "$FRONTEND_PORT"; then
    echo "Frontend laeuft bereits auf http://$FRONTEND_HOST:$FRONTEND_PORT"
    return
  fi

  echo "Starte Frontend auf http://$FRONTEND_HOST:$FRONTEND_PORT ..."
  (
    cd "$ADMIN_DIR"
    nohup bash -lc "cd \"$ADMIN_DIR\" && exec ./node_modules/.bin/next dev --hostname \"$FRONTEND_HOST\"" >"$FRONTEND_LOG" 2>&1 &
    echo $! >"$FRONTEND_PID_FILE"
  )

  for _ in {1..30}; do
    if port_is_listening "$FRONTEND_PORT"; then
      echo "Frontend ist bereit."
      return
    fi
    sleep 1
  done

  echo "Frontend wurde nicht rechtzeitig erreichbar."
  echo "Log: $FRONTEND_LOG"
  exit 1
}

require_cmd lsof
require_cmd npm
require_cmd ssh

start_tunnel "DB" "$DB_HOST" "$DB_PORT" "$REMOTE_DB_HOST" "$REMOTE_DB_PORT" "$DB_TUNNEL_PID_FILE" "$DB_TUNNEL_LOG"
start_frontend

echo
echo "Fertig."
echo "Frontend: http://127.0.0.1:3000"
echo "API:      https://api.spdfraktion-intern.de"
echo "DB:       postgres://127.0.0.1:15432 -> remote 5432"
echo "Frontend-Log: $FRONTEND_LOG"
echo "DB-Tunnel-Log:  $DB_TUNNEL_LOG"
