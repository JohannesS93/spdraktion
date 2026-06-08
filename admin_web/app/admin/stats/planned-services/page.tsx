"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { ChevronDown, ChevronUp, Download, RefreshCw } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { AdminStatsSubnav } from "@/components/admin-stats-subnav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type PlannedService = {
  slot_date: string;
  weekday: string;
  slot_code: string;
  start_time?: string | null;
  end_time?: string | null;
  open_end: boolean;
  assignment_type: "active" | "ruf";
};

type PlannedServicesEntry = {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  active_count: number;
  ruf_count: number;
  total_count: number;
  services: PlannedService[];
};

function canAccess(role?: string | null) {
  return role === "admin" || role === "pgf";
}

function formatDateLabel(value?: string | null) {
  if (!value) return "—";
  const dateValue = new Date(`${value}T00:00:00`);
  if (Number.isNaN(dateValue.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(dateValue);
}

function slotTimeLabel(start?: string | null, end?: string | null, openEnd?: boolean) {
  const startLabel = (start ?? "").slice(0, 5);
  if (openEnd || !end) return `${startLabel} – offen`;
  return `${startLabel} – ${end.slice(0, 5)}`;
}

function isFridayAfternoon(service: PlannedService) {
  if (!service.start_time) return false;
  const dateValue = new Date(`${service.slot_date}T00:00:00`);
  if (Number.isNaN(dateValue.getTime())) return false;
  const startLabel = service.start_time.slice(0, 5);
  return dateValue.getDay() === 5 && startLabel >= "14:00";
}

function serviceStats(services: PlannedService[]) {
  return {
    openEndCount: services.filter((service) => service.open_end).length,
    fridayAfternoonCount: services.filter(isFridayAfternoon).length,
  };
}

export default function PlannedServicesStatsPage() {
  const router = useRouter();

  const [session, setSessionState] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [rows, setRows] = useState<PlannedServicesEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [expandedUserIds, setExpandedUserIds] = useState<string[]>([]);

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

  async function loadRows() {
    setLoading(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams();
      if (fromDate) params.set("from_date", fromDate);
      if (toDate) params.set("to_date", toDate);

      const res = await fetch(`${API_BASE}/admin/stats/planned-services?${params}`, { headers });
      const text = await res.text();
      if (!res.ok) throw new Error(text || "Fehler beim Laden");
      setRows(JSON.parse(text));
    } catch {
      setError("Fehler beim Laden der eingeplanten Dienste");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authReady || !session) return;
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, session]);

  const filteredRows = useMemo(() => {
    const query = nameFilter.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      `${row.first_name} ${row.last_name} ${row.email}`.toLowerCase().includes(query)
    );
  }, [nameFilter, rows]);

  const totalActive = filteredRows.reduce((sum, row) => sum + row.active_count, 0);
  const totalRuf = filteredRows.reduce((sum, row) => sum + row.ruf_count, 0);

  function toggleExpanded(userId: string) {
    setExpandedUserIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    );
  }

  function exportCsv() {
    const header = [
      "Name",
      "E-Mail",
      "Dienste gesamt",
      "Offenes Ende",
      "Freitag nachmittag",
      "Aktive Dienste",
      "Ruf-Dienste",
      "Termine",
    ];
    const csvRows = filteredRows.map((row) => {
      const { openEndCount, fridayAfternoonCount } = serviceStats(row.services);
      return [
        `${row.first_name} ${row.last_name}`.trim(),
        row.email,
        String(row.total_count),
        String(openEndCount),
        String(fridayAfternoonCount),
        String(row.active_count),
        String(row.ruf_count),
        row.services
          .map(
            (service) =>
              `${formatDateLabel(service.slot_date)} ${service.weekday} ${service.slot_code} ${slotTimeLabel(
                service.start_time,
                service.end_time,
                service.open_end
              )} (${service.assignment_type === "ruf" ? "Ruf" : "Aktiv"})`
          )
          .join(" | "),
      ];
    });

    const csv = [header, ...csvRows]
      .map((columns) =>
        columns
          .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
          .join(";")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "eingeplante-dienste.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!authReady) return <div className="p-6">Lade…</div>;
  if (!session) return null;

  return (
    <AdminShell
      session={session}
      title="Statistik"
      subtitle="Anwesenheit und eingeplante Dienste getrennt auswerten."
      actions={
        <div className="flex items-center gap-2">
          <Button className="admin-btn" variant="outline" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />
            CSV exportieren
          </Button>
          <Button className="admin-btn" variant="outline" onClick={() => void loadRows()}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Aktualisieren
          </Button>
        </div>
      }
    >
      <AdminStatsSubnav />

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Leselogik</div>
            <div className="mt-1 text-sm text-slate-600">
              Diese Ansicht zeigt eingeplante Dienste, offene Enden, Freitag-Nachmittage und auf
              Wunsch alle Einzeltermine pro Person. CSV eignet sich fuer Export und Abstimmung.
            </div>
          </div>
          <Link href="/admin/handbook" className="inline-flex">
            <Button className="admin-btn" variant="outline">
              Handbuch oeffnen
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="admin-card">
          <CardContent className="p-5">
            <div className="admin-stat-label">Kollegen mit Diensten</div>
            <div className="mt-3 text-3xl font-semibold">{filteredRows.length}</div>
          </CardContent>
        </Card>
        <Card className="admin-card">
          <CardContent className="p-5">
            <div className="admin-stat-label">Aktive Dienste</div>
            <div className="mt-3 text-3xl font-semibold">{totalActive}</div>
          </CardContent>
        </Card>
        <Card className="admin-card">
          <CardContent className="p-5">
            <div className="admin-stat-label">Ruf-Dienste</div>
            <div className="mt-3 text-3xl font-semibold">{totalRuf}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="admin-card">
        <CardHeader className="admin-card-header">
          <CardTitle>Eingeplante Dienste nach Kollegen</CardTitle>
        </CardHeader>

        <CardContent className="admin-section">
          <div className="grid gap-3 md:grid-cols-[160px_160px_260px_auto]">
            <div>
              <Label>Von</Label>
              <Input className="admin-input mt-1" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label>Bis</Label>
              <Input className="admin-input mt-1" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div>
              <Label>Name filtern</Label>
              <Input
                className="admin-input mt-1"
                type="text"
                placeholder="z. B. Müller"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button className="admin-btn" variant="outline" onClick={() => void loadRows()}>
                Filtern
              </Button>
              <Button className="admin-btn" variant="outline" onClick={() => setNameFilter("")} disabled={!nameFilter.trim()}>
                Reset
              </Button>
            </div>
          </div>

          {error ? <div className="admin-error">{error}</div> : null}

          <div className="space-y-4">
            {filteredRows.map((row) => {
              const { openEndCount, fridayAfternoonCount } = serviceStats(row.services);
              const isExpanded = expandedUserIds.includes(row.user_id);

              return (
                <div key={row.user_id} className="rounded-xl border border-slate-200 bg-white">
                  <div className="flex flex-col gap-4 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-base font-semibold text-slate-900">
                        {row.first_name} {row.last_name}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">{row.email}</div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{row.total_count} Dienste</Badge>
                      <Button
                        className="admin-btn"
                        variant="outline"
                        onClick={() => toggleExpanded(row.user_id)}
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="mr-2 h-4 w-4" />
                            Details ausblenden
                          </>
                        ) : (
                          <>
                            <ChevronDown className="mr-2 h-4 w-4" />
                            Details anzeigen
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {isExpanded ? (
                    <div className="border-t border-slate-200 px-4 py-4">
                      <div className="mb-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Offenes Ende</div>
                          <div className="mt-1 text-2xl font-semibold text-slate-900">{openEndCount}</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Freitag nachmittag</div>
                          <div className="mt-1 text-2xl font-semibold text-slate-900">{fridayAfternoonCount}</div>
                        </div>
                      </div>

                      <div className="admin-table overflow-x-auto">
                        <div className="admin-table-header grid min-w-[760px] grid-cols-[130px_130px_100px_160px_100px]">
                          <div>Datum</div>
                          <div>Wochentag</div>
                          <div>Code</div>
                          <div>Zeit</div>
                          <div>Typ</div>
                        </div>

                        {row.services.map((service, index) => (
                          <div
                            key={`${row.user_id}-${service.slot_date}-${service.slot_code}-${service.assignment_type}-${index}`}
                            className="admin-table-row grid min-w-[760px] grid-cols-[130px_130px_100px_160px_100px]"
                          >
                            <div>{formatDateLabel(service.slot_date)}</div>
                            <div>{service.weekday}</div>
                            <div className="font-medium">{service.slot_code}</div>
                            <div>{slotTimeLabel(service.start_time, service.end_time, service.open_end)}</div>
                            <div>
                              <Badge variant={service.assignment_type === "ruf" ? "secondary" : "outline"}>
                                {service.assignment_type === "ruf" ? "Ruf" : "Aktiv"}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
              </div>
              );
            })}

            {!loading && filteredRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                Keine eingeplanten Dienste für diese Auswahl gefunden.
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </AdminShell>
  );
}
