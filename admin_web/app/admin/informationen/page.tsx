"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { CalendarClock, Clock3, Radio, RefreshCw, Timer } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { clearSession, getSession } from "@/lib/auth";
import { API_BASE } from "@/lib/api";
import { auth } from "@/lib/firebase";

type SessionUser = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role: string;
  assigned_mdb_user_id?: string | null;
};

type ParliamentPoint = {
  top?: string | null;
  title?: string | null;
  status?: string | null;
  article_id?: string | null;
  start_at?: string | null;
  end_at?: string | null;
};

type RollCall = {
  top?: string | null;
  title?: string | null;
  article_id?: string | null;
  article_title?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  duration_minutes?: number | null;
  location?: string | null;
  schedule_note?: string | null;
  pdf_url?: string | null;
  source_url?: string | null;
};

type ServiceDuty = {
  slot_id: string;
  date?: string | null;
  weekday?: string | null;
  slot_code?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  assignment_type?: string | null;
};

type FactionSpeech = {
  user_id?: string | null;
  speaker_name?: string | null;
  source_speaker_name?: string | null;
  role?: string | null;
  email?: string | null;
  top_labels?: string[] | null;
  top?: string | null;
  title?: string | null;
  planned_start_at?: string | null;
  effective_start_at?: string | null;
  live_matched?: boolean | null;
  notes?: string[] | null;
};

type FactionSpeechesResponse = {
  items?: FactionSpeech[];
  speeches?: FactionSpeech[];
};

type ParliamentInfo = {
  mode: string;
  generated_at: string;
  effective_at: string;
  session_running: boolean;
  speaker_live: boolean;
  speaker_topic_number?: string | null;
  speaker_names: string[];
  current_session?: {
    date?: string | null;
    date_text?: string | null;
    session_number?: string | null;
    name?: string | null;
    active?: boolean;
  } | null;
  current_top?: ParliamentPoint | null;
  next_top?: ParliamentPoint | null;
  next_roll_call?: RollCall | null;
  next_pgf_duty?: ServiceDuty | null;
  next_speech?: { title?: string | null; start_at?: string | null } | null;
  next_speech_source?: string | null;
  agenda_points: ParliamentPoint[];
};

const ALLOWED_EMAIL = "johannes.schaetzl.mdb@bundestag.de";

function canAccess(session?: SessionUser | null) {
  return session?.email?.toLowerCase() === ALLOWED_EMAIL;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function pointLabel(point?: ParliamentPoint | RollCall | null) {
  if (!point) return "—";
  const top = (point.top ?? "").toString().trim();
  const title = (point.title ?? "").toString().trim();
  if (top && title) return `${top} · ${title}`;
  return top || title || "—";
}

function normalizeTopLabels(value?: string | null) {
  const raw = (value ?? "").trim().toUpperCase();
  if (!raw) return [];
  const normalized = raw.replace(/\bTOP\s+/g, "").replace(/\bZP\s+/g, "ZP ");
  return normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export default function InformationenPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ParliamentInfo | null>(null);
  const [factionSpeeches, setFactionSpeeches] = useState<FactionSpeech[]>([]);
  const [selectedTop, setSelectedTop] = useState<string | null>(null);

  const loadInfo = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${API_BASE}/me/live-info`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      const [data, speechesRes] = await Promise.all([
        res.json() as Promise<ParliamentInfo>,
        fetch(`${API_BASE}/admin/kurzuebersicht/faction-speakers`, {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }),
      ]);
      setInfo(data);
      if (speechesRes.ok) {
        const speechesData = (await speechesRes.json()) as FactionSpeechesResponse;
        setFactionSpeeches(speechesData.speeches ?? speechesData.items ?? []);
      } else {
        setFactionSpeeches([]);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const localSession = getSession();
      if (!firebaseUser || !canAccess(localSession)) {
        clearSession();
        router.replace("/");
        return;
      }

      setSession(localSession);
      setLoading(false);
      await loadInfo();
    });

    return () => unsubscribe();
  }, [loadInfo, router]);

  useEffect(() => {
    if (!session) return;
    const interval = window.setInterval(() => {
      void loadInfo();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [loadInfo, session]);

  const runningBadge = useMemo(() => {
    if (!info) return null;
    if (info.session_running) {
      return <Badge className="rounded-full bg-emerald-600 hover:bg-emerald-600">Sitzung läuft</Badge>;
    }
    return <Badge variant="outline" className="rounded-full">Keine laufende Sitzung</Badge>;
  }, [info]);

  const speakersByTop = useMemo(() => {
    const grouped = new Map<string, FactionSpeech[]>();
    factionSpeeches.forEach((speech) => {
      const labels = [...(speech.top_labels ?? []), speech.top ?? null].flatMap((value) =>
        normalizeTopLabels(value),
      );
      labels.forEach((label) => {
        const existing = grouped.get(label) ?? [];
        existing.push(speech);
        grouped.set(label, existing);
      });
    });
    return grouped;
  }, [factionSpeeches]);

  if (loading || !session) {
    return <div className="p-8 text-sm text-slate-500">Lade Informationen…</div>;
  }

  return (
    <AdminShell
      title="Informationen"
      subtitle="Spiegel der Bundestag-Live-Daten für den späteren Mobile-Infoscreen."
      session={session}
      actions={
        <Button
          variant="outline"
          className="rounded-none"
          onClick={() => void loadInfo()}
          disabled={refreshing}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Aktualisieren
        </Button>
      }
    >
      <div className="space-y-6 p-6">
        <Card className="rounded-none border-slate-200">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-xl">Aktueller Sitzungsstatus</CardTitle>
                <p className="mt-1 text-sm text-slate-500">
                  Dieser Block zeigt genau die Live-Grundlage, aus der später der Mobile-Banner gebaut wird.
                </p>
              </div>
              {runningBadge}
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <InfoMetric
                icon={Clock3}
                label="Datenstand"
                value={formatDateTime(info?.generated_at)}
              />
              <InfoMetric
                icon={Timer}
                label="Wirksame Uhrzeit"
                value={formatDateTime(info?.effective_at)}
              />
              <InfoMetric
                icon={Radio}
                label="Speaker API"
                value={info?.speaker_live ? "live" : "nicht live"}
              />
              <InfoMetric
                icon={CalendarClock}
                label="Sitzung"
                value={info?.current_session?.name || "—"}
              />
            </div>

            {error ? (
              <div className="rounded-none border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700">
                {error}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-3">
          <InfoCard
            title="Aktuell laufender TOP"
            subtitle="Basis für den geplanten Live-Banner in der App."
            point={info?.current_top}
            emptyText="Zurzeit läuft laut Datenstand kein TOP."
          />
          <InfoCard
            title="Nächster TOP"
            subtitle="Wird später im Banner als nächster Punkt mit Startzeit gezeigt."
            point={info?.next_top}
            emptyText="Zurzeit ist kein nächster TOP erkennbar."
          />
          <RollCallCard rollCall={info?.next_roll_call} />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <SpeechCard speech={info?.next_speech} source={info?.next_speech_source} />
          <PgfDutyCard duty={info?.next_pgf_duty} />
        </div>

        <Card className="rounded-none border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl">Aktuelle Sitzungsagenda</CardTitle>
            <p className="text-sm text-slate-500">
              Hilfreich zur fachlichen Kontrolle, ob die Live-Zuordnung von aktuellem und nächstem TOP plausibel ist.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(info?.agenda_points ?? []).map((point, index) => {
                const isCurrent =
                  point.top === info?.current_top?.top && point.start_at === info?.current_top?.start_at;
                const isNext =
                  point.top === info?.next_top?.top && point.start_at === info?.next_top?.start_at;
                const topKeys = normalizeTopLabels(point.top);
                const speakers = Array.from(
                  new Map(
                    topKeys
                      .flatMap((key) => speakersByTop.get(key) ?? [])
                      .map((speaker, speakerIndex) => [
                        `${speaker.user_id ?? speaker.speaker_name ?? "speaker"}-${speaker.top ?? ""}-${speakerIndex}`,
                        speaker,
                      ]),
                  ).values(),
                );
                const topKey = topKeys.join("|");
                const isSelected = selectedTop === topKey;

                return (
                  <button
                    key={`${point.top ?? "no-top"}-${point.start_at ?? index}`}
                    type="button"
                    onClick={() => setSelectedTop(isSelected ? null : topKey)}
                    className="w-full border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs uppercase tracking-[0.24em] text-slate-500">
                              {point.top || "Ohne TOP"}
                            </span>
                            {isCurrent ? (
                              <Badge className="rounded-full bg-slate-900 hover:bg-slate-900">Aktuell</Badge>
                            ) : null}
                            {isNext ? (
                              <Badge variant="outline" className="rounded-full">Als Nächstes</Badge>
                            ) : null}
                            <Badge variant="outline" className="rounded-full">
                              {speakers.length} {speakers.length === 1 ? "Redner" : "Redner"}
                            </Badge>
                          </div>
                          <div className="mt-1 font-medium text-slate-900">{point.title || "Ohne Titel"}</div>
                        </div>
                        <div className="shrink-0 text-sm text-slate-500">
                          {formatTime(point.start_at)} – {formatTime(point.end_at)}
                        </div>
                      </div>
                      {isSelected ? (
                        <div className="border-t border-slate-200 pt-3">
                          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">
                            Redner zu diesem TOP
                          </div>
                          {speakers.length ? (
                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                              {speakers.map((speaker, speakerIndex) => {
                                const startAt = speaker.effective_start_at ?? speaker.planned_start_at;
                                return (
                                  <div
                                    key={`${speaker.user_id ?? speaker.speaker_name ?? "speaker"}-${speakerIndex}`}
                                    className="border border-slate-200 bg-slate-50 px-3 py-3"
                                  >
                                    <div className="font-medium text-slate-900">
                                      {speaker.speaker_name || speaker.source_speaker_name || "Unbekannt"}
                                    </div>
                                    {speaker.title ? (
                                      <div className="mt-1 text-sm text-slate-600">{speaker.title}</div>
                                    ) : null}
                                    <div className="mt-2 text-sm text-slate-500">
                                      Geplante Zeit: {formatTime(startAt)}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="mt-3 text-sm text-slate-500">
                              Für diesen TOP sind aktuell keine Redner aus der Kurzübersicht erfasst.
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}

function formatSlotTimeRange(start?: string | null, end?: string | null) {
  if (!start) return "—";
  const startLabel = start.slice(0, 5);
  const endLabel = end ? end.slice(0, 5) : null;
  return endLabel ? `${startLabel} bis ${endLabel}` : `${startLabel} Uhr`;
}

function InfoMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-slate-500">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <div className="mt-3 text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}

function InfoCard({
  title,
  subtitle,
  point,
  emptyText,
}: {
  title: string;
  subtitle: string;
  point?: ParliamentPoint | null;
  emptyText: string;
}) {
  return (
    <Card className="rounded-none border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{title}</CardTitle>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </CardHeader>
      <CardContent>
        {point ? (
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">
              {point.top || "Ohne TOP"}
            </div>
            <div className="text-base font-semibold text-slate-900">{point.title || "Ohne Titel"}</div>
            <div className="text-sm text-slate-500">
              {formatDateTime(point.start_at)} bis {formatTime(point.end_at)}
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">{emptyText}</div>
        )}
      </CardContent>
    </Card>
  );
}

function RollCallCard({ rollCall }: { rollCall?: RollCall | null }) {
  return (
    <Card className="rounded-none border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Nächste namentliche Abstimmung</CardTitle>
        <p className="text-sm text-slate-500">
          Diese Information soll später im Mobile-Infoscreen als eigener Kasten erscheinen.
        </p>
      </CardHeader>
      <CardContent>
        {rollCall ? (
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">
              {rollCall.top || "Ohne TOP"}
            </div>
            <div className="text-base font-semibold text-slate-900">{pointLabel(rollCall)}</div>
            <div className="text-sm text-slate-500">
              {formatDateTime(rollCall.start_at)} bis {formatTime(rollCall.end_at)}
            </div>
            {rollCall.duration_minutes || rollCall.location ? (
              <div className="text-sm text-slate-500">
                {[rollCall.duration_minutes ? `${rollCall.duration_minutes} Minuten` : null, rollCall.location]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            ) : null}
            {rollCall.schedule_note ? (
              <div className="text-sm text-slate-500">{rollCall.schedule_note}</div>
            ) : null}
            {rollCall.source_url ? (
              <div className="flex flex-wrap gap-4">
                <a
                  href={rollCall.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex text-sm font-medium text-[#E3000F] hover:underline"
                >
                  Offiziellen Bundestag-Artikel öffnen
                </a>
                {rollCall.pdf_url ? (
                  <a
                    href={rollCall.pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex text-sm font-medium text-[#E3000F] hover:underline"
                  >
                    Ablaufplan öffnen
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-sm text-slate-500">
            Für den aktuellen Datenstand wurde keine kommende namentliche Abstimmung erkannt.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SpeechCard({
  speech,
  source,
}: {
  speech?: { title?: string | null; start_at?: string | null } | null;
  source?: string | null;
}) {
  return (
    <Card className="rounded-none border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Nächste Rede</CardTitle>
        <p className="text-sm text-slate-500">
          Dieser Block bleibt sichtbar, bis wir eine belastbare offizielle Redequelle anbinden können.
        </p>
      </CardHeader>
      <CardContent>
        {speech ? (
          <div className="space-y-3">
            <div className="text-base font-semibold text-slate-900">{speech.title || "Rede"}</div>
            <div className="text-sm text-slate-500">{formatDateTime(speech.start_at)}</div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">
            {source === "not_available_yet"
              ? "Aktuell ist noch keine offizielle Redequelle im Backend angebunden."
              : "Für den aktuellen Datenstand wurde keine kommende Rede erkannt."}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PgfDutyCard({ duty }: { duty?: ServiceDuty | null }) {
  return (
    <Card className="rounded-none border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Nächster PGF-Dienst</CardTitle>
        <p className="text-sm text-slate-500">
          Dieser Block spiegelt die nächste eingeteilte PGF-Schicht des eingeloggten Nutzers.
        </p>
      </CardHeader>
      <CardContent>
        {duty ? (
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">
              {duty.slot_code || "Dienst"}
            </div>
            <div className="text-base font-semibold text-slate-900">
              {[duty.weekday, duty.date].filter(Boolean).join(" · ") || "Geplanter Dienst"}
            </div>
            <div className="text-sm text-slate-500">
              {formatSlotTimeRange(duty.start_time, duty.end_time)}
            </div>
            {duty.assignment_type ? (
              <div className="text-sm text-slate-500">
                Typ: {duty.assignment_type === "ruf" ? "Ruf" : "Aktiv"}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-sm text-slate-500">
            Für den eingeloggten Nutzer ist aktuell kein kommender PGF-Dienst hinterlegt.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
