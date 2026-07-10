#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

ensure_requirements
check_remote_ready
sync_api
sync_deploy_files
backend_only_deploy

echo
echo "Backend-Only-Deploy abgeschlossen."
