"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { RefreshCw, Send, Trash2 } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

type Message = {
  id: string;
  created_at: string;
  sender_name: string;
  content: string;
  urgency: string;
};

function canAccess(role?: string | null) {
  return role === "admin" || role === "pgf";
}

export default function MessagesPage() {
  const router = useRouter();

  const [session, setSessionState] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [senderName, setSenderName] = useState("");
  const [content, setContent] = useState("");
  const [urgency, setUrgency] = useState("information");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [listError, setListError] = useState("");
  const [listSuccess, setListSuccess] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [bulkFrom, setBulkFrom] = useState("");
  const [bulkTo, setBulkTo] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const localSession = getSession();

      if (!firebaseUser || !localSession || !canAccess(localSession.role)) {
        clearSession();
        setSessionState(null);
        setAuthReady(true);
        router.replace("/login");
        return;
      }

      setSessionState(localSession as SessionUser);
      setSenderName(
        `${localSession.first_name || ""} ${localSession.last_name || ""}`.trim() || "PGF"
      );
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

  async function loadMessages() {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/pgf/messages?limit=50`, {
        headers,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      const data = JSON.parse(text);
      setMessages(Array.isArray(data) ? data : data.messages || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function deleteMessage(id: string) {
    const ok = window.confirm("Nachricht wirklich löschen? (wird auf Geräten entfernt)");
    if (!ok) return;

    setListError("");
    setListSuccess("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/pgf/messages/${id}`, {
        method: "DELETE",
        headers,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || "Fehler beim Löschen");

      setListSuccess("Nachricht gelöscht.");
      await loadMessages();
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Fehler beim Löschen");
    }
  }

  async function deleteMessagesInRange() {
    if (!bulkFrom || !bulkTo) {
      setListError("Bitte 'von' und 'bis' (Datum) auswählen.");
      return;
    }

    if (bulkFrom > bulkTo) {
      setListError("'Von' muss vor oder gleich 'Bis' sein.");
      return;
    }

    const ok1 = window.confirm(
      `Wirklich alle Nachrichten vom ${bulkFrom} bis ${bulkTo} löschen?`
    );
    if (!ok1) return;

    const ok2 = window.confirm(
      "Letzte Warnung: Das Löschen kann nicht rückgängig gemacht werden. Wirklich fortfahren?"
    );
    if (!ok2) return;

    setBulkDeleting(true);
    setListError("");
    setListSuccess("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/pgf/messages?from=${bulkFrom}&to=${bulkTo}`, {
        method: "DELETE",
        headers,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || "Fehler beim Löschen");

      const result = JSON.parse(text);
      setListSuccess(`Gelöscht: ${result.deleted || 0}.`);
      await loadMessages();
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Fehler beim Löschen");
    } finally {
      setBulkDeleting(false);
    }
  }

  async function sendMessage() {
    if (!content.trim()) {
      setFormError("Bitte eine Nachricht eingeben.");
      return;
    }

    setSending(true);
    setFormError("");
    setFormSuccess("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/pgf/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          sender_name: senderName || "PGF",
          content: content.trim(),
          urgency,
        }),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || "Fehler beim Senden");

      const result = JSON.parse(text);
      setFormSuccess(
        `Nachricht gesendet. Push an ${result.push?.targets || 0} Geräte (${result.push?.success || 0} erfolgreich).`
      );
      setContent("");
      await loadMessages();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Fehler beim Senden");
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (!authReady || !session) return;
    loadMessages();
  }, [authReady, session]);

  if (!authReady) return <div className="p-6">Lade…</div>;
  if (!session) return null;

  const urgencyLabel: Record<string, string> = {
    information: "Information",
    mittel: "Mittel",
    hoch: "Hoch",
  };

  const urgencyVariant: Record<string, "secondary" | "default" | "destructive"> = {
    information: "secondary",
    mittel: "default",
    hoch: "destructive",
  };

  return (
    <AdminShell
      session={session}
      title="Nachrichten"
      subtitle="Mitteilungen an alle Nutzer senden"
      actions={
        <Button className="admin-btn" variant="outline" onClick={loadMessages}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Aktualisieren
        </Button>
      }
    >
      <Card className="admin-card">
        <CardHeader className="admin-card-header">
          <CardTitle>Neue Nachricht</CardTitle>
        </CardHeader>

        <CardContent className="admin-section">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Absender</Label>
                <Input
                  className="admin-input mt-1"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="z. B. PGF"
                />
              </div>

              <div>
                <Label>Dringlichkeit</Label>
                <Select value={urgency} onValueChange={setUrgency}>
                  <SelectTrigger className="admin-select-trigger mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="information">Information</SelectItem>
                    <SelectItem value="mittel">Mittel</SelectItem>
                    <SelectItem value="hoch">Hoch</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Nachricht</Label>
              <textarea
                className="admin-input mt-1 w-full min-h-[100px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Nachricht an alle Nutzer..."
              />
            </div>

            {formError && <div className="admin-error">{formError}</div>}
            {formSuccess && (
              <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                {formSuccess}
              </div>
            )}

            <div className="flex justify-end">
              <Button
                className="admin-btn-primary"
                onClick={sendMessage}
                disabled={sending}
              >
                <Send className="mr-2 h-4 w-4" />
                {sending ? "Sendet…" : "Nachricht senden"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="admin-card">
        <CardHeader className="admin-card-header">
          <CardTitle>Gesendete Nachrichten</CardTitle>
        </CardHeader>

        <CardContent className="admin-section">
          <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold text-slate-900">
              Nachrichten im Zeitraum löschen
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <div>
                <Label>Von</Label>
                <Input
                  className="admin-input mt-1"
                  type="date"
                  value={bulkFrom}
                  onChange={(e) => {
                    setBulkFrom(e.target.value);
                    // Clear stale hints from previous attempts.
                    setListError("");
                    setListSuccess("");
                  }}
                />
              </div>
              <div>
                <Label>Bis</Label>
                <Input
                  className="admin-input mt-1"
                  type="date"
                  value={bulkTo}
                  onChange={(e) => {
                    setBulkTo(e.target.value);
                    // Clear stale hints from previous attempts.
                    setListError("");
                    setListSuccess("");
                  }}
                />
              </div>
              <div className="flex items-end justify-end">
                <Button
                  className="admin-btn"
                  variant="outline"
                  onClick={deleteMessagesInRange}
                  disabled={bulkDeleting}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {bulkDeleting ? "Löscht…" : "Alle löschen"}
                </Button>
              </div>
            </div>

            {(listError || listSuccess) && (
              <div className="mt-3">
                {listError && <div className="admin-error">{listError}</div>}
                {listSuccess && (
                  <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                    {listSuccess}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="admin-table">
            <div className="admin-table-header grid grid-cols-[160px_140px_120px_1fr_110px]">
              <div>Datum</div>
              <div>Absender</div>
              <div>Dringlichkeit</div>
              <div>Nachricht</div>
              <div className="text-right">Aktion</div>
            </div>

            {messages.map((m) => (
              <div
                key={m.id}
                className="admin-table-row grid grid-cols-[160px_140px_120px_1fr_110px]"
              >
                <div className="text-sm">
                  {new Date(m.created_at).toLocaleString("de-DE", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
                <div className="font-medium text-sm">{m.sender_name}</div>
                <div>
                  <Badge variant={urgencyVariant[m.urgency] || "secondary"}>
                    {urgencyLabel[m.urgency] || m.urgency}
                  </Badge>
                </div>
                <div className="text-sm">{m.content}</div>
                <div className="flex justify-end">
                  <Button
                    className="admin-btn"
                    size="sm"
                    variant="outline"
                    onClick={() => deleteMessage(m.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Löschen
                  </Button>
                </div>
              </div>
            ))}

            {!loading && messages.length === 0 && (
              <div className="p-6 text-center text-sm text-slate-500">
                Keine Nachrichten vorhanden
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </AdminShell>
  );
}
