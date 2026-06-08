"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { Plus, RefreshCw, Search, Pencil, Shield, UserCog, Users } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "staff", label: "Mitarbeiter" },
  { value: "mdb", label: "MDB" },
  { value: "pgf", label: "PGF" },
] as const;

const EMPTY_FORM = {
  id: null as string | null,
  email: "",
  first_name: "",
  last_name: "",
  role: "staff",
  group_id: "",
  assigned_mdb_user_id: "",
  is_faction_staff: false,
  is_active: true,
};

type AdminUser = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  assigned_mdb_user_id?: string | null;
  assigned_mdb_name?: string | null;
  is_faction_staff: boolean;
  is_active: boolean;
};

type SessionUser = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role: string;
};

function roleBadgeVariant(role?: string | null) {
  if (role === "admin") return "destructive";
  if (role === "staff") return "default";
  if (role === "pgf") return "secondary";
  return "outline";
}

export default function AdminUsersPage() {
  const router = useRouter();

  const [session, setSessionState] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const [error, setError] = useState("");

  const mdbOptions = useMemo(
    () =>
      users
        .filter((u) => u.role === "mdb")
        .map((u) => ({
          value: u.id,
          label: `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.email,
        })),
    [users]
  );

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

  async function loadUsers() {
    setLoading(true);
    setError("");

    try {
      const headers = await getAuthHeaders();

      const params = new URLSearchParams();
      if (roleFilter !== "all") params.set("role", roleFilter);
      if (query.trim()) params.set("q", query.trim());

      const res = await fetch(`${API_BASE}/admin/users?${params.toString()}`, {
        headers,
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }

      setUsers(JSON.parse(text));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Laden: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authReady || !session) return;
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, session, roleFilter]);

  function openCreateDialog() {
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEditDialog(user: AdminUser) {
    setForm({
      id: user.id,
      email: user.email ?? "",
      first_name: user.first_name ?? "",
      last_name: user.last_name ?? "",
      role: user.role ?? "staff",
      group_id: user.group_id ?? "",
      assigned_mdb_user_id: user.assigned_mdb_user_id ?? "",
      is_faction_staff: !!user.is_faction_staff,
      is_active: !!user.is_active,
    });
    setDialogOpen(true);
  }

  async function saveUser() {
    setSaving(true);
    setError("");

    const payload = {
      email: form.email,
      first_name: form.first_name,
      last_name: form.last_name,
      role: form.role,
      group_id: form.group_id || null,
      assigned_mdb_user_id: form.is_faction_staff
        ? null
        : form.assigned_mdb_user_id || null,
      is_faction_staff: form.is_faction_staff,
      is_active: form.is_active,
    };

    try {
      const headers = await getAuthHeaders();
      const isEdit = !!form.id;

      const res = await fetch(
        `${API_BASE}/admin/users${isEdit ? `/${form.id}` : ""}`,
        {
          method: isEdit ? "PATCH" : "POST",
          headers,
          body: JSON.stringify(payload),
        }
      );

      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }

      setDialogOpen(false);
      await loadUsers();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Speichern: ${message}`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(id: string) {
    if (!window.confirm("Diesen Nutzer wirklich löschen?")) return;

    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/users/${id}`, {
        method: "DELETE",
        headers,
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }

      await loadUsers();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Löschen: ${message}`);
    }
  }

  const totalAdmins = users.filter((u) => u.role === "admin").length;
  const totalStaff = users.filter((u) => u.role === "staff").length;
  const totalMdb = users.filter((u) => u.role === "mdb").length;

  if (!authReady) {
    return (
      <main className="min-h-screen bg-[#f7f7f8] flex items-center justify-center">
        <div className="text-sm text-slate-500">Lade…</div>
      </main>
    );
  }

  if (!session) return null;

  return (
    <AdminShell
      session={session}
      title="Nutzerverwaltung"
      subtitle="Nutzer anlegen, Rollen setzen und Mitarbeiter MDBs zuweisen."
      actions={
        <>
          <Button
            variant="outline"
            className="rounded-none"
            onClick={loadUsers}
            disabled={loading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Aktualisieren
          </Button>

          <Button
            onClick={openCreateDialog}
            className="rounded-none bg-slate-900 text-white hover:bg-slate-800"
          >
            <Plus className="mr-2 h-4 w-4" />
            Nutzer anlegen
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="rounded-none border border-slate-200 bg-white shadow-sm">
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-slate-500">
              Admins
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Shield className="h-5 w-5 text-slate-500" />
              <div className="text-3xl font-semibold">{totalAdmins}</div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-none border border-slate-200 bg-white shadow-sm">
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-slate-500">
              Mitarbeiter
            </div>
            <div className="mt-3 flex items-center gap-3">
              <UserCog className="h-5 w-5 text-slate-500" />
              <div className="text-3xl font-semibold">{totalStaff}</div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-none border border-slate-200 bg-white shadow-sm">
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-slate-500">
              MDBs
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Users className="h-5 w-5 text-slate-500" />
              <div className="text-3xl font-semibold">{totalMdb}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-none border border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200">
          <CardTitle className="text-base font-semibold">Nutzer</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4 p-5">
          <div className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input
                className="rounded-none pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name oder E-Mail suchen"
              />
            </div>

            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="rounded-none">
                <SelectValue placeholder="Rolle filtern" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Rollen</SelectItem>
                {ROLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" className="rounded-none" onClick={loadUsers}>
              Suchen
            </Button>
          </div>

          {error && (
            <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="overflow-hidden border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[1.5fr_120px_160px_180px_100px_100px] gap-3 border-b border-slate-200 bg-white px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              <div>Nutzer</div>
              <div>Rolle</div>
              <div>Gruppe</div>
              <div>Zugewiesen an</div>
              <div>Status</div>
              <div>Aktion</div>
            </div>

            {users.map((user) => (
              <div
                key={user.id}
                className="grid grid-cols-[1.5fr_120px_160px_180px_100px_100px] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0"
              >
                <div>
                  <div className="font-medium">
                    {user.first_name} {user.last_name}
                  </div>
                  <div className="text-slate-500">{user.email}</div>
                </div>

                <div>
                  <Badge variant={roleBadgeVariant(user.role) as never}>
                    {user.role}
                  </Badge>
                </div>

                <div>{user.group_name ?? "—"}</div>

                <div>
                  {user.is_faction_staff
                    ? "Fraktion/Admin"
                    : user.assigned_mdb_name ?? "—"}
                </div>

                <div>
                  <Badge variant={user.is_active ? "secondary" : "outline"}>
                    {user.is_active ? "aktiv" : "inaktiv"}
                  </Badge>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="icon"
                    variant="outline"
                    className="rounded-none"
                    onClick={() => openEditDialog(user)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>

                  <Button
                    size="icon"
                    variant="outline"
                    className="rounded-none"
                    onClick={() => deleteUser(user.id)}
                  >
                    ×
                  </Button>
                </div>
              </div>
            ))}

            {!loading && users.length === 0 && (
              <div className="px-6 py-10 text-center text-sm text-slate-500">
                Keine Nutzer gefunden.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl rounded-none border-slate-200">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Nutzer bearbeiten" : "Nutzer anlegen"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-2">
              <Label>E-Mail</Label>
              <Input
                className="rounded-none"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Rolle</Label>
              <Select
                value={form.role}
                onValueChange={(value) => setForm({ ...form, role: value })}
              >
                <SelectTrigger className="rounded-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Vorname</Label>
              <Input
                className="rounded-none"
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Nachname</Label>
              <Input
                className="rounded-none"
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Zugewiesener MDB</Label>
              <Select
                value={form.assigned_mdb_user_id || "none"}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    assigned_mdb_user_id: value === "none" ? "" : value,
                  })
                }
                disabled={form.is_faction_staff}
              >
                <SelectTrigger className="rounded-none">
                  <SelectValue placeholder="MDB wählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Keine Zuordnung</SelectItem>
                  {mdbOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between border border-slate-200 px-4 py-3">
              <div>
                <div className="font-medium">Fraktionsmitarbeiter</div>
                <div className="text-xs text-slate-500">
                  Arbeitet für Admin/Fraktion statt für einen MDB
                </div>
              </div>
              <Switch
                checked={form.is_faction_staff}
                onCheckedChange={(checked) =>
                  setForm({
                    ...form,
                    is_faction_staff: checked,
                    assigned_mdb_user_id: checked ? "" : form.assigned_mdb_user_id,
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between border border-slate-200 px-4 py-3">
              <div>
                <div className="font-medium">Aktiv</div>
                <div className="text-xs text-slate-500">
                  Inaktive Nutzer erscheinen später nicht mehr im Plan
                </div>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(checked) =>
                  setForm({ ...form, is_active: checked })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-none"
              onClick={() => setDialogOpen(false)}
            >
              Abbrechen
            </Button>

            <Button
              onClick={saveUser}
              disabled={saving}
              className="rounded-none bg-slate-900 text-white hover:bg-slate-800"
            >
              {saving ? "Speichert…" : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}