"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { Plus, RefreshCw, Trash2 } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

type SlotTemplateItem = {
  id: string;
  template_id: string;
  weekday: string;
  slot_code: string;
  slot_order: number;
  day_offset: number;
  start_time: string;
  end_time?: string | null;
  open_end: boolean;
  required_active_count?: number | null;
  required_ruf_count?: number | null;
  full_attendance: boolean;
};

type SlotTemplate = {
  id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  default_active_count: number;
  default_ruf_count: number;
  item_count: number;
  items: SlotTemplateItem[];
};

type AppVersionPlatformPolicy = {
  platform: "ios" | "android";
  latest_version?: string | null;
  min_required_version?: string | null;
  force_update: boolean;
  store_url?: string | null;
  message?: string | null;
  updated_at?: string | null;
};

const JOHANNES_INFO_EMAIL = "johannes.schaetzl.mdb@bundestag.de";

const EMPTY_TEMPLATE_ITEM_FORM = {
  weekday: "Mittwoch",
  slot_code: "",
  slot_order: 1,
  day_offset: 2,
  start_time: "",
  end_time: null as string | null,
  open_end: false,
  required_active_count: null as number | null,
  required_ruf_count: null as number | null,
  full_attendance: false,
};

function canManageSettings(role?: string | null) {
  return role === "admin" || role === "pgf";
}

export default function SettingsPage() {
  const router = useRouter();

  const [session, setSessionState] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [error, setError] = useState("");

  const [slotTemplates, setSlotTemplates] = useState<SlotTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateNameDraft, setTemplateNameDraft] = useState("");
  const [templateDefaultActiveCountDraft, setTemplateDefaultActiveCountDraft] = useState(24);
  const [templateDefaultRufCountDraft, setTemplateDefaultRufCountDraft] = useState(24);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [templateImportText, setTemplateImportText] = useState("");
  const [importingTemplate, setImportingTemplate] = useState(false);
  const [newTemplateItem, setNewTemplateItem] = useState(EMPTY_TEMPLATE_ITEM_FORM);
  const [savingTemplateMeta, setSavingTemplateMeta] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [creatingTemplateItem, setCreatingTemplateItem] = useState(false);
  const [savingTemplateItemId, setSavingTemplateItemId] = useState<string | null>(null);
  const [deletingTemplateItemId, setDeletingTemplateItemId] = useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [appVersionPolicy, setAppVersionPolicy] = useState<Record<string, AppVersionPlatformPolicy>>({});
  const [appVersionLoading, setAppVersionLoading] = useState(false);
  const [savingAppVersionPolicy, setSavingAppVersionPolicy] = useState(false);

  const selectedTemplate = useMemo(
    () => slotTemplates.find((template) => template.id === selectedTemplateId) ?? null,
    [slotTemplates, selectedTemplateId]
  );
  const defaultTemplate = useMemo(
    () => slotTemplates.find((template) => template.is_default) ?? null,
    [slotTemplates]
  );
  const selectedTemplateDayCount = useMemo(
    () => new Set((selectedTemplate?.items ?? []).map((item) => item.weekday)).size,
    [selectedTemplate]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const localSession = getSession();

      if (!firebaseUser || !localSession || !canManageSettings(localSession.role)) {
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

  useEffect(() => {
    if (!authReady || !session) return;
    void loadSlotTemplates();
    if (session.email?.toLowerCase() === JOHANNES_INFO_EMAIL) {
      void loadAppVersionPolicy();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, session]);

  useEffect(() => {
    if (!selectedTemplate) {
      setTemplateNameDraft("");
      return;
    }
    setTemplateNameDraft(selectedTemplate.name);
    setTemplateDefaultActiveCountDraft(selectedTemplate.default_active_count ?? 24);
    setTemplateDefaultRufCountDraft(selectedTemplate.default_ruf_count ?? 24);
  }, [selectedTemplate]);

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

  async function loadSlotTemplates() {
    setTemplatesLoading(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slot-templates`, { headers });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const templates = JSON.parse(text) as SlotTemplate[];
      setSlotTemplates(templates);
      setSelectedTemplateId((current) => {
        if (current && templates.some((template) => template.id === current)) return current;
        const defaultTemplate = templates.find((template) => template.is_default);
        return defaultTemplate?.id ?? templates[0]?.id ?? "";
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Laden der Templates: ${message}`);
    } finally {
      setTemplatesLoading(false);
    }
  }

  async function loadAppVersionPolicy() {
    setAppVersionLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/app-version-policy`, { headers });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      setAppVersionPolicy(JSON.parse(text) as Record<string, AppVersionPlatformPolicy>);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Laden des Update-Managements: ${message}`);
    } finally {
      setAppVersionLoading(false);
    }
  }

  function updatePolicyDraft(platform: "ios" | "android", field: keyof AppVersionPlatformPolicy, value: string | boolean) {
    setAppVersionPolicy((prev) => ({
      ...prev,
      [platform]: {
        ...(prev[platform] ?? {}),
        platform,
        force_update: prev[platform]?.force_update ?? false,
        [field]: value,
      },
    }));
  }

  async function saveAppVersionPolicy() {
    setSavingAppVersionPolicy(true);
    setError("");
    try {
      const headers = await getAuthHeaders();
      const ios = appVersionPolicy.ios ?? { platform: "ios", force_update: false };
      const android = appVersionPolicy.android ?? { platform: "android", force_update: false };
      const res = await fetch(`${API_BASE}/admin/app-version-policy`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          ios_latest_version: ios.latest_version ?? "",
          ios_min_required_version: ios.min_required_version ?? "",
          ios_force_update: ios.force_update ?? false,
          ios_store_url: ios.store_url ?? "",
          ios_message: ios.message ?? "",
          android_latest_version: android.latest_version ?? "",
          android_min_required_version: android.min_required_version ?? "",
          android_force_update: android.force_update ?? false,
          android_store_url: android.store_url ?? "",
          android_message: android.message ?? "",
        }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      setAppVersionPolicy(JSON.parse(text) as Record<string, AppVersionPlatformPolicy>);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Speichern des Update-Managements: ${message}`);
    } finally {
      setSavingAppVersionPolicy(false);
    }
  }

  function updateTemplateItemLocal<K extends keyof SlotTemplateItem>(
    itemId: string,
    field: K,
    value: SlotTemplateItem[K]
  ) {
    setSlotTemplates((prev) =>
      prev.map((template) =>
        template.id !== selectedTemplateId
          ? template
          : {
              ...template,
              items: template.items.map((item) =>
                item.id === itemId ? { ...item, [field]: value } : item
              ),
            }
      )
    );
  }

  async function createTemplate() {
    if (!newTemplateName.trim()) {
      setError("Bitte einen Namen für das neue Template eingeben.");
      return;
    }

    setCreatingTemplate(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slot-templates`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: newTemplateName.trim(),
          is_default: false,
          default_active_count: 24,
          default_ruf_count: 24,
        }),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const data = JSON.parse(text) as { template: SlotTemplate };
      setNewTemplateName("");
      await loadSlotTemplates();
      setSelectedTemplateId(data.template.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Anlegen des Templates: ${message}`);
    } finally {
      setCreatingTemplate(false);
    }
  }

  async function saveTemplateMeta(options?: { isDefault?: boolean }) {
    if (!selectedTemplate) return;

    setSavingTemplateMeta(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slot-templates/${selectedTemplate.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          name: templateNameDraft.trim() || selectedTemplate.name,
          default_active_count: templateDefaultActiveCountDraft,
          default_ruf_count: templateDefaultRufCountDraft,
          ...(options?.isDefault !== undefined ? { is_default: options.isDefault } : {}),
        }),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      await loadSlotTemplates();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Speichern des Templates: ${message}`);
    } finally {
      setSavingTemplateMeta(false);
    }
  }

  async function deleteTemplate() {
    if (!selectedTemplate) return;
    const confirmed = window.confirm(
      `Template "${selectedTemplate.name}" wirklich löschen? Alle darin enthaltenen Standardslots werden entfernt.`
    );
    if (!confirmed) return;

    setDeletingTemplateId(selectedTemplate.id);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slot-templates/${selectedTemplate.id}`, {
        method: "DELETE",
        headers,
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      await loadSlotTemplates();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Löschen des Templates: ${message}`);
    } finally {
      setDeletingTemplateId(null);
    }
  }

  async function importTemplateItems() {
    if (!selectedTemplateId) {
      setError("Bitte zuerst ein Template auswählen.");
      return;
    }

    if (!templateImportText.trim()) {
      setError("Bitte zuerst den Tabellenblock für den Import einfügen.");
      return;
    }

    const confirmed = window.confirm(
      "Der Import ersetzt alle bisherigen Standardslots des ausgewählten Templates. Jetzt importieren?"
    );
    if (!confirmed) return;

    setImportingTemplate(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slot-templates/${selectedTemplateId}/import`, {
        method: "POST",
        headers,
        body: JSON.stringify({ raw_text: templateImportText }),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      setTemplateImportText("");
      await loadSlotTemplates();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Import der Standardslots: ${message}`);
    } finally {
      setImportingTemplate(false);
    }
  }

  async function createTemplateItem() {
    if (!selectedTemplateId) {
      setError("Bitte zuerst ein Template auswählen.");
      return;
    }

    if (!newTemplateItem.slot_code.trim() || !newTemplateItem.start_time) {
      setError("Bitte mindestens Slot-Code und Startzeit angeben.");
      return;
    }

    setCreatingTemplateItem(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slot-templates/${selectedTemplateId}/items`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...newTemplateItem,
          slot_code: newTemplateItem.slot_code.trim(),
          end_time: newTemplateItem.end_time || null,
          required_active_count: newTemplateItem.required_active_count,
          required_ruf_count: newTemplateItem.required_ruf_count,
          full_attendance: newTemplateItem.full_attendance,
        }),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      setNewTemplateItem(EMPTY_TEMPLATE_ITEM_FORM);
      await loadSlotTemplates();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Anlegen des Standardslots: ${message}`);
    } finally {
      setCreatingTemplateItem(false);
    }
  }

  async function saveTemplateItem(item: SlotTemplateItem) {
    setSavingTemplateItemId(item.id);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slot-template-items/${item.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          weekday: item.weekday,
          slot_code: item.slot_code,
          slot_order: item.slot_order,
          day_offset: item.day_offset,
          start_time: item.start_time,
          end_time: item.end_time || null,
          open_end: item.open_end,
          required_active_count: item.required_active_count,
          required_ruf_count: item.required_ruf_count,
          full_attendance: item.full_attendance,
        }),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      await loadSlotTemplates();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Speichern des Standardslots: ${message}`);
    } finally {
      setSavingTemplateItemId(null);
    }
  }

  async function deleteTemplateItem(itemId: string) {
    if (!window.confirm("Diesen Standardslot wirklich löschen?")) return;

    setDeletingTemplateItemId(itemId);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slot-template-items/${itemId}`, {
        method: "DELETE",
        headers,
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      await loadSlotTemplates();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Löschen des Standardslots: ${message}`);
    } finally {
      setDeletingTemplateItemId(null);
    }
  }

  if (!authReady) {
    return <main className="min-h-screen bg-[#f7f7f8]" />;
  }

  if (!session) return null;

  return (
    <AdminShell
      session={session}
      title="Einstellungen"
      subtitle="Standardslot-Templates zentral verwalten."
      actions={
        <Button className="admin-btn" variant="outline" onClick={() => {
          void loadSlotTemplates();
          if (session.email?.toLowerCase() === JOHANNES_INFO_EMAIL) {
            void loadAppVersionPolicy();
          }
        }}>
          <RefreshCw className={`mr-2 h-4 w-4 ${templatesLoading ? "animate-spin" : ""}`} />
          Aktualisieren
        </Button>
      }
    >
      {error ? <div className="admin-error">{error}</div> : null}

      {session.email?.toLowerCase() === JOHANNES_INFO_EMAIL ? (
        <Card className="admin-card">
          <CardHeader className="admin-card-header">
            <CardTitle className="text-base font-semibold">App-Update-Management</CardTitle>
          </CardHeader>
          <CardContent className="admin-section space-y-5 p-5">
            <div className="text-sm text-slate-600">
              Hier steuerst du, welche iPhone- und Android-Version empfohlen oder zwingend erforderlich ist.
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              {(["ios", "android"] as const).map((platform) => {
                const policy = appVersionPolicy[platform] ?? {
                  platform,
                  force_update: false,
                  latest_version: "",
                  min_required_version: "",
                  store_url: "",
                  message: "",
                };

                return (
                  <div key={platform} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-4">
                      <div className="text-sm font-semibold text-slate-900">
                        {platform === "ios" ? "iPhone / App Store" : "Android / Play Store"}
                      </div>
                      <div className="text-xs text-slate-500">
                        Letzte Aenderung: {policy.updated_at ? new Date(policy.updated_at).toLocaleString("de-DE") : "noch keine"}
                      </div>
                    </div>

                    <div className="grid gap-4">
                      <div className="grid gap-2">
                        <Label>Neueste Version</Label>
                        <Input
                          className="admin-input"
                          placeholder="z. B. 1.0.2"
                          value={policy.latest_version ?? ""}
                          onChange={(e) => updatePolicyDraft(platform, "latest_version", e.target.value)}
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label>Minimal erforderliche Version</Label>
                        <Input
                          className="admin-input"
                          placeholder="z. B. 1.0.2"
                          value={policy.min_required_version ?? ""}
                          onChange={(e) => updatePolicyDraft(platform, "min_required_version", e.target.value)}
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label>Store-URL</Label>
                        <Input
                          className="admin-input"
                          placeholder={platform === "ios" ? "https://apps.apple.com/..." : "https://play.google.com/store/apps/..."}
                          value={policy.store_url ?? ""}
                          onChange={(e) => updatePolicyDraft(platform, "store_url", e.target.value)}
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label>Hinweistext in der App</Label>
                        <Input
                          className="admin-input"
                          placeholder="z. B. Bitte jetzt aktualisieren."
                          value={policy.message ?? ""}
                          onChange={(e) => updatePolicyDraft(platform, "message", e.target.value)}
                        />
                      </div>

                      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-3">
                        <div>
                          <div className="text-sm font-medium text-slate-900">Update erzwingen</div>
                          <div className="text-xs text-slate-500">
                            Nutzer muessen aktualisieren, bevor sie die App weiter nutzen koennen.
                          </div>
                        </div>
                        <Switch
                          checked={Boolean(policy.force_update)}
                          onCheckedChange={(checked) => updatePolicyDraft(platform, "force_update", checked)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-3">
              <Button
                className="admin-btn-primary"
                disabled={savingAppVersionPolicy || appVersionLoading}
                onClick={() => void saveAppVersionPolicy()}
              >
                {savingAppVersionPolicy ? "Speichert…" : "Update-Regeln speichern"}
              </Button>
              <Button
                className="admin-btn"
                variant="outline"
                disabled={appVersionLoading}
                onClick={() => void loadAppVersionPolicy()}
              >
                {appVersionLoading ? "Laedt…" : "Neu laden"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="admin-card">
          <CardContent className="p-5">
            <div className="admin-stat-label">Templates</div>
            <div className="mt-3 text-3xl font-semibold">{slotTemplates.length}</div>
          </CardContent>
        </Card>

        <Card className="admin-card">
          <CardContent className="p-5">
            <div className="admin-stat-label">Default-Besetzung</div>
            <div className="mt-3 text-2xl font-semibold">
              {selectedTemplate ? `${selectedTemplate.default_active_count} Aktiv · ${selectedTemplate.default_ruf_count} Ruf` : "—"}
            </div>
          </CardContent>
        </Card>

        <Card className="admin-card">
          <CardContent className="p-5">
            <div className="admin-stat-label">Standard-Template</div>
            <div className="mt-3 truncate text-lg font-semibold">
              {defaultTemplate?.name ?? "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Empfohlener Ablauf</div>
            <div className="mt-1 text-sm text-slate-600">
              Erst Template anlegen, dann Standardwerte fuer Aktiv und Ruf setzen, danach einzelne
              Slots oder Vollanwesenheit pflegen.
            </div>
          </div>
          <Link href="/admin/handbook" className="inline-flex">
            <Button className="admin-btn" variant="outline">
              Handbuch oeffnen
            </Button>
          </Link>
        </div>
      </div>

      <Card className="admin-card">
        <CardHeader className="admin-card-header">
          <CardTitle className="text-base font-semibold">Standardslot-Templates</CardTitle>
        </CardHeader>

        <CardContent className="admin-section p-5">
          <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3">
                  <div className="text-sm font-medium text-slate-900">Neues Template</div>
                  <div className="text-xs text-slate-500">
                    Neue Wochenlogik anlegen und danach importieren oder nachpflegen.
                  </div>
                </div>
                <div className="space-y-3">
                  <Input
                    className="admin-input"
                    placeholder="z. B. Haushaltswoche"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                  />
                  <Button
                    className="admin-btn-primary w-full"
                    disabled={creatingTemplate}
                    onClick={() => void createTemplate()}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {creatingTemplate ? "Erstellt…" : "Template erstellen"}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200">
                <div className="border-b border-slate-200 px-4 py-3">
                  <div className="text-sm font-medium text-slate-900">Template-Liste</div>
                  <div className="text-xs text-slate-500">
                    Standard-Template zuerst, danach alle weiteren Konfigurationen.
                  </div>
                </div>
                <div className="divide-y divide-slate-200">
                  {slotTemplates.map((template) => {
                    const isActive = template.id === selectedTemplateId;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => setSelectedTemplateId(template.id)}
                        className={[
                          "flex w-full items-start justify-between px-4 py-3 text-left transition-colors",
                          isActive ? "bg-slate-50" : "hover:bg-slate-50",
                        ].join(" ")}
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-900">{template.name}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {template.items.length} Slots · {new Set(template.items.map((item) => item.weekday)).size} Tage
                          </div>
                        </div>
                        <div className="ml-3 shrink-0">
                          {template.is_default ? (
                            <span className="rounded-full bg-slate-900 px-2 py-1 text-[11px] font-medium text-white">
                              Standard
                            </span>
                          ) : (
                            <span className="rounded-full border border-slate-200 px-2 py-1 text-[11px] text-slate-500">
                              Vorlage
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}

                  {!templatesLoading && slotTemplates.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-500">Noch keine Templates vorhanden.</div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {selectedTemplate ? (
                <>
                  <div className="rounded-lg border border-slate-200 bg-white">
                    <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4 lg:flex-row lg:items-end lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-900">Aktives Template</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {selectedTemplate.items.length} Slots · {selectedTemplateDayCount} Tage
                          {selectedTemplate.is_default ? " · Standard-Template" : ""}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          className="admin-btn"
                          variant="outline"
                          disabled={savingTemplateMeta}
                          onClick={() => void saveTemplateMeta()}
                        >
                          {savingTemplateMeta ? "Speichert…" : "Bearbeiten"}
                        </Button>
                        <Button
                          className="admin-btn"
                          variant="outline"
                          disabled={savingTemplateMeta || !!selectedTemplate.is_default}
                          onClick={() => void saveTemplateMeta({ isDefault: true })}
                        >
                          Als Standard setzen
                        </Button>
                        <Button
                          className="admin-btn"
                          variant="outline"
                          disabled={deletingTemplateId === selectedTemplate.id}
                          onClick={() => void deleteTemplate()}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {deletingTemplateId === selectedTemplate.id ? "Löscht…" : "Löschen"}
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_120px]">
                      <div className="space-y-2">
                        <Label>Name</Label>
                        <Input
                          className="admin-input"
                          value={templateNameDraft}
                          onChange={(e) => setTemplateNameDraft(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Standard</Label>
                        <div className="flex h-10 items-center rounded-md border border-slate-200 px-3 text-sm text-slate-700">
                          {selectedTemplate.is_default ? "Ja" : "Nein"}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 border-t border-slate-200 px-4 py-4 lg:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Standard Aktiv pro Slot</Label>
                        <Input
                          className="admin-input"
                          type="number"
                          min={0}
                          value={templateDefaultActiveCountDraft}
                          onChange={(e) => setTemplateDefaultActiveCountDraft(Number(e.target.value) || 0)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Standard Ruf pro Slot</Label>
                        <Input
                          className="admin-input"
                          type="number"
                          min={0}
                          value={templateDefaultRufCountDraft}
                          onChange={(e) => setTemplateDefaultRufCountDraft(Number(e.target.value) || 0)}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                    <div className="rounded-lg border border-slate-200 bg-white p-4">
                      <div className="mb-3">
                        <div className="text-sm font-medium text-slate-900">Import aus Tabelle</div>
                        <div className="text-xs text-slate-500">
                          Excel-/CSV-Paste mit Typ, Wochentag und mehreren Zeitfenstern pro Zeile.
                        </div>
                      </div>
                      <textarea
                        className="min-h-[180px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-0 placeholder:text-slate-400 focus:border-slate-400"
                        placeholder={
                          "H\tDienstag\t10:00 - 12:30\t12:30 - 15:00\t15:00 - 17:30\t17:30 - 20:00\t20:00 - Ende\nH\tMittwoch\t09:00 - 11:30\t11:30 - 14:00\t14:00 - 16:30\t16:30 - 19:00\t19:00 - Ende"
                        }
                        value={templateImportText}
                        onChange={(e) => setTemplateImportText(e.target.value)}
                      />
                      <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="text-xs text-slate-500">
                          `HH:MM - Ende` wird als Slot mit offenem Ende erkannt. Der Import ersetzt die aktuelle Template-Struktur vollständig.
                        </div>
                        <Button
                          className="admin-btn-primary shrink-0"
                          disabled={importingTemplate}
                          onClick={() => void importTemplateItems()}
                        >
                          {importingTemplate ? "Importiert…" : "Importieren"}
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-white p-4">
                      <div className="mb-3">
                        <div className="text-sm font-medium text-slate-900">Standardslot ergänzen</div>
                        <div className="text-xs text-slate-500">
                          Für Sonderfälle oder kleine Korrekturen nach dem Import.
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Wochentag</Label>
                          <Input
                            className="admin-input"
                            value={newTemplateItem.weekday}
                            onChange={(e) =>
                              setNewTemplateItem((prev) => ({ ...prev, weekday: e.target.value }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Code</Label>
                          <Input
                            className="admin-input"
                            value={newTemplateItem.slot_code}
                            onChange={(e) =>
                              setNewTemplateItem((prev) => ({ ...prev, slot_code: e.target.value }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Reihenfolge</Label>
                          <Input
                            className="admin-input"
                            type="number"
                            value={newTemplateItem.slot_order}
                            onChange={(e) =>
                              setNewTemplateItem((prev) => ({
                                ...prev,
                                slot_order: Number(e.target.value) || 0,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Tag-Offset</Label>
                          <Input
                            className="admin-input"
                            type="number"
                            value={newTemplateItem.day_offset}
                            onChange={(e) =>
                              setNewTemplateItem((prev) => ({
                                ...prev,
                                day_offset: Number(e.target.value) || 0,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Start</Label>
                          <Input
                            className="admin-input"
                            type="time"
                            value={newTemplateItem.start_time}
                            onChange={(e) =>
                              setNewTemplateItem((prev) => ({ ...prev, start_time: e.target.value }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Ende</Label>
                          <Input
                            className="admin-input"
                            type="time"
                            value={newTemplateItem.end_time ?? ""}
                            onChange={(e) =>
                              setNewTemplateItem((prev) => ({
                                ...prev,
                                end_time: e.target.value || null,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Aktiv-Override</Label>
                          <Input
                            className="admin-input"
                            type="number"
                            min={0}
                            value={newTemplateItem.required_active_count ?? ""}
                            onChange={(e) =>
                              setNewTemplateItem((prev) => ({
                                ...prev,
                                required_active_count: e.target.value === "" ? null : Number(e.target.value),
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Ruf-Override</Label>
                          <Input
                            className="admin-input"
                            type="number"
                            min={0}
                            value={newTemplateItem.required_ruf_count ?? ""}
                            onChange={(e) =>
                              setNewTemplateItem((prev) => ({
                                ...prev,
                                required_ruf_count: e.target.value === "" ? null : Number(e.target.value),
                              }))
                            }
                          />
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                          <span className="text-sm text-slate-600">Open End</span>
                          <Switch
                            checked={newTemplateItem.open_end}
                            onCheckedChange={(checked) =>
                              setNewTemplateItem((prev) => ({ ...prev, open_end: checked }))
                            }
                          />
                        </div>
                        <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                          <div>
                            <span className="text-sm text-slate-600">Vollanwesenheit</span>
                            <div className="text-xs text-slate-500">
                              Alle planbaren MdBs werden für diesen Slot aktiv gesetzt.
                            </div>
                          </div>
                          <Switch
                            checked={newTemplateItem.full_attendance}
                            onCheckedChange={(checked) =>
                              setNewTemplateItem((prev) => ({ ...prev, full_attendance: checked }))
                            }
                          />
                        </div>
                      </div>
                      <Button
                        className="admin-btn-primary mt-3 w-full"
                        disabled={creatingTemplateItem}
                        onClick={() => void createTemplateItem()}
                      >
                        {creatingTemplateItem ? "Erstellt…" : "Standardslot hinzufügen"}
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white">
                    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                      <div>
                        <div className="text-sm font-medium text-slate-900">Slot-Liste</div>
                        <div className="text-xs text-slate-500">
                          Kompakte Bearbeitung aller Standardslots des gewählten Templates.
                        </div>
                      </div>
                    </div>

                    <div className="admin-table overflow-x-auto">
                      <div className="admin-table-header grid min-w-[1330px] grid-cols-[120px_90px_90px_90px_110px_110px_90px_110px_110px_110px_120px]">
                        <div>Tag</div>
                        <div>Code</div>
                        <div>Order</div>
                        <div>Offset</div>
                        <div>Start</div>
                        <div>Ende</div>
                        <div>Open</div>
                        <div>Aktiv</div>
                        <div>Ruf</div>
                        <div>Voll</div>
                        <div>Aktion</div>
                      </div>

                      {selectedTemplate.items.map((item) => (
                        <div
                          key={item.id}
                          className="admin-table-row grid min-w-[1330px] grid-cols-[120px_90px_90px_90px_110px_110px_90px_110px_110px_110px_120px] items-center"
                        >
                          <Input
                            className="admin-input"
                            value={item.weekday}
                            onChange={(e) => updateTemplateItemLocal(item.id, "weekday", e.target.value)}
                          />
                          <Input
                            className="admin-input"
                            value={item.slot_code}
                            onChange={(e) => updateTemplateItemLocal(item.id, "slot_code", e.target.value)}
                          />
                          <Input
                            className="admin-input"
                            type="number"
                            value={item.slot_order}
                            onChange={(e) =>
                              updateTemplateItemLocal(item.id, "slot_order", Number(e.target.value) || 0)
                            }
                          />
                          <Input
                            className="admin-input"
                            type="number"
                            value={item.day_offset}
                            onChange={(e) =>
                              updateTemplateItemLocal(item.id, "day_offset", Number(e.target.value) || 0)
                            }
                          />
                          <Input
                            className="admin-input"
                            type="time"
                            value={item.start_time ?? ""}
                            onChange={(e) => updateTemplateItemLocal(item.id, "start_time", e.target.value)}
                          />
                          <Input
                            className="admin-input"
                            type="time"
                            value={item.end_time ?? ""}
                            onChange={(e) =>
                              updateTemplateItemLocal(item.id, "end_time", e.target.value || null)
                            }
                          />
                          <div className="flex justify-center">
                            <Switch
                              checked={item.open_end}
                              onCheckedChange={(checked) =>
                                updateTemplateItemLocal(item.id, "open_end", checked)
                              }
                            />
                          </div>
                          <Input
                            className="admin-input"
                            type="number"
                            min={0}
                            value={item.required_active_count ?? ""}
                            onChange={(e) =>
                              updateTemplateItemLocal(
                                item.id,
                                "required_active_count",
                                e.target.value === "" ? null : Number(e.target.value)
                              )
                            }
                            placeholder={String(selectedTemplate.default_active_count)}
                          />
                          <Input
                            className="admin-input"
                            type="number"
                            min={0}
                            value={item.required_ruf_count ?? ""}
                            onChange={(e) =>
                              updateTemplateItemLocal(
                                item.id,
                                "required_ruf_count",
                                e.target.value === "" ? null : Number(e.target.value)
                              )
                            }
                            placeholder={String(selectedTemplate.default_ruf_count)}
                          />
                          <div className="flex justify-center">
                            <Switch
                              checked={item.full_attendance}
                              onCheckedChange={(checked) =>
                                updateTemplateItemLocal(item.id, "full_attendance", checked)
                              }
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button
                              className="admin-btn"
                              variant="outline"
                              disabled={savingTemplateItemId === item.id}
                              onClick={() => void saveTemplateItem(item)}
                            >
                              {savingTemplateItemId === item.id ? "..." : "Speichern"}
                            </Button>
                            <Button
                              className="admin-btn"
                              variant="outline"
                              disabled={deletingTemplateItemId === item.id}
                              onClick={() => void deleteTemplateItem(item.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
                  Bitte links ein Template auswählen oder neu anlegen.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </AdminShell>
  );
}
