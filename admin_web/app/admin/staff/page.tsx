"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { Plus, RefreshCw, Search, Pencil } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { API_BASE } from "@/lib/api";
import { getSession, clearSession } from "@/lib/auth";
import { auth } from "@/lib/firebase";

type StaffUser = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  assigned_mdb_name?: string | null;
  assigned_mdb_user_id?: string | null;
  is_faction_staff: boolean;
  is_active: boolean;
};

type SessionUser = {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  role: string;
  assigned_mdb_user_id?: string | null;
};

type MdbUser = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
};

type StaffForm = {
  first_name: string;
  last_name: string;
  email: string;
  is_active: boolean;
  assigned_mdb_user_id: string;
  create_firebase_auth: boolean;
  firebase_password: string;
};

const EMPTY_STAFF_FORM: StaffForm = {
  first_name: "",
  last_name: "",
  email: "",
  is_active: true,
  assigned_mdb_user_id: "",
  create_firebase_auth: true,
  firebase_password: "",
};

function canAccessStaff(role?: string | null) {
  return role === "admin" || role === "pgf" || role === "mdb" || role === "staff";
}

function canManageMdbAssignment(role?: string | null) {
  return role === "admin" || role === "pgf";
}

export default function StaffPage() {
  const router = useRouter();

  const [session, setSessionState] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [mdbUsers, setMdbUsers] = useState<MdbUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffUser | null>(null);
  const [form, setForm] = useState<StaffForm>(EMPTY_STAFF_FORM);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const localSession = getSession();

      if (!firebaseUser || !localSession || !canAccessStaff(localSession.role)) {
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
    };
  }

  async function loadStaff() {
    setLoading(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());

      const res = await fetch(`${API_BASE}/admin/staff?${params.toString()}`, {
        headers,
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || "Fehler beim Laden");

      const data = JSON.parse(text) as StaffUser[];
      setStaff(Array.isArray(data) ? data : []);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Fehler beim Laden der Mitarbeiter";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMdbUsers() {
    if (!canManageMdbAssignment(session?.role)) {
      setMdbUsers([]);
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/users?is_mdb=true`, { headers });
      const text = await res.text();
      if (!res.ok) throw new Error(text || "Fehler beim Laden der MdB");

      const data = JSON.parse(text) as MdbUser[];
      setMdbUsers(Array.isArray(data) ? data : []);
    } catch {
      setMdbUsers([]);
    }
  }

  useEffect(() => {
    if (!authReady || !session) return;
    loadStaff();
    loadMdbUsers();
  }, [authReady, session]);

  function openCreateDialog() {
    setSelectedStaff(null);
    setForm(EMPTY_STAFF_FORM);
    setDialogOpen(true);
  }

  function openEditDialog(staffUser: StaffUser) {
    setSelectedStaff(staffUser);
    setForm({
      first_name: staffUser.first_name ?? "",
      last_name: staffUser.last_name ?? "",
      email: staffUser.email,
      is_active: !!staffUser.is_active,
      assigned_mdb_user_id: staffUser.assigned_mdb_user_id ?? "",
      create_firebase_auth: false,
      firebase_password: "",
    });
    setDialogOpen(true);
  }

  async function saveStaff() {
    if (!form.first_name.trim() || !form.last_name.trim() || !form.email.trim()) {
      setError("Bitte Vorname, Nachname und E-Mail ausfüllen.");
      return;
    }

    if (canManageMdbAssignment(session?.role) && !form.assigned_mdb_user_id) {
      setError("Bitte einen zugewiesenen MdB auswählen.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const isEdit = !!selectedStaff;

      const body = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        is_active: form.is_active,
        ...(canManageMdbAssignment(session?.role) && {
          assigned_mdb_user_id: form.assigned_mdb_user_id || null,
        }),
        ...(!isEdit && {
          create_firebase_auth: form.create_firebase_auth,
          firebase_password: form.firebase_password || null,
        }),
      };

      const res = await fetch(
        `${API_BASE}/admin/staff${isEdit ? `/${selectedStaff.id}` : ""}`,
        {
          method: isEdit ? "PATCH" : "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      const text = await res.text();
      if (!res.ok) throw new Error(text || "Fehler beim Speichern");

      setDialogOpen(false);
      await loadStaff();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Fehler beim Speichern";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  if (!authReady) return <div className="p-6">Lade…</div>;
  if (!session) return null;

  const showMdbAssignment = canManageMdbAssignment(session.role);

  return (
    <AdminShell
      session={session}
      title="Mitarbeiter"
      subtitle={
        showMdbAssignment
          ? "Mitarbeiter-Übersicht und Zuordnungen verwalten"
          : "Eigene Mitarbeiter verwalten"
      }
      actions={
        <>
          <Button className="admin-btn" variant="outline" onClick={loadStaff}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Aktualisieren
          </Button>
          <Button className="admin-btn-primary" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Mitarbeiter anlegen
          </Button>
        </>
      }
    >
      <Card className="admin-card">
        <CardHeader className="admin-card-header">
          <CardTitle>Mitarbeiter</CardTitle>
        </CardHeader>

        <CardContent className="admin-section">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input
                className="admin-input pl-9"
                placeholder="Suche..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <Button className="admin-btn" variant="outline" onClick={loadStaff}>
              Suchen
            </Button>
          </div>

          {error ? <div className="admin-error">{error}</div> : null}

          <div className="admin-table">
            <div className="admin-table-header grid grid-cols-[2fr_200px_120px_120px]">
              <div>Mitarbeiter</div>
              <div>Zugeordnet zu</div>
              <div>Status</div>
              <div>Aktion</div>
            </div>

            {staff.map((u) => (
              <div
                key={u.id}
                className="admin-table-row grid grid-cols-[2fr_200px_120px_120px]"
              >
                <div>
                  <div className="font-medium">
                    {u.first_name} {u.last_name}
                  </div>
                  <div className="text-slate-500 text-sm">{u.email}</div>
                </div>

                <div>{u.assigned_mdb_name || "-"}</div>

                <div>
                  <Badge variant={u.is_active ? "secondary" : "outline"}>
                    {u.is_active ? "aktiv" : "inaktiv"}
                  </Badge>
                </div>

                <div className="flex justify-end">
                  <Button
                    size="icon"
                    className="admin-btn"
                    variant="outline"
                    onClick={() => openEditDialog(u)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}

            {!loading && staff.length === 0 && (
              <div className="p-6 text-center text-sm text-slate-500">
                Keine Mitarbeiter gefunden
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="admin-dialog sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedStaff ? "Mitarbeiter bearbeiten" : "Mitarbeiter anlegen"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Vorname</Label>
                <Input
                  className="admin-input mt-1"
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                />
              </div>

              <div>
                <Label>Nachname</Label>
                <Input
                  className="admin-input mt-1"
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label>E-Mail</Label>
              <Input
                className="admin-input mt-1"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>

            {showMdbAssignment ? (
              <div>
                <Label>Zugewiesener MdB</Label>
                <Select
                  value={form.assigned_mdb_user_id || "none"}
                  onValueChange={(value) =>
                    setForm({
                      ...form,
                      assigned_mdb_user_id: value === "none" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger className="admin-select-trigger mt-1">
                    <SelectValue placeholder="MdB auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Kein MdB</SelectItem>
                    {mdbUsers.map((mdb) => (
                      <SelectItem key={mdb.id} value={mdb.id}>
                        {mdb.first_name} {mdb.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {!selectedStaff ? (
              <div className="rounded-md border border-slate-200 px-4 py-3">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={form.create_firebase_auth}
                    onChange={(e) =>
                      setForm({ ...form, create_firebase_auth: e.target.checked })
                    }
                  />
                  <div>
                    <div className="font-medium">Firebase-Zugang erstellen/zuordnen</div>
                    <div className="text-xs text-slate-500">
                      Wenn die E-Mail in Firebase schon existiert, wird sie verknüpft.
                    </div>
                  </div>
                </label>

                {form.create_firebase_auth ? (
                  <div className="mt-3">
                    <Label>Initialpasswort (nur falls Firebase-Nutzer neu ist)</Label>
                    <Input
                      className="admin-input mt-1"
                      type="password"
                      value={form.firebase_password}
                      onChange={(e) =>
                        setForm({ ...form, firebase_password: e.target.value })
                      }
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center justify-between border border-slate-200 px-4 py-3">
              <div>
                <div className="font-medium">Aktiv</div>
                <div className="text-xs text-slate-500">
                  Inaktive Mitarbeiter können sich nicht anmelden
                </div>
              </div>

              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) =>
                  setForm({ ...form, is_active: e.target.checked })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="admin-btn"
              onClick={() => setDialogOpen(false)}
            >
              Abbrechen
            </Button>
            <Button
              className="admin-btn-primary"
              onClick={saveStaff}
              disabled={saving}
            >
              {saving ? "Speichert…" : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
