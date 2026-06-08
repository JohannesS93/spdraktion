"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
    CalendarDays,
    Clock3,
    LogOut,
    Pencil,
    Plus,
    RefreshCw,
    Search,
} from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { API_BASE } from "@/lib/api";
import { getSession, clearSession } from "@/lib/auth";
import { auth } from "@/lib/firebase";



type SlotParticipant = {
    id: string;
    email: string;
    first_name?: string | null;
    last_name?: string | null;
    role?: string | null;

    is_in_base_group: boolean;
    is_manually_added: boolean;
    is_manually_removed: boolean;
    is_effectively_assigned: boolean;
};

type WeekSlot = {
    slot_date: string;
    weekday: string;
    slot_code: string;
    slot_order: number;
    start_time: string;
    end_time?: string | null;
    open_end: boolean;
    base_group_id?: string | null;
};

type SlotParticipantsSlot = {
    id: string;
    slot_code: string;
    slot_date: string;
    base_group_id?: string | null;
    group_name?: string | null;
};

type SessionUser = {
    id: string;
    email: string;
    first_name?: string | null;
    last_name?: string | null;
    role: string;
};

type Slot = {
    id: string;
    slot_date: string;
    slot_code: string;
    start_time?: string | null;
    end_time?: string | null;
    open_end: boolean;
    base_group_id?: string | null;
    group_name?: string | null;
};

type Group = {
    id: string;
    name: string;
};

const EMPTY_FORM = {
    id: null as string | null,
    slot_date: "",
    slot_code: "",
    start_time: "",
    end_time: "",
    open_end: false,
    base_group_id: "",
};

export default function AdminSlotsPage() {
    const router = useRouter();

    const [session, setSessionState] = useState<SessionUser | null>(null);
    const [authReady, setAuthReady] = useState(false);

    const [slots, setSlots] = useState<Slot[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const [query, setQuery] = useState("");
    const [groupFilter, setGroupFilter] = useState("all");

    const [dialogOpen, setDialogOpen] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);

    const [weekDialogOpen, setWeekDialogOpen] = useState(false);
    const [weekStart, setWeekStart] = useState("");
    const [weekEnd, setWeekEnd] = useState("");
    const [weekSlots, setWeekSlots] = useState<WeekSlot[]>([]);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [creatingWeek, setCreatingWeek] = useState(false);

    const [participantsDialogOpen, setParticipantsDialogOpen] = useState(false);
    const [selectedSlotForParticipants, setSelectedSlotForParticipants] =
        useState<SlotParticipantsSlot | null>(null); const [slotParticipants, setSlotParticipants] = useState<SlotParticipant[]>([]);
    const [participantsLoading, setParticipantsLoading] = useState(false);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            const localSession = getSession();

            if (!firebaseUser || !localSession || localSession.role !== "admin") {
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

    async function previewWeek() {
        setPreviewLoading(true);
        setError("");

        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`${API_BASE}/admin/slot-weeks/preview`, {
                method: "POST",
                headers,
                body: JSON.stringify({ week_start: weekStart }),
            });

            const text = await res.text();
            if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

            const data = JSON.parse(text);
            setWeekStart(data.week_start);
            setWeekEnd(data.week_end);
            setWeekSlots(data.slots);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            setError(`Fehler bei der Wochenvorschau: ${message}`);
        } finally {
            setPreviewLoading(false);
        }
    }

    function updateWeekSlot<K extends keyof WeekSlot>(
        index: number,
        field: K,
        value: WeekSlot[K]
    ) {
        setWeekSlots((prev) =>
            prev.map((slot, i) =>
                i === index ? { ...slot, [field]: value } : slot
            )
        );
    }
    function deleteWeekSlot(index: number) {
        setWeekSlots((prev) => prev.filter((_, i) => i !== index));
    }

    function addWeekSlot() {
        setWeekSlots((prev) => [
            ...prev,
            {
                slot_date: weekStart,
                weekday: "",
                slot_code: "",
                slot_order: prev.length + 1,
                start_time: "",
                end_time: "",
                open_end: false,
                base_group_id: null,
            },
        ]);
    }

    async function openParticipantsDialog(slot: Slot) {
        setParticipantsLoading(true);
        setError("");

        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`${API_BASE}/admin/slots/${slot.id}/participants`, {
                headers,
            });

            const text = await res.text();
            if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

            const data = JSON.parse(text);
            setSelectedSlotForParticipants(data.slot);
            setSlotParticipants(data.participants);
            setParticipantsDialogOpen(true);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            setError(`Fehler beim Laden der Teilnehmer: ${message}`);
        } finally {
            setParticipantsLoading(false);
        }
    }

    async function addParticipant(userId: string) {
        if (!selectedSlotForParticipants) return;

        try {
            const headers = await getAuthHeaders();
            const res = await fetch(
                `${API_BASE}/admin/slots/${selectedSlotForParticipants.id}/participants/add`,
                {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ user_id: userId }),
                }
            );

            const text = await res.text();
            if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

            await openParticipantsDialog({
                id: selectedSlotForParticipants.id,
            } as Slot);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            setError(`Fehler beim Hinzufügen: ${message}`);
        }
    }

    async function removeParticipant(userId: string) {
        if (!selectedSlotForParticipants) return;

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

            await openParticipantsDialog({
                id: selectedSlotForParticipants.id,
            } as Slot);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            setError(`Fehler beim Entfernen: ${message}`);
        }
    }

    async function clearParticipantOverride(userId: string) {
        if (!selectedSlotForParticipants) return;

        try {
            const headers = await getAuthHeaders();
            const res = await fetch(
                `${API_BASE}/admin/slots/${selectedSlotForParticipants.id}/participants/${userId}/override`,
                {
                    method: "DELETE",
                    headers,
                }
            );

            const text = await res.text();
            if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

            await openParticipantsDialog({
                id: selectedSlotForParticipants.id,
            } as Slot);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            setError(`Fehler beim Zurücksetzen: ${message}`);
        }
    }

    async function createWeek() {
        setCreatingWeek(true);
        setError("");

        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`${API_BASE}/admin/slot-weeks/create`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    week_start: weekStart,
                    week_end: weekEnd,
                    slots: weekSlots,
                }),
            });

            const text = await res.text();
            if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

            setWeekDialogOpen(false);
            setWeekStart("");
            setWeekEnd("");
            setWeekSlots([]);
            await loadSlots();
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            setError(`Fehler beim Anlegen der Woche: ${message}`);
        } finally {
            setCreatingWeek(false);
        }
    }

    async function loadGroups() {
        const headers = await getAuthHeaders();
        const res = await fetch(`${API_BASE}/admin/groups`, { headers });

        const text = await res.text();
        if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

        setGroups(JSON.parse(text));
    }

    async function loadSlots() {
        setLoading(true);
        setError("");

        try {
            const headers = await getAuthHeaders();
            const params = new URLSearchParams();

            if (groupFilter !== "all") params.set("group_id", groupFilter);
            if (query.trim()) params.set("q", query.trim());

            const res = await fetch(`${API_BASE}/admin/slots?${params.toString()}`, {
                headers,
            });

            const text = await res.text();
            if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

            setSlots(JSON.parse(text));
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            setError(`Fehler beim Laden: ${message}`);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (!authReady || !session) return;
        loadGroups();
        loadSlots();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authReady, session, groupFilter]);

    function openCreateDialog() {
        setForm(EMPTY_FORM);
        setDialogOpen(true);
    }

    function openEditDialog(slot: Slot) {
        setForm({
            id: slot.id,
            slot_date: slot.slot_date ?? "",
            slot_code: slot.slot_code ?? "",
            start_time: (slot.start_time ?? "").slice(0, 5),
            end_time: (slot.end_time ?? "").slice(0, 5),
            open_end: !!slot.open_end,
            base_group_id: slot.base_group_id ?? "",
        });
        setDialogOpen(true);
    }

    async function saveSlot() {
        setSaving(true);
        setError("");

        const payload = {
            slot_date: form.slot_date,
            slot_code: form.slot_code,
            start_time: form.start_time,
            end_time: form.end_time || null,
            open_end: form.open_end,
            base_group_id: form.base_group_id || null,
        };

        try {
            const headers = await getAuthHeaders();
            const isEdit = !!form.id;

            const res = await fetch(
                `${API_BASE}/admin/slots${isEdit ? `/${form.id}` : ""}`,
                {
                    method: isEdit ? "PATCH" : "POST",
                    headers,
                    body: JSON.stringify(payload),
                }
            );

            const text = await res.text();
            if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

            setDialogOpen(false);
            await loadSlots();
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            setError(`Fehler beim Speichern: ${message}`);
        } finally {
            setSaving(false);
        }
    }

    async function deleteSlot(id: string) {
        if (!window.confirm("Diesen Slot wirklich löschen?")) return;

        try {
            const headers = await getAuthHeaders();
            const res = await fetch(`${API_BASE}/admin/slots/${id}`, {
                method: "DELETE",
                headers,
            });

            const text = await res.text();
            if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

            await loadSlots();
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            setError(`Fehler beim Löschen: ${message}`);
        }
    }

    async function handleLogout() {
        clearSession();
        await auth.signOut();
        router.replace("/login");
    }

    if (!authReady) {
        return (
            <main className="min-h-screen bg-slate-50 flex items-center justify-center">
                <div className="text-sm text-slate-500">Lade…</div>
            </main>
        );
    }

    if (!session) return null;

    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <div className="flex items-center justify-between rounded-2xl border bg-white px-6 py-4 shadow-sm">
                    <div>
                        <div className="text-lg font-semibold">SPD Admin</div>
                        <div className="text-sm text-slate-500">
                            {session.first_name} {session.last_name}
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => router.push("/admin/users")}>
                            Nutzer
                        </Button>
                        <Button variant="outline" onClick={() => router.push("/admin/staff")}>
                            Mitarbeiter
                        </Button>
                        <Button variant="outline" onClick={() => setWeekDialogOpen(true)}>
                            Woche hinzufügen
                        </Button>
                        <Button variant="outline" onClick={handleLogout}>
                            <LogOut className="mr-2 h-4 w-4" />
                            Logout
                        </Button>
                    </div>
                </div>

                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">
                            Admin · Sitzungsdienste
                        </h1>
                        <p className="mt-1 text-sm text-slate-600">
                            Slots anlegen, bearbeiten und Gruppen zuweisen.
                        </p>
                    </div>

                    <div className="flex gap-2">
                        <Button variant="outline" onClick={loadSlots} disabled={loading}>
                            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                            Aktualisieren
                        </Button>
                        <Button onClick={openCreateDialog}>
                            <Plus className="mr-2 h-4 w-4" />
                            Slot anlegen
                        </Button>
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                    <Card className="rounded-2xl shadow-sm">
                        <CardContent className="flex items-center gap-4 p-6">
                            <CalendarDays className="h-8 w-8" />
                            <div>
                                <div className="text-2xl font-bold">{slots.length}</div>
                                <div className="text-sm text-slate-600">Slots gesamt</div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="rounded-2xl shadow-sm">
                        <CardContent className="flex items-center gap-4 p-6">
                            <Clock3 className="h-8 w-8" />
                            <div>
                                <div className="text-2xl font-bold">
                                    {slots.filter((s) => s.open_end).length}
                                </div>
                                <div className="text-sm text-slate-600">Mit offenem Ende</div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="rounded-2xl shadow-sm">
                        <CardContent className="flex items-center gap-4 p-6">
                            <CalendarDays className="h-8 w-8" />
                            <div>
                                <div className="text-2xl font-bold">
                                    {new Set(slots.map((s) => s.slot_date)).size}
                                </div>
                                <div className="text-sm text-slate-600">Sitzungstage</div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <Card className="rounded-2xl shadow-sm">
                    <CardHeader>
                        <CardTitle>Slots</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-[1fr_240px_auto]">
                            <div className="relative">
                                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                                <Input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Code oder Gruppe suchen"
                                    className="pl-9"
                                />
                            </div>

                            <Select value={groupFilter} onValueChange={setGroupFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Gruppe filtern" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Alle Gruppen</SelectItem>
                                    {groups.map((g) => (
                                        <SelectItem key={g.id} value={g.id}>
                                            {g.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Button variant="outline" onClick={loadSlots}>
                                Suchen
                            </Button>
                        </div>

                        {error && (
                            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                {error}
                            </div>
                        )}

                        <div className="overflow-hidden rounded-2xl border bg-white">
                            <div className="grid grid-cols-[140px_120px_140px_160px_100px_100px] gap-3 border-b bg-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                                <div>Datum</div>
                                <div>Code</div>
                                <div>Zeit</div>
                                <div>Gruppe</div>
                                <div>Status</div>
                                <div>Aktion</div>
                            </div>

                            {slots.map((slot) => (
                                <div
                                    key={slot.id}
                                    className="grid grid-cols-[140px_120px_140px_160px_100px_100px] gap-3 border-b px-4 py-3 text-sm last:border-b-0"
                                >
                                    <div>{slot.slot_date}</div>
                                    <div className="font-medium">{slot.slot_code}</div>
                                    <div>
                                        {(slot.start_time ?? "").slice(0, 5)}
                                        {slot.end_time ? `–${slot.end_time.slice(0, 5)}` : ""}
                                    </div>
                                    <div>{slot.group_name ?? "—"}</div>
                                    <div>
                                        <Badge variant={slot.open_end ? "secondary" : "outline"}>
                                            {slot.open_end ? "offenes Ende" : "normal"}
                                        </Badge>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            size="icon"
                                            variant="outline"
                                            onClick={() => openEditDialog(slot)}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            size="icon"
                                            variant="outline"
                                            onClick={() => deleteSlot(slot.id)}
                                        >
                                            ×
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => openParticipantsDialog(slot)}
                                        >
                                            Teilnehmer
                                        </Button>
                                    </div>
                                </div>
                            ))}

                            {!loading && slots.length === 0 && (
                                <div className="px-6 py-10 text-center text-sm text-slate-500">
                                    Keine Slots gefunden.
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-2xl rounded-2xl">
                    <DialogHeader>
                        <DialogTitle>
                            {form.id ? "Slot bearbeiten" : "Slot anlegen"}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="grid gap-4 py-2 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Datum</Label>
                            <Input
                                type="date"
                                value={form.slot_date}
                                onChange={(e) => setForm({ ...form, slot_date: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Slot-Code</Label>
                            <Input
                                value={form.slot_code}
                                onChange={(e) => setForm({ ...form, slot_code: e.target.value })}
                                placeholder="z. B. S01"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Startzeit</Label>
                            <Input
                                type="time"
                                value={form.start_time}
                                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Endzeit</Label>
                            <Input
                                type="time"
                                value={form.end_time}
                                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2 md:col-span-2">
                            <Label>Gruppe</Label>
                            <Select
                                value={form.base_group_id || "none"}
                                onValueChange={(value) =>
                                    setForm({
                                        ...form,
                                        base_group_id: value === "none" ? "" : value,
                                    })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Gruppe wählen" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Keine Gruppe</SelectItem>
                                    {groups.map((g) => (
                                        <SelectItem key={g.id} value={g.id}>
                                            {g.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex items-center justify-between rounded-xl border px-4 py-3 md:col-span-2">
                            <div>
                                <div className="font-medium">Offenes Ende</div>
                                <div className="text-xs text-slate-500">
                                    Slot läuft offen weiter
                                </div>
                            </div>
                            <Switch
                                checked={form.open_end}
                                onCheckedChange={(checked) =>
                                    setForm({ ...form, open_end: checked })
                                }
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            Abbrechen
                        </Button>
                        <Button onClick={saveSlot} disabled={saving}>
                            {saving ? "Speichert…" : "Speichern"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog open={weekDialogOpen} onOpenChange={setWeekDialogOpen}>
                <DialogContent className="sm:max-w-6xl rounded-2xl">
                    <DialogHeader>
                        <DialogTitle>Woche hinzufügen</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="flex gap-3 items-end">
                            <div className="space-y-2">
                                <Label>Wochenstart</Label>
                                <Input
                                    type="date"
                                    value={weekStart}
                                    onChange={(e) => setWeekStart(e.target.value)}
                                />
                            </div>
                            <Button onClick={previewWeek} disabled={previewLoading || !weekStart}>
                                {previewLoading ? "Lädt…" : "Vorschau laden"}
                            </Button>
                            <Button variant="outline" onClick={addWeekSlot} disabled={!weekStart}>
                                Slot ergänzen
                            </Button>
                        </div>

                        {weekSlots.length > 0 && (
                            <div className="overflow-hidden rounded-2xl border bg-white">
                                <div className="grid grid-cols-[140px_120px_120px_120px_120px_100px_160px_80px] gap-3 border-b bg-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                                    <div>Datum</div>
                                    <div>Wochentag</div>
                                    <div>Code</div>
                                    <div>Start</div>
                                    <div>Ende</div>
                                    <div>Open End</div>
                                    <div>Gruppe</div>
                                    <div></div>
                                </div>

                                {weekSlots.map((slot, index) => (
                                    <div
                                        key={index}
                                        className="grid grid-cols-[140px_120px_120px_120px_120px_100px_160px_80px] gap-3 border-b px-4 py-3 text-sm last:border-b-0"
                                    >
                                        <Input
                                            type="date"
                                            value={slot.slot_date}
                                            onChange={(e) => updateWeekSlot(index, "slot_date", e.target.value)}
                                        />
                                        <Input
                                            value={slot.weekday}
                                            onChange={(e) => updateWeekSlot(index, "weekday", e.target.value)}
                                        />
                                        <Input
                                            value={slot.slot_code}
                                            onChange={(e) => updateWeekSlot(index, "slot_code", e.target.value)}
                                        />
                                        <Input
                                            type="time"
                                            value={slot.start_time ?? ""}
                                            onChange={(e) => updateWeekSlot(index, "start_time", e.target.value)}
                                        />
                                        <Input
                                            type="time"
                                            value={slot.end_time ?? ""}
                                            onChange={(e) => updateWeekSlot(index, "end_time", e.target.value)}
                                        />
                                        <div className="flex items-center">
                                            <Switch
                                                checked={!!slot.open_end}
                                                onCheckedChange={(checked) =>
                                                    updateWeekSlot(index, "open_end", checked)
                                                }
                                            />
                                        </div>
                                        <Select
                                            value={slot.base_group_id || "none"}
                                            onValueChange={(value) =>
                                                updateWeekSlot(
                                                    index,
                                                    "base_group_id",
                                                    value === "none" ? null : value
                                                )
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Gruppe wählen" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">Keine Gruppe</SelectItem>
                                                {groups.map((g) => (
                                                    <SelectItem key={g.id} value={g.id}>
                                                        {g.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Button variant="outline" onClick={() => deleteWeekSlot(index)}>
                                            ×
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setWeekDialogOpen(false)}>
                            Abbrechen
                        </Button>
                        <Button onClick={createWeek} disabled={creatingWeek || weekSlots.length === 0}>
                            {creatingWeek ? "Speichert…" : "Woche anlegen"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={participantsDialogOpen} onOpenChange={setParticipantsDialogOpen}>
                <DialogContent className="sm:max-w-6xl rounded-2xl">
                    <DialogHeader>
                        <DialogTitle>
                            Teilnehmer verwalten
                            {selectedSlotForParticipants
                                ? ` · ${selectedSlotForParticipants.slot_code} · ${selectedSlotForParticipants.slot_date}`
                                : ""}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="text-sm text-slate-600">
                            Basisgruppe: {selectedSlotForParticipants?.group_name ?? "Keine Gruppe"}
                        </div>

                        <div className="overflow-hidden rounded-2xl border bg-white">
                            <div className="grid grid-cols-[1.5fr_120px_120px_120px_160px] gap-3 border-b bg-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                                <div>Person</div>
                                <div>Basisgruppe</div>
                                <div>Effektiv drin</div>
                                <div>Override</div>
                                <div>Aktion</div>
                            </div>

                            {slotParticipants.map((p) => (
                                <div
                                    key={p.id}
                                    className="grid grid-cols-[1.5fr_120px_120px_120px_160px] gap-3 border-b px-4 py-3 text-sm last:border-b-0"
                                >
                                    <div>
                                        <div className="font-medium">
                                            {p.first_name} {p.last_name}
                                        </div>
                                        <div className="text-slate-500">{p.email}</div>
                                    </div>

                                    <div>
                                        <Badge variant={p.is_in_base_group ? "secondary" : "outline"}>
                                            {p.is_in_base_group ? "ja" : "nein"}
                                        </Badge>
                                    </div>

                                    <div>
                                        <Badge variant={p.is_effectively_assigned ? "default" : "outline"}>
                                            {p.is_effectively_assigned ? "ja" : "nein"}
                                        </Badge>
                                    </div>

                                    <div>
                                        {p.is_manually_added ? (
                                            <Badge variant="secondary">hinzugefügt</Badge>
                                        ) : p.is_manually_removed ? (
                                            <Badge variant="destructive">entfernt</Badge>
                                        ) : (
                                            <Badge variant="outline">kein</Badge>
                                        )}
                                    </div>

                                    <div className="flex gap-2">
                                        <Button size="sm" variant="outline" onClick={() => addParticipant(p.id)}>
                                            Rein
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => removeParticipant(p.id)}>
                                            Raus
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => clearParticipantOverride(p.id)}>
                                            Reset
                                        </Button>
                                    </div>
                                </div>
                            ))}

                            {!participantsLoading && slotParticipants.length === 0 && (
                                <div className="px-6 py-10 text-center text-sm text-slate-500">
                                    Keine Personen gefunden.
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setParticipantsDialogOpen(false)}>
                            Schließen
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}