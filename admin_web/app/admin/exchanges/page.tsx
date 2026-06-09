"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";

import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export default function ExchangesPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const localSession = getSession();

      if (!firebaseUser || !localSession) {
        clearSession();
        setSession(null);
        setAuthReady(true);
        router.replace("/login");
        return;
      }

      setSession(localSession as SessionUser);
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, [router]);

  if (!authReady) {
    return <div className="p-6">Lade…</div>;
  }

  if (!session) return null;

  return (
    <AdminShell
      title="Tausch"
      subtitle="Der Tauschbereich bleibt vorerst deaktiviert."
      session={session}
    >
      <Card className="admin-card">
        <CardHeader className="admin-card-header">
          <CardTitle>Tausch später verfügbar</CardTitle>
        </CardHeader>
        <CardContent className="admin-section text-sm text-slate-600">
          Das Tauschtool ist aktuell bewusst ausgegraut und noch nicht scharf geschaltet.
          Sobald wir es freigeben, erscheint hier wieder die normale Bearbeitungsoberfläche.
        </CardContent>
      </Card>
    </AdminShell>
  );
}
