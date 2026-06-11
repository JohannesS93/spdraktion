"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { RefreshCw } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type FeedbackEntry = {
  id: string;
  kind: "improvement" | "error" | "general";
  status: "open" | "in_review" | "done" | "dismissed";
  title: string;
  content: string;
  context?: string | null;
  admin_note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  user: {
    id: string;
    email: string;
    first_name?: string | null;
    last_name?: string | null;
    role?: string | null;
  };
};

const STATUS_OPTIONS = [
  { value: "open", label: "Offen" },
  { value: "in_review", label: "In Prüfung" },
  { value: "done", label: "Erledigt" },
  { value: "dismissed", label: "Zurückgestellt" },
] as const;

export default function FeedbackAdminPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const localSession = getSession();

      if (!firebaseUser || !localSession) {
        clearSession();
        setSession(null);
        setAuthReady(true);
        router.replace("/login");
        return;
      }

      setSession(localSession as SessionUser);
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, [router]);

  const getAuthHeaders = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) {
      clearSession();
      router.replace("/login");
      throw new Error("Nicht eingeloggt.");
    }

    const token = await firebaseUser.getIdToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, [router]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/feedback`, { headers, cache: "no-store" });
      const text = await res.text();
      if (!res.ok) throw new Error(text || "Rückmeldungen konnten nicht geladen werden");
      const data = JSON.parse(text) as FeedbackEntry[];
      setEntries(Array.isArray(data) ? data : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!authReady || !session) return;
    void loadEntries();
  }, [authReady, loadEntries, session]);

  async function updateStatus(entry: FeedbackEntry, status: FeedbackEntry["status"]) {
    setSavingId(entry.id);
    setError("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/feedback/${entry.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status,
          admin_note: entry.admin_note ?? null,
        }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || "Status konnte nicht aktualisiert werden");
      setEntries((current) =>
        current.map((item) => (item.id === entry.id ? { ...item, status } : item))
      );
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Status konnte nicht aktualisiert werden");
    } finally {
      setSavingId(null);
    }
  }

  function kindLabel(kind: FeedbackEntry["kind"]) {
    if (kind === "improvement") return "Verbesserung";
    if (kind === "error") return "Fehler";
    return "Allgemein";
  }

  function statusLabel(status: FeedbackEntry["status"]) {
    return STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status;
  }

  function formatDate(value?: string | null) {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleString("de-DE");
    } catch {
      return value;
    }
  }

  function userLabel(user: FeedbackEntry["user"]) {
    const name = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
    return name || user.email;
  }

  const filteredEntries = entries.filter((entry) => {
    const statusMatches = statusFilter === "all" || entry.status === statusFilter;
    const kindMatches = kindFilter === "all" || entry.kind === kindFilter;
    return statusMatches && kindMatches;
  });

  const summary = {
    total: entries.length,
    open: entries.filter((entry) => entry.status === "open").length,
    review: entries.filter((entry) => entry.status === "in_review").length,
    errors: entries.filter((entry) => entry.kind === "error").length,
  };

  if (!authReady) {
    return <div className="p-6">Lade…</div>;
  }

  if (!session) return null;

  return (
    <AdminShell
      session={session}
      title="Rückmeldungen"
      subtitle="Fehler, Vorschläge und allgemeine Hinweise aus der App"
      actions={
        <Button className="admin-btn" variant="outline" onClick={() => void loadEntries()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Aktualisieren
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="admin-card">
          <CardContent className="p-4">
            <div className="admin-stat-label">Gesamt</div>
            <div className="admin-stat-value">{summary.total}</div>
          </CardContent>
        </Card>
        <Card className="admin-card">
          <CardContent className="p-4">
            <div className="admin-stat-label">Offen</div>
            <div className="admin-stat-value">{summary.open}</div>
          </CardContent>
        </Card>
        <Card className="admin-card">
          <CardContent className="p-4">
            <div className="admin-stat-label">In Prüfung</div>
            <div className="admin-stat-value">{summary.review}</div>
          </CardContent>
        </Card>
        <Card className="admin-card">
          <CardContent className="p-4">
            <div className="admin-stat-label">Fehler</div>
            <div className="admin-stat-value">{summary.errors}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="admin-card">
        <CardHeader className="admin-card-header">
          <CardTitle>Eingegangene Rückmeldungen</CardTitle>
        </CardHeader>
        <CardContent className="admin-section">
          {error ? <div className="admin-error">{error}</div> : null}
          <div className="grid gap-3 md:grid-cols-2 xl:max-w-2xl">
            <div>
              <div className="mb-1 text-sm font-medium text-slate-700">Status</div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="admin-select-trigger">
                  <SelectValue placeholder="Alle Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Status</SelectItem>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-sm font-medium text-slate-700">Art</div>
              <Select value={kindFilter} onValueChange={setKindFilter}>
                <SelectTrigger className="admin-select-trigger">
                  <SelectValue placeholder="Alle Arten" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Arten</SelectItem>
                  <SelectItem value="error">Fehler</SelectItem>
                  <SelectItem value="improvement">Verbesserung</SelectItem>
                  <SelectItem value="general">Allgemein</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {loading ? (
            <div className="text-sm text-slate-500">Rückmeldungen werden geladen…</div>
          ) : filteredEntries.length === 0 ? (
            <div className="text-sm text-slate-500">Noch keine Rückmeldungen vorhanden.</div>
          ) : (
            <div className="space-y-4">
              {filteredEntries.map((entry) => (
                <div key={entry.id} className="rounded border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                          {kindLabel(entry.kind)}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                          {statusLabel(entry.status)}
                        </span>
                      </div>
                      <div className="mt-3 text-base font-semibold text-slate-900">{entry.title}</div>
                      <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{entry.content}</div>
                      <div className="mt-3 text-xs text-slate-500">
                        Von {userLabel(entry.user)} · {entry.user.email} · {formatDate(entry.created_at)}
                      </div>
                      {entry.context ? (
                        <div className="mt-1 text-xs text-slate-500">Kontext: {entry.context}</div>
                      ) : null}
                    </div>

                    <div className="w-full shrink-0 lg:w-[220px]">
                      <Select
                        value={entry.status}
                        onValueChange={(value) => void updateStatus(entry, value as FeedbackEntry["status"])}
                        disabled={savingId === entry.id}
                      >
                        <SelectTrigger className="admin-select-trigger">
                          <SelectValue placeholder="Status wählen" />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </AdminShell>
  );
}
