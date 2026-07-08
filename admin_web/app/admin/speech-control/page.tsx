"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { AlertTriangle, Mail, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { API_BASE } from "@/lib/api";
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
  document_id?: string | null;
};

type SpeechStatus = {
  generated_at: string;
  week_start: string;
  week_end: string;
  latest_kurzuebersicht?: {
    id: string;
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
  created_at?: string | null;
  updated_at?: string | null;
};

const EMPTY_FORM = {
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

const JOHANNES_ADMIN_EMAIL = "johannes.schaetzl.mdb@bundestag.de";

function hasFullAccess(session?: SessionUser | null) {
  return session?.role === "admin" || session?.email?.toLowerCase() === JOHANNES_ADMIN_EMAIL;
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

function userName(user: User) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.email;
}

export default function SpeechControlPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [speeches, setSpeeches] = useState<ManualSpeech[]>([]);
  const [mdbUsers, setMdbUsers] = useState<User[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);

  async function authHeaders() {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) throw new Error("Nicht eingeloggt.");
    return { Authorization: `Bearer ${await firebaseUser.getIdToken()}` };
  }

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const headers = await authHeaders();
      const [statusRes, speechesRes, usersRes] = await Promise.all([
        fetch(`${API_BASE}/admin/speech-control/status`, { headers, cache: "no-store" }),
        fetch(`${API_BASE}/admin/speech-control/speeches`, { headers, cache: "no-store" }),
        fetch(`${API_BASE}/admin/users?is_mdb=true`, { headers, cache: "no-store" }),
      ]);

      if (!statusRes.ok) throw new Error(await statusRes.text());
      if (!speechesRes.ok) throw new Error(await speechesRes.text());
      if (!usersRes.ok) throw new Error(await usersRes.text());

      setStatus(await statusRes.json());
      setSpeeches(await speechesRes.json());
      setMdbUsers(await usersRes.json());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const localSession = getSession();
      if (!firebaseUser || !localSession || !hasFullAccess(localSession as SessionUser)) {
        clearSession();
        router.replace("/");
        return;
      }
      setSession(localSession as SessionUser);
      await loadAll();
    });
    return () => unsubscribe();
  }, [router]);

  const selectedUser = useMemo(
    () => mdbUsers.find((user) => user.id === form.user_id),
    [form.user_id, mdbUsers],
  );

  function resetForm() {
    setForm(EMPTY_FORM);
  }

  function editSpeech(speech: ManualSpeech) {
    setForm({
      id: speech.id,
      user_id: speech.user_id || "none",
      speaker_name: speech.speaker_name || "",
      date: speech.date || "",
      start_time: speech.start_time || "",
      top: speech.top || "",
      title: speech.title || "",
      notes: speech.notes || "",
      is_active: speech.is_active,
    });
  }

  async function saveSpeech(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const headers = {
        ...(await authHeaders()),
        "Content-Type": "application/json",
      };
      const payload = {
        user_id: form.user_id === "none" ? null : form.user_id,
        speaker_name: form.speaker_name.trim(),
        date: form.date,
        start_time: form.start_time,
        top: form.top.trim(),
        title: form.title.trim(),
        notes: form.notes.trim() || null,
        is_active: form.is_active,
      };
      const res = await fetch(
        form.id
          ? `${API_BASE}/admin/speech-control/speeches/${form.id}`
          : `${API_BASE}/admin/speech-control/speeches`,
        {
          method: form.id ? "PUT" : "POST",
          headers,
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error(await res.text());
      resetForm();
      await loadAll();
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
      if (form.id === id) resetForm();
      await loadAll();
    } catch (err) {
      setError(String(err));
    }
  }

  if (!session) {
    return <div className="p-8 text-slate-500">Lade...</div>;
  }

  const latestKuCurrent = Boolean(status?.latest_kurzuebersicht_is_current_week);

  return (
    <AdminShell
      title="KÜ & Reden"
      subtitle="Importstatus prüfen und Reden manuell ergänzen, wenn die Kurzübersicht fehlt oder unvollständig ist."
      session={session}
      actions={
        <Button variant="outline" onClick={loadAll} disabled={loading} className="rounded-none">
          <RefreshCw className="mr-2 h-4 w-4" />
          Aktualisieren
        </Button>
      }
    >
      <div className="space-y-6">
        {error ? (
          <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="rounded-none border-slate-200">
            <CardHeader>
              <CardTitle className="text-lg">Kurzübersicht</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                {latestKuCurrent ? (
                  <Badge className="rounded-full bg-emerald-600 hover:bg-emerald-600">aktuelle Woche</Badge>
                ) : (
                  <Badge variant="destructive" className="rounded-full">veraltet oder fehlt</Badge>
                )}
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Letzte KÜ</div>
                <div className="mt-1 font-medium text-slate-900">
                  {status?.latest_kurzuebersicht?.title || "Keine KÜ importiert"}
                </div>
                <div>{formatDateTime(status?.latest_kurzuebersicht?.created_at)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Erkannte Sitzungstage</div>
                <div>{status?.latest_kurzuebersicht_dates?.map(formatDate).join(", ") || "—"}</div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-none border-slate-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Mail className="h-4 w-4" />
                Mail-Import
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Postfach</div>
                <div className="mt-1 font-medium text-slate-900">{status?.mail_import_username || "nicht konfiguriert"}</div>
              </div>
              <div>Suchzeitraum: {status?.mail_import_lookback_days ?? "—"} Tage</div>
              <div>
                Status:{" "}
                {status?.mail_import_enabled ? (
                  <Badge className="rounded-full bg-emerald-600 hover:bg-emerald-600">aktiv</Badge>
                ) : (
                  <Badge variant="destructive" className="rounded-full">inaktiv</Badge>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-none border-slate-200">
            <CardHeader>
              <CardTitle className="text-lg">Manuelle Reden</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <div>
                <div className="text-4xl font-semibold text-slate-950">{status?.manual_active_speech_count ?? 0}</div>
                <div>aktive manuelle Einträge</div>
              </div>
              <div>{status?.manual_speech_count ?? 0} Einträge insgesamt</div>
              {!latestKuCurrent ? (
                <div className="flex gap-2 border border-amber-200 bg-amber-50 p-3 text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Die automatische KÜ ist nicht aktuell. Für diese Woche sollten Reden hier manuell gepflegt werden.</span>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-none border-slate-200">
          <CardHeader>
            <CardTitle>Manuelle Rede anlegen oder bearbeiten</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveSpeech} className="grid gap-4 lg:grid-cols-6">
              <div className="lg:col-span-2">
                <Label>MdB-Zuordnung</Label>
                <Select
                  value={form.user_id}
                  onValueChange={(value) => {
                    const user = mdbUsers.find((item) => item.id === value);
                    setForm((prev) => ({
                      ...prev,
                      user_id: value,
                      speaker_name: user ? userName(user) : prev.speaker_name,
                    }));
                  }}
                >
                  <SelectTrigger className="mt-1 rounded-none">
                    <SelectValue placeholder="MdB auswählen" />
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

              <div className="lg:col-span-2">
                <Label>Name anzeigen</Label>
                <Input
                  className="mt-1 rounded-none"
                  value={form.speaker_name}
                  onChange={(event) => setForm((prev) => ({ ...prev, speaker_name: event.target.value }))}
                  placeholder={selectedUser ? userName(selectedUser) : "z.B. Johannes Schätzl"}
                  required
                />
              </div>

              <div>
                <Label>Datum</Label>
                <Input
                  className="mt-1 rounded-none"
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
                  required
                />
              </div>

              <div>
                <Label>Uhrzeit</Label>
                <Input
                  className="mt-1 rounded-none"
                  type="time"
                  value={form.start_time}
                  onChange={(event) => setForm((prev) => ({ ...prev, start_time: event.target.value }))}
                  required
                />
              </div>

              <div>
                <Label>TOP/ZP</Label>
                <Input
                  className="mt-1 rounded-none"
                  value={form.top}
                  onChange={(event) => setForm((prev) => ({ ...prev, top: event.target.value }))}
                  placeholder="TOP 6 oder ZP 2"
                  required
                />
              </div>

              <div className="lg:col-span-4">
                <Label>Titel</Label>
                <Input
                  className="mt-1 rounded-none"
                  value={form.title}
                  onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                  required
                />
              </div>

              <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.checked }))}
                />
                Aktiv
              </label>

              <div className="lg:col-span-6">
                <Label>Notiz</Label>
                <textarea
                  className="mt-1 min-h-20 w-full rounded-none border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                  value={form.notes}
                  onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                  placeholder="Optional, nur intern sichtbar."
                />
              </div>

              <div className="flex gap-2 lg:col-span-6">
                <Button type="submit" disabled={saving} className="rounded-none bg-slate-950 hover:bg-slate-800">
                  {form.id ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
                  {form.id ? "Speichern" : "Eintrag anlegen"}
                </Button>
                {form.id ? (
                  <Button type="button" variant="outline" onClick={resetForm} className="rounded-none">
                    Abbrechen
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-none border-slate-200">
          <CardHeader>
            <CardTitle>Manuell gepflegte Reden</CardTitle>
          </CardHeader>
          <CardContent>
            {speeches.length ? (
              <div className="space-y-2">
                {speeches.map((speech) => (
                  <div key={speech.id} className="grid gap-3 border border-slate-200 p-3 lg:grid-cols-[160px_1fr_auto]">
                    <div className="text-sm text-slate-500">
                      <div className="font-medium text-slate-900">{formatDate(speech.date)}</div>
                      <div>{speech.start_time} Uhr</div>
                      <div>{speech.top}</div>
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-slate-950">{speech.speaker_name}</div>
                        {speech.is_active ? <Badge className="rounded-full bg-emerald-600">aktiv</Badge> : <Badge variant="outline">inaktiv</Badge>}
                      </div>
                      <div className="mt-1 text-sm text-slate-700">{speech.title}</div>
                      {speech.notes ? <div className="mt-1 text-xs text-slate-500">{speech.notes}</div> : null}
                    </div>
                    <div className="flex items-start gap-2">
                      <Button variant="outline" className="rounded-none" onClick={() => editSpeech(speech)}>
                        Bearbeiten
                      </Button>
                      <Button variant="outline" className="rounded-none text-red-700" onClick={() => deleteSpeech(speech.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-500">Noch keine manuellen Reden gepflegt.</div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-none border-slate-200">
          <CardHeader>
            <CardTitle>Letzte Mail-Import-Ereignisse</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(status?.mail_import_events ?? []).map((event, index) => (
                <div key={`${event.mailbox_uid}-${event.attachment_name}-${index}`} className="border border-slate-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-full">{event.attachment_category || "unbekannt"}</Badge>
                    {event.skip_reason ? <Badge variant="destructive" className="rounded-full">{event.skip_reason}</Badge> : <Badge className="rounded-full bg-emerald-600">importiert</Badge>}
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
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}
