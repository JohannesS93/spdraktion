"use client";

import React, { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { FileText, FileUp, RefreshCw, Trash2 } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

type SentDocument = {
  id: string;
  title: string;
  filename: string;
  category: string;
  created_at?: string | null;
  uploaded_by_name?: string | null;
  recipient_count: number;
};

const CATEGORY_OPTIONS = [
  { value: "kurzuebersicht", label: "Kurzübersicht" },
  { value: "information", label: "Information" },
  { value: "musterantworten", label: "Musterantworten" },
  { value: "reden", label: "Reden" },
];

const RECIPIENT_SCOPE_OPTIONS = [
  { value: "all", label: "Alle" },
  { value: "mdb", label: "MdBs" },
  { value: "pgf", label: "PGFs" },
];

export default function DocumentsAdminPage() {
  const router = useRouter();

  const [session, setSessionState] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [documents, setDocuments] = useState<SentDocument[]>([]);
  const [recipientScope, setRecipientScope] = useState("all");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("information");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const localSession = getSession();

      if (!firebaseUser || !localSession) {
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
    };
  }, [router]);

  const loadDocuments = useCallback(async () => {
    setLoadingDocuments(true);

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/documents`, { headers });

      if (!res.ok) {
        throw new Error("Dokumente konnten nicht geladen werden");
      }

      const data = await res.json();
      setDocuments(Array.isArray(data) ? (data as SentDocument[]) : []);
    } catch {
      setError("Fehler beim Laden der versendeten Dateien");
    } finally {
      setLoadingDocuments(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!authReady || !session) return;
    loadDocuments();
  }, [authReady, loadDocuments, session]);

  const canUpload = session?.role === "admin" || session?.role === "pgf";

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);

    if (!title && file) {
      const titleWithoutExtension = file.name.replace(/\.[^.]+$/, "");
      setTitle(titleWithoutExtension);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!title.trim()) {
      setError("Bitte einen Titel eingeben.");
      return;
    }

    if (!canUpload) {
      setError("Deine Rolle darf aktuell keine Dateien hochladen.");
      return;
    }

    if (!selectedFile) {
      setError("Bitte eine Datei auswählen.");
      return;
    }

    if (!recipientScope) {
      setError("Bitte einen Empfängerkreis auswählen.");
      return;
    }

    setSaving(true);

    try {
      const headers = await getAuthHeaders();
      const formData = new FormData();
      formData.append("title", title.trim());
      formData.append("category", category);
      formData.append("recipient_scope", recipientScope);
      formData.append("file", selectedFile);

      const res = await fetch(`${API_BASE}/documents/upload`, {
        method: "POST",
        headers,
        body: formData,
      });

      const text = await res.text();

      if (!res.ok) {
        throw new Error(text || "Upload fehlgeschlagen");
      }

      setSuccess("Datei wurde erfolgreich hochgeladen.");
      setTitle("");
      setCategory("information");
      setRecipientScope("all");
      setSelectedFile(null);
      await loadDocuments();

      const fileInput = document.getElementById("document-file-input") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Upload fehlgeschlagen";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteDocument(doc: SentDocument) {
    const ok = window.confirm(`Datei "${doc.title}" wirklich löschen?`);
    if (!ok) return;

    setError("");
    setSuccess("");
    setDeletingId(doc.id);

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/documents/${doc.id}`, {
        method: "DELETE",
        headers,
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || "Löschen fehlgeschlagen");
      }

      setSuccess(`Datei "${doc.title}" wurde gelöscht.`);
      await loadDocuments();
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : "Löschen fehlgeschlagen";
      setError(message);
    } finally {
      setDeletingId(null);
    }
  }

  function categoryLabel(value: string) {
    const match = CATEGORY_OPTIONS.find((option) => option.value === value);
    return match?.label ?? value;
  }

  function formatDate(value?: string | null) {
    if (!value) return "-";

    try {
      return new Date(value).toLocaleString("de-DE");
    } catch {
      return value;
    }
  }

  if (!authReady) {
    return <div className="p-6">Lade…</div>;
  }

  if (!session) return null;

  return (
    <AdminShell
      session={session}
      title="Dateien"
      subtitle="Dokumente hochladen und an feste Empfängerkreise verteilen"
      actions={
        <>
          <Button className="admin-btn" variant="outline" onClick={loadDocuments}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Dateien aktualisieren
          </Button>
        </>
      }
    >
      <Card className="admin-card">
        <CardHeader className="admin-card-header">
          <CardTitle>Dokument hochladen</CardTitle>
        </CardHeader>
        <CardContent className="admin-section">
          {!canUpload ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Dein Account kann die Dokumentenseite sehen, aber aktuell keine Dateien hochladen.
            </div>
          ) : null}
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="document-title">Titel</Label>
                <Input
                  id="document-title"
                  className="admin-input mt-1"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="z. B. Rede Innenpolitik"
                  disabled={!canUpload}
                />
              </div>

              <div>
                <Label htmlFor="document-category">Kategorie</Label>
                <Select value={category} onValueChange={setCategory} disabled={!canUpload}>
                  <SelectTrigger id="document-category" className="admin-select-trigger mt-1">
                    <SelectValue placeholder="Kategorie auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="document-file-input">Datei</Label>
              <Input
                id="document-file-input"
                className="admin-input mt-1"
                type="file"
                onChange={handleFileChange}
                disabled={!canUpload}
              />
              {selectedFile ? (
                <p className="mt-2 text-sm text-slate-500">
                  Ausgewählt: {selectedFile.name}
                </p>
              ) : null}
            </div>

            <div>
              <Label htmlFor="document-recipient-scope">Datei senden an</Label>
              <Select value={recipientScope} onValueChange={setRecipientScope} disabled={!canUpload}>
                <SelectTrigger id="document-recipient-scope" className="admin-select-trigger mt-1">
                  <SelectValue placeholder="Empfängerkreis auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {RECIPIENT_SCOPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-2 text-sm text-slate-500">
                Verfügbare Verteiler: Alle, MdBs oder PGFs.
              </p>
            </div>

            {error ? <div className="admin-error">{error}</div> : null}
            {success ? (
              <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {success}
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button className="admin-btn-primary" type="submit" disabled={saving || !canUpload}>
                <FileUp className="mr-2 h-4 w-4" />
                {saving ? "Lädt hoch…" : "Datei hochladen"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="admin-card">
        <CardHeader className="admin-card-header">
          <CardTitle>Versendete Dateien</CardTitle>
        </CardHeader>
        <CardContent className="admin-section">
          {loadingDocuments ? (
            <div className="text-sm text-slate-500">Dateien werden geladen…</div>
          ) : documents.length === 0 ? (
            <div className="text-sm text-slate-500">Noch keine Dateien versendet.</div>
          ) : (
            <div className="admin-table overflow-x-auto">
              <div className="admin-table-header grid grid-cols-[1.8fr_1.1fr_150px_170px_100px_120px]">
                <div>Datei</div>
                <div>Kategorie</div>
                <div>Empfänger</div>
                <div>Versendet am</div>
                <div>Von</div>
                <div>Aktionen</div>
              </div>

              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="admin-table-row grid grid-cols-[1.8fr_1.1fr_150px_170px_100px_120px] items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-start gap-3">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-900">{doc.title}</div>
                        <div className="truncate text-sm text-slate-500">{doc.filename}</div>
                      </div>
                    </div>
                  </div>

                  <div>{categoryLabel(doc.category)}</div>
                  <div>{doc.recipient_count}</div>
                  <div>{formatDate(doc.created_at)}</div>
                  <div>{doc.uploaded_by_name ?? "-"}</div>
                  <div>
                    <Button
                      className="admin-btn"
                      variant="outline"
                      onClick={() => deleteDocument(doc)}
                      disabled={deletingId === doc.id}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {deletingId === doc.id ? "Löscht…" : "Löschen"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </AdminShell>
  );
}
