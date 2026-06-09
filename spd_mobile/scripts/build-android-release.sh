#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_NUMBER="${1:-}"

if [[ -z "$BUILD_NUMBER" ]]; then
  echo "Nutzung: $0 <build-number>"
  exit 1
fi

export JAVA_HOME="${JAVA_HOME:-$("/usr/libexec/java_home" -v 17)}"

cd "$ROOT_DIR"

flutter clean
flutter pub get
flutter build appbundle \
  --release \
  --build-number "$BUILD_NUMBER" \
  --dart-define=API_BASE_URL=https://api.spdfraktion-intern.de

echo
echo "Android Release gebaut:"
echo "$ROOT_DIR/build/app/outputs/bundle/release/app-release.aab"
