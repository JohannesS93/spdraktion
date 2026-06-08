## Lokale Secret-Dateien

Diese Dateien werden lokal benoetigt, sind aber bewusst nicht in Git versioniert:

- `spd_mobile/android/app/google-services.json`
- `spd_mobile/ios/GoogleService-Info.plist`
- `spd_mobile/ios/Runner/GoogleService-Info.plist`
- Firebase-Admin-Schluessel unter `api/` falls lokal benoetigt

Die echten Dateien muessen nach einem neuen Checkout oder auf einem neuen Rechner separat eingespielt werden.

## Beispiel-Dateien

Zur Orientierung liegen im Projekt neutrale Platzhalter:

- `spd_mobile/android/app/google-services.example.json`
- `spd_mobile/ios/GoogleService-Info.example.plist`

Diese Beispiel-Dateien enthalten keine echten Zugangsdaten und sind nicht direkt lauffaehig.

## Einrichtung auf neuem Rechner

1. Echte Firebase-Dateien aus sicherer Quelle besorgen.
2. Android:
   `spd_mobile/android/app/google-services.json` ablegen.
3. iOS:
   `spd_mobile/ios/GoogleService-Info.plist` ablegen.
4. iOS:
   dieselbe Datei zusaetzlich nach `spd_mobile/ios/Runner/GoogleService-Info.plist` kopieren, weil das Xcode-Projekt dort aktuell direkt darauf verweist.
5. Falls lokal das API-Backend mit Firebase-Admin laufen soll, auch den passenden Admin-Schluessel in `api/` hinterlegen.

## Sichere Ablage

Empfohlen ist eine getrennte, sichere Ablage ausserhalb von Git, zum Beispiel:

- 1Password
- verschluesselter Team-Ordner
- interner Secret-Manager

## Wichtiger Hinweis

Diese Dateien niemals in Git committen oder per E-Mail unverschluesselt verschicken.
