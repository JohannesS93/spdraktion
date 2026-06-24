# Android Release

Die Android-App wird als signiertes Android App Bundle gebaut:

```bash
/Users/johannesbt/spd-app/scripts/build-android-release.sh
```

Die fertige Datei liegt danach hier:

```text
/Users/johannesbt/spd-app/spd_mobile/build/app/outputs/bundle/release/app-release.aab
```

## Lokale Secrets

Der Upload-Key liegt lokal und wird nicht committed:

```text
/Users/johannesbt/spd-app/spd_mobile/android/app/spdfraktion-upload-key.jks
/Users/johannesbt/spd-app/spd_mobile/android/key.properties
```

Diese beiden Dateien muessen sicher extern gesichert werden. Ohne diesen Upload-Key koennen spaetere Android-Updates nicht mit demselben Schluessel gebaut werden.

## Play Console

1. Neue App in der Google Play Console anlegen.
2. Paketname verwenden: `de.spdfraktion.intern`.
3. App Bundle `app-release.aab` im internen Testtrack hochladen.
4. Testzugang fuer Google angeben.
5. Datenschutz- und Berechtigungsangaben ausfuellen.
6. Internen Test pruefen, danach Produktionsrelease einreichen.

## Firebase Android-App

Vor dem ersten erfolgreichen Android-Build muss in Firebase eine Android-App im bestehenden Projekt angelegt werden:

```text
Android package name: de.spdfraktion.intern
App nickname: SPD Fraktion Intern Android
```

Danach die neue `google-services.json` herunterladen und lokal hier ersetzen:

```text
/Users/johannesbt/spd-app/spd_mobile/android/app/google-services.json
```

Wenn die Datei noch den Paketnamen `com.example.spd_mobile` enthaelt, kann kein Release-Build erstellt werden.
