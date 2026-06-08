#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$ROOT_DIR/.tmp/local-dev"

FRONTEND_PID_FILE="$TMP_DIR/frontend.pid"
API_TUNNEL_PID_FILE="$TMP_DIR/api-tunnel.pid"
DB_TUNNEL_PID_FILE="$TMP_DIR/db-tunnel.pid"

kill_from_file() {
  local file="$1"
  local label="$2"

  if [[ ! -f "$file" ]]; then
    echo "$label: keine PID-Datei."
    return
  fi

  local pid
  pid="$(cat "$file")"
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid"
    echo "$label gestoppt ($pid)."
  else
    echo "$label lief nicht mehr."
  fi
  rm -f "$file"
}

kill_from_file "$FRONTEND_PID_FILE" "Frontend"
kill_from_file "$API_TUNNEL_PID_FILE" "API-Tunnel"
kill_from_file "$DB_TUNNEL_PID_FILE" "DB-Tunnel"
