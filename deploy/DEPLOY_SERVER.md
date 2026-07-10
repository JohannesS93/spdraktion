# Server-Deploy (`spdfraktion-intern.de`)

## Ziel
- Admin-Web: `https://spdfraktion-intern.de`
- API: `https://api.spdfraktion-intern.de`

## Vorbedingungen
- SSH-Zugriff auf `root@147.93.126.127`
- Remote-Pfad: `/opt/spd-app`
- Remote-Env vorhanden: `/opt/spd-app/deploy/.env`
- Remote-Firebase-Secret vorhanden: `/opt/spd-app/deploy/secrets/firebase-adminsdk.json`

## Empfohlener Ablauf
```bash
cd /Users/johannesbt/spd-app
git status
./deploy/deploy-full.sh
```

## Verfügbare Skripte

### Voller Deploy
Für Änderungen an `admin_web`, `api` oder `deploy`:
```bash
cd /Users/johannesbt/spd-app
./deploy/deploy-full.sh
```

### Backend-Only-Deploy
Für reine API-Änderungen, deutlich ressourcenschonender:
```bash
cd /Users/johannesbt/spd-app
./deploy/deploy-backend.sh
```

### Alter Name bleibt gültig
```bash
./deploy/deploy-server.sh
```
Das ist jetzt nur noch ein Alias für den **vollen Deploy**.

## Was die Skripte machen
1. Prüfen SSH-Zugriff und die Remote-Env-Dateien.
2. Synchronisieren nur die jeweils nötigen Ordner nach `/opt/spd-app`.
3. Starten danach entweder:
   - `deploy-full.sh`: komplettes `docker compose up -d --build`
   - `deploy-backend.sh`: nur `api` mit `--build --no-deps`
4. Prüfen anschließend die Erreichbarkeit.

## Wichtige Hinweise
- Das Skript überschreibt **nicht** die produktive `.env` und **nicht** die Secrets.
- Produktive Uploads bleiben erhalten, weil sie in Docker-Volumes liegen.
- Vor dem Deploy sollte der Stand lokal committed und nach GitHub gepusht sein.
- Wenn sich eine Admin-Seite nicht geändert hat, obwohl der Backend-Deploy lief, fehlt meistens ein **voller Deploy**.
