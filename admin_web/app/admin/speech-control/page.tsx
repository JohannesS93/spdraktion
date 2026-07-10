"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  AlertTriangle,
  ChevronDown,
  FileText,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { API_BASE } from "@/lib/api";
import { clearSession, getSession } from "@/lib/auth";
import { auth } from "@/lib/firebase";
import { getPostLoginRoute } from "@/lib/navigation";

type SessionUser = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role: string;
  assigned_mdb_user_id?: string | null;
};

type User = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
  is_mdb: boolean;
};

type MailEvent = {
  mailbox_uid?: string | null;
  subject?: string | null;
  attachment_name?: string | null;
  attachment_category?: string | null;
  skip_reason?: string | null;
  imported_at?: string | null;
};

type SpeechStatus = {
  latest_kurzuebersicht?: {
    title: string;
    filename: string;
    created_at: string;
  } | null;
  latest_kurzuebersicht_dates: string[];
  latest_kurzuebersicht_is_current_week: boolean;
  mail_import_enabled: boolean;
  mail_import_username?: string | null;
  mail_import_lookback_days: number;
  mail_import_events: MailEvent[];
  manual_speech_count: number;
  manual_active_speech_count: number;
};

type ManualSpeech = {
  id: string;
  user_id?: string | null;
  speaker_name: string;
  date: string;
  start_time: string;
  top: string;
  title: string;
  notes?: string | null;
  is_active: boolean;
};

type OverviewSpeech = {
  id?: string;
  user_id?: string | null;
  speaker_name: string;
  source_speaker_name?: string | null;
  role?: string | null;
  email?: string | null;
  top?: string | null;
  title?: string | null;
  planned_start_at?: string | null;
  effective_start_at?: string | null;
  live_matched?: boolean | null;
  has_live_time?: boolean | null;
  live_state?: string | null;
  notes?: string[];
  source: string;
};

type ManualSpeechDraft = {
  id: string;
  user_id: string;
  speaker_name: string;
  date: string;
  start_time: string;
  top: string;
  title: string;
  notes: string;
  is_active: boolean;
};

type RowItem = {
  key: string;
  kind: "overview" | "manual";
  speech: OverviewSpeech;
  manualSpeech?: ManualSpeech;
};

const EMPTY_DRAFT: ManualSpeechDraft = {
  id: "",
  user_id: "none",
  speaker_name: "",
  date: "",
  start_time: "",
  top: "",
  title: "",
  notes: "",
  is_active: true,
};

function hasAdminAccess(session?: SessionUser | null) {
  return session?.role === "admin";
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function userName(user: User) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.email;
}

function toDateInputValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toTimeInputValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mm = `${date.getMinutes()}`.padStart(2, "0");
  return `${hh}:${mm}`;
}

function toDraft(speech?: ManualSpeech | null): ManualSpeechDraft {
  if (!speech) return { ...EMPTY_DRAFT };
  return {
    id: speech.id,
    user_id: speech.user_id || "none",
    speaker_name: speech.speaker_name || "",
    date: speech.date || "",
    start_time: speech.start_time || "",
    top: speech.top || "",
    title: speech.title || "",
    notes: speech.notes || "",
    is_active: speech.is_active,
  };
}

function draftFromOverview(speech: OverviewSpeech): ManualSpeechDraft {
  const startAt = speech.effective_start_at || speech.planned_start_at;
  return {
    id: "",
    user_id: speech.user_id || "none",
    speaker_name: speech.speaker_name || "",
    date: toDateInputValue(startAt),
    start_time: toTimeInputValue(startAt),
    top: speech.top || "",
    title: speech.title || "",
    notes: (speech.notes || []).join(" | "),
    is_active: true,
  };
}

function manualSpeechToOverview(speech: ManualSpeech): OverviewSpeech {
  const startAt = speech.date && speech.start_time ? `${speech.date}T${speech.start_time}:00` : null;
  return {
    id: speech.id,
    user_id: speech.user_id ?? null,
    speaker_name: speech.speaker_name,
    source_speaker_name: speech.speaker_name,
    top: speech.top,
    title: speech.title,
    planned_start_at: startAt,
    effective_start_at: startAt,
    live_matched: false,
    has_live_time: false,
    live_state: null,
    notes: speech.notes ? [speech.notes] : [],
    source: "manual",
  };
}

function describeSpeechSource(speech: OverviewSpeech) {
  if (speech.source === "manual") {
    return {
      label: "manuell",
      detail: "manuell gepflegt",
      badges: ["manual"] as string[],
    };
  }

  if (speech.live_matched || speech.has_live_time) {
    return {
      label: "PDF + Live-Daten",
      detail: "KÜ mit Live-Abgleich",
      badges: ["pdf", "live"] as string[],
    };
  }

  return {
    label: "PDF",
    detail: "aus der Kurzübersicht",
    badges: ["pdf"] as string[],
  };
}

function speechDateKey(speech: OverviewSpeech) {
  return toDateInputValue(speech.effective_start_at || speech.planned_start_at) || "unbekannt";
}

function speechSortValue(speech: OverviewSpeech) {
  return speech.effective_start_at || speech.planned_start_at || "";
}

function speechPreviewTitle(title?: string | null) {
  return (title || "Ohne Titel").trim();
}

function shortNotes(notes?: string[]) {
  if (!notes?.length) return null;
  return notes[0];
}

export default function SpeechControlPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [manualSpeeches, setManualSpeeches] = useState<ManualSpeech[]>([]);
  const [overviewSpeeches, setOverviewSpeeches] = useState<OverviewSpeech[]>([]);
  const [mdbUsers, setMdbUsers] = useState<User[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState<ManualSpeechDraft | null>(null);
  const [editorMode, setEditorMode] = useState<"new" | "copy" | "manual" | null>(null);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "pdf" | "live" | "manual">("all");

  const authHeaders = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) throw new Error("Nicht eingeloggt.");
    return { Authorization: `Bearer ${await firebaseUser.getIdToken()}` };
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const headers = await authHeaders();
      const [statusRes, speechesRes, usersRes, overviewRes] = await Promise.all([
        fetch(`${API_BASE}/admin/speech-control/status`, { headers, cache: "no-store" }),
        fetch(`${API_BASE}/admin/speech-control/speeches`, { headers, cache: "no-store" }),
        fetch(`${API_BASE}/admin/users?is_mdb=true`, { headers, cache: "no-store" }),
        fetch(`${API_BASE}/admin/kurzuebersicht/faction-speakers`, { headers, cache: "no-store" }),
      ]);

      if (!statusRes.ok) throw new Error(await statusRes.text());
      if (!speechesRes.ok) throw new Error(await speechesRes.text());
      if (!usersRes.ok) throw new Error(await usersRes.text());
      if (!overviewRes.ok) throw new Error(await overviewRes.text());

      setStatus(await statusRes.json());
      setManualSpeeches(await speechesRes.json());
      setMdbUsers(await usersRes.json());
      setOverviewSpeeches(((await overviewRes.json())?.speeches ?? []) as OverviewSpeech[]);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const localSession = getSession();
      if (!firebaseUser || !localSession) {
        clearSession();
        router.replace("/");
        return;
      }
      if (!hasAdminAccess(localSession as SessionUser)) {
        router.replace(getPostLoginRoute((localSession as SessionUser).role));
        return;
      }

      setSession(localSession as SessionUser);
      await loadAll();
    });
    return () => unsubscribe();
  }, [loadAll, router]);

  const sourceSummary = useMemo(() => {
    return overviewSpeeches.reduce(
      (acc, speech) => {
        if (speech.source === "manual") {
          acc.manual += 1;
          return acc;
        }
        acc.pdf += 1;
        if (speech.live_matched || speech.has_live_time) {
          acc.live += 1;
        }
        return acc;
      },
      { pdf: 0, live: 0, manual: 0 },
    );
  }, [overviewSpeeches]);

  const allRows = useMemo(() => {
    const manualById = new Map(manualSpeeches.map((speech) => [speech.id, speech]));
    const rows: RowItem[] = overviewSpeeches.map((speech, index) => {
      const manualSpeech = speech.id ? manualById.get(speech.id) : undefined;
      return {
        key: manualSpeech ? `manual:${manualSpeech.id}` : `overview:${speech.id || `${speech.speaker_name}-${index}`}`,
        kind: manualSpeech ? "manual" : "overview",
        speech,
        manualSpeech,
      };
    });

    manualSpeeches.forEach((speech) => {
      if (rows.some((row) => row.manualSpeech?.id === speech.id)) return;
      rows.push({
        key: `manual:${speech.id}`,
        kind: "manual",
        speech: manualSpeechToOverview(speech),
        manualSpeech: speech,
      });
    });

    return rows.sort((left, right) => speechSortValue(left.speech).localeCompare(speechSortValue(right.speech)));
  }, [manualSpeeches, overviewSpeeches]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allRows.filter((row) => {
      const speech = row.speech;
      const matchesSource =
        sourceFilter === "all" ||
        (sourceFilter === "manual" && row.kind === "manual") ||
        (sourceFilter === "live" && Boolean(speech.live_matched || speech.has_live_time)) ||
        (sourceFilter === "pdf" &&
          row.kind !== "manual" &&
          !speech.live_matched &&
          !speech.has_live_time);

      if (!matchesSource) return false;
      if (!needle) return true;

      return [
        speech.speaker_name,
        speech.top,
        speech.title,
        ...(speech.notes || []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [allRows, query, sourceFilter]);

  const groupedRows = useMemo(() => {
    const groups = new Map<string, RowItem[]>();
    filteredRows.forEach((row) => {
      const key = speechDateKey(row.speech);
      const items = groups.get(key) ?? [];
      items.push(row);
      groups.set(key, items);
    });
    return Array.from(groups.entries());
  }, [filteredRows]);

  const selectedRow = useMemo(
    () => allRows.find((row) => row.key === selectedKey) ?? null,
    [allRows, selectedKey],
  );

  useEffect(() => {
    if (editorMode === "new") return;
    if (selectedKey && filteredRows.some((row) => row.key === selectedKey)) return;
    if (filteredRows.length) {
      setSelectedKey(filteredRows[0].key);
      return;
    }
    setSelectedKey(null);
  }, [editorMode, filteredRows, selectedKey]);

  useEffect(() => {
    if (!selectedRow) return;
    if (selectedRow.kind !== "manual" || !selectedRow.manualSpeech) return;
    setEditorMode("manual");
    setEditorDraft(toDraft(selectedRow.manualSpeech));
  }, [selectedRow]);

  function resetEditor() {
    setEditorDraft(null);
    setEditorMode(null);
  }

  function openNewManual() {
    setSelectedKey(null);
    setEditorMode("new");
    setEditorDraft({ ...EMPTY_DRAFT });
  }

  function openCopyFromOverview(row: RowItem) {
    setSelectedKey(row.key);
    setEditorMode("copy");
    setEditorDraft(draftFromOverview(row.speech));
  }

  async function persistSpeech() {
    if (!editorDraft) return;
    setSaving(true);
    setError("");
    try {
      const headers = {
        ...(await authHeaders()),
        "Content-Type": "application/json",
      };
      const payload = {
        user_id: editorDraft.user_id === "none" ? null : editorDraft.user_id,
        speaker_name: editorDraft.speaker_name.trim(),
        date: editorDraft.date,
        start_time: editorDraft.start_time,
        top: editorDraft.top.trim(),
        title: editorDraft.title.trim(),
        notes: editorDraft.notes.trim() || null,
        is_active: editorDraft.is_active,
      };
      const res = await fetch(
        editorDraft.id
          ? `${API_BASE}/admin/speech-control/speeches/${editorDraft.id}`
          : `${API_BASE}/admin/speech-control/speeches`,
        {
          method: editorDraft.id ? "PUT" : "POST",
          headers,
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error(await res.text());

      const data = (await res.json().catch(() => null)) as { id?: string } | null;
      const nextId = editorDraft.id || data?.id;

      await loadAll();
      if (nextId) {
        setSelectedKey(`manual:${nextId}`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSpeech(id: string) {
    if (!window.confirm("Manuellen Redeeintrag löschen?")) return;
    setError("");
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/admin/speech-control/speeches/${id}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error(await res.text());
      await loadAll();
      setSelectedKey(null);
      resetEditor();
    } catch (err) {
      setError(String(err));
    }
  }

  function updateDraft(field: keyof ManualSpeechDraft, value: string | boolean) {
    setEditorDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  function assignUserToDraft(value: string) {
    setEditorDraft((prev) => {
      if (!prev) return prev;
      const user = mdbUsers.find((item) => item.id === value);
      return {
        ...prev,
        user_id: value,
        speaker_name: user ? userName(user) : prev.speaker_name,
      };
    });
  }

  function canSaveDraft(draft?: ManualSpeechDraft | null) {
    if (!draft) return false;
    return Boolean(
      draft.speaker_name.trim() &&
        draft.date &&
        draft.start_time &&
        draft.top.trim() &&
        draft.title.trim(),
    );
  }

  function renderSourceBadges(speech: OverviewSpeech) {
    const source = describeSpeechSource(speech);
    return (
      <div className="flex flex-wrap gap-2">
        {source.badges.includes("pdf") ? (
          <Badge className="rounded-full bg-slate-800 hover:bg-slate-800">
            <FileText className="mr-1 h-3 w-3" />
            PDF
          </Badge>
        ) : null}
        {source.badges.includes("live") ? (
          <Badge className="rounded-full bg-sky-700 hover:bg-sky-700">
            <Radio className="mr-1 h-3 w-3" />
            Live
          </Badge>
        ) : null}
        {source.badges.includes("manual") ? (
          <Badge className="rounded-full bg-amber-600 hover:bg-amber-600">manuell</Badge>
        ) : null}
      </div>
    );
  }

  if (!session) {
    return <div className="p-8 text-slate-500">Lade...</div>;
  }

  const latestKuCurrent = Boolean(status?.latest_kurzuebersicht_is_current_week);

  return (
    <AdminShell
      title="KÜ & Reden"
      subtitle="Kompakte Arbeitsliste links, Detail- und Bearbeitungspanel rechts."
      session={session}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={openNewManual} className="rounded-none">
            <Plus className="mr-2 h-4 w-4" />
            Neue manuelle Rede
          </Button>
          <Button variant="outline" onClick={loadAll} disabled={loading} className="rounded-none">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Aktualisieren
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {error ? (
          <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-4">
          <Card className="rounded-none border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Letzte KÜ</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <div className="font-medium text-slate-950">
                {status?.latest_kurzuebersicht?.title || "Keine KÜ importiert"}
              </div>
              <div>{formatDateTime(status?.latest_kurzuebersicht?.created_at)}</div>
              <div className="text-xs text-slate-500">{status?.latest_kurzuebersicht?.filename || "—"}</div>
            </CardContent>
          </Card>

          <Card className="rounded-none border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Mail-Import</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <div className="font-medium text-slate-950">{status?.mail_import_username || "nicht konfiguriert"}</div>
              <div>Suchzeitraum: {status?.mail_import_lookback_days ?? "—"} Tage</div>
              <div>
                {status?.mail_import_enabled ? (
                  <Badge className="rounded-full bg-emerald-600 hover:bg-emerald-600">aktiv</Badge>
                ) : (
                  <Badge variant="destructive" className="rounded-full">
                    inaktiv
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-none border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Manuelle Einträge</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <div className="text-3xl font-semibold text-slate-950">{status?.manual_active_speech_count ?? 0}</div>
              <div>{status?.manual_speech_count ?? 0} Einträge insgesamt</div>
            </CardContent>
          </Card>

          <Card className="rounded-none border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Quellen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <div className="flex items-center justify-between">
                <span>PDF</span>
                <span className="font-medium text-slate-950">{sourceSummary.pdf}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Live</span>
                <span className="font-medium text-slate-950">{sourceSummary.live}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>manuell</span>
                <span className="font-medium text-slate-950">{sourceSummary.manual}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {!latestKuCurrent ? (
          <div className="flex gap-2 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Die automatische KÜ ist nicht aktuell. Sonderfälle und Korrekturen bitte über das rechte Bearbeitungspanel manuell ergänzen.</span>
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_420px]">
          <Card className="rounded-none border-slate-200">
            <CardHeader className="pb-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle>KÜ und Reden</CardTitle>
                  <div className="mt-1 text-sm text-slate-500">
                    Liste zum Finden, Detailpanel zum Bearbeiten.
                  </div>
                </div>
                <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                  <div className="relative min-w-[240px]">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      className="rounded-none pl-9"
                      placeholder="Name, TOP oder Titel suchen"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </div>
                  <Select value={sourceFilter} onValueChange={(value: "all" | "pdf" | "live" | "manual") => setSourceFilter(value)}>
                    <SelectTrigger className="min-w-[180px] rounded-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle Quellen</SelectItem>
                      <SelectItem value="pdf">Nur PDF</SelectItem>
                      <SelectItem value="live">Nur Live</SelectItem>
                      <SelectItem value="manual">Nur manuell</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {groupedRows.length ? (
                groupedRows.map(([dateKey, rows]) => (
                  <div key={dateKey} className="space-y-2">
                    <div className="border-b border-slate-200 pb-2 text-sm font-medium text-slate-700">
                      {dateKey === "unbekannt" ? "Ohne Datum" : formatDate(dateKey)}
                    </div>
                    <div className="space-y-2">
                      {rows.map((row) => {
                        const speech = row.speech;
                        const selected = row.key === selectedKey && editorMode !== "new";
                        return (
                          <button
                            key={row.key}
                            type="button"
                            onClick={() => {
                              setSelectedKey(row.key);
                              if (row.kind === "overview") {
                                resetEditor();
                              }
                            }}
                            className={`w-full rounded-none border px-4 py-3 text-left transition-colors ${
                              selected
                                ? "border-slate-900 bg-slate-50"
                                : row.kind === "manual"
                                  ? "border-amber-200 bg-amber-50/40 hover:bg-amber-50"
                                  : "border-slate-200 bg-white hover:bg-slate-50"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0 flex-1 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="font-medium text-slate-950">{formatTime(speech.effective_start_at || speech.planned_start_at)}</div>
                                  {renderSourceBadges(speech)}
                                  {speech.live_state ? (
                                    <Badge variant="outline" className="rounded-full">
                                      {speech.live_state}
                                    </Badge>
                                  ) : null}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                  <span className="font-medium text-slate-900">{speech.speaker_name}</span>
                                  {speech.top ? <span className="text-slate-500">TOP {speech.top}</span> : null}
                                  {!speech.user_id ? (
                                    <span className="text-amber-700">ohne Zuordnung</span>
                                  ) : null}
                                </div>
                                <div className="truncate text-sm text-slate-600">
                                  {speechPreviewTitle(speech.title)}
                                </div>
                              </div>
                              {shortNotes(speech.notes) ? (
                                <div className="hidden max-w-[220px] text-xs text-slate-500 xl:block">
                                  {shortNotes(speech.notes)}
                                </div>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-500">Keine Einträge für den aktuellen Filter.</div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-none border-slate-200 xl:sticky xl:top-6 xl:self-start">
            <CardHeader>
              <CardTitle>
                {editorMode === "new"
                  ? "Neue manuelle Rede"
                  : editorMode === "copy"
                    ? "Manuelle Rede anlegen"
                    : editorMode === "manual"
                      ? "Manuellen Eintrag bearbeiten"
                      : "Details"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {editorDraft ? (
                <>
                  {editorMode === "copy" ? (
                    <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      Die ausgewählte PDF-/Live-Zeile wird als manueller Eintrag übernommen und kann hier angepasst werden.
                    </div>
                  ) : null}

                  <div className="grid gap-4">
                    <div>
                      <div className="mb-1 text-xs uppercase tracking-[0.16em] text-slate-400">MdB-Zuordnung</div>
                      <Select value={editorDraft.user_id} onValueChange={assignUserToDraft}>
                        <SelectTrigger className="rounded-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Keine feste Zuordnung</SelectItem>
                          {mdbUsers.map((user) => (
                            <SelectItem key={user.id} value={user.id}>
                              {userName(user)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <div className="mb-1 text-xs uppercase tracking-[0.16em] text-slate-400">Name</div>
                      <Input
                        className="rounded-none"
                        value={editorDraft.speaker_name}
                        onChange={(event) => updateDraft("speaker_name", event.target.value)}
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <div className="mb-1 text-xs uppercase tracking-[0.16em] text-slate-400">Datum</div>
                        <Input
                          className="rounded-none"
                          type="date"
                          value={editorDraft.date}
                          onChange={(event) => updateDraft("date", event.target.value)}
                        />
                      </div>
                      <div>
                        <div className="mb-1 text-xs uppercase tracking-[0.16em] text-slate-400">Uhrzeit</div>
                        <Input
                          className="rounded-none"
                          type="time"
                          value={editorDraft.start_time}
                          onChange={(event) => updateDraft("start_time", event.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 text-xs uppercase tracking-[0.16em] text-slate-400">TOP</div>
                      <Input
                        className="rounded-none"
                        value={editorDraft.top}
                        onChange={(event) => updateDraft("top", event.target.value)}
                      />
                    </div>

                    <div>
                      <div className="mb-1 text-xs uppercase tracking-[0.16em] text-slate-400">Titel</div>
                      <Input
                        className="rounded-none"
                        value={editorDraft.title}
                        onChange={(event) => updateDraft("title", event.target.value)}
                      />
                    </div>

                    <div>
                      <div className="mb-1 text-xs uppercase tracking-[0.16em] text-slate-400">Notiz</div>
                      <textarea
                        className="min-h-28 w-full rounded-none border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                        value={editorDraft.notes}
                        onChange={(event) => updateDraft("notes", event.target.value)}
                      />
                    </div>

                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={editorDraft.is_active}
                        onChange={(event) => updateDraft("is_active", event.target.checked)}
                      />
                      Aktiv
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={!canSaveDraft(editorDraft) || saving}
                      onClick={persistSpeech}
                      className="rounded-none bg-slate-950 hover:bg-slate-800"
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {editorDraft.id ? "Speichern" : "Anlegen"}
                    </Button>
                    <Button type="button" variant="outline" onClick={resetEditor} className="rounded-none">
                      Abbrechen
                    </Button>
                    {editorDraft.id ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-none text-red-700"
                        onClick={() => void deleteSpeech(editorDraft.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Löschen
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : selectedRow ? (
                <>
                  <div className="space-y-3">
                    <div>
                      <div className="text-lg font-medium text-slate-950">{selectedRow.speech.title || "Ohne Titel"}</div>
                      <div className="mt-2">{renderSourceBadges(selectedRow.speech)}</div>
                    </div>

                    <div className="grid gap-3 rounded-none border border-slate-200 bg-slate-50 p-4 text-sm">
                      <div>
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Person</div>
                        <div className="mt-1 text-slate-900">{selectedRow.speech.speaker_name}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Zeit</div>
                        <div className="mt-1 text-slate-900">
                          {formatDateTime(selectedRow.speech.effective_start_at || selectedRow.speech.planned_start_at)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">TOP</div>
                        <div className="mt-1 text-slate-900">{selectedRow.speech.top || "—"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Quelle</div>
                        <div className="mt-1 text-slate-900">{describeSpeechSource(selectedRow.speech).detail}</div>
                      </div>
                    </div>

                    <div>
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Hinweise</div>
                      {selectedRow.speech.notes?.length ? (
                        <div className="mt-2 space-y-2 text-sm text-slate-600">
                          {selectedRow.speech.notes.map((note) => (
                            <div key={note} className="border border-slate-200 bg-white px-3 py-2">
                              {note}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-slate-500">Keine zusätzlichen Hinweise vorhanden.</div>
                      )}
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full rounded-none"
                    onClick={() => openCopyFromOverview(selectedRow)}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Als manuellen Eintrag übernehmen
                  </Button>
                </>
              ) : (
                <div className="text-sm text-slate-500">
                  Wähle links einen Eintrag aus oder lege oben eine neue manuelle Rede an.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <details className="rounded-none border border-slate-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 text-sm font-medium text-slate-900">
            <span>Letzte Mail-Import-Ereignisse</span>
            <ChevronDown className="h-4 w-4 text-slate-500" />
          </summary>
          <div className="border-t border-slate-200 px-6 py-4">
            <div className="space-y-2">
              {(status?.mail_import_events ?? []).map((event, index) => (
                <div
                  key={`${event.mailbox_uid}-${event.attachment_name}-${index}`}
                  className="border border-slate-200 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-full">
                      {event.attachment_category || "unbekannt"}
                    </Badge>
                    {event.skip_reason ? (
                      <Badge variant="destructive" className="rounded-full">
                        {event.skip_reason}
                      </Badge>
                    ) : (
                      <Badge className="rounded-full bg-emerald-600">importiert</Badge>
                    )}
                    <span className="text-slate-500">{formatDateTime(event.imported_at)}</span>
                  </div>
                  <div className="mt-1 font-medium text-slate-900">{event.subject || "Ohne Betreff"}</div>
                  <div className="text-slate-500">{event.attachment_name || "Ohne Anhang"}</div>
                </div>
              ))}
              {!(status?.mail_import_events ?? []).length ? (
                <div className="text-sm text-slate-500">Noch keine Importereignisse vorhanden.</div>
              ) : null}
            </div>
          </div>
        </details>
      </div>
    </AdminShell>
  );
}
