"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { RefreshCw } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { AdminStatsSubnav } from "@/components/admin-stats-subnav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { API_BASE } from "@/lib/api";
import { getSession, clearSession } from "@/lib/auth";
import { auth } from "@/lib/firebase";

type SessionUser = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role: string;
  assigned_mdb_user_id?: string | null;
};

type StatEntry = {
  user_id: string;
  first_name: string;
  last_name: string;
  planned_count: number;
  done_count: number;
  completion_rate: number;
};

function canAccess(role?: string | null) {
  return role === "admin" || role === "pgf";
}

export default function AttendanceStatsPage() {
  const router = useRouter();

  const [session, setSessionState] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [stats, setStats] = useState<StatEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [nameFilter, setNameFilter] = useState("");

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

  async function getAuthHeaders() {
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
  }

  async function loadStats() {
    setLoading(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams();
      if (fromDate) params.set("from_date", fromDate);
      if (toDate) params.set("to_date", toDate);

      const res = await fetch(`${API_BASE}/attendance/stats?${params}`, { headers });
      const text = await res.text();
      if (!res.ok) throw new Error(text || "Fehler beim Laden");
      setStats(JSON.parse(text));
    } catch {
      setError("Fehler beim Laden der Statistik");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authReady || !session) return;
    void loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, session]);

  if (!authReady) return <div className="p-6">Lade…</div>;
  if (!session) return null;

  const totalPlanned = stats.reduce((sum, entry) => sum + entry.planned_count, 0);
  const totalDone = stats.reduce((sum, entry) => sum + entry.done_count, 0);
  const avgRate = stats.length > 0
    ? Math.round((stats.reduce((sum, entry) => sum + entry.completion_rate, 0) / stats.length) * 10) / 10
    : 0;

  const filteredStats = stats.filter((entry) => {
    const query = nameFilter.trim().toLowerCase();
    if (!query) return true;
    return `${entry.first_name} ${entry.last_name}`.toLowerCase().includes(query);
  });

  function exportPdf() {
    window.print();
  }

  return (
    <AdminShell
      session={session}
      title="Statistik"
      subtitle="Anwesenheit und eingeplante Dienste getrennt auswerten."
      actions={
        <div className="flex items-center gap-2 no-print">
          <Button className="admin-btn" variant="outline" onClick={exportPdf}>
            Export PDF
          </Button>
          <Button className="admin-btn" variant="outline" onClick={() => void loadStats()}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Aktualisieren
          </Button>
        </div>
      }
    >
      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            background: white !important;
          }
          @page {
            size: A4;
            margin: 12mm;
          }
        }
      `}</style>

      <AdminStatsSubnav />

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Leselogik</div>
            <div className="mt-1 text-sm text-slate-600">
              Diese Ansicht vergleicht je Person geplante und erledigte Dienste. Filter helfen fuer
              Zeitraum und Namen, der PDF-Export eignet sich fuer Weitergabe.
            </div>
          </div>
          <Link href="/admin/handbook" className="inline-flex">
            <Button className="admin-btn" variant="outline">
              Handbuch oeffnen
            </Button>
          </Link>
        </div>
      </div>

      <Card className="admin-card">
        <CardHeader className="admin-card-header">
          <CardTitle>Anwesenheit pro Nutzer</CardTitle>
        </CardHeader>

        <CardContent className="admin-section">
          <div className="grid gap-3 md:grid-cols-[160px_160px_260px_auto] no-print">
            <div>
              <Label>Von</Label>
              <Input className="admin-input mt-1" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label>Bis</Label>
              <Input className="admin-input mt-1" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button className="admin-btn" variant="outline" onClick={() => void loadStats()}>
                Filtern
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[260px_auto] no-print">
            <div>
              <Label>Name filtern</Label>
              <Input
                className="admin-input mt-1"
                type="text"
                placeholder="z. B. Müller"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
              />
              <div className="mt-1 text-xs text-slate-500">
                Filter wird in Echtzeit angewendet ({filteredStats.length} von {stats.length})
              </div>
            </div>

            <div className="flex items-end justify-end">
              <Button className="admin-btn" variant="outline" onClick={() => setNameFilter("")} disabled={!nameFilter.trim()}>
                Filter zurücksetzen
              </Button>
            </div>
          </div>

          {error ? <div className="admin-error">{error}</div> : null}

          <div className="admin-table">
            <div className="admin-table-header grid grid-cols-[2fr_220px_100px_100px_120px]">
              <div>Name</div>
              <div>Diagramm</div>
              <div>Geplant</div>
              <div>Erledigt</div>
              <div>Quote</div>
            </div>

            {filteredStats.map((entry) => {
              const planned = entry.planned_count || 0;
              const done = entry.done_count || 0;
              const pct = planned > 0 ? Math.round((done / planned) * 100) : 0;

              return (
                <div key={entry.user_id} className="admin-table-row grid grid-cols-[2fr_220px_100px_100px_120px]">
                  <div className="font-medium">{entry.first_name} {entry.last_name}</div>
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-full max-w-[180px] overflow-hidden rounded bg-slate-100">
                      <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                    </div>
                    <div className="text-xs text-slate-500 tabular-nums">{pct}%</div>
                  </div>
                  <div>{entry.planned_count}</div>
                  <div>{entry.done_count}</div>
                  <div>
                    <Badge variant={entry.completion_rate >= 80 ? "default" : entry.completion_rate >= 50 ? "secondary" : "destructive"}>
                      {entry.completion_rate}%
                    </Badge>
                  </div>
                </div>
              );
            })}

            {!loading && filteredStats.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">Keine Daten vorhanden</div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="admin-card">
          <CardContent className="p-5">
            <div className="admin-stat-label">Geplante Dienste</div>
            <div className="mt-3 text-3xl font-semibold">{totalPlanned}</div>
          </CardContent>
        </Card>
        <Card className="admin-card">
          <CardContent className="p-5">
            <div className="admin-stat-label">Erledigt</div>
            <div className="mt-3 text-3xl font-semibold">{totalDone}</div>
          </CardContent>
        </Card>
        <Card className="admin-card">
          <CardContent className="p-5">
            <div className="admin-stat-label">Ø Anwesenheit</div>
            <div className="mt-3 text-3xl font-semibold">{avgRate}%</div>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}
