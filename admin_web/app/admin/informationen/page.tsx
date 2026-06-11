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
  has_live_time?: boolean | null;
  live_state?: string | null;
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
  viewer?: {
    user_id?: string | null;
    role?: string | null;
    principal_user_id?: string | null;
    principal_name?: string | null;
  } | null;
  current_top?: ParliamentPoint | null;
  next_top?: ParliamentPoint | null;
  session_days?: Array<{
    date?: string | null;
    date_text?: string | null;
    session_number?: string | null;
    name?: string | null;
    active?: boolean;
    selected?: boolean;
  }>;
  next_roll_call?: RollCall | null;
  weekly_roll_calls?: RollCall[];
  next_pgf_duty?: ServiceDuty | null;
  next_speech?: { title?: string | null; start_at?: string | null } | null;
  next_speech_source?: string | null;
  agenda_points: ParliamentPoint[];
};

function canAccess(session?: SessionUser | null) {
  return Boolean(session?.email);
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

  const parts = raw
    .replace(/\s+/g, " ")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const labels: string[] = [];

  const pushLabel = (prefix: string | null, number: string) => {
    labels.push(prefix === "ZP" ? `ZP ${number}` : number);
  };

  for (const part of parts) {
    const rangeMatch = part.match(/^(TOP|ZP)?\s*(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const prefix = rangeMatch[1] ?? null;
      const start = Number(rangeMatch[2]);
      const end = Number(rangeMatch[3]);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        for (let current = start; current <= end; current += 1) {
          pushLabel(prefix, String(current));
        }
        continue;
      }
    }

    const plusMatch = part.match(/^(TOP|ZP)?\s*(\d+)\+(\d+)$/);
    if (plusMatch) {
      const prefix = plusMatch[1] ?? null;
      pushLabel(prefix, plusMatch[2]);
      pushLabel(prefix, plusMatch[3]);
      continue;
    }

    const simpleMatch = part.match(/^(TOP|ZP)?\s*(\d+[A-Z]?)$/);
    if (simpleMatch) {
      pushLabel(simpleMatch[1] ?? null, simpleMatch[2]);
      continue;
    }

    labels.push(part.replace(/\bTOP\s+/g, "").replace(/\bZP\s+/g, "ZP "));
  }

  return Array.from(new Set(labels));
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function endOfWeek(date: Date) {
  const copy = startOfWeek(date);
  copy.setDate(copy.getDate() + 6);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function isoDatePart(value?: string | null) {
  return value ? value.slice(0, 10) : null;
}

export default function InformationenPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ParliamentInfo | null>(null);
  const [agendaInfo, setAgendaInfo] = useState<ParliamentInfo | null>(null);
  const [factionSpeeches, setFactionSpeeches] = useState<FactionSpeech[]>([]);
  const [selectedTop, setSelectedTop] = useState<string | null>(null);
  const [selectedSessionDate, setSelectedSessionDate] = useState<string | null>(null);

  const fetchFactionSpeeches = useCallback(
    async (token?: string | null, suffix = "") => {
      try {
        const speechesRes = await fetch(`${API_BASE}/me/faction-speakers${suffix}`, {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!speechesRes.ok) {
          setFactionSpeeches([]);
          return;
        }
        const speechesData = (await speechesRes.json()) as FactionSpeechesResponse;
        setFactionSpeeches(speechesData.speeches ?? speechesData.items ?? []);
      } catch {
        setFactionSpeeches([]);
      }
    },
    [],
  );

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
      const data = (await res.json()) as ParliamentInfo;
      setInfo(data);
      setAgendaInfo((previous) => previous ?? data);
      setSelectedSessionDate((previous) => previous ?? data.current_session?.date ?? null);
      await fetchFactionSpeeches(token);
    } catch (err) {
      setError(String(err));
    } finally {
      setRefreshing(false);
    }
  }, [fetchFactionSpeeches]);

  const loadAgendaForDate = useCallback(async (sessionDate?: string | null) => {
    if (!sessionDate) return;
    setRefreshing(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const query = new URLSearchParams({ at: `${sessionDate}T12:00:00+02:00` });
      const suffix = `?${query.toString()}`;
      const agendaRes = await fetch(`${API_BASE}/me/live-info${suffix}`, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!agendaRes.ok) {
        const text = await agendaRes.text().catch(() => "");
        throw new Error(text || `HTTP ${agendaRes.status}`);
      }
      const data = (await agendaRes.json()) as ParliamentInfo;
      setAgendaInfo(data);
      setSelectedSessionDate(sessionDate);
      setSelectedTop(null);
      await fetchFactionSpeeches(token, suffix);
    } catch (err) {
      setError(String(err));
    } finally {
      setRefreshing(false);
    }
  }, [fetchFactionSpeeches]);

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

  const visibleSessionDays = useMemo(() => {
    const days = info?.session_days ?? [];
    if (!days.length) return [];
    const baseDate = new Date(selectedSessionDate ?? info?.current_session?.date ?? info?.effective_at ?? Date.now());
    if (Number.isNaN(baseDate.getTime())) return days;
    const weekStart = startOfWeek(baseDate);
    const weekEnd = endOfWeek(baseDate);
    return days.filter((day) => {
      if (!day.date) return false;
      const current = new Date(`${day.date}T12:00:00+02:00`);
      return current >= weekStart && current <= weekEnd;
    });
  }, [info, selectedSessionDate]);

  const isAgendaLiveDay = Boolean(
    selectedSessionDate &&
      info?.current_session?.date &&
      selectedSessionDate === info.current_session.date,
  );

  if (loading || !session) {
    return <div className="p-8 text-sm text-slate-500">Lade Informationen…</div>;
  }

  return (
    <AdminShell
      title="Informationen"
      subtitle="Aktuelle Informationen aus Sitzung, Agenda und Rednerfolge."
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
              <CardTitle className="text-xl">Aktueller Sitzungsstatus</CardTitle>
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
            point={info?.current_top}
            emptyText="Zurzeit läuft laut Datenstand kein TOP."
          />
          <InfoCard
            title="Nächster TOP"
            point={info?.next_top}
            emptyText="Zurzeit ist kein nächster TOP erkennbar."
          />
          <RollCallCard rollCall={info?.next_roll_call} />
        </div>

        <Card className="rounded-none border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Namentliche Abstimmungen diese Woche</CardTitle>
          </CardHeader>
          <CardContent>
            {(info?.weekly_roll_calls?.length ?? 0) > 0 ? (
              <div className="space-y-3">
                {info?.weekly_roll_calls?.map((rollCall, index) => (
                  <div
                    key={`${rollCall.top ?? "roll-call"}-${rollCall.end_at ?? rollCall.start_at ?? index}`}
                    className="border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div className="text-xs uppercase tracking-[0.24em] text-slate-500">
                      {rollCall.top || "Namentliche Abstimmung"}
                    </div>
                    <div className="mt-1 font-medium text-slate-900">
                      {rollCall.title || "Namentliche Abstimmung"}
                    </div>
                    <div className="mt-2 text-sm text-slate-500">
                      {formatDateTime(rollCall.end_at || rollCall.start_at)}
                    </div>
                    {rollCall.schedule_note ? (
                      <div className="mt-2 text-sm text-slate-500">{rollCall.schedule_note}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-500">
                Für diese Woche wurden aktuell keine namentlichen Abstimmungen erkannt.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-2">
          <SpeechCard
            speech={info?.next_speech}
            principalName={info?.viewer?.principal_name}
          />
          <PgfDutyCard duty={info?.next_pgf_duty} />
        </div>

        <Card className="rounded-none border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl">Aktuelle Sitzungsagenda</CardTitle>
            {visibleSessionDays.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {visibleSessionDays.map((day) => {
                  const isSelected = day.date === selectedSessionDate;
                  return (
                    <button
                      key={day.date ?? day.date_text}
                      type="button"
                      onClick={() => void loadAgendaForDate(day.date ?? null)}
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${
                        isSelected
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
                      }`}
                    >
                      {day.date_text || day.date || "Sitzungstag"}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(agendaInfo?.agenda_points ?? []).map((point, index) => {
                const topKeys = normalizeTopLabels(point.top);
                const currentTopKeys = normalizeTopLabels(info?.current_top?.top);
                const nextTopKeys = normalizeTopLabels(info?.next_top?.top);
                const isCurrent =
                  isAgendaLiveDay &&
                  topKeys.length > 0 &&
                  topKeys.some((key) => currentTopKeys.includes(key));
                const isNext =
                  isAgendaLiveDay &&
                  topKeys.length > 0 &&
                  topKeys.some((key) => nextTopKeys.includes(key));
                const pointDate = isoDatePart(point.start_at);
                const speakers = Array.from(
                  new Map(
                    topKeys
                      .flatMap((key) =>
                        (speakersByTop.get(key) ?? []).filter(
                          (speaker) =>
                            isoDatePart(speaker.effective_start_at || speaker.planned_start_at) === pointDate,
                        ),
                      )
                      .map((speaker) => {
                        const displayName = (speaker.source_speaker_name || speaker.speaker_name || "Unbekannt").trim();
                        return [
                          `${displayName.toUpperCase()}|${speaker.top ?? ""}`,
                          {
                            ...speaker,
                            speaker_name: displayName,
                          },
                        ];
                      }),
                  ).values(),
                ).sort((a, b) => {
                  const aHasLive = Boolean(a.has_live_time && a.effective_start_at);
                  const bHasLive = Boolean(b.has_live_time && b.effective_start_at);
                  if (aHasLive && bHasLive) {
                    return (a.effective_start_at || "").localeCompare(b.effective_start_at || "");
                  }
                  if (aHasLive !== bHasLive) {
                    return aHasLive ? -1 : 1;
                  }
                  return (a.speaker_name || "").localeCompare(b.speaker_name || "", "de", {
                    sensitivity: "base",
                  });
                });
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
                            <div className="mt-3 space-y-2">
                              {speakers.map((speaker, speakerIndex) => (
                                <div
                                  key={`${speaker.speaker_name ?? "speaker"}-${speakerIndex}`}
                                  className="border border-slate-200 bg-slate-50 px-3 py-3"
                                >
                                  <div className="font-medium text-slate-900">
                                    {speaker.speaker_name || "Unbekannt"}
                                  </div>
                                  {isAgendaLiveDay && speaker.has_live_time ? (
                                    <div className="mt-1 text-sm text-slate-500">
                                      Live-Zeit: {formatTime(speaker.effective_start_at)}
                                    </div>
                                  ) : null}
                                </div>
                              ))}
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
  point,
  emptyText,
}: {
  title: string;
  point?: ParliamentPoint | null;
  emptyText: string;
}) {
  return (
    <Card className="rounded-none border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{title}</CardTitle>
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
      </CardHeader>
      <CardContent>
        {rollCall ? (
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">
              {rollCall.top || "Ohne TOP"}
            </div>
            <div className="text-base font-semibold text-slate-900">{pointLabel(rollCall)}</div>
            <div className="text-sm text-slate-500">
              {formatDateTime(rollCall.end_at || rollCall.start_at)}
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
  principalName,
}: {
  speech?: { title?: string | null; start_at?: string | null } | null;
  principalName?: string | null;
}) {
  return (
    <Card className="rounded-none border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">
          {principalName ? `Nächste Rede - ${principalName}` : "Nächste Rede"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {speech ? (
          <div className="space-y-3">
            <div className="text-base font-semibold text-slate-900">{speech.title || "Rede"}</div>
            <div className="text-sm text-slate-500">{formatDateTime(speech.start_at)}</div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">
            Für den aktuellen Datenstand wurde keine kommende Rede erkannt.
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
