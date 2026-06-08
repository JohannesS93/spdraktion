import Link from "next/link";

type Props = {
  /**
   * When set, renders a small "Back to Backend" link in the header area.
   * Useful for the in-backend view, but we keep the page public by default.
   */
  showBackendLink?: boolean;
};

const AS_OF_DATE = "05.05.2026";

export function PrivacyPolicy({ showBackendLink }: Props) {
  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-10">
      <div className="mb-8 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <img
              src="/spd-logo.png"
              alt="SPD"
              className="h-6 w-auto object-contain opacity-90"
            />
            <div className="text-sm font-medium text-slate-700">
              Fraktion Intern
            </div>
          </div>
          <h1 className="mt-4 text-balance text-3xl font-semibold text-slate-950">
            Datenschutzhinweise
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Stand: {AS_OF_DATE}
          </p>
        </div>

        {showBackendLink ? (
          <div className="shrink-0">
            <Link
              href="/backend"
              className="text-sm font-medium text-slate-700 underline underline-offset-4 hover:text-slate-950"
            >
              Zurueck ins Backend
            </Link>
          </div>
        ) : null}
      </div>

      <div className="space-y-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-950">
            1. Verantwortlicher
          </h2>
          <p className="text-sm leading-6 text-slate-700">
            Verantwortlicher im Sinne der DSGVO ist die SPD-Bundestagsfraktion
            (Fraktion im Deutschen Bundestag), Platz der Republik 1, 11011
            Berlin.
          </p>
          <p className="text-sm leading-6 text-slate-700">
            Kontakt (Support/Datenschutz): Bitte trage hier eine zentrale
            Kontaktadresse:{" "}
            <span className="font-medium">johannes.schaetzl@bundestag.de</span>.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-950">
            2. Geltungsbereich
          </h2>
          <p className="text-sm leading-6 text-slate-700">
            Diese Datenschutzhinweise gelten fuer die iOS-App{" "}
            <span className="font-medium">Fraktion Intern</span> sowie das dazu
            gehoerige Web-Backend (Administration) und die Server-API.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-950">
            3. Welche Daten wir verarbeiten (Ueberblick)
          </h2>
          <div className="space-y-3 text-sm leading-6 text-slate-700">
            <p>
              Wir verarbeiten personenbezogene Daten, um Nutzerkonten zu
              verwalten, Inhalte bereitzustellen (z. B. Mitteilungen, Dokumente)
              und organisatorische Prozesse zu unterstuetzen (z. B.
              Praesenzdienste, Tauschfunktionen, Auswertungen).
            </p>
            <div>
              <p className="font-medium text-slate-900">Typische Datenkategorien:</p>
              <ul className="mt-1 list-disc pl-5">
                <li>Stammdaten: Vorname, Nachname, E-Mail-Adresse, Rolle und organisatorische Zuordnungen.</li>
                <li>Login-/Sitzungsdaten: Firebase-ID-Token (kurzlebig), technische Sitzungsinformationen im Browser.</li>
                <li>App-/Geraetedaten fuer Push: FCM-Registrierungstoken, Plattform (iOS/Android) und Zeitstempel.</li>
                <li>Inhaltsdaten: Mitteilungen (Text, Dringlichkeit, Absendername), Dokumenttitel/Metadaten sowie hochgeladene Dateien.</li>
                <li>Organisationsdaten: Slot-Teilnahmen, Tauschvorgaenge, Zuordnungen (z. B. Mitarbeitende zu MdB).</li>
                <li>Protokolldaten: Server-Logs (z. B. Zeitpunkte, Fehler, ggf. IP-Adresse in Logfiles).</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-950">
            4. Zwecke und Funktionsbausteine
          </h2>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">
              4.1 Authentifizierung (Firebase Authentication)
            </h3>
            <p className="text-sm leading-6 text-slate-700">
              Fuer die Anmeldung verwenden wir Firebase Authentication (Google).
              Dabei wird die E-Mail-Adresse als Nutzerkennung genutzt. Passwoerter
              werden nicht in unserer Postgres-Datenbank gespeichert, sondern
              durch den Authentifizierungsdienst verwaltet.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">
              4.2 Inhalte, Planung und Administration (Server-API + Postgres)
            </h3>
            <p className="text-sm leading-6 text-slate-700">
              Die App und das Backend greifen auf eine Server-API zu, die Daten
              in einer PostgreSQL-Datenbank verarbeitet (z. B. Nutzerverwaltung,
              Praesenzdienste/Slots, direkte Personenzuordnungen,
              Tauschvorgaenge, Mitteilungen und
              Dokumente).
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">
              4.3 Push-Benachrichtigungen (Firebase Cloud Messaging / Apple APNs)
            </h3>
            <p className="text-sm leading-6 text-slate-700">
              Wenn du Push-Benachrichtigungen aktivierst, speichert die App einen
              technischen Geraeteschluessel (FCM-Registrierungstoken) auf dem
              Server, um Benachrichtigungen zuzustellen (z. B. neue Mitteilungen
              oder Dokumenthinweise). Die Zustellung erfolgt ueber Firebase Cloud
              Messaging und Apple Push Notification service (APNs). Du kannst Push
              jederzeit in den iOS-Einstellungen deaktivieren.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">
              4.4 Dateiverwaltung (Uploads)
            </h3>
            <p className="text-sm leading-6 text-slate-700">
              Im Backend koennen Dokumente hochgeladen und an Nutzer verteilt
              werden. Dabei speichern wir Datei-Inhalte sowie
              Metadaten (z. B. Titel, Zuordnung, Zeitpunkt).
            </p>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-950">
            5. Rechtsgrundlagen (Hinweis)
          </h2>
          <p className="text-sm leading-6 text-slate-700">
            Die konkrete Rechtsgrundlage haengt vom Einsatzkontext ab (interne
            Organisation, ggf. Beschaeftigten-/Mitarbeitendenkontext). Typische
            Grundlagen koennen Art. 6 Abs. 1 lit. b (Vertrag/Vertragsaehnliches
            Nutzungsverhaeltnis), Art. 6 Abs. 1 lit. f (berechtigtes Interesse)
            und ggf. nationale Regelungen (z. B. § 26 BDSG) sein. Bitte lass die
            Rechtsgrundlage im Zweifel juristisch pruefen.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-950">
            6. Empfaenger / eingesetzte Dienstleister
          </h2>
          <div className="space-y-2 text-sm leading-6 text-slate-700">
            <p>
              Zur Bereitstellung der App/Services setzen wir u. a. folgende
              Anbieter ein:
            </p>
            <ul className="list-disc pl-5">
              <li>
                <span className="font-medium">Google Firebase</span> (Authentication,
                Cloud Messaging) als Identity- und Push-Dienst.
              </li>
              <li>
                <span className="font-medium">Apple</span> (APNs) zur Zustellung
                von Push-Benachrichtigungen auf iOS-Geraete.
              </li>
              <li>
                <span className="font-medium">Oracle Cloud Infrastructure (OCI)</span>{" "}
                fuer Hosting (Server/DB/Storage) der Backend-Komponenten.
              </li>
            </ul>
            <p>
              Mit Dienstleistern, die als Auftragsverarbeiter agieren, sollten
              entsprechende Vertraege (AVV) abgeschlossen werden.
            </p>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-950">
            7. Datenuebermittlungen in Drittländer
          </h2>
          <p className="text-sm leading-6 text-slate-700">
            Bei der Nutzung von Firebase/Google kann eine Verarbeitung in
            Drittlaendern (z. B. USA) nicht ausgeschlossen werden. Google stellt
            in der Regel geeignete Garantien (z. B. Standardvertragsklauseln)
            bereit. Bitte pruefe/konfiguriere dies projektspezifisch in den
            jeweiligen Admin-Konsolen.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-950">
            8. Speicherdauer / Loeschung
          </h2>
          <div className="space-y-2 text-sm leading-6 text-slate-700">
            <p>
              Wir speichern Daten nur so lange, wie es fuer die Zwecke erforderlich
              ist oder gesetzliche Aufbewahrungsfristen bestehen.
            </p>
            <ul className="list-disc pl-5">
              <li>Nutzerkonten: bis zur Deaktivierung/Loeschung durch Administration.</li>
              <li>Push-Token: bis zur Abmeldung/Token-Rotation oder Loeschung; ungueltige Tokens werden bereinigt.</li>
              <li>Mitteilungen/Dokumente: entsprechend organisatorischer Erfordernisse; Loeschfunktionen koennen bereitgestellt werden.</li>
            </ul>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-950">
            9. Deine Rechte
          </h2>
          <p className="text-sm leading-6 text-slate-700">
            Du hast (im Rahmen der gesetzlichen Voraussetzungen) das Recht auf
            Auskunft, Berichtigung, Loeschung, Einschraenkung der Verarbeitung,
            Datenuebertragbarkeit sowie Widerspruch. Zudem besteht ein
            Beschwerderecht bei einer Datenschutzaufsichtsbehoerde.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-950">
            10. Sicherheit
          </h2>
          <p className="text-sm leading-6 text-slate-700">
            Wir setzen technische und organisatorische Massnahmen ein, um Daten
            zu schuetzen (u. a. TLS-Verschluesselung beim Transport, rollenbasierte
            Zugriffssteuerung im Backend). Bitte beachte, dass absolute Sicherheit
            nicht garantiert werden kann.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-950">
            11. Aenderungen
          </h2>
          <p className="text-sm leading-6 text-slate-700">
            Wir koennen diese Datenschutzhinweise anpassen, wenn sich Funktionen
            oder rechtliche Anforderungen aendern. Die jeweils aktuelle Fassung
            ist ueber diese Seite abrufbar.
          </p>
        </section>
      </div>

      <div className="mt-6 text-xs text-slate-500">
        Hinweis: Dieser Text ist als technische Basis gedacht und sollte vor
        dem App-Store-Release durch Datenschutz/Legal final geprueft werden.
      </div>
    </div>
  );
}
