"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  Users,
  FolderKanban,
  Search,
} from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

type SessionUser = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role: string;
};

type Group = {
  id: string;
  name: string;
  member_count: number;
};

type User = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  is_active?: boolean;
};

type GroupMembersResponse = {
  group: {
    id: string;
    name: string;
  };
  members: User[];
};

const EMPTY_GROUP_FORM = {
  id: null as string | null,
  name: "",
};

export default function AdminGroupsPage() {
  const router = useRouter();

  const [session, setSessionState] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [groups, setGroups] = useState<Group[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingMembers, setSavingMembers] = useState(false);
  const [error, setError] = useState("");

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);

  const [groupForm, setGroupForm] = useState(EMPTY_GROUP_FORM);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState("");

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

  async function loadGroups() {
    setLoading(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/groups`, { headers });
      const text = await res.text();

      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }

      setGroups(JSON.parse(text));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Laden der Gruppen: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadAllUsers() {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/users`, { headers });
      const text = await res.text();

      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }

      setAllUsers(JSON.parse(text));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Laden der Nutzer: ${message}`);
    }
  }

  useEffect(() => {
    if (!authReady || !session) return;
    loadGroups();
    loadAllUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, session]);

  function openCreateGroupDialog() {
    setGroupForm(EMPTY_GROUP_FORM);
    setGroupDialogOpen(true);
  }

  function openEditGroupDialog(group: Group) {
    setGroupForm({
      id: group.id,
      name: group.name,
    });
    setGroupDialogOpen(true);
  }

  async function saveGroup() {
    setSaving(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const isEdit = !!groupForm.id;

      const res = await fetch(
        `${API_BASE}/admin/groups${isEdit ? `/${groupForm.id}` : ""}`,
        {
          method: isEdit ? "PATCH" : "POST",
          headers,
          body: JSON.stringify({ name: groupForm.name }),
        }
      );

      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }

      setGroupDialogOpen(false);
      setGroupForm(EMPTY_GROUP_FORM);
      await loadGroups();
      await loadAllUsers();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Speichern der Gruppe: ${message}`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteGroup(group: Group) {
    if (
      !window.confirm(
        `Gruppe "${group.name}" wirklich löschen? Zugewiesene Nutzer und Slots verlieren die Gruppen-Zuordnung.`
      )
    ) {
      return;
    }

    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/groups/${group.id}`, {
        method: "DELETE",
        headers,
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }

      if (selectedGroup?.id === group.id) {
        setMembersDialogOpen(false);
        setSelectedGroup(null);
        setSelectedMemberIds([]);
      }

      await loadGroups();
      await loadAllUsers();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Löschen der Gruppe: ${message}`);
    }
  }

  async function openMembersDialog(group: Group) {
    setError("");
    setSelectedGroup(group);
    setMemberSearch("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/groups/${group.id}/members`, {
        headers,
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }

      const data: GroupMembersResponse = JSON.parse(text);
      setSelectedMemberIds(data.members.map((m) => m.id));
      setMembersDialogOpen(true);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Laden der Gruppenmitglieder: ${message}`);
    }
  }

  async function saveMembers() {
    if (!selectedGroup) return;

    setSavingMembers(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${API_BASE}/admin/groups/${selectedGroup.id}/members`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({ user_ids: selectedMemberIds }),
        }
      );

      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }

      setMembersDialogOpen(false);
      await loadGroups();
      await loadAllUsers();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Speichern der Gruppenmitglieder: ${message}`);
    } finally {
      setSavingMembers(false);
    }
  }

  function toggleMember(userId: string) {
    setSelectedMemberIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  }

  const filteredUsers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return allUsers;

    return allUsers.filter((u) => {
      const haystack =
        `${u.first_name ?? ""} ${u.last_name ?? ""} ${u.email ?? ""} ${u.role ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [allUsers, memberSearch]);

  const usersWithoutGroup = allUsers.filter((u) => !u.group_id).length;
  const totalAssigned = groups.reduce((sum, g) => sum + g.member_count, 0);

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
      title="Gruppenverwaltung"
      subtitle="Gruppen anlegen, umbenennen und Mitglieder zuordnen."
      actions={
        <>
          <Button
            variant="outline"
            className="rounded-none"
            onClick={() => {
              loadGroups();
              loadAllUsers();
            }}
            disabled={loading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Aktualisieren
          </Button>

          <Button
            onClick={openCreateGroupDialog}
            className="rounded-none bg-slate-900 text-white hover:bg-slate-800"
          >
            <Plus className="mr-2 h-4 w-4" />
            Gruppe anlegen
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="rounded-none border border-slate-200 bg-white shadow-sm">
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-slate-500">
              Gruppen
            </div>
            <div className="mt-3 flex items-center gap-3">
              <FolderKanban className="h-5 w-5 text-slate-500" />
              <div className="text-3xl font-semibold">{groups.length}</div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-none border border-slate-200 bg-white shadow-sm">
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-slate-500">
              Zugeordnete Nutzer
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Users className="h-5 w-5 text-slate-500" />
              <div className="text-3xl font-semibold">{totalAssigned}</div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-none border border-slate-200 bg-white shadow-sm">
          <CardContent className="p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-slate-500">
              Ohne Gruppe
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Users className="h-5 w-5 text-slate-500" />
              <div className="text-3xl font-semibold">{usersWithoutGroup}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-none border border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200">
          <CardTitle className="text-base font-semibold">Gruppen</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4 p-5">
          {error && (
            <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="overflow-hidden border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[1.5fr_140px_220px_120px] gap-3 border-b border-slate-200 bg-white px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              <div>Name</div>
              <div>Mitglieder</div>
              <div>Verwalten</div>
              <div>Aktion</div>
            </div>

            {groups.map((group) => (
              <div
                key={group.id}
                className="grid grid-cols-[1.5fr_140px_220px_120px] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0"
              >
                <div className="font-medium">{group.name}</div>

                <div>
                  <Badge variant="secondary">{group.member_count}</Badge>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="rounded-none"
                    size="sm"
                    onClick={() => openMembersDialog(group)}
                  >
                    Mitglieder
                  </Button>

                  <Button
                    variant="outline"
                    className="rounded-none"
                    size="sm"
                    onClick={() => openEditGroupDialog(group)}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Bearbeiten
                  </Button>
                </div>

                <div>
                  <Button
                    variant="outline"
                    className="rounded-none"
                    size="sm"
                    onClick={() => deleteGroup(group)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}

            {!loading && groups.length === 0 && (
              <div className="px-6 py-10 text-center text-sm text-slate-500">
                Keine Gruppen vorhanden.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="sm:max-w-lg rounded-none border-slate-200">
          <DialogHeader>
            <DialogTitle>
              {groupForm.id ? "Gruppe bearbeiten" : "Gruppe anlegen"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label>Name</Label>
            <Input
              className="rounded-none"
              value={groupForm.name}
              onChange={(e) =>
                setGroupForm({ ...groupForm, name: e.target.value })
              }
              placeholder="z. B. Gruppe A"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-none"
              onClick={() => setGroupDialogOpen(false)}
            >
              Abbrechen
            </Button>

            <Button
              onClick={saveGroup}
              disabled={saving}
              className="rounded-none bg-slate-900 text-white hover:bg-slate-800"
            >
              {saving ? "Speichert…" : "Speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={membersDialogOpen} onOpenChange={setMembersDialogOpen}>
        <DialogContent className="sm:max-w-3xl rounded-none border-slate-200">
          <DialogHeader>
            <DialogTitle>
              Mitglieder verwalten
              {selectedGroup ? ` · ${selectedGroup.name}` : ""}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nutzer suchen</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input
                  className="rounded-none pl-9"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Name, E-Mail oder Rolle"
                />
              </div>
            </div>

            <div className="max-h-[420px] overflow-y-auto border border-slate-200 bg-white">
              {filteredUsers.map((user) => {
                const checked = selectedMemberIds.includes(user.id);

                return (
                  <label
                    key={user.id}
                    className="flex cursor-pointer items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0"
                  >
                    <div>
                      <div className="font-medium">
                        {user.first_name} {user.last_name}
                      </div>
                      <div className="text-slate-500">{user.email}</div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Badge variant="outline">{user.role ?? "—"}</Badge>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMember(user.id)}
                        className="h-4 w-4 rounded-none"
                      />
                    </div>
                  </label>
                );
              })}

              {filteredUsers.length === 0 && (
                <div className="px-6 py-10 text-center text-sm text-slate-500">
                  Keine Nutzer gefunden.
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-none"
              onClick={() => setMembersDialogOpen(false)}
            >
              Abbrechen
            </Button>

            <Button
              onClick={saveMembers}
              disabled={savingMembers}
              className="rounded-none bg-slate-900 text-white hover:bg-slate-800"
            >
              {savingMembers ? "Speichert…" : "Mitglieder speichern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}