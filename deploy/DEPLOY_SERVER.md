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
./deploy/deploy-server.sh
```

## Was das Skript macht
1. Prüft SSH-Zugriff und die Remote-Env-Dateien.
2. Synchronisiert `admin_web`, `api` und `deploy` nach `/opt/spd-app`.
3. Lässt die Compose-Services auf dem Server mit `--build` neu bauen.
4. Zeigt danach Container-Status und Health-URLs an.

## Wichtige Hinweise
- Das Skript überschreibt **nicht** die produktive `.env` und **nicht** die Secrets.
- Produktive Uploads bleiben erhalten, weil sie in Docker-Volumes liegen.
- Vor dem Deploy sollte der Stand lokal committed und nach GitHub gepusht sein.
