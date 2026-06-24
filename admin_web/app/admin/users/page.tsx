"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { Plus, RefreshCw, Search, Pencil, KeyRound, Copy, Trash2 } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { API_BASE } from "@/lib/api";
import { getSession, clearSession } from "@/lib/auth";
import { auth } from "@/lib/firebase";

import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type User = {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  is_mdb: boolean;
  assigned_mdb_name?: string;
  is_active: boolean;
  is_faction_staff: boolean;
  is_planner_exempt: boolean;
  assigned_mdb_user_id?: string;
};

type SessionUser = {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  role: string;
  assigned_mdb_user_id?: string | null;
};

const JOHANNES_ADMIN_EMAIL = "johannes.schaetzl.mdb@bundestag.de";

function hasFullAccess(role?: string | null, email?: string | null) {
  return role === "admin" || email?.toLowerCase() === JOHANNES_ADMIN_EMAIL;
}

export default function UsersPage() {
  const router = useRouter();

  const [session, setSessionState] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    role: "staff",
    is_mdb: false,
    is_active: true,
    is_planner_exempt: false,
    assigned_mdb_user_id: "",
    create_firebase_auth: true,
    firebase_password: "",
  });
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingResetLinkForUserId, setCreatingResetLinkForUserId] = useState<string | null>(null);
  const [resetLinkDialogOpen, setResetLinkDialogOpen] = useState(false);
  const [resetLinkEmail, setResetLinkEmail] = useState("");
  const [resetLinkValue, setResetLinkValue] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [error, setError] = useState("");
  const [mdbUsers, setMdbUsers] = useState<User[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const localSession = getSession();

      if (!firebaseUser || !localSession || !hasFullAccess(localSession.role, localSession.email)) {
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

  function openEditDialog(user: User) {
    setSelectedUser(user);
    setEditForm({
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      email: user.email || "",
      role: user.role || "staff",
      is_mdb: !!user.is_mdb,
      is_active: !!user.is_active,
      is_planner_exempt: !!user.is_planner_exempt,
      assigned_mdb_user_id: user.assigned_mdb_user_id || "",
      create_firebase_auth: false,
      firebase_password: "",
    });
    setDialogOpen(true);
  }

  async function loadMdbUsers() {
    try {
      const headers = await getAuthHeaders();

      const res = await fetch(`${API_BASE}/admin/users?is_mdb=true`, {
        headers,
      });

      if (!res.ok) {
        throw new Error("Fehler beim Laden der MDBs");
      }

      const data = await res.json();
      setMdbUsers(Array.isArray(data) ? data : []);
    } catch {
      setMdbUsers([]);
      setError("Fehler beim Laden der MDBs");
    }
  }

  async function loadUsers() {
    setLoading(true);
    setError("");

    try {
      const headers = await getAuthHeaders();

      const params = new URLSearchParams();
      if (roleFilter !== "all") params.set("role", roleFilter);
      if (query) params.set("q", query);

      const res = await fetch(`${API_BASE}/admin/users?${params}`, {
        headers,
      });

      if (!res.ok) {
        throw new Error("Fehler beim Laden");
      }

      const data = await res.json();
      setUsers(data);
    } catch {
      setError("Fehler beim Laden der Nutzer");
    } finally {
      setLoading(false);
    }
  }

  function openCreateDialog() {
    setSelectedUser(null);
    setEditForm({
      first_name: "",
      last_name: "",
      email: "",
      role: "mdb",
      is_mdb: true,
      is_active: true,
      is_planner_exempt: false,
      assigned_mdb_user_id: "",
      create_firebase_auth: true,
      firebase_password: "",
    });
    setDialogOpen(true);
  }

  async function saveUser() {
    setSaving(true);
    setError("");
    if (editForm.role === "staff" && !editForm.assigned_mdb_user_id) {
      setError("Mitarbeiter muss einem MDB zugewiesen werden");
      setSaving(false);
      return;
    }

    try {
      const headers = await getAuthHeaders();

      const isEdit = !!selectedUser;
      const requestBody = {
        first_name: editForm.first_name,
        last_name: editForm.last_name,
        email: editForm.email,
        role: editForm.role,
        is_mdb:
          editForm.role === "staff"
            ? false
            : editForm.role === "mdb" || editForm.role === "pgf"
              ? true
              : editForm.is_mdb,
        is_active: editForm.is_active,
        is_planner_exempt: editForm.is_planner_exempt,
        assigned_mdb_user_id:
          editForm.role === "staff"
            ? editForm.assigned_mdb_user_id || null
            : null,
        ...(!isEdit && {
          create_firebase_auth: editForm.create_firebase_auth,
          firebase_password: editForm.firebase_password || null,
        }),
      };

      const res = await fetch(
        `${API_BASE}/admin/users${isEdit ? `/${selectedUser.id}` : ""}`,
        {
          method: isEdit ? "PATCH" : "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );

      const text = await res.text();

      if (!res.ok) {
        throw new Error(text || "Fehler beim Speichern");
      }

      setDialogOpen(false);
      await loadUsers();
    } catch {
      setError("Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  async function createPasswordResetLink(user: User) {
    setError("");
    setCreatingResetLinkForUserId(user.id);

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/users/${user.id}/password-reset-link`, {
        method: "POST",
        headers,
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || "Fehler beim Erzeugen des Reset-Links");
      }

      const payload = JSON.parse(text) as { email?: string; reset_link?: string };
      setResetLinkEmail(payload.email || user.email);
      setResetLinkValue(payload.reset_link || "");
      setResetLinkDialogOpen(true);
    } catch {
      setError("Passwort-Reset-Link konnte nicht erzeugt werden");
    } finally {
      setCreatingResetLinkForUserId(null);
    }
  }


  async function deleteUser(user: User) {
    if (!window.confirm(`Nutzer "${user.first_name} ${user.last_name}" (${user.email}) wirklich löschen? Der Firebase-Zugang wird ebenfalls entfernt.`)) return;

    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/users/${user.id}`, {
        method: "DELETE",
        headers,
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || "Fehler beim Löschen");

      await loadUsers();
    } catch {
      setError("Fehler beim Löschen des Nutzers");
    }
  }

  useEffect(() => {
    if (!authReady || !session) return;
    loadUsers();
    loadMdbUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, session, roleFilter]);

  if (!authReady) {
    return <div className="p-6">Lade…</div>;
  }

  if (!session) return null;

  return (



    <AdminShell
      session={session}
      title="Nutzerverwaltung"
      subtitle="Alle Nutzer im Überblick"
      actions={
        <>
          <Button
            className="admin-btn"
            variant="outline"
            onClick={loadUsers}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Aktualisieren
          </Button>

          <Button className="admin-btn-primary" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Nutzer anlegen
          </Button>
        </>
      }
    >
      <Card className="admin-card">
        <CardHeader className="admin-card-header">
          <CardTitle>Nutzer</CardTitle>
        </CardHeader>

        <CardContent className="admin-section">
          <div className="grid gap-3 md:grid-cols-[1fr_200px_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input
                className="admin-input pl-9"
                placeholder="Suche..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="admin-select-trigger">
                <SelectValue placeholder="Rolle" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="staff">Mitarbeiter</SelectItem>
                <SelectItem value="mdb">MDB</SelectItem>
              </SelectContent>
            </Select>

            <Button className="admin-btn" variant="outline" onClick={loadUsers}>
              Suchen
            </Button>
          </div>

          {error && <div className="admin-error">{error}</div>}

          <div className="admin-table overflow-x-auto">
            <div className="admin-table-header grid grid-cols-[1.9fr_120px_220px_150px_180px]">
              <div>Nutzer</div>
              <div>Rolle</div>
              <div>Zugewiesen</div>
              <div>Status</div>
              <div>Aktion</div>
            </div>

            {users.map((u) => (
              <div
                key={u.id}
                className="admin-table-row grid grid-cols-[1.9fr_120px_220px_150px_180px]"
              >
                <div>
                  <div className="font-medium">
                    {u.first_name} {u.last_name}
                  </div>
                  <div className="text-slate-500 text-sm">{u.email}</div>
                </div>

                <div>
                  <Badge>{u.role}</Badge>
                  {u.is_mdb ? <div className="mt-1 text-xs text-slate-500">MdB</div> : null}
                </div>

                <div>{u.assigned_mdb_name || "-"}</div>

                <div>
                  <Badge variant={u.is_active ? "secondary" : "outline"}>
                    {u.is_active ? "aktiv" : "inaktiv"}
                  </Badge>
                  {u.is_planner_exempt ? (
                    <div className="mt-1 text-xs text-slate-500">vom Planer befreit</div>
                  ) : null}
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    size="icon"
                    className="admin-btn"
                    variant="outline"
                    onClick={() => createPasswordResetLink(u)}
                    disabled={creatingResetLinkForUserId === u.id}
                    title="Passwort-Reset-Link erzeugen"
                  >
                    <KeyRound className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    className="admin-btn"
                    variant="outline"
                    onClick={() => openEditDialog(u)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    className="admin-btn"
                    variant="outline"
                    onClick={() => deleteUser(u)}
                    title="Nutzer löschen"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}

            {!loading && users.length === 0 && (
              <div className="p-6 text-center text-sm text-slate-500">
                Keine Nutzer gefunden
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="admin-dialog sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedUser ? "Nutzer bearbeiten" : "Nutzer anlegen"}
            </DialogTitle>          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Vorname</Label>
                <Input
                  className="admin-input mt-1"
                  value={editForm.first_name}
                  onChange={(e) =>
                    setEditForm({ ...editForm, first_name: e.target.value })
                  }
                />
              </div>

              <div>
                <Label>Nachname</Label>
                <Input
                  className="admin-input mt-1"
                  value={editForm.last_name}
                  onChange={(e) =>
                    setEditForm({ ...editForm, last_name: e.target.value })
                  }
                />
              </div>
            </div>

            <div>
              <Label>E-Mail</Label>
              <Input
                className="admin-input mt-1"
                value={editForm.email}
                onChange={(e) =>
                  setEditForm({ ...editForm, email: e.target.value })
                }
              />
            </div>

            {!selectedUser && (
              <div className="rounded-md border border-slate-200 px-4 py-3">
                <div className="text-sm text-slate-600 mb-2">
                  Firebase-Zugang wird automatisch erstellt. Falls die E-Mail bereits existiert, wird sie verknüpft.
                </div>
                <div>
                  <Label>Initialpasswort</Label>
                  <Input
                    className="admin-input mt-1"
                    type="password"
                    placeholder="Passwort für neuen Nutzer"
                    value={editForm.firebase_password}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        firebase_password: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
            )}

            <div>
              <Label>Rolle</Label>
              <Select
                value={editForm.role}
                onValueChange={(value) =>
                  setEditForm({
                    ...editForm,
                    role: value,
                    is_mdb: value === "staff" ? false : value === "mdb" || value === "pgf" ? true : editForm.is_mdb,
                    assigned_mdb_user_id: value === "staff" ? editForm.assigned_mdb_user_id : "",
                  })
                }
              >
                <SelectTrigger className="admin-select-trigger mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mdb">MDB</SelectItem>
                  <SelectItem value="staff">Mitarbeiter</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="pgf">PGF</SelectItem>
                </SelectContent>
              </Select>

            {editForm.role === "staff" && (
              <div className="mt-4">
                <Label>Zugewiesener MDB</Label>
                <Select
                  value={editForm.assigned_mdb_user_id || "none"}
                  onValueChange={(value) =>
                    setEditForm({
                      ...editForm,
                      assigned_mdb_user_id: value === "none" ? "" : value,
                    })
                  }
                >
                  <SelectTrigger className="admin-select-trigger mt-1">
                    <SelectValue placeholder="MDB auswählen" />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="none">Kein MDB</SelectItem>

                    {mdbUsers.map((mdb) => (
                      <SelectItem key={mdb.id} value={mdb.id}>
                        {mdb.first_name} {mdb.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            </div>

            <div className="flex items-center justify-between border border-slate-200 px-4 py-3">
              <div>
                <div className="font-medium">Ist MdB</div>
                <div className="text-xs text-slate-500">
                  Nur MdBs koennen Praesenzdienste und Slot-Zuweisungen erhalten.
                </div>
              </div>

              <input
                type="checkbox"
                checked={editForm.role === "mdb" || editForm.role === "pgf" ? true : editForm.is_mdb}
                disabled={editForm.role === "staff" || editForm.role === "mdb" || editForm.role === "pgf"}
                onChange={(e) =>
                  setEditForm({ ...editForm, is_mdb: e.target.checked })
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

              <input
                type="checkbox"
                checked={editForm.is_active}
                onChange={(e) =>
                  setEditForm({ ...editForm, is_active: e.target.checked })
                }
              />
            </div>

            <div className="flex items-center justify-between border border-slate-200 px-4 py-3">
              <div>
                <div className="font-medium">Vom Planer befreit</div>
                <div className="text-xs text-slate-500">
                  Vollstaendig vom automatischen Praesenzdienst ausnehmen.
                </div>
              </div>

              <input
                type="checkbox"
                checked={editForm.is_planner_exempt}
                onChange={(e) =>
                  setEditForm({ ...editForm, is_planner_exempt: e.target.checked })
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
              onClick={saveUser}
              disabled={saving}
            >
              {saving ? "Speichert…" : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={resetLinkDialogOpen} onOpenChange={setResetLinkDialogOpen}>
        <DialogContent className="admin-dialog sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Passwort-Reset-Link</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="text-sm text-slate-600">
              Nutzer: <span className="font-medium">{resetLinkEmail}</span>
            </div>
            <Input className="admin-input" value={resetLinkValue} readOnly />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="admin-btn"
              onClick={() => setResetLinkDialogOpen(false)}
            >
              Schließen
            </Button>
            <Button
              className="admin-btn-primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(resetLinkValue);
                } catch {
                  setError("Link konnte nicht in die Zwischenablage kopiert werden");
                }
              }}
            >
              <Copy className="mr-2 h-4 w-4" />
              Link kopieren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
