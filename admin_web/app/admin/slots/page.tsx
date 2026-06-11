"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { Pencil, Plus, RefreshCw, Search, Trash2, Users } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

type Slot = {
  id: string;
  slot_date: string;
  slot_code: string;
  start_time?: string | null;
  end_time?: string | null;
  open_end: boolean;
  active_count?: number;
  ruf_count?: number;
};

type SlotWeekSummary = {
  week_start: string;
  week_end: string;
  slot_count: number;
  day_count: number;
  active_assignment_count: number;
  ruf_assignment_count: number;
};

type SlotForm = {
  id: string | null;
  slot_date: string;
  slot_code: string;
  start_time: string;
  end_time: string;
  open_end: boolean;
};

type SlotParticipantsSlot = {
  id: string;
  slot_code: string;
  slot_date: string;
  start_time?: string | null;
  end_time?: string | null;
  open_end?: boolean;
};

type SlotParticipant = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
  assignment_type?: "active" | "ruf" | null;
  is_effectively_assigned: boolean;
};

type SlotParticipantsResponse = {
  slot: SlotParticipantsSlot;
  participants: SlotParticipant[];
};

type AttendanceGrant = {
  id: string;
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  valid_from?: string | null;
  valid_until?: string | null;
  created_at?: string | null;
};

type MdbUser = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
};

const EMPTY_SLOT_FORM: SlotForm = {
  id: null,
  slot_date: "",
  slot_code: "",
  start_time: "",
  end_time: "",
  open_end: false,
};

function canManageSlots(role?: string | null) {
  return role === "admin" || role === "pgf";
}

function canAccessSlots(role?: string | null) {
  return role === "admin" || role === "pgf" || role === "mdb" || role === "staff";
}

function slotTimeLabel(start?: string | null, end?: string | null, openEnd?: boolean) {
  const startLabel = (start ?? "").slice(0, 5);
  if (openEnd || !end) return `${startLabel} – offen`;
  return `${startLabel} – ${end.slice(0, 5)}`;
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

function assignmentLabel(value?: "active" | "ruf" | null) {
  if (value === "active") return "Aktiv";
  if (value === "ruf") return "Ruf";
  return "Nicht zugewiesen";
}

function toLocalDateTimeInputValue(dateValue: string, timeValue?: string | null) {
  if (!dateValue || !timeValue) return "";
  return `${dateValue}T${timeValue.slice(0, 5)}`;
}

function addOneHour(localValue: string) {
  if (!localValue) return "";
  const parsed = new Date(localValue);
  if (Number.isNaN(parsed.getTime())) return localValue;
  parsed.setHours(parsed.getHours() + 1);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}T${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

function formatDateTimeLabel(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export default function SlotsPage() {
  const router = useRouter();

  const [session, setSessionState] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [slotWeeks, setSlotWeeks] = useState<SlotWeekSummary[]>([]);
  const [weeksLoading, setWeeksLoading] = useState(false);
  const [selectedWeekStart, setSelectedWeekStart] = useState("");
  const [selectedWeekEnd, setSelectedWeekEnd] = useState("");

  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [slotForm, setSlotForm] = useState<SlotForm>(EMPTY_SLOT_FORM);

  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkDeleteFrom, setBulkDeleteFrom] = useState("");
  const [bulkDeleteTo, setBulkDeleteTo] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [participantsDialogOpen, setParticipantsDialogOpen] = useState(false);
  const [selectedSlotForParticipants, setSelectedSlotForParticipants] =
    useState<SlotParticipantsSlot | null>(null);
  const [slotParticipants, setSlotParticipants] = useState<SlotParticipant[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [participantSearch, setParticipantSearch] = useState("");
  const [attendanceGrants, setAttendanceGrants] = useState<AttendanceGrant[]>([]);
  const [attendanceGrantUserId, setAttendanceGrantUserId] = useState("");
  const [attendanceGrantValidFrom, setAttendanceGrantValidFrom] = useState("");
  const [attendanceGrantValidUntil, setAttendanceGrantValidUntil] = useState("");
  const [attendanceGrantSaving, setAttendanceGrantSaving] = useState(false);
  const [attendanceGrantDeletingId, setAttendanceGrantDeletingId] = useState<string | null>(null);
  const [attendanceGrantsLoading, setAttendanceGrantsLoading] = useState(false);
  const [mdbUsers, setMdbUsers] = useState<MdbUser[]>([]);

  const canManage = canManageSlots(session?.role);

  const selectedWeek = useMemo(
    () => slotWeeks.find((week) => week.week_start === selectedWeekStart) ?? null,
    [slotWeeks, selectedWeekStart]
  );

  const filteredParticipants = useMemo(() => {
    const q = participantSearch.trim().toLowerCase();
    if (!q) return slotParticipants;

    return slotParticipants.filter((participant) => {
      const haystack =
        `${participant.first_name ?? ""} ${participant.last_name ?? ""} ${participant.email ?? ""} ${participant.role ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [participantSearch, slotParticipants]);

  const visibleParticipants = useMemo(() => {
    if (canManage) return filteredParticipants;
    return filteredParticipants.filter((participant) => participant.is_effectively_assigned);
  }, [canManage, filteredParticipants]);

  const totalAssignments =
    (selectedWeek?.active_assignment_count ?? 0) + (selectedWeek?.ruf_assignment_count ?? 0);
  const bulkDeleteMatchCount =
    bulkDeleteFrom && bulkDeleteTo
      ? slots.filter(
          (slot) => slot.slot_date >= bulkDeleteFrom && slot.slot_date <= bulkDeleteTo
        ).length
      : 0;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const localSession = getSession();

      if (!firebaseUser || !localSession || !canAccessSlots(localSession.role)) {
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

  useEffect(() => {
    if (!authReady || !session) return;
    void loadSlotWeeks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, session]);

  useEffect(() => {
    if (!authReady || !session) return;

    if (!selectedWeekStart || !selectedWeekEnd) {
      setSlots([]);
      return;
    }

    void loadSlots(selectedWeekStart, selectedWeekEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, session, selectedWeekStart, selectedWeekEnd]);

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

  async function loadSlotWeeks() {
    setWeeksLoading(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slot-weeks`, { headers });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const weeks = JSON.parse(text) as SlotWeekSummary[];
      setSlotWeeks(weeks);

      if (!selectedWeekStart) return;

      const matchingWeek = weeks.find((week) => week.week_start === selectedWeekStart);
      if (!matchingWeek) {
        setSelectedWeekStart("");
        setSelectedWeekEnd("");
        setSlots([]);
        return;
      }

      setSelectedWeekEnd(matchingWeek.week_end);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Laden der Sitzungswochen: ${message}`);
    } finally {
      setWeeksLoading(false);
    }
  }

  async function loadSlots(dateFrom?: string, dateTo?: string) {
    if (!dateFrom || !dateTo) {
      setSlots([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams();
      params.set("slot_date_from", dateFrom);
      params.set("slot_date_to", dateTo);
      if (query.trim()) params.set("q", query.trim());

      const res = await fetch(`${API_BASE}/admin/slots?${params.toString()}`, { headers });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      setSlots(JSON.parse(text) as Slot[]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Laden der Slots: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function refreshSlotPage() {
    await loadSlotWeeks();
    if (selectedWeekStart && selectedWeekEnd) {
      await loadSlots(selectedWeekStart, selectedWeekEnd);
    }
  }

  function selectWeek(week: SlotWeekSummary) {
    setSelectedWeekStart(week.week_start);
    setSelectedWeekEnd(week.week_end);
  }

  function clearSelectedWeek() {
    setSelectedWeekStart("");
    setSelectedWeekEnd("");
    setSlots([]);
  }

  async function loadMdbUsers() {
    const headers = await getAuthHeaders();
    const res = await fetch(`${API_BASE}/admin/users?role=mdb`, { headers });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    setMdbUsers(JSON.parse(text) as MdbUser[]);
  }

  async function loadAttendanceGrants(slotId: string) {
    setAttendanceGrantsLoading(true);

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slots/${slotId}/temporary-pgf-grants`, { headers });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      setAttendanceGrants(JSON.parse(text) as AttendanceGrant[]);
    } finally {
      setAttendanceGrantsLoading(false);
    }
  }

  function openCreateSlotDialog() {
    setSlotForm(EMPTY_SLOT_FORM);
    setSlotDialogOpen(true);
  }

  function openEditSlotDialog(slot: Slot) {
    setSlotForm({
      id: slot.id,
      slot_date: slot.slot_date ?? "",
      slot_code: slot.slot_code ?? "",
      start_time: (slot.start_time ?? "").slice(0, 5),
      end_time: (slot.end_time ?? "").slice(0, 5),
      open_end: !!slot.open_end,
    });
    setSlotDialogOpen(true);
  }

  async function saveSlot() {
    setSaving(true);
    setError("");

    const payload = {
      slot_date: slotForm.slot_date,
      slot_code: slotForm.slot_code,
      start_time: slotForm.start_time,
      end_time: slotForm.end_time || null,
      open_end: slotForm.open_end,
    };

    try {
      const headers = await getAuthHeaders();
      const isEdit = !!slotForm.id;

      const res = await fetch(`${API_BASE}/admin/slots${isEdit ? `/${slotForm.id}` : ""}`, {
        method: isEdit ? "PATCH" : "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      setSlotDialogOpen(false);
      setSlotForm(EMPTY_SLOT_FORM);
      await refreshSlotPage();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Speichern: ${message}`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteSlot(id: string) {
    if (!window.confirm("Diesen Slot wirklich löschen?")) return;

    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slots/${id}`, {
        method: "DELETE",
        headers,
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      await refreshSlotPage();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Löschen: ${message}`);
    }
  }

  async function bulkDeleteSlots() {
    if (!bulkDeleteFrom || !bulkDeleteTo) {
      setError("Bitte Start- und Enddatum für die Löschung auswählen.");
      return;
    }

    if (bulkDeleteTo < bulkDeleteFrom) {
      setError("Das Enddatum muss am oder nach dem Startdatum liegen.");
      return;
    }

    const confirmed = window.confirm(
      `Wirklich alle Slots vom ${bulkDeleteFrom} bis ${bulkDeleteTo} löschen?${bulkDeleteMatchCount ? ` (${bulkDeleteMatchCount} gefundene Slots)` : ""}`
    );
    if (!confirmed) return;

    setBulkDeleting(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slots/bulk-delete`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          date_from: bulkDeleteFrom,
          date_to: bulkDeleteTo,
        }),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      setBulkDeleteDialogOpen(false);
      setBulkDeleteFrom("");
      setBulkDeleteTo("");
      await refreshSlotPage();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Löschen des Zeitraums: ${message}`);
    } finally {
      setBulkDeleting(false);
    }
  }

  async function openParticipantsDialog(slot: Slot) {
    setParticipantsLoading(true);
    setError("");
    setParticipantSearch("");
    setAttendanceGrantUserId("");
    const defaultFrom = toLocalDateTimeInputValue(slot.slot_date, slot.start_time);
    setAttendanceGrantValidFrom(defaultFrom);
    setAttendanceGrantValidUntil(
      slot.end_time
        ? toLocalDateTimeInputValue(slot.slot_date, slot.end_time)
        : addOneHour(defaultFrom)
    );

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slots/${slot.id}/participants`, { headers });

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const data = JSON.parse(text) as SlotParticipantsResponse;
      setSelectedSlotForParticipants({
        ...data.slot,
        start_time: slot.start_time,
        end_time: slot.end_time,
        open_end: slot.open_end,
      });
      setSlotParticipants(data.participants);
      if (canManage) {
        await Promise.all([loadAttendanceGrants(slot.id), loadMdbUsers()]);
      } else {
        setAttendanceGrants([]);
      }
      setParticipantsDialogOpen(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Laden der Teilnehmer: ${message}`);
    } finally {
      setParticipantsLoading(false);
    }
  }

  async function setParticipantAssignment(userId: string, assignmentType: "active" | "ruf") {
    if (!canManage || !selectedSlotForParticipants) return;

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${API_BASE}/admin/slots/${selectedSlotForParticipants.id}/participants/add`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ user_id: userId, assignment_type: assignmentType }),
        }
      );

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      await openParticipantsDialog({ id: selectedSlotForParticipants.id } as Slot);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Zuweisen: ${message}`);
    }
  }

  async function removeParticipant(userId: string) {
    if (!canManage || !selectedSlotForParticipants) return;

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${API_BASE}/admin/slots/${selectedSlotForParticipants.id}/participants/remove`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ user_id: userId }),
        }
      );

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      await openParticipantsDialog({ id: selectedSlotForParticipants.id } as Slot);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Entfernen: ${message}`);
    }
  }

  async function createAttendanceGrant() {
    if (!selectedSlotForParticipants || !attendanceGrantUserId) {
      setError("Bitte zuerst einen MdB für die temporären PGF-Rechte auswählen.");
      return;
    }

    if (!attendanceGrantValidFrom || !attendanceGrantValidUntil) {
      setError("Bitte Beginn und Ende für die temporären PGF-Rechte setzen.");
      return;
    }

    setAttendanceGrantSaving(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${API_BASE}/admin/slots/${selectedSlotForParticipants.id}/temporary-pgf-grants`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            user_id: attendanceGrantUserId,
            valid_from: new Date(attendanceGrantValidFrom).toISOString(),
            valid_until: new Date(attendanceGrantValidUntil).toISOString(),
          }),
        }
      );
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      setAttendanceGrantUserId("");
      setAttendanceGrantValidFrom("");
      setAttendanceGrantValidUntil("");
      await loadAttendanceGrants(selectedSlotForParticipants.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Vergeben der temporären PGF-Rechte: ${message}`);
    } finally {
      setAttendanceGrantSaving(false);
    }
  }

  async function deleteAttendanceGrant(grantId: string) {
    if (!selectedSlotForParticipants) return;

    setAttendanceGrantDeletingId(grantId);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${API_BASE}/admin/slots/${selectedSlotForParticipants.id}/temporary-pgf-grants/${grantId}`,
        {
          method: "DELETE",
          headers,
        }
      );
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      await loadAttendanceGrants(selectedSlotForParticipants.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Entfernen der temporären PGF-Rechte: ${message}`);
    } finally {
      setAttendanceGrantDeletingId(null);
    }
  }

  if (!authReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f8]">
        <div className="text-sm text-slate-500">Lade…</div>
      </main>
    );
  }

  if (!session) return null;

  return (
    <AdminShell
      session={session}
      title={canManage ? "Slots" : "Präsenzdienste"}
      subtitle={
        canManage
          ? "Einzelne Slots und Besetzungen manuell nachbearbeiten."
          : "Nächste Präsenzdienste und Teilnehmerübersicht."
      }
      actions={
        canManage ? (
          <>
            <Button
              className="admin-btn"
              variant="outline"
              onClick={() => void refreshSlotPage()}
              disabled={loading || weeksLoading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${loading || weeksLoading ? "animate-spin" : ""}`}
              />
              Aktualisieren
            </Button>

            <Button
              className="admin-btn"
              variant="outline"
              onClick={() => setBulkDeleteDialogOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Zeitraum löschen
            </Button>

            <Button onClick={openCreateSlotDialog} className="admin-btn-primary">
              <Plus className="mr-2 h-4 w-4" />
              Slot anlegen
            </Button>
          </>
        ) : (
          <Button
            className="admin-btn"
            variant="outline"
            onClick={() => void refreshSlotPage()}
            disabled={loading || weeksLoading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading || weeksLoading ? "animate-spin" : ""}`}
            />
            Aktualisieren
          </Button>
        )
      }
    >
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
            <div className="admin-stat-label">Sitzungswochen</div>
            <div className="mt-3 text-3xl font-semibold">{slotWeeks.length}</div>
          </CardContent>
        </Card>

        <Card className="admin-card">
          <CardContent className="p-5">
            <div className="admin-stat-label">Slots in Auswahl</div>
            <div className="mt-3 text-3xl font-semibold">{selectedWeek?.slot_count ?? 0}</div>
          </CardContent>
        </Card>

        <Card className="admin-card">
          <CardContent className="p-5">
            <div className="admin-stat-label">Zuweisungen in Auswahl</div>
            <div className="mt-3 text-3xl font-semibold">{totalAssignments}</div>
          </CardContent>
        </Card>
      </div>

      {error ? <div className="admin-error">{error}</div> : null}

      <Card className="admin-card">
        <CardHeader className="admin-card-header">
          <CardTitle className="text-base font-semibold">Sitzungswochen</CardTitle>
        </CardHeader>

        <CardContent className="admin-section p-5">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-600">
                Erst eine Woche auswählen, dann werden die zugehörigen Slots geladen.
              </div>

              {selectedWeek ? (
                <Button className="admin-btn" variant="outline" onClick={clearSelectedWeek}>
                  Auswahl aufheben
                </Button>
              ) : null}
            </div>

            <div className="grid gap-3">
              {slotWeeks.map((week) => {
                const isSelected = week.week_start === selectedWeekStart;
                const assignmentCount =
                  (week.active_assignment_count ?? 0) + (week.ruf_assignment_count ?? 0);

                return (
                  <button
                    key={week.week_start}
                    type="button"
                    onClick={() => selectWeek(week)}
                    className={[
                      "rounded-xl border px-4 py-4 text-left transition",
                      isSelected
                        ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className={`text-sm ${isSelected ? "text-slate-200" : "text-slate-500"}`}>
                          Sitzungswoche
                        </div>
                        <div className="mt-1 text-lg font-semibold">
                          {formatDateLabel(week.week_start)} – {formatDateLabel(week.week_end)}
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <div className={`text-xs uppercase ${isSelected ? "text-slate-300" : "text-slate-500"}`}>
                            Tage
                          </div>
                          <div className="mt-1 text-base font-semibold">{week.day_count}</div>
                        </div>
                        <div>
                          <div className={`text-xs uppercase ${isSelected ? "text-slate-300" : "text-slate-500"}`}>
                            Slots
                          </div>
                          <div className="mt-1 text-base font-semibold">{week.slot_count}</div>
                        </div>
                        <div>
                          <div className={`text-xs uppercase ${isSelected ? "text-slate-300" : "text-slate-500"}`}>
                            Zuweisungen
                          </div>
                          <div className="mt-1 text-base font-semibold">{assignmentCount}</div>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}

              {!weeksLoading && slotWeeks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                  Noch keine Sitzungswochen vorhanden.
                </div>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="admin-card">
        <CardHeader className="admin-card-header">
          <CardTitle className="text-base font-semibold">
            {selectedWeek
              ? `Slots · ${formatDateLabel(selectedWeek.week_start)} – ${formatDateLabel(selectedWeek.week_end)}`
              : "Slots"}
          </CardTitle>
        </CardHeader>

        <CardContent className="admin-section p-5">
          {!selectedWeek ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
              Bitte zuerst eine Sitzungswoche auswählen.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    className="admin-input pl-9"
                    placeholder="Code suchen"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>

                <Button
                  className="admin-btn"
                  variant="outline"
                  onClick={() => void loadSlots(selectedWeekStart, selectedWeekEnd)}
                >
                  Suchen
                </Button>
              </div>

              <div className="admin-table">
                <div
                  className={[
                    "admin-table-header grid",
                    canManage
                      ? "grid-cols-[140px_110px_140px_90px_90px_110px_220px]"
                      : "grid-cols-[140px_110px_140px_90px_90px_110px_120px]",
                  ].join(" ")}
                >
                  <div>Datum</div>
                  <div>Code</div>
                  <div>Zeit</div>
                  <div>Aktiv</div>
                  <div>Ruf</div>
                  <div>Status</div>
                  <div>Aktion</div>
                </div>

                {slots.map((slot) => (
                  <div
                    key={slot.id}
                    className={[
                      "admin-table-row grid",
                      canManage
                        ? "grid-cols-[140px_110px_140px_90px_90px_110px_220px]"
                        : "grid-cols-[140px_110px_140px_90px_90px_110px_120px]",
                    ].join(" ")}
                  >
                    <div>{slot.slot_date}</div>
                    <div className="font-medium">{slot.slot_code}</div>
                    <div>{slotTimeLabel(slot.start_time, slot.end_time, slot.open_end)}</div>
                    <div>{slot.active_count ?? 0}</div>
                    <div>{slot.ruf_count ?? 0}</div>
                    <div>
                      <Badge variant={slot.open_end ? "secondary" : "outline"}>
                        {slot.open_end ? "offen" : "normal"}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="admin-btn"
                        onClick={() => void openParticipantsDialog(slot)}
                      >
                        <Users className="mr-2 h-4 w-4" />
                        Teilnehmer
                      </Button>

                      {canManage ? (
                        <>
                          <Button
                            size="icon"
                            variant="outline"
                            className="admin-btn"
                            onClick={() => openEditSlotDialog(slot)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>

                          <Button
                            size="icon"
                            variant="outline"
                            className="admin-btn"
                            onClick={() => void deleteSlot(slot.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}

                {!loading && slots.length === 0 ? (
                  <div className="p-6 text-center text-sm text-slate-500">
                    Keine Slots in dieser Woche vorhanden
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <Dialog open={slotDialogOpen} onOpenChange={setSlotDialogOpen}>
          <DialogContent className="admin-dialog sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{slotForm.id ? "Slot bearbeiten" : "Slot anlegen"}</DialogTitle>
            </DialogHeader>

            <div className="grid gap-4 py-2 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Datum</Label>
                <Input
                  className="admin-input"
                  type="date"
                  value={slotForm.slot_date}
                  onChange={(e) => setSlotForm({ ...slotForm, slot_date: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Slot-Code</Label>
                <Input
                  className="admin-input"
                  value={slotForm.slot_code}
                  onChange={(e) => setSlotForm({ ...slotForm, slot_code: e.target.value })}
                  placeholder="z. B. S01"
                />
              </div>

              <div className="space-y-2">
                <Label>Startzeit</Label>
                <Input
                  className="admin-input"
                  type="time"
                  value={slotForm.start_time}
                  onChange={(e) => setSlotForm({ ...slotForm, slot_date: slotForm.slot_date, start_time: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Endzeit</Label>
                <Input
                  className="admin-input"
                  type="time"
                  value={slotForm.end_time}
                  onChange={(e) => setSlotForm({ ...slotForm, end_time: e.target.value })}
                />
              </div>

              <div className="flex items-center justify-between border border-slate-200 px-4 py-3 md:col-span-2">
                <div>
                  <div className="font-medium">Offenes Ende</div>
                  <div className="text-xs text-slate-500">Slot läuft offen weiter</div>
                </div>
                <Switch
                  checked={slotForm.open_end}
                  onCheckedChange={(checked) => setSlotForm({ ...slotForm, open_end: checked })}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                className="admin-btn"
                onClick={() => setSlotDialogOpen(false)}
              >
                Abbrechen
              </Button>

              <Button onClick={() => void saveSlot()} disabled={saving} className="admin-btn-primary">
                {saving ? "Speichert…" : "Speichern"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {canManage ? (
        <Dialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
          <DialogContent className="admin-dialog sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Zeitraum löschen</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Von</Label>
                  <Input
                    className="admin-input"
                    type="date"
                    value={bulkDeleteFrom}
                    onChange={(e) => setBulkDeleteFrom(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Bis</Label>
                  <Input
                    className="admin-input"
                    type="date"
                    value={bulkDeleteTo}
                    onChange={(e) => setBulkDeleteTo(e.target.value)}
                  />
                </div>
              </div>

              <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {bulkDeleteMatchCount
                  ? `${bulkDeleteMatchCount} Slots würden im aktuell geladenen Ausschnitt gelöscht.`
                  : "Im aktuell geladenen Ausschnitt wurden noch keine passenden Slots gefunden."}
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                className="admin-btn"
                onClick={() => setBulkDeleteDialogOpen(false)}
              >
                Abbrechen
              </Button>

              <Button
                className="admin-btn-primary"
                disabled={bulkDeleting}
                onClick={() => void bulkDeleteSlots()}
              >
                {bulkDeleting ? "Löscht…" : "Zeitraum löschen"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      <Dialog open={participantsDialogOpen} onOpenChange={setParticipantsDialogOpen}>
        <DialogContent className="admin-dialog flex h-auto max-h-[90vh] !w-[90vw] !max-w-[90vw] min-w-0 flex-col overflow-hidden p-0">
          <DialogHeader>
            <DialogTitle className="px-4 pt-4">
              Teilnehmer
              {selectedSlotForParticipants ? (
                <span className="ml-2 text-sm font-normal text-slate-500">
                  {selectedSlotForParticipants.slot_date} · {selectedSlotForParticipants.slot_code}
                </span>
              ) : null}
            </DialogTitle>
          </DialogHeader>

          <div className="min-w-0 space-y-4 overflow-y-auto px-4 pb-4 pt-2">
            {canManage ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-sm font-semibold text-slate-900">Temporäre PGF-Rechte</div>
                <div className="mt-1 text-sm text-slate-600">
                  Hier kann ein einzelner MdB für ein begrenztes Zeitfenster die Sitzungsleitung
                  übernehmen und den Dienst abhaken, ohne weitere PGF-Rechte zu erhalten.
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_180px_180px_auto] lg:items-end">
                  <div className="space-y-2">
                    <Label>MdB auswählen</Label>
                    <Select
                      value={attendanceGrantUserId || "none"}
                      onValueChange={(value) =>
                        setAttendanceGrantUserId(value === "none" ? "" : value)
                      }
                    >
                      <SelectTrigger className="admin-select-trigger">
                        <SelectValue placeholder="MdB auswählen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">MdB auswählen</SelectItem>
                        {mdbUsers.map((user) => {
                          const label =
                            `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email;
                          return (
                            <SelectItem key={user.id} value={user.id}>
                              {label}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Beginn</Label>
                    <Input
                      className="admin-input"
                      type="datetime-local"
                      value={attendanceGrantValidFrom}
                      onChange={(e) => setAttendanceGrantValidFrom(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Ende</Label>
                    <Input
                      className="admin-input"
                      type="datetime-local"
                      value={attendanceGrantValidUntil}
                      onChange={(e) => setAttendanceGrantValidUntil(e.target.value)}
                    />
                  </div>

                  <Button
                    className="admin-btn-primary"
                    disabled={
                      attendanceGrantSaving ||
                      !attendanceGrantUserId ||
                      !attendanceGrantValidFrom ||
                      !attendanceGrantValidUntil
                    }
                    onClick={() => void createAttendanceGrant()}
                  >
                    {attendanceGrantSaving ? "Vergibt…" : "PGF-Rechte vergeben"}
                  </Button>
                </div>

                <div className="mt-4 space-y-3">
                  {attendanceGrants.map((grant) => {
                    const grantName =
                      `${grant.first_name ?? ""} ${grant.last_name ?? ""}`.trim() || grant.email;
                    return (
                      <div
                        key={grant.id}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-4"
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <div className="font-medium text-slate-900">{grantName}</div>
                            <div className="mt-1 break-all text-sm text-slate-600">
                              {grant.email}
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
                              {formatDateTimeLabel(grant.valid_from)} – {formatDateTimeLabel(grant.valid_until)}
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            className="admin-btn"
                            disabled={attendanceGrantDeletingId === grant.id}
                            onClick={() => void deleteAttendanceGrant(grant.id)}
                          >
                            {attendanceGrantDeletingId === grant.id
                              ? "Entfernt…"
                              : "PGF-Rechte entziehen"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}

                  {!attendanceGrantsLoading && attendanceGrants.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                      Für diesen Slot überschneidet sich aktuell kein temporäres PGF-Zeitfenster.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input
                className="admin-input pl-9"
                placeholder="Person suchen"
                value={participantSearch}
                onChange={(e) => setParticipantSearch(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              {visibleParticipants.map((participant) => {
                const participantName =
                  `${participant.first_name ?? ""} ${participant.last_name ?? ""}`.trim() || "—";

                return (
                  <div
                    key={participant.id}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-base font-semibold text-slate-900">
                            {participantName}
                          </div>
                          <Badge variant="outline">{participant.role ?? "—"}</Badge>
                          <Badge
                            variant={
                              participant.assignment_type === "active"
                                ? "default"
                                : participant.assignment_type === "ruf"
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {assignmentLabel(participant.assignment_type)}
                          </Badge>
                        </div>

                        <div className="break-all text-sm text-slate-600">{participant.email}</div>
                      </div>

                      {canManage ? (
                        <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                          <Button
                            variant="outline"
                            className="admin-btn"
                            size="sm"
                            onClick={() => void setParticipantAssignment(participant.id, "active")}
                          >
                            Aktiv
                          </Button>
                          <Button
                            variant="outline"
                            className="admin-btn"
                            size="sm"
                            onClick={() => void setParticipantAssignment(participant.id, "ruf")}
                          >
                            Ruf
                          </Button>
                          <Button
                            variant="outline"
                            className="admin-btn"
                            size="sm"
                            onClick={() => void removeParticipant(participant.id)}
                          >
                            Entfernen
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {!participantsLoading && visibleParticipants.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                  Keine Personen gefunden.
                </div>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
