# Secrets-Rotation (Firebase Admin SDK)

## 1) Neuen Firebase Admin Key erzeugen
1. Google Cloud Console öffnen (`IAM & Admin` -> `Service Accounts`).
2. Service Account `firebase-adminsdk-...` wählen.
3. Unter `Keys` einen **neuen JSON Key** erstellen.
4. Die Datei lokal unter `deploy/secrets/firebase-adminsdk.json` speichern.

Wichtig: `deploy/secrets/` ist per `.gitignore` ausgeschlossen.

## 2) Alte Schlüssel sofort deaktivieren
1. In derselben Service-Account-Ansicht die bisherigen Keys löschen/deaktivieren.
2. Nur der neue Key darf aktiv bleiben.

## 3) Oracle Deployment vorbereiten
1. `cp deploy/.env.oracle.example deploy/.env.oracle`
2. In `deploy/.env.oracle` alle Werte setzen (Domains, DB-Passwort, Firebase Public Config).
3. Prüfen:
   - `FIREBASE_SECRET_FILE=./secrets/firebase-adminsdk.json`
   - `FIREBASE_CRED_PATH=/run/secrets/firebase-adminsdk.json`
   - `FIREBASE_PROJECT_ID=spd-fraktion-intern`

## 4) Neu starten
```bash
cd deploy
./check-env.sh .env.oracle
docker compose -f docker-compose.oracle.yml --env-file .env.oracle up -d --build
```

## 5) Smoke-Test
1. API Health prüfen (z. B. `/me` mit gültigem Bearer Token).
2. Push-Test über Admin/Web auslösen.
3. Dokument-Download und Login einmal auf iOS/Android gegen Oracle testen.
