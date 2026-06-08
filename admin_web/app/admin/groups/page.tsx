"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { CalendarDays, UserCog, Users } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

function canAccessPage(role?: string | null) {
  return role === "admin" || role === "pgf" || role === "mdb" || role === "staff";
}

export default function GroupsRemovedPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const localSession = getSession();

      if (!firebaseUser || !localSession || !canAccessPage(localSession.role)) {
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

  if (!authReady) {
    return <div className="min-h-screen bg-[#f7f7f8]" />;
  }

  if (!session) return null;

  return (
    <AdminShell
      title="Gruppen entfernt"
      subtitle="Die Planung läuft jetzt direkt über Personen und Slot-Zuweisungen."
      session={session}
    >
      <Card className="admin-card">
        <CardHeader className="admin-card-header">
          <CardTitle className="text-base font-semibold">
            Gruppenverwaltung ist nicht mehr aktiv
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-5 text-sm text-slate-600">
          <p>
            Die frühere Gruppenlogik wurde aus der Slot-Planung entfernt. Präsenzdienste
            werden jetzt direkt einzelnen MdBs bzw. PGF zugewiesen.
          </p>
          <p>Stattdessen nutzt ihr jetzt diese Bereiche:</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/slots">
              <Button className="admin-btn-primary">
                <CalendarDays className="mr-2 h-4 w-4" />
                Zu den Slots
              </Button>
            </Link>
            <Link href="/admin/staff">
              <Button variant="outline" className="admin-btn">
                <UserCog className="mr-2 h-4 w-4" />
                Zu den Mitarbeitern
              </Button>
            </Link>
            <Link href="/admin/users">
              <Button variant="outline" className="admin-btn">
                <Users className="mr-2 h-4 w-4" />
                Zu den Nutzern
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </AdminShell>
  );
}
