# iOS TestFlight Release Checklist

## 1) Vorbedingungen
- Oracle-Backend ist erreichbar (`https://api.130.61.45.35.sslip.io/docs`).
- Bundle-ID ist korrekt: `de.spdfraktion.intern`.
- iOS-Firebase-Config passt zur Bundle-ID (`GoogleService-Info.plist`).
- Apple Signing ist korrekt:
  - `Automatically manage signing` aktiviert
  - Team: `9VSWMBT78S`
  - Zertifikate vorhanden (`Apple Development` + `Apple Distribution`)

Prüfen:
```bash
security find-identity -v -p codesigning
```

## 2) Clean Build
```bash
cd /Users/johannesbt/spd-app/spd_mobile
rm -rf build ios/Pods ios/Podfile.lock
flutter clean
flutter pub get
cd ios && pod install && cd ..
```

## 3) Release-IPA bauen
Wichtig: `--build-number` bei jedem Upload erhöhen (z. B. `5`, `6`, `7`).

```bash
cd /Users/johannesbt/spd-app/spd_mobile
flutter build ipa \
  --release \
  --export-method app-store \
  --build-number <N> \
  --dart-define=API_BASE_URL=https://api.130.61.45.35.sslip.io
```

Ergebnis:
- IPA liegt unter `build/ios/ipa/*.ipa`

## 4) Upload
- Transporter öffnen
- `build/ios/ipa/*.ipa` per Drag & Drop hinzufügen
- `Deliver` klicken

## 5) App Store Connect / TestFlight
- `My Apps` -> `SPD-Fraktion Intern` -> `TestFlight`
- Warten bis Build `Ready to Test`
- `Internal Testing` -> Gruppe wählen -> `Add Build`
- Tester hinzufügen (Apple-IDs)

## 6) Smoke-Test nach Verteilung
- Login funktioniert
- Home lädt Daten (`/me`, Dienstplan, Mitteilungen)
- Push kommt an
- Nachricht erscheint in Mitteilungen
- App-Icon Badge zählt hoch/runter
- Datei öffnen / Download funktioniert
- Tausch-Funktionen funktionieren

## 7) Häufige Fehler
- `Invalid Signature (90035)`:
  - Meist kein `Apple Distribution` Zertifikat aktiv
  - oder falsches Signing im Runner Target
- `com.example` Fehler:
  - Bundle-ID im iOS-Projekt oder Firebase plist noch falsch
- Push geht nicht:
  - falsches `GoogleService-Info.plist`
  - APNs/Push Capability fehlt

