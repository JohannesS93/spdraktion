"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { RefreshCw } from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type Person = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  group?: string | null;
};

type Slot = {
  id: string;
  date: string;
  slot_code: string;
  weekday: string;
  start_time?: string | null;
  end_time?: string | null;
  open_end?: boolean;
  base_group?: string | null;
};

type ExchangeRequest = {
  exchange_id: string;
  status: string;
  created_at?: string | null;
  slot: Slot;
  from_user: Person;
  alternatives?: Slot[];
  match?: ExchangeMatchSummary | null;
};

type ExchangeMatchSummary = {
  id: string;
  request_a_id: string;
  request_b_id: string;
  status: string;
  a_confirmed_at?: string | null;
  b_confirmed_at?: string | null;
  confirmed_at?: string | null;
};

type ExchangeMatch = {
  id: string;
  status: string;
  a_confirmed_at?: string | null;
  b_confirmed_at?: string | null;
  confirmed_at?: string | null;
  request_a: ExchangeRequest;
  request_b: ExchangeRequest;
};

type ExchangeContext = {
  actor: SessionUser;
  principal: Person;
  my_slots: Slot[];
  available_slots: Slot[];
  requests: ExchangeRequest[];
};

export default function ExchangesPage() {
  const router = useRouter();

  const [session, setSession] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [context, setContext] = useState<ExchangeContext | null>(null);
  const [matches, setMatches] = useState<ExchangeRequest[]>([]);
  const [statusMatches, setStatusMatches] = useState<ExchangeMatch[]>([]);
  const [offeredSlotId, setOfferedSlotId] = useState("");
  const [alternativeSlotIds, setAlternativeSlotIds] = useState<string[]>([]);
  const [createdExchangeId, setCreatedExchangeId] = useState<string | null>(null);
  const [offerWeek, setOfferWeek] = useState("");
  const [alternativeWeek, setAlternativeWeek] = useState("");
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [editingExchangeId, setEditingExchangeId] = useState<string | null>(null);

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

  async function authHeaders() {
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

  async function loadAll() {
    setLoading(true);
    setError("");

    try {
      const headers = await authHeaders();
      const [contextRes, overviewRes] = await Promise.all([
        fetch(`${API_BASE}/exchange-requests/context`, { headers }),
        fetch(`${API_BASE}/exchange-requests/overview`, { headers }),
      ]);

      const contextText = await contextRes.text();
      const overviewText = await overviewRes.text();

      if (!contextRes.ok) throw new Error(contextText || "Tauschdaten konnten nicht geladen werden");
      if (!overviewRes.ok) throw new Error(overviewText || "Tauschstatus konnte nicht geladen werden");

      const contextData = JSON.parse(contextText) as ExchangeContext;
      const overviewData = JSON.parse(overviewText) as { matches: ExchangeMatch[] };
      const normalizedContext = await withDirectSlots(contextData, headers);

      setContext(normalizedContext);
      setStatusMatches(overviewData.matches ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  async function withDirectSlots(
    contextData: ExchangeContext,
    headers: Record<string, string>
  ) {
    const principalId = contextData.principal?.id || session?.id;
    if (!principalId) return contextData;

    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + 120);
    const fromDate = toDateParam(from);
    const toDate = toDateParam(to);

    const [mySlotsRes, allSlotsRes] = await Promise.all([
      fetch(`${API_BASE}/me/slots?user_id=${principalId}&from=${fromDate}&to=${toDate}`, {
        headers,
      }),
      fetch(`${API_BASE}/slots?from=${fromDate}&to=${toDate}`, { headers }),
    ]);

    if (!mySlotsRes.ok || !allSlotsRes.ok) {
      return contextData;
    }

    const mySlots = (await mySlotsRes.json()) as Slot[];
    const allSlots = (await allSlotsRes.json()) as Slot[];
    const mySlotIds = new Set(mySlots.map((slot) => slot.id));

    return {
      ...contextData,
      my_slots: mySlots,
      available_slots: allSlots.filter((slot) => !mySlotIds.has(slot.id)),
    };
  }

  useEffect(() => {
    if (!authReady || !session) return;
    loadAll();
  }, [authReady, session]);

  const offeredSlot = useMemo(
    () => context?.my_slots.find((slot) => slot.id === offeredSlotId) ?? null,
    [context?.my_slots, offeredSlotId]
  );

  const mySlots = context?.my_slots ?? [];
  const availableSlots = context?.available_slots ?? [];

  const offerWeeks = useMemo(
    () => collectWeeks(mySlots),
    [mySlots]
  );

  const alternativeWeeks = useMemo(
    () => collectWeeks(availableSlots),
    [availableSlots]
  );

  const activeOfferWeek = offerWeeks.some((week) => week.key === offerWeek)
    ? offerWeek
    : "";

  const activeAlternativeWeek = alternativeWeeks.some(
    (week) => week.key === alternativeWeek
  )
    ? alternativeWeek
    : "";

  const filteredOfferSlots = useMemo(
    () =>
      activeOfferWeek
        ? mySlots.filter((slot) => weekKey(slot) === activeOfferWeek)
        : mySlots,
    [mySlots, activeOfferWeek]
  );

  const filteredAlternatives = useMemo(
    () =>
      activeAlternativeWeek
        ? availableSlots.filter(
            (slot) => weekKey(slot) === activeAlternativeWeek
          )
        : availableSlots,
    [availableSlots, activeAlternativeWeek]
  );

  const visibleOfferSlots =
    filteredOfferSlots.length > 0 || mySlots.length === 0 ? filteredOfferSlots : mySlots;
  const visibleAlternativeSlots =
    filteredAlternatives.length > 0 || availableSlots.length === 0
      ? filteredAlternatives
      : availableSlots;

  function toggleAlternative(slotId: string) {
    setAlternativeSlotIds((prev) =>
      prev.includes(slotId)
        ? prev.filter((id) => id !== slotId)
        : [...prev, slotId]
    );
    setCreatedExchangeId(null);
    setMatches([]);
  }

  function resetDraft() {
    setOfferedSlotId("");
    setAlternativeSlotIds([]);
    setMatches([]);
    setCreatedExchangeId(null);
    setPendingSubmit(false);
    setEditingExchangeId(null);
  }

  async function findMatches() {
    if (!offeredSlotId || alternativeSlotIds.length === 0) {
      setError("Bitte zuerst angebotenen Dienst und mindestens eine Alternative auswählen.");
      return null;
    }

    setActionLoading(true);
    setError("");

    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/exchange-requests/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          offered_slot_id: offeredSlotId,
          alternative_slot_ids: alternativeSlotIds,
        }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || "Suche fehlgeschlagen");

      const data = JSON.parse(text) as { matches: ExchangeRequest[] };
      setMatches(data.matches ?? []);
      return data.matches ?? [];
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Suche fehlgeschlagen");
      return null;
    } finally {
      setActionLoading(false);
    }
  }

  async function cancelOwnExchangeRequest(exchangeId: string, reason: string) {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE}/exchanges/${exchangeId}/cancel`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        actor_user_id: context?.principal.id,
        reason,
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || "Tauschwunsch konnte nicht gelöscht werden");
  }

  async function createRequest({
    resetAfterCreate = false,
    replaceExchangeId,
  }: {
    resetAfterCreate?: boolean;
    replaceExchangeId?: string | null;
  } = {}) {
    if (!offeredSlotId || alternativeSlotIds.length === 0) {
      setError("Bitte zuerst angebotenen Dienst und mindestens eine Alternative auswählen.");
      return null;
    }

    setActionLoading(true);
    setError("");

    try {
      if (replaceExchangeId) {
        await cancelOwnExchangeRequest(replaceExchangeId, "Im Backend bearbeitet");
      }

      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/exchange-requests`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          offered_slot_id: offeredSlotId,
          alternative_slot_ids: alternativeSlotIds,
        }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || "Tauschwunsch konnte nicht eingestellt werden");

      const data = JSON.parse(text) as { exchange_id: string; matches: ExchangeRequest[] };
      setCreatedExchangeId(data.exchange_id);
      setMatches(data.matches ?? []);
      await loadAll();
      if (resetAfterCreate) resetDraft();
      return data.exchange_id;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Tauschwunsch konnte nicht eingestellt werden");
      return null;
    } finally {
      setActionLoading(false);
    }
  }

  async function submitExchangeRequest() {
    if (editingExchangeId) {
      await createRequest({
        resetAfterCreate: true,
        replaceExchangeId: editingExchangeId,
      });
      return;
    }

    const foundMatches = await findMatches();
    if (foundMatches === null) return;

    if (foundMatches.length > 0) {
      setPendingSubmit(true);
      return;
    }

    await createRequest({ resetAfterCreate: true });
  }

  async function createAnyway() {
    await createRequest({
      resetAfterCreate: true,
      replaceExchangeId: editingExchangeId,
    });
  }

  async function continueWithMatch(otherExchangeId: string) {
    let ownExchangeId = createdExchangeId;
    if (!ownExchangeId) {
      ownExchangeId = await createRequest();
      if (!ownExchangeId) return;
    }

    setActionLoading(true);
    setError("");

    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/exchange-requests/${ownExchangeId}/match`, {
        method: "POST",
        headers,
        body: JSON.stringify({ other_exchange_id: otherExchangeId }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || "Match konnte nicht fortgesetzt werden");

      resetDraft();
      await loadAll();
    } catch (matchError) {
      setError(matchError instanceof Error ? matchError.message : "Match konnte nicht fortgesetzt werden");
    } finally {
      setActionLoading(false);
    }
  }

  async function confirmMatch(matchId: string) {
    setActionLoading(true);
    setError("");

    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/exchange-matches/${matchId}/confirm`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || "Bestätigung fehlgeschlagen");
      await loadAll();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Bestätigung fehlgeschlagen");
    } finally {
      setActionLoading(false);
    }
  }

  async function deleteRequest(exchangeId: string) {
    if (!window.confirm("Diesen Tauschwunsch wirklich löschen?")) return;

    setActionLoading(true);
    setError("");

    try {
      await cancelOwnExchangeRequest(exchangeId, "Im Backend gelöscht");
      if (editingExchangeId === exchangeId) resetDraft();
      await loadAll();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Löschen fehlgeschlagen");
    } finally {
      setActionLoading(false);
    }
  }

  function editRequest(request: ExchangeRequest) {
    setOfferedSlotId(request.slot.id);
    setAlternativeSlotIds((request.alternatives ?? []).map((slot) => slot.id));
    setMatches([]);
    setCreatedExchangeId(null);
    setPendingSubmit(false);
    setEditingExchangeId(request.exchange_id);
    setOfferWeek(weekKey(request.slot));
    const firstAlternativeWeek = request.alternatives?.[0] ? weekKey(request.alternatives[0]) : "";
    setAlternativeWeek(firstAlternativeWeek);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!authReady) {
    return <div className="p-6">Lade…</div>;
  }

  if (!session) return null;

  return (
    <AdminShell
      session={session}
      title="Tausch"
      subtitle="Präsenzdienste tauschen"
      actions={
        <Button className="admin-btn" variant="outline" onClick={loadAll} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Aktualisieren
        </Button>
      }
    >
      {error ? <div className="admin-error">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="admin-card">
          <CardHeader className="admin-card-header">
            <CardTitle>Tausch einstellen oder suchen</CardTitle>
          </CardHeader>
          <CardContent className="admin-section space-y-6">
            <div>
              <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="text-sm font-semibold">1. Ich biete an</div>
                <WeekPicker
                  value={activeOfferWeek}
                  weeks={offerWeeks}
                  onChange={(week) => {
                    setOfferWeek(week);
                    setOfferedSlotId("");
                    setMatches([]);
                    setPendingSubmit(false);
                  }}
                />
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {visibleOfferSlots.map((slot) => (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => {
                      setOfferedSlotId(slot.id);
                      setCreatedExchangeId(null);
                      setMatches([]);
                      setPendingSubmit(false);
                    }}
                    className={[
                      "rounded border p-3 text-left text-sm transition",
                      offeredSlotId === slot.id
                        ? "border-[#E3000F] bg-red-50"
                        : "border-slate-200 bg-white hover:border-slate-300",
                    ].join(" ")}
                  >
                    <SlotLine slot={slot} />
                  </button>
                ))}
              </div>
              {!loading && (context?.my_slots ?? []).length === 0 ? (
                <p className="text-sm text-slate-500">Keine eigenen Dienste gefunden.</p>
              ) : null}
              {!loading && mySlots.length > 0 && filteredOfferSlots.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Keine eigenen Dienste in dieser Woche. Deshalb werden alle geladenen Dienste angezeigt.
                </p>
              ) : null}
            </div>

            <div>
              <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="text-sm font-semibold">2. Ich kann übernehmen</div>
                <WeekPicker
                  value={activeAlternativeWeek}
                  weeks={alternativeWeeks}
                  onChange={(week) => setAlternativeWeek(week)}
                />
              </div>
              <div className="grid max-h-[420px] gap-2 overflow-auto pr-1 md:grid-cols-2">
                {visibleAlternativeSlots.map((slot) => {
                  const selected = alternativeSlotIds.includes(slot.id);
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => toggleAlternative(slot.id)}
                      className={[
                        "rounded border p-3 text-left text-sm transition",
                        selected
                          ? "border-[#E3000F] bg-red-50"
                          : "border-slate-200 bg-white hover:border-slate-300",
                      ].join(" ")}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={[
                            "mt-0.5 h-4 w-4 shrink-0 rounded border",
                            selected ? "border-[#E3000F] bg-[#E3000F]" : "border-slate-300",
                          ].join(" ")}
                        />
                        <SlotLine slot={slot} />
                      </div>
                    </button>
                  );
                })}
              </div>
              {!loading && availableSlots.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">Keine übernehmbaren Dienste gefunden.</p>
              ) : null}
              {!loading && availableSlots.length > 0 && filteredAlternatives.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">
                  Keine übernehmbaren Dienste in dieser Woche. Deshalb werden alle geladenen Dienste angezeigt.
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button className="admin-btn-primary" onClick={submitExchangeRequest} disabled={actionLoading}>
                {editingExchangeId ? "Änderungen speichern" : "Einstellen"}
              </Button>
              <Button className="admin-btn" variant="outline" onClick={resetDraft}>
                {editingExchangeId ? "Bearbeitung abbrechen" : "Zurücksetzen"}
              </Button>
            </div>
            {editingExchangeId ? (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Du bearbeitest gerade einen bestehenden Tauschwunsch. Beim Speichern wird der alte Wunsch ersetzt.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="admin-card">
          <CardHeader className="admin-card-header">
            <CardTitle>Passende Treffer</CardTitle>
          </CardHeader>
          <CardContent className="admin-section space-y-3">
            {offeredSlot ? (
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="text-xs font-semibold uppercase text-slate-500">Dein Angebot</div>
                <SlotLine slot={offeredSlot} />
              </div>
            ) : null}

            {matches.length === 0 ? (
              <p className="text-sm text-slate-500">
                Beim Einstellen wird automatisch zuerst nach passenden Tauschwünschen gesucht.
              </p>
            ) : (
              <>
                {pendingSubmit ? (
                  <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    Es gibt bereits passende Tauschwünsche. Du kannst einen Tausch annehmen oder deinen Wunsch trotzdem neu einstellen.
                  </div>
                ) : null}

                {matches.map((match) => (
                  <div key={match.exchange_id} className="rounded border border-slate-200 bg-white p-3">
                    <div className="mb-2 text-xs font-semibold uppercase text-slate-500">
                      Passt mit {formatPerson(match.from_user)}
                    </div>
                    <SlotLine slot={match.slot} />
                    <Button
                      className="admin-btn-primary mt-3"
                      onClick={() => continueWithMatch(match.exchange_id)}
                      disabled={actionLoading}
                    >
                      Tausch annehmen
                    </Button>
                  </div>
                ))}

                {pendingSubmit ? (
                  <Button className="admin-btn mt-1" variant="outline" onClick={createAnyway} disabled={actionLoading}>
                    Neu einstellen
                  </Button>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="admin-card">
          <CardHeader className="admin-card-header">
            <CardTitle>Meine offenen Tauschwünsche</CardTitle>
          </CardHeader>
          <CardContent className="admin-section space-y-3">
            {(context?.requests ?? []).filter((request) => request.status !== "CONFIRMED").length === 0 ? (
              <p className="text-sm text-slate-500">Keine offenen Tauschwünsche.</p>
            ) : (
              (context?.requests ?? [])
                .filter((request) => request.status !== "CONFIRMED")
                .map((request) => (
                  <RequestCard
                    key={request.exchange_id}
                    request={request}
                    onEdit={() => editRequest(request)}
                    onDelete={() => deleteRequest(request.exchange_id)}
                    busy={actionLoading}
                  />
                ))
            )}
          </CardContent>
        </Card>

        <Card className="admin-card">
          <CardHeader className="admin-card-header">
            <CardTitle>Laufende und abgeschlossene Tausche</CardTitle>
          </CardHeader>
          <CardContent className="admin-section space-y-3">
            {statusMatches.length === 0 ? (
              <p className="text-sm text-slate-500">Noch keine passenden Tausche.</p>
            ) : (
              statusMatches.map((match) => (
                <MatchCard
                  key={match.id}
                  match={match}
                  principalId={context?.principal.id ?? ""}
                  onConfirm={() => confirmMatch(match.id)}
                  busy={actionLoading}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}

function WeekPicker({
  value,
  weeks,
  onChange,
}: {
  value: string;
  weeks: { key: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="admin-input md:w-64"
    >
      <option value="">Alle Wochen</option>
      {weeks.map((week) => (
        <option key={week.key} value={week.key}>
          {week.label}
        </option>
      ))}
    </select>
  );
}

function SlotLine({ slot }: { slot: Slot }) {
  const time = slot.open_end
    ? `${slot.start_time ?? ""} bis Ende`
    : `${slot.start_time ?? ""}${slot.end_time ? ` bis ${slot.end_time}` : ""}`;

  return (
    <div>
      <div className="font-medium text-slate-900">
        {slot.weekday}, {slot.date} · {slot.slot_code}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        {time}
      </div>
    </div>
  );
}

function RequestCard({
  request,
  onEdit,
  onDelete,
  busy,
}: {
  request: ExchangeRequest;
  onEdit: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <StatusBadge status={request.status} />
        <span className="text-xs text-slate-500">{request.alternatives?.length ?? 0} Alternativen</span>
      </div>
      <SlotLine slot={request.slot} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button className="admin-btn" variant="outline" onClick={onEdit} disabled={busy}>
          Bearbeiten
        </Button>
        <Button className="admin-btn" variant="outline" onClick={onDelete} disabled={busy}>
          Löschen
        </Button>
      </div>
    </div>
  );
}

function MatchCard({
  match,
  principalId,
  onConfirm,
  busy,
}: {
  match: ExchangeMatch;
  principalId: string;
  onConfirm: () => void;
  busy: boolean;
}) {
  const isA = match.request_a.from_user.id === principalId;
  const ownConfirmed = isA ? match.a_confirmed_at : match.b_confirmed_at;
  const canConfirm = match.status === "PENDING_CONFIRMATION" && !ownConfirmed;

  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <StatusBadge status={match.status} />
        {canConfirm ? (
          <Button className="admin-btn-primary" onClick={onConfirm} disabled={busy}>
            Bestätigen
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
            {formatPerson(match.request_a.from_user)} gibt ab
          </div>
          <SlotLine slot={match.request_a.slot} />
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
            {formatPerson(match.request_b.from_user)} gibt ab
          </div>
          <SlotLine slot={match.request_b.slot} />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label =
    status === "OPEN"
      ? "Offen"
      : status === "PENDING_CONFIRMATION"
        ? "Wartet"
        : status === "CONFIRMED"
          ? "Bestätigt"
          : status === "CANCELLED"
            ? "Abgebrochen"
            : status;

  const classes =
    status === "CONFIRMED"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : status === "PENDING_CONFIRMATION"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : status === "CANCELLED"
          ? "border-red-300 bg-red-50 text-red-800"
          : "border-slate-300 bg-slate-50 text-slate-700";

  return (
    <span className={`rounded border px-2 py-1 text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}

function formatPerson(person: Person) {
  const name = `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim();
  return name || "Unbekannt";
}

function weekKey(slot?: Slot) {
  if (!slot?.date) return "";

  const date = new Date(`${slot.date}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";

  const day = date.getDay() || 7;
  date.setDate(date.getDate() + 4 - day);

  const year = date.getFullYear();
  const yearStart = new Date(year, 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  return `${year}-W${week.toString().padStart(2, "0")}`;
}

function collectWeeks(slots: Slot[]) {
  const byWeek = new Map<string, string>();

  for (const slot of [...slots].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = weekKey(slot);
    if (!key || byWeek.has(key)) continue;
    byWeek.set(key, slot.date);
  }

  return Array.from(byWeek.entries()).map(([key, firstDate]) => ({
    key,
    label: `${key} · ab ${firstDate}`,
  }));
}

function toDateParam(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
