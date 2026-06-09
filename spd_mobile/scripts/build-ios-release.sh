#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_NUMBER="${1:-}"

if [[ -z "$BUILD_NUMBER" ]]; then
  echo "Nutzung: $0 <build-number>"
  exit 1
fi

cd "$ROOT_DIR"

flutter clean
flutter pub get
(cd ios && pod install)
flutter build ipa \
  --release \
  --export-method app-store \
  --build-number "$BUILD_NUMBER" \
  --dart-define=API_BASE_URL=https://api.spdfraktion-intern.de

echo
echo "iOS Release gebaut:"
echo "$ROOT_DIR/build/ios/ipa"
