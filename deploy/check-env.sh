#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env.oracle}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ Env-Datei nicht gefunden: $ENV_FILE"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

required_vars=(
  ADMIN_DOMAIN
  API_DOMAIN
  POSTGRES_DB
  POSTGRES_USER
  POSTGRES_PASSWORD
  NEXT_PUBLIC_FIREBASE_API_KEY
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
  NEXT_PUBLIC_FIREBASE_PROJECT_ID
  NEXT_PUBLIC_FIREBASE_APP_ID
  FIREBASE_PROJECT_ID
  FIREBASE_CRED_PATH
  FIREBASE_SECRET_FILE
)

missing=()
for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    missing+=("$var_name")
  fi
done

if (( ${#missing[@]} > 0 )); then
  echo "❌ Fehlende Variablen in $ENV_FILE:"
  printf ' - %s\n' "${missing[@]}"
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
secret_file="$FIREBASE_SECRET_FILE"
if [[ "$secret_file" != /* ]]; then
  secret_file="$script_dir/$secret_file"
fi

if [[ ! -f "$secret_file" ]]; then
  echo "❌ Firebase Secret-Datei fehlt: $secret_file"
  exit 1
fi

echo "✅ Env-Prüfung OK"
echo "   Env:    $ENV_FILE"
echo "   Secret: $secret_file"
