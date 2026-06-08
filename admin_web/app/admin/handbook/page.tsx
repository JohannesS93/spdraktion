"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  FileText,
  Pencil,
  Settings,
} from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { clearSession, getSession } from "@/lib/auth";
import { auth } from "@/lib/firebase";

type SessionUser = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role: string;
  assigned_mdb_user_id?: string | null;
};

type HandbookButton = {
  label: string;
  description: string;
};

type HandbookSection = {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  summary: string;
  whenToUse: string;
  steps: string[];
  buttons: HandbookButton[];
  notes?: string[];
};

function canAccess(role?: string | null) {
  return role === "admin" || role === "pgf" || role === "mdb" || role === "staff";
}

const QUICK_START_STEPS = [
  "1. In Einstellungen zuerst das passende Standardslot-Template prüfen oder anpassen.",
  "2. Im Planer unter `Sitzungswoche anlegen` die neue Woche aus dem gewünschten Template erzeugen.",
  "3. Danach im Planer auf `Sitzungswoche einteilen` wechseln, Woche auswählen und `Vorschlag berechnen` ausführen.",
  "4. Ergebnis prüfen, Hinweise lesen und den Lauf erst mit `In Slots übernehmen` festschreiben, wenn die Verteilung passt.",
  "5. Einzelne Ausnahmen und Feinkorrekturen danach nur noch im Bereich Slots nacharbeiten.",
  "6. Zum Schluss in Statistik kontrollieren, ob Umfang, offene Enden und Freitag-Nachmittage plausibel sind.",
];

const GENERAL_BUTTONS: HandbookButton[] = [
  {
    label: "Handbuch öffnen",
    description: "Öffnet dieses Handbuch direkt aus einer Fachseite, ohne die aktuelle Arbeit im Kopf verlassen zu müssen.",
  },
  {
    label: "Aktualisieren",
    description: "Lädt die Daten der aktuellen Seite neu. Sinnvoll nach Änderungen durch andere Personen oder nach größeren Bearbeitungsschritten.",
  },
  {
    label: "Logout",
    description: "Meldet dich aus der Verwaltungsoberfläche ab.",
  },
  {
    label: "Datenschutz",
    description: "Öffnet die Datenschutzseite in einem neuen Fenster.",
  },
  {
    label: "Test-Push senden",
    description: "Sendet eine Testnachricht aus dem Backend. Dieser Button ist nur für Admin oder PGF gedacht.",
  },
];

const SECTIONS: HandbookSection[] = [
  {
    title: "Planer",
    href: "/admin/planner",
    icon: CalendarDays,
    summary: "Hier entstehen Sitzungswochen und automatische Planungsläufe.",
    whenToUse: "Immer dann, wenn eine neue Sitzungswoche angelegt oder automatisch verteilt werden soll.",
    steps: [
      "Wechsle zuerst zwischen `Wochenplanung` und `Präsenzregeln`. `Wochenplanung` ist für die eigentliche Verteilung, `Präsenzregeln` für dauerhafte Sperren und Befreiungen.",
      "Im Modus `Sitzungswoche anlegen` öffnest du den Dialog zur Erstellung einer neuen Woche. Dort wählst du Wochenstart und Standardslot-Template aus.",
      "Nach dem Speichern wechselst du in den Modus `Sitzungswoche einteilen`.",
      "Suche oder filtere die gewünschte Woche und klicke die Wochenkarte an. Erst danach arbeitet der Planer für genau diese Woche.",
      "Klicke auf `Vorschlag berechnen`. Damit wird ein neuer Planungslauf erzeugt, aber noch nichts endgültig in die Slots geschrieben.",
      "Prüfe danach die Ergebnisblöcke: Hinweise, offene Punkte, Verteilung pro MdB und die Detailansicht je Person.",
      "Wenn die Verteilung stimmt, klicke `In Slots übernehmen`. Erst dieser Schritt schreibt den berechneten Lauf in die echten Slots.",
      "Wenn nur einzelne Details nachkorrigiert werden müssen, wechsle über `Feinpflege in Slots` in die Slot-Seite, statt einen ganzen Lauf neu zu denken.",
      "Im Bereich `Präsenzregeln` wählst du links Person und Template, schaltest `Komplett befreit` oder setzt einzelne Standardslot-Sperren.",
      "Wenn beim Speichern gefragt wird, ob eine Regel rückwirkend gelten soll, bedeutet `rückwirkend`: Die Person wird aus bestehenden Zuweisungen entfernt, es erfolgt aber keine automatische Neuverteilung.",
    ],
    buttons: [
      {
        label: "Wochenplanung",
        description: "Zeigt nur die Arbeitsfläche zum Erstellen und Einteilen von Sitzungswochen.",
      },
      {
        label: "Präsenzregeln",
        description: "Öffnet die getrennte Pflege dauerhafter Regeln pro Person.",
      },
      {
        label: "Sitzungswoche anlegen",
        description: "Startet den Erstellungsfluss für eine neue Sitzungswoche aus einem Standardslot-Template.",
      },
      {
        label: "Sitzungswoche einteilen",
        description: "Zeigt die lineare Arbeitsansicht für Auswahl, Berechnung, Prüfung und Übernahme.",
      },
      {
        label: "Aktuell & kommend",
        description: "Filtert die Wochenliste auf die aktuell relevante und die kommenden Sitzungswochen.",
      },
      {
        label: "Alle Wochen",
        description: "Blendet die vollständige Wochenhistorie ein.",
      },
      {
        label: "Leere Sitzungswochen",
        description: "Zeigt gezielt Wochen ohne oder mit sehr wenig Zuweisungen, damit unbearbeitete Fälle schneller auffallen.",
      },
      {
        label: "Vorschlag berechnen",
        description: "Erzeugt einen neuen Planungslauf für die ausgewählte Woche. Das Ergebnis ist zunächst nur ein Vorschlag.",
      },
      {
        label: "In Slots übernehmen",
        description: "Schreibt den ausgewählten Vorschlag verbindlich in die Slot-Zuweisungen.",
      },
      {
        label: "Feinpflege in Slots",
        description: "Springt in die Slot-Seite für spätere Einzelkorrekturen.",
      },
      {
        label: "Sperre hinzufügen",
        description: "Verbietet einer ausgewählten Person einen bestimmten Standardslot aus dem gewählten Template.",
      },
      {
        label: "Nur künftig speichern",
        description: "Speichert eine neue Regel nur für spätere Planungen. Bereits vorhandene Zuweisungen bleiben unberührt.",
      },
      {
        label: "Rückwirkend anwenden",
        description: "Entfernt die betroffene Person aus bestehenden Zuweisungen, verteilt aber nicht automatisch neu.",
      },
      {
        label: "Entfernen",
        description: "Löscht eine bestehende Standardslot-Sperre der aktuell ausgewählten Person.",
      },
    ],
    notes: [
      "Ein berechneter Vorschlag ist noch kein veröffentlichter Wochenplan.",
      "Rückwirkende Regeln sind stark wirksam. Danach sollte die betroffene Woche in Slots oder erneut per Planungslauf geprüft werden.",
    ],
  },
  {
    title: "Einstellungen",
    href: "/admin/settings",
    icon: Settings,
    summary: "Hier wird die Grundlogik neuer Sitzungswochen gepflegt.",
    whenToUse: "Immer vor dem ersten Anlegen einer neuen Wochenart oder wenn Standardbesetzungen und Standardslots angepasst werden sollen.",
    steps: [
      "Lege links bei Bedarf zuerst ein neues Template an, wenn eine neue Wochenlogik benötigt wird.",
      "Wähle danach in der Template-Liste das Template aus, das du bearbeiten möchtest.",
      "Prüfe im oberen Bereich Name, Standardstatus sowie die Werte `Standard Aktiv pro Slot` und `Standard Ruf pro Slot`.",
      "Nutze `Import aus Tabelle`, wenn eine komplette Template-Struktur aus Excel oder CSV übernommen werden soll.",
      "Nutze `Standardslot ergänzen`, wenn nur einzelne Slots ergänzt oder Sonderfälle nach dem Import nachgezogen werden sollen.",
      "Pflege in der `Slot-Liste` einzelne Standardslots nach: Wochentag, Code, Reihenfolge, Tag-Offset, Zeiten, Open End, Aktiv/Ruf-Overrides und Vollanwesenheit.",
      "Speichere Änderungen an einzelnen Slot-Zeilen immer explizit mit `Speichern`.",
      "Wenn ein Template künftig die Standardgrundlage für neue Sitzungswochen sein soll, setze es mit `Als Standard setzen` als aktive Standardvorlage.",
    ],
    buttons: [
      {
        label: "Template erstellen",
        description: "Legt eine neue leere Vorlage an, die danach importiert oder manuell befüllt werden kann.",
      },
      {
        label: "Bearbeiten",
        description: "Speichert die Änderungen an Namen und Standardbesetzungen des aktuell ausgewählten Templates.",
      },
      {
        label: "Als Standard setzen",
        description: "Markiert das aktuelle Template als Standardvorlage für neue Sitzungswochen.",
      },
      {
        label: "Importieren",
        description: "Liest den eingefügten Tabellenblock ein und ersetzt die komplette aktuelle Slot-Struktur des gewählten Templates.",
      },
      {
        label: "Standardslot hinzufügen",
        description: "Erzeugt einen einzelnen zusätzlichen Standardslot im ausgewählten Template.",
      },
      {
        label: "Speichern",
        description: "Sichert Änderungen an genau einer Standardslot-Zeile.",
      },
      {
        label: "Löschen",
        description: "Entfernt entweder das aktuelle Template oder einen einzelnen Standardslot. Vor dem Löschen immer prüfen, was genau gerade ausgewählt ist.",
      },
      {
        label: "Open End",
        description: "Markiert einen Slot als offen endend. In der Planung und Statistik wird dieser Slot besonders behandelt.",
      },
      {
        label: "Vollanwesenheit",
        description: "Setzt für diesen Standardslot alle planbaren MdBs aktiv in den Slot.",
      },
    ],
    notes: [
      "Der Tabellenimport ersetzt die bestehende Struktur vollständig. Vorher prüfen, ob wirklich das richtige Template ausgewählt ist.",
      "Aktiv- oder Ruf-Overrides überschreiben nur den einzelnen Standardslot, nicht das ganze Template.",
    ],
  },
  {
    title: "Slots",
    href: "/admin/slots",
    icon: Pencil,
    summary: "Hier findet die Feinarbeit an bereits vorhandenen Slots statt.",
    whenToUse: "Wenn eine Woche schon existiert und einzelne Slots, Teilnehmer oder Zeiträume manuell geprüft oder geändert werden müssen.",
    steps: [
      "Wähle zuerst links die passende Sitzungswoche aus.",
      "Nutze die Suche, wenn du nur bestimmte Slot-Codes innerhalb der Woche sehen möchtest.",
      "Öffne mit `Teilnehmer` die Personenliste eines konkreten Slots, um die Besetzung zu kontrollieren.",
      "Wenn ein MdB für eine Sitzung temporär die Sitzungsleitung übernimmt, vergib im Teilnehmer-Dialog `temporäre PGF-Rechte` mit klarem Beginn und Ende.",
      "Dieses temporäre Recht ist zeitbezogen. Es öffnet nur die nötige Abhak-Funktion im gültigen Zeitfenster und macht den MdB nicht allgemein zu PGF.",
      "Wenn du Verwaltungsrechte hast, kannst du einzelne Slots bearbeiten oder löschen.",
      "Nutze `Zeitraum löschen` nur für größere Korrekturen, wenn ein zusammenhängender Datumsbereich entfernt werden soll.",
      "Speichere Änderungen in Dialogen immer aktiv ab. Geschlossene Dialoge ohne Speichern übernehmen nichts.",
    ],
    buttons: [
      {
        label: "Suchen",
        description: "Filtert die bereits geladene Woche nach dem eingegebenen Slot-Code.",
      },
      {
        label: "Teilnehmer",
        description: "Öffnet die Teilnehmerliste eines Slots. Für normale Nutzer werden nur tatsächlich zugewiesene Personen gezeigt.",
      },
      {
        label: "PGF-Rechte vergeben",
        description: "Vergibt einem einzelnen MdB für ein definiertes Zeitfenster die nötigen Rechte für die Sitzungsleitung und das Abhaken.",
      },
      {
        label: "PGF-Rechte entziehen",
        description: "Entfernt ein zuvor vergebenes temporäres PGF-Zeitfenster wieder.",
      },
      {
        label: "Stift-Symbol",
        description: "Bearbeitet einen einzelnen vorhandenen Slot.",
      },
      {
        label: "Papierkorb-Symbol",
        description: "Löscht genau den ausgewählten Slot.",
      },
      {
        label: "Zeitraum löschen",
        description: "Löscht alle Slots im gewählten Datumsbereich innerhalb des aktuell geladenen Ausschnitts.",
      },
      {
        label: "Offenes Ende",
        description: "Kennzeichnet im Slot-Dialog, dass dieser Slot kein festes Endzeitfeld hat.",
      },
      {
        label: "Speichern",
        description: "Übernimmt die Änderungen aus dem Slot-Dialog.",
      },
    ],
    notes: [
      "Die Slot-Seite ist bewusst für Nacharbeit gedacht, nicht für die komplette Erstverteilung einer Woche.",
      "Temporäre PGF-Rechte sind zeitbezogen. Sie sollen nur die Sitzungsleitung in einem klaren Zeitraum unterstützen und keine allgemeinen PGF-Rechte ersetzen.",
    ],
  },
  {
    title: "Statistik",
    href: "/admin/stats/attendance",
    icon: BarChart3,
    summary: "Die Auswertung ist in Anwesenheit und eingeplante Dienste getrennt.",
    whenToUse: "Wenn kontrolliert werden soll, wie viele Dienste geplant, erledigt oder in bestimmten Mustern verteilt wurden.",
    steps: [
      "Wähle zuerst die passende Unterseite: `Anwesenheit` oder `Eingeplante Dienste`.",
      "Setze bei Bedarf einen Zeitraum mit `Von` und `Bis`.",
      "Filtere zusätzlich über den Namen, wenn nur einzelne Personen betrachtet werden sollen.",
      "Prüfe in `Anwesenheit`, wie viele geplante Dienste tatsächlich erledigt wurden.",
      "Prüfe in `Eingeplante Dienste`, wie viele Dienste insgesamt geplant wurden und welche Sonderlasten wie offenes Ende oder Freitag-Nachmittag vorkommen.",
      "Nutze die Exportfunktionen nur dann, wenn du eine Weitergabe, Ablage oder externe Abstimmung brauchst.",
    ],
    buttons: [
      {
        label: "Filtern",
        description: "Lädt die Statistik mit dem aktuell gewählten Zeitraum neu.",
      },
      {
        label: "Filter zurücksetzen",
        description: "Entfernt den Namensfilter in der aktuellen Ansicht.",
      },
      {
        label: "Export PDF",
        description: "Öffnet die Druckansicht der Anwesenheitsstatistik zur PDF-Ausgabe.",
      },
      {
        label: "CSV exportieren",
        description: "Erzeugt eine CSV-Datei der eingeplanten Dienste inklusive Detailterminen.",
      },
      {
        label: "Pfeil auf / Pfeil zu",
        description: "Blendet in `Eingeplante Dienste` die Detailansicht einer Person ein oder aus.",
      },
    ],
    notes: [
      "Die Detailansichten in `Eingeplante Dienste` sind absichtlich zunächst eingeklappt, damit nur die Gesamtlast sofort sichtbar ist.",
    ],
  },
  {
    title: "Dateien",
    href: "/admin/documents",
    icon: FileText,
    summary: "Hier liegen ergänzende Unterlagen außerhalb der eigentlichen Planung.",
    whenToUse: "Wenn Dateien hochgeladen, nachgeschlagen oder für andere Beteiligte bereitgestellt werden sollen.",
    steps: [
      "Öffne den Bereich, wenn du Begleitdokumente, Tabellen oder Vorlagen brauchst.",
      "Nutze diesen Bereich für Inhalte, nicht für die eigentliche Planung oder Regelpflege.",
      "Wenn ein Arbeitsablauf dauerhaft erklärt werden muss, ist das Handbuch der richtige Ort für die Bedienung und der Dokumentenbereich der richtige Ort für Zusatzmaterial.",
    ],
    buttons: [
      {
        label: "Löschen",
        description: "Entfernt ein Dokument endgültig aus der Liste.",
      },
    ],
  },
];

function HandbookSectionCard({ section }: { section: HandbookSection }) {
  const Icon = section.icon;

  return (
    <Card className="admin-card border-slate-300">
      <CardHeader className="admin-card-header">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Icon className="h-4 w-4" />
              {section.title}
            </CardTitle>
            <div className="mt-1 text-sm text-slate-500">{section.summary}</div>
          </div>
          <Link href={section.href}>
            <Button className="admin-btn" variant="outline">
              Bereich öffnen
            </Button>
          </Link>
        </div>
      </CardHeader>

      <CardContent className="admin-section space-y-6 p-5">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="text-sm font-semibold text-slate-900">Wann nutze ich diesen Bereich?</div>
          <div className="mt-2 text-sm text-slate-700">{section.whenToUse}</div>
        </div>

        <div>
          <div className="text-sm font-semibold text-slate-900">Schritt für Schritt</div>
          <div className="mt-3 space-y-3 text-sm text-slate-700">
            {section.steps.map((step) => (
              <div key={step}>{step}</div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold text-slate-900">Buttons und wichtige Aktionen</div>
          <div className="mt-3 space-y-3">
            {section.buttons.map((button) => (
              <div key={button.label} className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{button.label}</Badge>
                </div>
                <div className="mt-2 text-sm text-slate-700">{button.description}</div>
              </div>
            ))}
          </div>
        </div>

        {section.notes?.length ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
            <div className="text-sm font-semibold text-amber-900">Wichtig zu beachten</div>
            <div className="mt-3 space-y-2 text-sm text-amber-900">
              {section.notes.map((note) => (
                <div key={note}>{note}</div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function HandbookPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const localSession = getSession();

      if (!firebaseUser || !localSession || !canAccess(localSession.role)) {
        clearSession();
        setSessionState(null);
        setAuthReady(true);
        router.replace("/login");
        return;
      }

      setSessionState(localSession as SessionUser);
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, [router]);

  if (!authReady) return <div className="p-6">Lade…</div>;
  if (!session) return null;

  return (
    <AdminShell
      session={session}
      title="Handbuch"
      subtitle="Ausführliche Anleitung für Arbeitsabläufe, Seiten und wichtige Buttons der Anwendung."
    >
      <Card className="admin-card border-slate-300">
        <CardHeader className="admin-card-header">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <BookOpen className="h-4 w-4" />
            Empfohlener Gesamtablauf
          </CardTitle>
        </CardHeader>
        <CardContent className="admin-section p-5">
          <div className="space-y-3 text-sm text-slate-700">
            {QUICK_START_STEPS.map((step) => (
              <div key={step}>{step}</div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="admin-card border-slate-300">
        <CardHeader className="admin-card-header">
          <CardTitle className="text-base font-semibold">Allgemeine Buttons in der Oberfläche</CardTitle>
        </CardHeader>
        <CardContent className="admin-section p-5">
          <div className="space-y-3">
            {GENERAL_BUTTONS.map((button) => (
              <div key={button.label} className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{button.label}</Badge>
                </div>
                <div className="mt-2 text-sm text-slate-700">{button.description}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {SECTIONS.map((section) => (
          <HandbookSectionCard key={section.href} section={section} />
        ))}
      </div>
    </AdminShell>
  );
}
