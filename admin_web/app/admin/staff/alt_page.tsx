"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { RefreshCw, Search, Users } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import { API_BASE } from "@/lib/api";
import { getSession, clearSession } from "@/lib/auth";
import { auth } from "@/lib/firebase";

type StaffUser = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
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

export default function AdminStaffPage() {
  const router = useRouter();

  const [session, setSessionState] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(false);

  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

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
      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }

      setStaff(JSON.parse(text));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Laden: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authReady || !session) return;
    loadStaff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, session]);

  if (!authReady) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#f7f7f8]">
        <div className="text-sm text-slate-500">Lade…</div>
      </main>
    );
  }

  if (!session) return null;

  return (
    <AdminShell
      session={session}
      title="Mitarbeiter"
      subtitle="Übersicht aller Mitarbeiter und ihrer Zuordnung."
      actions={
        <>
          <Button
            variant="outline"
            className="rounded-none"
            onClick={loadStaff}
            disabled={loading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Aktualisieren
          </Button>
        </>
      }
    >
      <Card className="rounded-none border border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200">
          <CardTitle className="text-base font-semibold">
            Mitarbeiterliste
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4 p-5">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input
                className="rounded-none pl-9"
                placeholder="Name oder E-Mail suchen"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <Button
              variant="outline"
              className="rounded-none"
              onClick={loadStaff}
            >
              Suchen
            </Button>
          </div>

          {error && (
            <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="overflow-hidden border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[1.5fr_200px_150px_120px] gap-3 border-b border-slate-200 bg-white px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              <div>Mitarbeiter</div>
              <div>Zugeordnet zu</div>
              <div>Typ</div>
              <div>Status</div>
            </div>

            {staff.map((user) => (
              <div
                key={user.id}
                className="grid grid-cols-[1.5fr_200px_150px_120px] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0"
              >
                <div>
                  <div className="font-medium">
                    {user.first_name} {user.last_name}
                  </div>
                  <div className="text-slate-500">{user.email}</div>
                </div>

                <div>{user.assigned_mdb_name ?? "—"}</div>

                <div>
                  <Badge variant="outline">
                    {user.is_faction_staff ? "Fraktion" : "MDB"}
                  </Badge>
                </div>

                <div>
                  <Badge variant={user.is_active ? "secondary" : "outline"}>
                    {user.is_active ? "aktiv" : "inaktiv"}
                  </Badge>
                </div>
              </div>
            ))}

            {!loading && staff.length === 0 && (
              <div className="px-6 py-10 text-center text-sm text-slate-500">
                Keine Mitarbeiter gefunden.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </AdminShell>
  );
}