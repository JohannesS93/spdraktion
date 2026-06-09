# Betriebs- und Änderungsworkflow

## Versionsmanagement

- Zentrales Repository: `main` auf GitHub
- Änderungen werden lokal entwickelt und als nachvollziehbare Commits gesichert
- Bei Problemen kann gezielt auf einen früheren Commit zurückgegangen werden
- Für größere Themen sollten eigene Arbeitsblöcke mit klaren Commit-Nachrichten genutzt werden

## Fehlermanagement

- Nutzer können Fehler direkt in der Mobile-App als Rückmeldung vom Typ `Fehler / Problem` melden
- Rückmeldungen landen serverseitig in `feedback_entries`
- Admin/PGF sieht alle Meldungen im Backend unter `Rückmeldungen`
- Status pro Meldung:
  - `Offen`
  - `In Prüfung`
  - `Erledigt`
  - `Zurückgestellt`

## Verbesserungsmanagement

- Nutzer können Verbesserungsvorschläge direkt in der Mobile-App melden
- Vorschläge laufen in dieselbe zentrale Rückmeldungsübersicht
- Rückmeldungen werden im Backend einheitlich verwaltet, damit keine Ideen verloren gehen

## Aktueller Produktstatus

- Das Tauschtool ist aktuell bewusst deaktiviert und nur ausgegraut sichtbar
- Freigabe erst nach späterer fachlicher und technischer Aktivierung
