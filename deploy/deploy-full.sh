#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

ensure_requirements
check_remote_ready
sync_api
sync_admin_web
sync_deploy_files
full_deploy

echo
echo "Voller Deploy abgeschlossen."
