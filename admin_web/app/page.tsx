"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_BASE } from "@/lib/api";
import { getSession, setSession, clearSession, type SessionUser } from "@/lib/auth";
import { auth } from "@/lib/firebase";
import { getPostLoginRoute } from "@/lib/navigation";

export default function Home() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [existingSession, setExistingSession] = useState<SessionUser | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const session = getSession();
      if (firebaseUser && session) {
        setExistingSession(session);
        setChecking(false);
        return;
      }
      if (!firebaseUser && session) {
        clearSession();
      }
      setExistingSession(null);
      setChecking(false);
    });

    return unsubscribe;
  }, []);

  async function logout() {
    setError("");
    clearSession();
    await auth.signOut();
    setExistingSession(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const token = await cred.user.getIdToken();

      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `HTTP ${res.status}`);
      }

      const data = JSON.parse(text);
      setSession(data);

      const target = getPostLoginRoute(data.role);
      router.replace(target);
      setTimeout(() => {
        window.location.href = target;
      }, 50);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);

      if (message.includes("auth/invalid-credential")) {
        setError("E-Mail oder Passwort ist falsch.");
      } else if (message.includes("auth/user-not-found")) {
        setError("Kein Nutzer mit dieser E-Mail gefunden.");
      } else if (message.includes("auth/wrong-password")) {
        setError("Das Passwort ist falsch.");
      } else if (message.includes("auth/too-many-requests")) {
        setError("Zu viele Login-Versuche. Bitte kurz warten.");
      } else if (message.includes("User inactive")) {
        setError("Dieser Nutzer ist deaktiviert.");
      } else if (message.includes("User not found in DB")) {
        setError("Der Firebase-Nutzer ist nicht in der lokalen Datenbank hinterlegt.");
      } else {
        setError(`Login fehlgeschlagen: ${message}`);
      }
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return <main className="min-h-screen bg-slate-50 p-6" />;
  }

  if (existingSession) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="w-full max-w-md rounded-2xl shadow-sm">
          <CardHeader>
            <img
              src="/spd-logo.png"
              alt="SPD"
              className="h-8 w-auto object-contain opacity-90"
            />
            <CardTitle className="text-2xl">Bereits angemeldet</CardTitle>
            <p className="text-sm text-slate-500">
              {existingSession.first_name || existingSession.email}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full"
              onClick={() => router.push(getPostLoginRoute(existingSession.role))}
            >
              Weiter ins Backend
            </Button>
            <Button variant="outline" className="w-full" onClick={logout}>
              Logout
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <Card className="w-full max-w-md rounded-2xl shadow-sm">
        <CardHeader>
          <img
            src="/spd-logo.png"
            alt="SPD"
            className="h-8 w-auto object-contain opacity-90"
          />
          <CardTitle className="text-2xl">Backend Login</CardTitle>
          <p className="text-sm text-slate-500">
            Fraktion Intern Administration
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@bundestag.de"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Passwort</Label>
              <Input
                id="password"
                type="password"
                placeholder="Passwort"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Anmelden…" : "Anmelden"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
