#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/spd_mobile"
ANDROID_DIR="$APP_DIR/android"
GOOGLE_SERVICES_FILE="$ANDROID_DIR/app/google-services.json"
EXPECTED_PACKAGE="de.spdfraktion.intern"

if [[ ! -f "$ANDROID_DIR/key.properties" ]]; then
  echo "Fehlt: $ANDROID_DIR/key.properties" >&2
  echo "Lege zuerst den Android Upload-Key lokal an. Diese Datei darf nicht committed werden." >&2
  exit 1
fi

if ! grep -q "^storeFile=" "$ANDROID_DIR/key.properties"; then
  echo "key.properties enthaelt keinen storeFile-Eintrag." >&2
  exit 1
fi

STORE_FILE="$(grep "^storeFile=" "$ANDROID_DIR/key.properties" | cut -d= -f2-)"
if [[ ! -f "$ANDROID_DIR/$STORE_FILE" ]]; then
  echo "Fehlt: $ANDROID_DIR/$STORE_FILE" >&2
  exit 1
fi

if [[ ! -f "$GOOGLE_SERVICES_FILE" ]]; then
  echo "Fehlt: $GOOGLE_SERVICES_FILE" >&2
  echo "Lege in Firebase eine Android-App mit Paketname $EXPECTED_PACKAGE an und lade google-services.json herunter." >&2
  exit 1
fi

if ! python3 - "$GOOGLE_SERVICES_FILE" "$EXPECTED_PACKAGE" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
expected = sys.argv[2]
data = json.loads(path.read_text())
packages = [
    client.get("client_info", {}).get("android_client_info", {}).get("package_name")
    for client in data.get("client", [])
]
if expected not in packages:
    print(f"google-services.json enthaelt nicht den Paketnamen {expected}.", file=sys.stderr)
    print("Gefundene Paketnamen: " + ", ".join(filter(None, packages)), file=sys.stderr)
    sys.exit(1)
PY
then
  echo "Bitte Firebase Android-App fuer $EXPECTED_PACKAGE anlegen und google-services.json ersetzen." >&2
  exit 1
fi

cd "$APP_DIR"
flutter pub get
flutter build appbundle --release

echo
echo "Android App Bundle erstellt:"
echo "$APP_DIR/build/app/outputs/bundle/release/app-release.aab"
