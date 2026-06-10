# Mail-Import für Kurzübersicht

## Entscheidung

Für `webmaster@spdfraktion-intern.de` ist **IMAP-Polling** die robusteste erste Lösung.

Warum nicht Push:
- Strato stellt hier kein sauberes Inbound-Webhook-Verfahren bereit.
- `IMAP IDLE` wäre zwar näher an Push, ist aber als dauerhafte Langverbindung fragiler.
- Ein Polling-Lauf alle **5 Minuten** ist fachlich nah genug an Echtzeit und deutlich wartbarer.

## Passwort / Secret-Ablage

Lege die Zugangsdaten hier ab:

`/Users/johannesbt/spd-app/deploy/secrets/webmaster-imap.env`

Diese Datei ist bereits über `deploy/secrets/` in `.gitignore` geschützt.

Inhalt:

```env
MAIL_IMPORT_IMAP_HOST=imap.strato.de
MAIL_IMPORT_IMAP_PORT=993
MAIL_IMPORT_USERNAME=webmaster@spdfraktion-intern.de
MAIL_IMPORT_PASSWORD=DEIN_PASSWORT
MAIL_IMPORT_LOOKBACK_DAYS=14
MAIL_IMPORT_POLL_MINUTES=5
```

Als Vorlage liegt bereit:

`/Users/johannesbt/spd-app/deploy/mail-import.env.example`

## Was importiert wird

Der Import liest Mails aus dem Postfach und verarbeitet Anhänge nur dann, wenn der Inhalt wirklich eine Kurzübersicht ist.

Aktuell gilt:

- erste Seite bzw. Dokumentanfang muss mit `Kurzübersicht über Plenarthemen vom ...` arbeiten
- darunter muss eine `Stand:`-Zeile stehen
- importiert werden nur Anhänge im `pdf`-Format
- importiert wird nur, wenn dieser `Stand` neuer ist als der zuletzt importierte KÜ-Stand
- wenn eine Kombi-Datei auch die `Tagesordnung` enthält, wird dieser Teil vor dem Speichern abgeschnitten

Der gespeicherte Dateiname folgt immer dem Schema:

- `KÜ 24 Stand 10-Jun 11Uhr.pdf`

Alle importierten Dokumente werden aktuell an **alle aktiven Nutzer** verteilt.

## Deduplizierung

Damit derselbe Anhang nicht mehrfach angelegt wird, speichert das Backend pro:

- Mail-UID
- Dateiname
- Kategorie

einen Import-Eintrag in `mail_import_events`.

Zusätzlich wird bei Kurzübersichten der inhaltliche `Stand` geprüft.
Ist der Stand nicht neuer, wird die Datei nicht noch einmal verteilt.

## Manuell testen

Lokaler Einzel-Lauf:

```bash
cd /Users/johannesbt/spd-app/api
set -a
source /Users/johannesbt/spd-app/deploy/secrets/webmaster-imap.env
set +a
export FIREBASE_CRED_PATH=/Users/johannesbt/spd-app/deploy/secrets/firebase-adminsdk.json
export FIREBASE_PROJECT_ID=spd-fraktion-intern
export DATABASE_URL='postgresql://spd_app:056df5cb434d772303dee5c1452bdd1370bb7f06db006d01fc3f0effdff43433@127.0.0.1:15432/spd_prod'
./.venv/bin/python run_mail_import.py
```

Oder über den Admin-Endpunkt:

`POST /admin/mail-import/run`

## Automatisierung

Der produktive API-Container pollt das Postfach jetzt selbst automatisch.

Standard:

- `MAIL_IMPORT_POLL_MINUTES=5`

Wichtig:

- die Datei `deploy/secrets/webmaster-imap.env` wird beim Deploy automatisch mit auf den Server synchronisiert
- im Compose-Setup wird sie als optionales `env_file` an die API gehängt
- sobald Benutzername und Passwort vorhanden sind, startet der Poller beim API-Start automatisch

Zum Deaktivieren:

```env
MAIL_IMPORT_POLL_MINUTES=0
```

## Nächste sinnvolle Erweiterung

- eigene Anzeige für `ausgezeichnete_tagesordnung`
- eigene Anzeige für `pgf_dienste`
- optional Betreff-/Anhangsregeln weiter verfeinern
