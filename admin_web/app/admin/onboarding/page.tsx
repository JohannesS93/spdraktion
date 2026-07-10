"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { Copy, Download, Printer, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { AdminShell } from "@/components/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_BASE } from "@/lib/api";
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

type Invitation = {
  id: string;
  user_id: string;
  email: string;
  name: string;
  status: string;
  expires_at?: string | null;
  activated_at?: string | null;
  created_at?: string | null;
  active_devices?: number;
  has_code?: boolean;
};

type CreatedInvitation = {
  id: string;
  user_id: string;
  email: string;
  name: string;
  code: string;
  qr_payload: string;
  expires_at?: string | null;
  created_at?: string | null;
  has_code?: boolean;
};

type InvitationDetail = Invitation & {
  code?: string | null;
  qr_payload?: string | null;
};

type InvitationDownloadTarget = {
  id: string;
  email: string;
  name?: string | null;
};

function canUseOnboarding(role?: string | null) {
  return role === "admin" || role === "pgf";
}

function formatDateTime(value?: string | null) {
  if (!value) return "offen";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: string) {
  if (status === "open") return "Offen";
  if (status === "activated") return "Aktiviert";
  if (status === "revoked") return "Widerrufen";
  return status;
}

function statusVariant(status: string) {
  if (status === "activated") return "default";
  if (status === "open") return "secondary";
  return "outline";
}

export default function OnboardingPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [items, setItems] = useState<Invitation[]>([]);
  const [createdItems, setCreatedItems] = useState<CreatedInvitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingAll, setCreatingAll] = useState(false);
  const [regeneratingInvitationId, setRegeneratingInvitationId] = useState<string | null>(null);
  const [downloadingInvitationId, setDownloadingInvitationId] = useState<string | null>(null);
  const [expiresDays, setExpiresDays] = useState("60");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedInvitation, setSelectedInvitation] = useState<InvitationDetail | null>(null);

  const openCount = useMemo(
    () => items.filter((item) => item.status === "open").length,
    [items],
  );
  const activatedCount = useMemo(
    () => items.filter((item) => item.status === "activated").length,
    [items],
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const localSession = getSession();

      if (!firebaseUser || !localSession || !canUseOnboarding(localSession.role)) {
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

  const getAuthHeaders = useCallback(async () => {
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
  }, [router]);

  const loadInvitations = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/onboarding/invitations`, {
        headers,
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(`Einladungen konnten nicht geladen werden: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (authReady && session) {
      void loadInvitations();
    }
  }, [authReady, session, loadInvitations]);

  async function createAllInvitations() {
    const confirmed = window.confirm(
      "Wenn du neue Einladungen für alle erzeugst, werden alle aktuell offenen Onboarding-Codes sofort ungültig. Wirklich fortfahren?",
    );

    if (!confirmed) {
      return;
    }

    setCreatingAll(true);
    setError("");
    setNotice("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/onboarding/invitations`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          expires_days: Number(expiresDays) || 60,
          replace_open: true,
        }),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const data = await res.json();
      const nextCreated = Array.isArray(data.items) ? data.items : [];
      setCreatedItems(nextCreated);
      setNotice(`${nextCreated.length} neue Einladung(en) erzeugt. Die Codes können jetzt auch pro Person erneut geöffnet werden.`);
      await loadInvitations();
    } catch (err) {
      setError(`Einladungen konnten nicht erzeugt werden: ${String(err)}`);
    } finally {
      setCreatingAll(false);
    }
  }

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
    setNotice("Code kopiert.");
  }

  async function openInvitationDetail(invitationId: string) {
    setDetailOpen(true);
    setDetailLoading(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/onboarding/invitations/${invitationId}`, {
        headers,
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || "Detailansicht konnte nicht geladen werden");
      }

      const payload = JSON.parse(text) as InvitationDetail;
      setSelectedInvitation(payload);
    } catch (err) {
      setSelectedInvitation(null);
      setError(`Einladungsdetails konnten nicht geladen werden: ${String(err)}`);
    } finally {
      setDetailLoading(false);
    }
  }

  async function regenerateInvitation(item: Invitation | InvitationDetail) {
    const confirmed = window.confirm(
      `Der bisher offene Code für ${item.name || item.email} wird damit sofort ungültig. Neuen Code jetzt erzeugen?`,
    );

    if (!confirmed) {
      return;
    }

    setRegeneratingInvitationId(item.id);
    setError("");
    setNotice("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/onboarding/users/${item.user_id}/invitation`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expires_days: Number(expiresDays) || 60,
          replace_open: true,
        }),
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || "Neuer Code konnte nicht erzeugt werden");
      }

      const payload = JSON.parse(text) as InvitationDetail;
      setSelectedInvitation(payload);
      setCreatedItems((current) => {
        const rest = current.filter((entry) => entry.user_id !== payload.user_id);
        return [payload as CreatedInvitation, ...rest];
      });
      setNotice(`Neuer Code für ${payload.name || payload.email} erzeugt.`);
      await loadInvitations();
    } catch (err) {
      setError(`Neuer Code konnte nicht erzeugt werden: ${String(err)}`);
    } finally {
      setRegeneratingInvitationId(null);
    }
  }

  async function downloadInvitationPdf(item: InvitationDownloadTarget) {
    setDownloadingInvitationId(item.id);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/onboarding/invitations/${item.id}/pdf`, {
        headers,
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `onboarding-${(item.name || item.email || "person").replace(/\s+/g, "-").toLowerCase()}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(`PDF konnte nicht geladen werden: ${String(err)}`);
    } finally {
      setDownloadingInvitationId(null);
    }
  }

  function printCodes() {
    window.print();
  }

  if (!authReady || !session) {
    return <div className="p-8 text-slate-500">Lade Onboarding...</div>;
  }

  return (
    <AdminShell
      title="Onboarding"
      subtitle="Geräteaktivierung per persönlichem QR-Code"
      session={session}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadInvitations} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Aktualisieren
          </Button>
          <Button onClick={createAllInvitations} disabled={creatingAll}>
            <QrCode className="mr-2 h-4 w-4" />
            Einladungen erzeugen
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Offene Einladungen</CardTitle>
            </CardHeader>
            <CardContent className="text-5xl font-semibold">{openCount}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Aktivierte Einladungen</CardTitle>
            </CardHeader>
            <CardContent className="text-5xl font-semibold">{activatedCount}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Gültigkeit neuer Codes</CardTitle>
            </CardHeader>
            <CardContent>
              <Label htmlFor="expires_days">Tage</Label>
              <Input
                id="expires_days"
                type="number"
                min={1}
                max={365}
                value={expiresDays}
                onChange={(event) => setExpiresDays(event.target.value)}
                className="mt-2"
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Aktivierungsprozess</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-slate-700 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold text-slate-950">
                <QrCode className="h-4 w-4" />
                QR-Code pro Person
              </div>
              Der Code wird per Brief verschickt und ist nur einmal nutzbar.
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold text-slate-950">
                <ShieldCheck className="h-4 w-4" />
                Gerät wird verbunden
              </div>
              Nach Scan, E-Mail und Passwort wird genau dieses Handy registriert.
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold text-slate-950">
                <RefreshCw className="h-4 w-4" />
                Neues Handy
              </div>
              Für ein neues Gerät wird wieder eine neue Einladung erzeugt.
            </div>
          </CardContent>
        </Card>

        {error ? (
          <div className="border border-red-200 bg-red-50 px-4 py-3 text-red-700">{error}</div>
        ) : null}
        {notice ? (
          <div className="border border-green-200 bg-green-50 px-4 py-3 text-green-700">{notice}</div>
        ) : null}

        {createdItems.length > 0 ? (
          <Card className="print:shadow-none">
            <CardHeader className="flex-row items-center justify-between gap-4">
              <CardTitle>Neu erzeugte QR-Codes</CardTitle>
              <Button variant="outline" onClick={printCodes}>
                <Printer className="mr-2 h-4 w-4" />
                Drucken
              </Button>
            </CardHeader>
            <CardContent>
              <div className="mb-4 text-sm text-slate-600 print:hidden">
                Direkt nach dem Erzeugen kannst du die Codes gesammelt drucken. Später sind sie zusätzlich pro Person erneut abrufbar.
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {createdItems.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="mb-4">
                      <div className="text-lg font-semibold text-slate-950">{item.name || item.email}</div>
                      <div className="text-sm text-slate-500">{item.email}</div>
                    </div>
                    <QRCodeSVG value={item.qr_payload} size={180} level="M" includeMargin />
                    <div className="mt-4 rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700">
                      {item.code}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 text-sm text-slate-500">
                      <span>Gültig bis {formatDateTime(item.expires_at)}</span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => copyText(item.code)}>
                          <Copy className="mr-2 h-3.5 w-3.5" />
                          Kopieren
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => void downloadInvitationPdf(item)}>
                          <Download className="mr-2 h-3.5 w-3.5" />
                          PDF
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Einladungen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-slate-200 border border-slate-200 bg-white">
              {items.map((item) => (
                <div key={item.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto_auto_auto] md:items-center">
                  <div>
                    <div className="font-semibold text-slate-950">{item.name || item.email}</div>
                    <div className="text-sm text-slate-500">{item.email}</div>
                  </div>
                  <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
                  <div className="text-sm text-slate-600">
                    {item.status === "activated"
                      ? `Aktiviert: ${formatDateTime(item.activated_at)}`
                      : `Gültig bis: ${formatDateTime(item.expires_at)}`}
                  </div>
                  <div className="text-sm text-slate-500">{item.active_devices || 0} Gerät(e)</div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => void openInvitationDetail(item.id)}>
                      Code anzeigen
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void regenerateInvitation(item)}
                      disabled={regeneratingInvitationId === item.id}
                    >
                      <RefreshCw className="mr-2 h-3.5 w-3.5" />
                      Neu erzeugen
                    </Button>
                  </div>
                </div>
              ))}
              {!loading && items.length === 0 ? (
                <div className="p-6 text-slate-500">Noch keine Onboarding-Einladungen vorhanden.</div>
              ) : null}
              {loading ? <div className="p-6 text-slate-500">Lade Einladungen...</div> : null}
            </div>
          </CardContent>
        </Card>

        <Dialog
          open={detailOpen}
          onOpenChange={(open) => {
            setDetailOpen(open);
            if (!open) {
              setSelectedInvitation(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Onboarding-Code</DialogTitle>
              <DialogDescription>
                Hier kannst du den persönlichen Code erneut anzeigen, als PDF laden oder direkt ersetzen.
              </DialogDescription>
            </DialogHeader>

            {detailLoading ? <div className="py-8 text-slate-500">Lade Einladung...</div> : null}

            {!detailLoading && selectedInvitation ? (
              <div className="space-y-5">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="font-semibold text-slate-950">{selectedInvitation.name || selectedInvitation.email}</div>
                  <div className="text-sm text-slate-500">{selectedInvitation.email}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-600">
                    <Badge variant={statusVariant(selectedInvitation.status)}>{statusLabel(selectedInvitation.status)}</Badge>
                    <span>Gültig bis {formatDateTime(selectedInvitation.expires_at)}</span>
                    <span>{selectedInvitation.active_devices || 0} Gerät(e)</span>
                  </div>
                </div>

                {selectedInvitation.code && selectedInvitation.qr_payload ? (
                  <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <QRCodeSVG value={selectedInvitation.qr_payload} size={180} level="M" includeMargin />
                    </div>
                    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="text-sm text-slate-600">
                        Diesen Code kannst du direkt scannen lassen oder in der App manuell eingeben.
                      </div>
                      <Input className="font-mono" value={selectedInvitation.code} readOnly />
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={() => void copyText(selectedInvitation.code || "")}>
                          <Copy className="mr-2 h-4 w-4" />
                          Code kopieren
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => void downloadInvitationPdf(selectedInvitation)}
                          disabled={downloadingInvitationId === selectedInvitation.id}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          PDF laden
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                    Dieser ältere Code wurde damals noch nicht speicherbar abgelegt. Bitte für diese Person einmal einen neuen Code erzeugen.
                  </div>
                )}
              </div>
            ) : null}

            <DialogFooter>
              {selectedInvitation ? (
                <Button
                  variant="outline"
                  onClick={() => void regenerateInvitation(selectedInvitation)}
                  disabled={regeneratingInvitationId === selectedInvitation.id}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Neuen Code erzeugen
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminShell>
  );
}
