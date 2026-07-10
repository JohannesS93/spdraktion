# Android-Release

## Vorbedingungen
- Firebase-Android-Konfiguration in `spd_mobile/android/app/google-services.json`
- Android-App in Firebase fuer Paket `com.spdfraktion.intern`
- Release-Keystore vorhanden
- `spd_mobile/android/key.properties` lokal vorhanden

## `key.properties` anlegen
Datei: `spd_mobile/android/key.properties`

Inhalt:
```properties
storeFile=/ABSOLUTER/PFAD/ZU/release-keystore.jks
storePassword=DEIN_STORE_PASSWORT
keyAlias=DEIN_KEY_ALIAS
keyPassword=DEIN_KEY_PASSWORT
```

`key.properties` und `*.jks` sind absichtlich nicht in Git.

## Release bauen
Schnellweg:
```bash
/Users/johannesbt/spd-app/spd_mobile/scripts/build-android-release.sh <N>
```

Oder manuell:
```bash
cd /Users/johannesbt/spd-app/spd_mobile
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
flutter clean
flutter pub get
flutter build appbundle \
  --release \
  --build-number <N> \
  --dart-define=API_BASE_URL=https://api.spdfraktion-intern.de
```

Ergebnis:
- `build/app/outputs/bundle/release/app-release.aab`

## Google Play Console
1. App `SPD Fraktion Intern` oeffnen.
2. `Internal testing`, `Closed testing` oder `Production` waehlen.
3. Neues Release anlegen.
4. `app-release.aab` hochladen.
5. Release Notes pflegen und ausrollen.

## Smoke-Test
- Login
- Startseite mit Live-Infos
- Push
- Dokumente/Kurzübersicht
- Tauschtool ist deaktiviert
