"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Users,
} from "lucide-react";

import { AdminShell } from "@/components/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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

type SlotWeekSummary = {
  week_start: string;
  week_end: string;
  slot_count: number;
  day_count: number;
  active_assignment_count: number;
  ruf_assignment_count: number;
};

type WeekSlot = {
  template_item_id?: string | null;
  slot_date: string;
  weekday: string;
  slot_code: string;
  slot_order: number;
  start_time: string;
  end_time?: string | null;
  open_end: boolean;
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
  full_attendance?: boolean;
};

type SlotTemplate = {
  id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  default_active_count?: number;
  default_ruf_count?: number;
  item_count: number;
  items: SlotTemplateItem[];
};

type PlannerUser = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
  is_mdb: boolean;
  is_active: boolean;
  is_planner_exempt: boolean;
};

type PlannerRule = {
  id: string;
  user_id: string;
  template_item_id: string;
  rule_type: "blocked";
  template_name: string;
  weekday: string;
  slot_code: string;
  slot_order: number;
  start_time?: string | null;
  end_time?: string | null;
  open_end: boolean;
};

type PlannerRulesResponse = {
  user_id: string;
  is_planner_exempt: boolean;
  rules: PlannerRule[];
  retroactive_cleanup?: RetroactiveCleanupSummary;
};

type RetroactiveCleanupSummary = {
  removed_assignment_count: number;
  affected_week_count: number;
  affected_weeks: string[];
};

type PlannerUserUpdateResponse = {
  id: string;
  is_planner_exempt: boolean;
  retroactive_cleanup?: RetroactiveCleanupSummary;
};

type PendingRetroactivePlannerChange =
  | {
      type: "exempt";
      checked: boolean;
      userLabel: string;
    }
  | {
      type: "blocked";
      templateItemId: string;
      slotLabel: string;
      userLabel: string;
    };

type WeekPreviewResponse = {
  template_id?: string | null;
  template_name?: string | null;
  week_start: string;
  week_end: string;
  slots: WeekSlot[];
};

type PlannerRunSummary = {
  id: string;
  week_start: string;
  week_end: string;
  status: string;
  template_id?: string | null;
  template_name?: string | null;
  random_seed: number;
  created_at?: string | null;
  applied_at?: string | null;
  summary?: {
    slot_count?: number;
    assignment_count?: number;
    people_with_assignments?: number;
    late_assignment_count?: number;
    friday_last_assignment_count?: number;
    unfilled_positions?: number;
  };
};

type PlannerWarning = {
  slot_id: string;
  warning_code: string;
  message: string;
};

type PlannerPersonSummary = {
  user_id: string;
  name: string;
  email: string;
  is_exempt: boolean;
  blocked_rules_count: number;
  blocked_wednesday_count: number;
  week_total_slots: number;
  week_active_slots: number;
  week_ruf_slots: number;
  week_late_slots: number;
  week_friday_last_slots: number;
  history_total_slots: number;
  history_active_slots: number;
  history_ruf_slots: number;
  history_late_slots: number;
  history_friday_last_slots: number;
  planned_weeks: number;
};

type PlannerPersonDetail = PlannerPersonSummary & {
  assignedSlots: Array<{
    slot_id: string;
    slot_date: string;
    weekday: string;
    slot_code: string;
    time_label: string;
    assignment_type: "active" | "ruf";
    reason_codes: string[];
    is_manual_fixed: boolean;
  }>;
};

type PlannerSlotAssignment = {
  user_id: string;
  name: string;
  email: string;
  assignment_type: "active" | "ruf";
  score: number;
  reason_codes: string[];
  score_details: Record<string, string | number | boolean>;
  is_manual_fixed: boolean;
  history_total_slots: number;
  history_late_slots: number;
  history_friday_last_slots: number;
};

type PlannerSlotSummary = {
  slot_id: string;
  slot_date: string;
  weekday: string;
  slot_code: string;
  slot_order: number;
  start_time: string;
  end_time?: string | null;
  open_end: boolean;
  required_active_count: number;
  required_ruf_count: number;
  full_attendance?: boolean;
  is_late_slot: boolean;
  is_last_slot_of_day: boolean;
  is_friday_last_slot: boolean;
  assignments: PlannerSlotAssignment[];
};

type PlannerRunDetail = {
  run: PlannerRunSummary;
  summary: {
    slot_count: number;
    assignment_count: number;
    people_with_assignments: number;
    late_assignment_count: number;
    friday_last_assignment_count: number;
    unfilled_positions: number;
  };
  people: PlannerPersonSummary[];
  slots: PlannerSlotSummary[];
  warnings: PlannerWarning[];
};

function canManagePlanner(role?: string | null) {
  return role === "admin" || role === "pgf";
}

function slotTimeLabel(start?: string | null, end?: string | null, openEnd?: boolean) {
  const startLabel = (start ?? "").slice(0, 5);
  if (openEnd || !end) return `${startLabel} – offen`;
  return `${startLabel} – ${end.slice(0, 5)}`;
}

function plannerUserLabel(user: PlannerUser) {
  return `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email;
}

function templateItemLabel(item: SlotTemplateItem) {
  return `${item.weekday} · ${item.slot_code} · ${slotTimeLabel(item.start_time, item.end_time, item.open_end)}`;
}

function formatDateLabel(value?: string | null) {
  if (!value) return "—";
  const dateValue = new Date(`${value}T00:00:00`);
  if (Number.isNaN(dateValue.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(dateValue);
}

function formatDateTimeLabel(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function runStatusLabel(status?: string | null) {
  if (status === "applied") return "Übernommen";
  if (status === "ready") return "Vorschlag bereit";
  if (status === "draft") return "Entwurf";
  return status ?? "—";
}

function assignmentLabel(value?: string | null) {
  return value === "ruf" ? "Ruf" : "Aktiv";
}

function reasonLabel(value?: string | null) {
  switch (value) {
    case "history_total":
      return "Historie gesamt";
    case "history_late":
      return "Historie späte Slots";
    case "history_friday_last":
      return "Historie Freitag letzter Slot";
    case "week_total":
      return "Woche gesamt";
    case "week_active":
      return "Woche Aktiv";
    case "week_ruf":
      return "Woche Ruf";
    case "week_late":
      return "Woche späte Slots";
    case "week_friday_last":
      return "Woche Freitag letzter Slot";
    case "role_balance":
      return "Rollenausgleich";
    case "wednesday_compensation":
      return "Mittwochsausgleich";
    case "manual_fixed":
      return "Manuell fixiert";
    case "full_attendance":
      return "Vollanwesenheit";
    default:
      return value?.replaceAll("_", " ") ?? "—";
  }
}

function retroactiveCleanupMessage(
  cleanup: RetroactiveCleanupSummary | undefined,
  fallback: string
) {
  if (!cleanup) return fallback;
  if (cleanup.removed_assignment_count === 0) {
    return `${fallback} Es mussten keine bestehenden Einsätze entfernt werden.`;
  }

  const weekLabel = cleanup.affected_week_count === 1 ? "Woche" : "Wochen";
  return `${fallback} ${cleanup.removed_assignment_count} bestehende Zuweisungen in ${cleanup.affected_week_count} ${weekLabel} wurden entfernt, ohne neu zu verteilen.`;
}

export default function PlannerPage() {
  const router = useRouter();

  const [session, setSessionState] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [slotWeeks, setSlotWeeks] = useState<SlotWeekSummary[]>([]);
  const [weeksLoading, setWeeksLoading] = useState(false);
  const [selectedWeekStart, setSelectedWeekStart] = useState("");
  const [weekSearch, setWeekSearch] = useState("");
  const [weekFilter, setWeekFilter] = useState<"current" | "all" | "empty">("current");

  const [slotTemplates, setSlotTemplates] = useState<SlotTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  const [plannerUsers, setPlannerUsers] = useState<PlannerUser[]>([]);
  const [plannerUsersLoading, setPlannerUsersLoading] = useState(false);
  const [plannerUserSearch, setPlannerUserSearch] = useState("");
  const [selectedPlannerUserId, setSelectedPlannerUserId] = useState("");
  const [plannerRules, setPlannerRules] = useState<PlannerRule[]>([]);
  const [plannerRulesLoading, setPlannerRulesLoading] = useState(false);
  const [plannerExempt, setPlannerExempt] = useState(false);
  const [togglingPlannerExempt, setTogglingPlannerExempt] = useState(false);
  const [plannerRuleTemplateItemId, setPlannerRuleTemplateItemId] = useState("");
  const [addingPlannerRule, setAddingPlannerRule] = useState(false);
  const [deletingPlannerRuleId, setDeletingPlannerRuleId] = useState<string | null>(null);

  const [plannerRuns, setPlannerRuns] = useState<PlannerRunSummary[]>([]);
  const [plannerRunsLoading, setPlannerRunsLoading] = useState(false);
  const [selectedPlannerRunId, setSelectedPlannerRunId] = useState("");
  const [plannerRunDetail, setPlannerRunDetail] = useState<PlannerRunDetail | null>(null);
  const [plannerRunDetailLoading, setPlannerRunDetailLoading] = useState(false);
  const [creatingPlannerRun, setCreatingPlannerRun] = useState(false);
  const [applyingPlannerRun, setApplyingPlannerRun] = useState(false);
  const [selectedPersonDetailId, setSelectedPersonDetailId] = useState<string | null>(null);
  const [plannerWorkspaceMode, setPlannerWorkspaceMode] = useState<"planning" | "rules">(
    "planning"
  );
  const [planningStepMode, setPlanningStepMode] = useState<"create" | "assign">("assign");
  const [pendingRetroactiveChange, setPendingRetroactiveChange] =
    useState<PendingRetroactivePlannerChange | null>(null);

  const [weekDialogOpen, setWeekDialogOpen] = useState(false);
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [weekSlots, setWeekSlots] = useState<WeekSlot[]>([]);
  const [weekTemplateName, setWeekTemplateName] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [creatingWeek, setCreatingWeek] = useState(false);

  const selectedTemplate = useMemo(
    () => slotTemplates.find((template) => template.id === selectedTemplateId) ?? null,
    [slotTemplates, selectedTemplateId]
  );

  const selectedPlannerUser = useMemo(
    () => plannerUsers.find((user) => user.id === selectedPlannerUserId) ?? null,
    [plannerUsers, selectedPlannerUserId]
  );

  const visiblePlannerUsers = useMemo(() => {
    const search = plannerUserSearch.trim().toLowerCase();
    if (!search) return plannerUsers;
    return plannerUsers.filter((user) =>
      `${plannerUserLabel(user)} ${user.email}`.toLowerCase().includes(search)
    );
  }, [plannerUserSearch, plannerUsers]);

  const availableRuleItems = useMemo(() => {
    if (!selectedTemplate) return [];
    const blockedIds = new Set(plannerRules.map((rule) => rule.template_item_id));
    return selectedTemplate.items.filter((item) => !blockedIds.has(item.id));
  }, [plannerRules, selectedTemplate]);

  const selectedWeek = useMemo(
    () => slotWeeks.find((week) => week.week_start === selectedWeekStart) ?? null,
    [slotWeeks, selectedWeekStart]
  );

  const visibleSlotWeeks = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const search = weekSearch.trim().toLowerCase();

    return slotWeeks.filter((week) => {
      const weekEndDate = new Date(`${week.week_end}T00:00:00`);
      const isCurrentOrUpcoming = Number.isNaN(weekEndDate.getTime()) ? true : weekEndDate >= today;
      const isSelected = week.week_start === selectedWeekStart;
      const assignmentCount =
        (week.active_assignment_count ?? 0) + (week.ruf_assignment_count ?? 0);
      const isEmptyWeek = assignmentCount === 0;

      const passesRange =
        weekFilter === "all"
          ? true
          : weekFilter === "empty"
            ? isEmptyWeek
            : isCurrentOrUpcoming;

      if (!passesRange && !isSelected) return false;

      if (!search) return true;

      const searchText = [
        formatDateLabel(week.week_start),
        formatDateLabel(week.week_end),
        week.week_start,
        week.week_end,
      ]
        .join(" ")
        .toLowerCase();

      return searchText.includes(search);
    });
  }, [weekFilter, slotWeeks, selectedWeekStart, weekSearch]);

  const assignedPeople = useMemo(
    () =>
      [...(plannerRunDetail?.people ?? [])]
        .filter((person) => person.week_total_slots > 0)
        .sort((left, right) => {
          if (right.week_total_slots !== left.week_total_slots) {
            return right.week_total_slots - left.week_total_slots;
          }
          return left.name.localeCompare(right.name, "de");
        }),
    [plannerRunDetail]
  );
  const unassignedPeople = useMemo(
    () =>
      [...(plannerRunDetail?.people ?? [])]
        .filter((person) => person.week_total_slots === 0 && !person.is_exempt)
        .sort((left, right) => left.name.localeCompare(right.name, "de")),
    [plannerRunDetail]
  );

  const personDetailsById = useMemo(() => {
    const detailMap = new Map<string, PlannerPersonDetail>();
    for (const person of plannerRunDetail?.people ?? []) {
      detailMap.set(person.user_id, { ...person, assignedSlots: [] });
    }

    for (const slot of plannerRunDetail?.slots ?? []) {
      for (const assignment of slot.assignments) {
        const person = detailMap.get(assignment.user_id);
        if (!person) continue;
        person.assignedSlots.push({
          slot_id: slot.slot_id,
          slot_date: slot.slot_date,
          weekday: slot.weekday,
          slot_code: slot.slot_code,
          time_label: slotTimeLabel(slot.start_time, slot.end_time, slot.open_end),
          assignment_type: assignment.assignment_type,
          reason_codes: assignment.reason_codes,
          is_manual_fixed: assignment.is_manual_fixed,
        });
      }
    }

    for (const person of detailMap.values()) {
      person.assignedSlots.sort((left, right) => {
        if (left.slot_date !== right.slot_date) return left.slot_date.localeCompare(right.slot_date);
        return left.slot_code.localeCompare(right.slot_code);
      });
    }

    return detailMap;
  }, [plannerRunDetail]);

  const selectedPersonDetail = selectedPersonDetailId
    ? personDetailsById.get(selectedPersonDetailId) ?? null
    : null;

  const totalPlannerRules = plannerRules.length;
  const exemptCount = plannerUsers.filter((user) => user.is_planner_exempt).length;
  const defaultTemplate = slotTemplates.find((template) => template.is_default) ?? null;
  const hasPlannerRun = Boolean(plannerRunDetail?.run.id);
  const plannerWarningsCount = plannerRunDetail?.warnings.length ?? 0;
  const plannerNextStepLabel = !selectedWeekStart
    ? "Zuerst links eine Sitzungswoche auswählen."
    : !plannerRunDetail
      ? "Danach den Wochenvorschlag berechnen."
      : plannerRunDetail.run.status === "applied"
        ? "Der Vorschlag ist bereits übernommen. Änderungen laufen jetzt über Slots."
        : "Verteilung prüfen und anschließend in Slots übernehmen.";

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      const localSession = getSession();

      if (!firebaseUser || !localSession || !canManagePlanner(localSession.role)) {
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
    void refreshPlannerPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, session]);

  useEffect(() => {
    if (!selectedPlannerUserId) {
      setPlannerRules([]);
      setPlannerExempt(false);
      return;
    }
    void loadPlannerRules(selectedPlannerUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlannerUserId]);

  useEffect(() => {
    if (!selectedWeekStart) {
      setPlannerRuns([]);
      setPlannerRunDetail(null);
      setSelectedPlannerRunId("");
      return;
    }
    void loadPlannerRuns(selectedWeekStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeekStart]);

  useEffect(() => {
    if (!availableRuleItems.length) {
      setPlannerRuleTemplateItemId("");
      return;
    }
    if (!availableRuleItems.some((item) => item.id === plannerRuleTemplateItemId)) {
      setPlannerRuleTemplateItemId(availableRuleItems[0].id);
    }
  }, [availableRuleItems, plannerRuleTemplateItemId]);

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

  async function loadSlotWeeks() {
    setWeeksLoading(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slot-weeks`, { headers });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const weeks = JSON.parse(text) as SlotWeekSummary[];
      setSlotWeeks(weeks);
      setSelectedWeekStart((current) => {
        if (current && weeks.some((week) => week.week_start === current)) return current;
        return weeks[0]?.week_start ?? "";
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Laden der Sitzungswochen: ${message}`);
    } finally {
      setWeeksLoading(false);
    }
  }

  async function loadSlotTemplates() {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slot-templates`, { headers });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const templates = JSON.parse(text) as SlotTemplate[];
      setSlotTemplates(templates);
      setSelectedTemplateId((current) => {
        if (current && templates.some((template) => template.id === current)) return current;
        return templates.find((template) => template.is_default)?.id ?? templates[0]?.id ?? "";
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Laden der Standardslots: ${message}`);
    }
  }

  async function loadPlannerUsers() {
    setPlannerUsersLoading(true);

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/users?is_mdb=true`, { headers });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const users = (JSON.parse(text) as PlannerUser[]).filter((user) => user.is_mdb && user.is_active);
      setPlannerUsers(users);
      setSelectedPlannerUserId((current) => {
        if (current && users.some((user) => user.id === current)) return current;
        return users[0]?.id ?? "";
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Laden der Planer-Personen: ${message}`);
    } finally {
      setPlannerUsersLoading(false);
    }
  }

  async function loadPlannerRules(userId: string) {
    setPlannerRulesLoading(true);

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/users/${userId}/planner-rules`, { headers });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const data = JSON.parse(text) as PlannerRulesResponse;
      setPlannerRules(data.rules);
      setPlannerExempt(Boolean(data.is_planner_exempt));
      setPlannerUsers((prev) =>
        prev.map((user) =>
          user.id === userId ? { ...user, is_planner_exempt: Boolean(data.is_planner_exempt) } : user
        )
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Laden der Planer-Regeln: ${message}`);
    } finally {
      setPlannerRulesLoading(false);
    }
  }

  async function loadPlannerRuns(weekStartValue: string) {
    setPlannerRunsLoading(true);
    setPlannerRunDetail(null);
    setSelectedPlannerRunId("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/planner/runs?week_start=${weekStartValue}`, {
        headers,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const runs = JSON.parse(text) as PlannerRunSummary[];
      setPlannerRuns(runs);
      if (runs[0]?.id) {
        setSelectedPlannerRunId(runs[0].id);
        await loadPlannerRunDetail(runs[0].id);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Laden der Planungsläufe: ${message}`);
    } finally {
      setPlannerRunsLoading(false);
    }
  }

  async function loadPlannerRunDetail(runId: string) {
    setPlannerRunDetailLoading(true);

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/planner/runs/${runId}`, { headers });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      setPlannerRunDetail(JSON.parse(text) as PlannerRunDetail);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Laden des Planungslaufs: ${message}`);
    } finally {
      setPlannerRunDetailLoading(false);
    }
  }

  async function refreshPlannerPage() {
    await Promise.all([loadSlotWeeks(), loadSlotTemplates(), loadPlannerUsers()]);
  }

  async function previewWeek() {
    setPreviewLoading(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slot-weeks/preview`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          week_start: weekStart,
          template_id: selectedTemplateId || null,
        }),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const data = JSON.parse(text) as WeekPreviewResponse;
      setWeekStart(data.week_start);
      setWeekEnd(data.week_end);
      setWeekTemplateName(data.template_name ?? "");
      setWeekSlots(data.slots);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler bei der Wochenvorschau: ${message}`);
    } finally {
      setPreviewLoading(false);
    }
  }

  function updateWeekSlot<K extends keyof WeekSlot>(index: number, field: K, value: WeekSlot[K]) {
    setWeekSlots((prev) =>
      prev.map((slot, slotIndex) => (slotIndex === index ? { ...slot, [field]: value } : slot))
    );
  }

  function deleteWeekSlot(index: number) {
    setWeekSlots((prev) => prev.filter((_, slotIndex) => slotIndex !== index));
  }

  function addWeekSlot() {
    setWeekSlots((prev) => [
      ...prev,
      {
        template_item_id: null,
        slot_date: weekStart,
        weekday: "",
        slot_code: "",
        slot_order: prev.length + 1,
        start_time: "",
        end_time: null,
        open_end: false,
      },
    ]);
  }

  async function createWeek() {
    setCreatingWeek(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/slot-weeks/create`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          week_start: weekStart,
          week_end: weekEnd,
          template_id: selectedTemplateId || null,
          slots: weekSlots,
        }),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      setWeekDialogOpen(false);
      setWeekStart("");
      setWeekEnd("");
      setWeekSlots([]);
      setWeekTemplateName("");
      await loadSlotWeeks();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Anlegen der Woche: ${message}`);
    } finally {
      setCreatingWeek(false);
    }
  }

  async function createPlannerRun() {
    if (!selectedWeekStart) {
      setError("Bitte zuerst links eine Sitzungswoche auswählen.");
      return;
    }

    setCreatingPlannerRun(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/planner/runs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ week_start: selectedWeekStart }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const detail = JSON.parse(text) as PlannerRunDetail;
      setPlannerRunDetail(detail);
      setSelectedPlannerRunId(detail.run.id);
      await loadPlannerRuns(selectedWeekStart);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Berechnen des Wochenvorschlags: ${message}`);
    } finally {
      setCreatingPlannerRun(false);
    }
  }

  async function applyPlannerRun() {
    if (!plannerRunDetail?.run.id) {
      setError("Es liegt noch kein Planungsvorschlag vor.");
      return;
    }

    setApplyingPlannerRun(true);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/planner/runs/${plannerRunDetail.run.id}/apply`, {
        method: "POST",
        headers,
        body: JSON.stringify({ overwrite_existing_planner_assignments: true }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const detail = JSON.parse(text) as PlannerRunDetail;
      setPlannerRunDetail(detail);
      await Promise.all([loadSlotWeeks(), loadPlannerRuns(selectedWeekStart)]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Übernehmen des Planungsvorschlags: ${message}`);
    } finally {
      setApplyingPlannerRun(false);
    }
  }

  async function togglePlannerUserExempt(checked: boolean, applyRetroactively = false) {
    if (!selectedPlannerUserId) return;

    setTogglingPlannerExempt(true);
    setError("");
    setNotice("");

    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams();
      if (applyRetroactively) params.set("apply_retroactively", "true");
      const queryString = params.toString();
      const res = await fetch(
        `${API_BASE}/admin/users/${selectedPlannerUserId}${queryString ? `?${queryString}` : ""}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ is_planner_exempt: checked }),
        }
      );
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      const data = text ? (JSON.parse(text) as PlannerUserUpdateResponse) : null;

      setPlannerExempt(checked);
      setPlannerUsers((prev) =>
        prev.map((user) => (user.id === selectedPlannerUserId ? { ...user, is_planner_exempt: checked } : user))
      );
      setNotice(
        retroactiveCleanupMessage(
          data?.retroactive_cleanup,
          checked ? "Komplettbefreiung gespeichert." : "Komplettbefreiung entfernt."
        )
      );

      if (applyRetroactively) {
        await Promise.all([
          loadSlotWeeks(),
          selectedWeekStart ? loadPlannerRuns(selectedWeekStart) : Promise.resolve(),
        ]);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Aktualisieren der Planer-Befreiung: ${message}`);
    } finally {
      setTogglingPlannerExempt(false);
    }
  }

  async function addPlannerRule(
    applyRetroactively = false,
    templateItemId = plannerRuleTemplateItemId
  ) {
    if (!selectedPlannerUserId || !templateItemId) {
      setError("Bitte Person und Standardslot für die Sperre auswählen.");
      return;
    }

    setAddingPlannerRule(true);
    setError("");
    setNotice("");

    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams();
      if (applyRetroactively) params.set("apply_retroactively", "true");
      const queryString = params.toString();
      const res = await fetch(
        `${API_BASE}/admin/users/${selectedPlannerUserId}/planner-rules${queryString ? `?${queryString}` : ""}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            template_item_id: templateItemId,
            rule_type: "blocked",
          }),
        }
      );
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      const data = JSON.parse(text) as PlannerRulesResponse;
      setPlannerRules(data.rules);
      setPlannerExempt(Boolean(data.is_planner_exempt));
      setNotice(retroactiveCleanupMessage(data.retroactive_cleanup, "Präsenzregel gespeichert."));

      if (applyRetroactively) {
        await Promise.all([
          loadSlotWeeks(),
          selectedWeekStart ? loadPlannerRuns(selectedWeekStart) : Promise.resolve(),
        ]);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Anlegen der Sperre: ${message}`);
    } finally {
      setAddingPlannerRule(false);
    }
  }

  async function deletePlannerRule(ruleId: string) {
    if (!window.confirm("Diese Planer-Sperre wirklich löschen?")) return;

    setDeletingPlannerRuleId(ruleId);
    setError("");

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/admin/planner-rules/${ruleId}`, {
        method: "DELETE",
        headers,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);

      if (selectedPlannerUserId) await loadPlannerRules(selectedPlannerUserId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Löschen der Sperre: ${message}`);
    } finally {
      setDeletingPlannerRuleId(null);
    }
  }

  function requestPlannerExemptChange(checked: boolean) {
    if (!selectedPlannerUserId || !selectedPlannerUser) return;
    if (!checked) {
      void togglePlannerUserExempt(false);
      return;
    }

    setPendingRetroactiveChange({
      type: "exempt",
      checked: true,
      userLabel: plannerUserLabel(selectedPlannerUser),
    });
  }

  function requestPlannerRuleCreate() {
    if (!selectedPlannerUserId || !plannerRuleTemplateItemId || !selectedPlannerUser) {
      setError("Bitte Person und Standardslot für die Sperre auswählen.");
      return;
    }

    const selectedItem = availableRuleItems.find((item) => item.id === plannerRuleTemplateItemId);
    setPendingRetroactiveChange({
      type: "blocked",
      templateItemId: plannerRuleTemplateItemId,
      slotLabel: selectedItem ? templateItemLabel(selectedItem) : "gewählter Standardslot",
      userLabel: plannerUserLabel(selectedPlannerUser),
    });
  }

  async function applyPendingRetroactiveChange(applyRetroactively: boolean) {
    if (!pendingRetroactiveChange) return;

    const action = pendingRetroactiveChange;
    setPendingRetroactiveChange(null);

    if (action.type === "exempt") {
      await togglePlannerUserExempt(action.checked, applyRetroactively);
      return;
    }

    await addPlannerRule(applyRetroactively, action.templateItemId);
  }

  if (!authReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f8]">
        <div className="text-sm text-slate-500">Lade…</div>
      </main>
    );
  }

  if (!session) return null;

  return (
    <AdminShell
      session={session}
      title="Planer"
      subtitle="Wochenvorschläge berechnen, fair verteilen und Präsenzregeln übersichtlich pflegen."
      actions={
        <>
          <Button
            className="admin-btn"
            variant="outline"
            onClick={() => void refreshPlannerPage()}
            disabled={weeksLoading || plannerUsersLoading || plannerRunsLoading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${
                weeksLoading || plannerUsersLoading || plannerRunsLoading ? "animate-spin" : ""
              }`}
            />
            Aktualisieren
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="admin-card">
          <CardContent className="p-5">
            <div className="admin-stat-label">Sitzungswochen</div>
            <div className="mt-3 text-3xl font-semibold">{slotWeeks.length}</div>
          </CardContent>
        </Card>

        <Card className="admin-card">
          <CardContent className="p-5">
            <div className="admin-stat-label">Standardslot-Templates</div>
            <div className="mt-3 text-3xl font-semibold">{slotTemplates.length}</div>
          </CardContent>
        </Card>

        <Card className="admin-card">
          <CardContent className="p-5">
            <div className="admin-stat-label">Komplett befreit</div>
            <div className="mt-3 text-3xl font-semibold">{exemptCount}</div>
          </CardContent>
        </Card>
      </div>

      {error ? <div className="admin-error">{error}</div> : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setPlannerWorkspaceMode("planning")}
          className={[
            "rounded-full border px-4 py-2 text-sm font-medium transition",
            plannerWorkspaceMode === "planning"
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
          ].join(" ")}
        >
          Wochenplanung
        </button>
        <button
          type="button"
          onClick={() => setPlannerWorkspaceMode("rules")}
          className={[
            "rounded-full border px-4 py-2 text-sm font-medium transition",
            plannerWorkspaceMode === "rules"
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
          ].join(" ")}
        >
          Präsenzregeln
        </button>
      </div>

      {plannerWorkspaceMode === "planning" ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
          Hier geht es nur um die Wochenplanung: Woche auswählen, Vorschlag rechnen, prüfen und übernehmen.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
          Hier pflegst du nur die dauerhaften Präsenzregeln pro Person, getrennt von der eigentlichen Wochenplanung.
        </div>
      )}

      {plannerWorkspaceMode === "planning" ? (
        <Card className="admin-card border-slate-300">
          <CardHeader className="admin-card-header">
            <CardTitle className="text-base font-semibold">Sitzungsplan erstellen</CardTitle>
          </CardHeader>

          <CardContent className="admin-section p-5">
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPlanningStepMode("create")}
                  className={[
                    "rounded-full border px-4 py-2 text-sm font-medium transition",
                    planningStepMode === "create"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                  ].join(" ")}
                >
                  Sitzungswoche anlegen
                </button>
                <button
                  type="button"
                  onClick={() => setPlanningStepMode("assign")}
                  className={[
                    "rounded-full border px-4 py-2 text-sm font-medium transition",
                    planningStepMode === "assign"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                  ].join(" ")}
                >
                  Sitzungswoche einteilen
                </button>
              </div>

              {planningStepMode === "create" ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Plus className="h-4 w-4" />
                      Neue Sitzungswoche anlegen
                    </div>
                    <div className="mt-2 text-sm text-slate-600">
                      Lege zuerst die Woche an. Danach wechselst du in den Modus
                      {" "}
                      <span className="font-medium text-slate-900">Sitzungswoche einteilen</span>
                      {" "}
                      und berechnest den Vorschlag.
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Woche vorbereiten</div>
                        <div className="mt-1 text-sm text-slate-500">
                          Standardslot-Template auswählen, Vorschau prüfen und Woche speichern.
                        </div>
                      </div>
                      <Button className="admin-btn-primary" onClick={() => setWeekDialogOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Sitzungswoche anlegen
                      </Button>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <div className="admin-stat-label">Sitzungswochen gesamt</div>
                        <div className="mt-2 text-2xl font-semibold">{slotWeeks.length}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <div className="admin-stat-label">Standardvorlage</div>
                        <div className="mt-2 text-base font-semibold text-slate-900">
                          {defaultTemplate?.name ?? "—"}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                        <div className="admin-stat-label">Standardslot-Templates</div>
                        <div className="mt-2 text-2xl font-semibold">{slotTemplates.length}</div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                    <div className="text-sm font-semibold text-slate-900">Zuletzt vorhandene Wochen</div>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      {slotWeeks.slice(0, 6).map((week) => {
                        const assignmentCount =
                          (week.active_assignment_count ?? 0) + (week.ruf_assignment_count ?? 0);
                        return (
                          <div
                            key={week.week_start}
                            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4"
                          >
                            <div className="text-base font-semibold text-slate-900">
                              {formatDateLabel(week.week_start)} – {formatDateLabel(week.week_end)}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Badge variant="outline">{week.day_count} Tage</Badge>
                              <Badge variant="outline">{week.slot_count} Slots</Badge>
                              <Badge variant="outline">{assignmentCount} Zuweisungen</Badge>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Sparkles className="h-4 w-4" />
                      Einteilen in klarer Reihenfolge
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-slate-600">
                      <div>1. Sitzungswoche auswählen</div>
                      <div>2. Vorschlag berechnen</div>
                      <div>3. Verteilung prüfen und übernehmen</div>
                      <div>4. Falls nötig im Bereich Slots fein nacharbeiten</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 px-4 py-4">
                      <div className="text-sm font-semibold text-slate-900">Sitzungswoche auswählen</div>
                      <div className="mt-1 text-sm text-slate-500">
                        Erst die Woche auswählen, dann den eigentlichen Planungslauf starten.
                      </div>

                      <div className="mt-4 space-y-3">
                        <div className="relative">
                          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                          <Input
                            className="admin-input pl-9"
                            placeholder="Woche suchen"
                            value={weekSearch}
                            onChange={(e) => setWeekSearch(e.target.value)}
                          />
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setWeekFilter("current")}
                            className={[
                              "rounded-full border px-3 py-1 text-sm transition",
                              weekFilter === "current"
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                            ].join(" ")}
                          >
                            Aktuell & kommend
                          </button>
                          <button
                            type="button"
                            onClick={() => setWeekFilter("all")}
                            className={[
                              "rounded-full border px-3 py-1 text-sm transition",
                              weekFilter === "all"
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                            ].join(" ")}
                          >
                            Alle Wochen
                          </button>
                          <button
                            type="button"
                            onClick={() => setWeekFilter("empty")}
                            className={[
                              "rounded-full border px-3 py-1 text-sm transition",
                              weekFilter === "empty"
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                            ].join(" ")}
                          >
                            Leere Sitzungswochen
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="p-3">
                      <div className="grid gap-3 xl:grid-cols-2">
                        {visibleSlotWeeks.map((week) => {
                          const assignmentCount =
                            (week.active_assignment_count ?? 0) + (week.ruf_assignment_count ?? 0);
                          const isSelected = selectedWeekStart === week.week_start;

                          return (
                            <button
                              key={week.week_start}
                              type="button"
                              onClick={() => setSelectedWeekStart(week.week_start)}
                              className={[
                                "w-full rounded-xl border px-4 py-4 text-left transition",
                                isSelected
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-200 bg-white hover:border-slate-300",
                              ].join(" ")}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className={`text-[11px] uppercase tracking-[0.14em] ${isSelected ? "text-slate-300" : "text-slate-500"}`}>
                                    Sitzungswoche
                                  </div>
                                  <div className="mt-1 text-base font-semibold">
                                    {formatDateLabel(week.week_start)} – {formatDateLabel(week.week_end)}
                                  </div>
                                </div>
                                {isSelected ? (
                                  <Badge className="bg-white text-slate-900">ausgewählt</Badge>
                                ) : null}
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2">
                                <Badge variant={isSelected ? "secondary" : "outline"}>
                                  {week.day_count} Tage
                                </Badge>
                                <Badge variant={isSelected ? "secondary" : "outline"}>
                                  {week.slot_count} Slots
                                </Badge>
                                <Badge variant={isSelected ? "secondary" : "outline"}>
                                  {assignmentCount} Zuweisungen
                                </Badge>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {!weeksLoading && visibleSlotWeeks.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                          Keine Sitzungswochen für diese Ansicht gefunden.
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <CalendarDays className="h-4 w-4" />
                          Planungsarbeitsplatz
                        </div>
                        {selectedWeek ? (
                          <>
                            <div className="mt-2 text-lg font-semibold text-slate-900">
                              {formatDateLabel(selectedWeek.week_start)} – {formatDateLabel(selectedWeek.week_end)}
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
                              Vorlage: {defaultTemplate?.name ?? "—"} · {selectedWeek.slot_count} Slots · {selectedWeek.day_count} Tage
                            </div>
                            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                              <div className="font-medium text-slate-900">Nächster Schritt</div>
                              <div className="mt-1">{plannerNextStepLabel}</div>
                            </div>
                          </>
                        ) : (
                          <div className="mt-2 text-sm text-slate-500">
                            Bitte zuerst eine Sitzungswoche auswählen.
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          className="admin-btn-primary"
                          disabled={!selectedWeekStart || creatingPlannerRun}
                          onClick={() => void createPlannerRun()}
                        >
                          <Sparkles className="mr-2 h-4 w-4" />
                          {creatingPlannerRun ? "Berechnet…" : "Vorschlag berechnen"}
                        </Button>
                        <Button
                          className="admin-btn"
                          variant="outline"
                          disabled={!plannerRunDetail?.run.id || applyingPlannerRun}
                          onClick={() => void applyPlannerRun()}
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          {applyingPlannerRun ? "Übernimmt…" : "In Slots übernehmen"}
                        </Button>
                        <Link href="/admin/slots" className="inline-flex">
                          <Button className="admin-btn" variant="outline">
                            Feinpflege in Slots
                          </Button>
                        </Link>
                      </div>
                    </div>

                    {plannerRuns.length > 0 ? (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <div className="text-sm text-slate-500">Vorhandene Läufe:</div>
                        {plannerRuns.map((run) => (
                          <button
                            key={run.id}
                            type="button"
                            onClick={() => {
                              setSelectedPlannerRunId(run.id);
                              void loadPlannerRunDetail(run.id);
                            }}
                            className={[
                              "rounded-full border px-3 py-1 text-sm transition",
                              selectedPlannerRunId === run.id
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                            ].join(" ")}
                          >
                            {runStatusLabel(run.status)} · {formatDateTimeLabel(run.created_at)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {plannerRunDetailLoading ? (
                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                      Planungslauf wird geladen…
                    </div>
                  ) : null}

                  {!plannerRunDetailLoading && !plannerRunDetail ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
                      Für die ausgewählte Woche gibt es noch keinen Vorschlag. Klicke auf{" "}
                      <span className="font-medium text-slate-900">Vorschlag berechnen</span>, dann siehst du
                      sofort die Verteilung pro MdB und die Wochenstatistik.
                    </div>
                  ) : null}

                  {plannerRunDetail ? (
                    <>
                      <div className="grid gap-4 md:grid-cols-3">
                        <Card className="border border-slate-200 shadow-none">
                          <CardContent className="p-5">
                            <div className="admin-stat-label">Einsätze im Vorschlag</div>
                            <div className="mt-3 text-3xl font-semibold">
                              {plannerRunDetail.summary.assignment_count}
                            </div>
                          </CardContent>
                        </Card>
                        <Card className="border border-slate-200 shadow-none">
                          <CardContent className="p-5">
                            <div className="admin-stat-label">Personen mit Einsatz</div>
                            <div className="mt-3 text-3xl font-semibold">
                              {plannerRunDetail.summary.people_with_assignments}
                            </div>
                          </CardContent>
                        </Card>
                        <Card className="border border-slate-200 shadow-none">
                          <CardContent className="p-5">
                            <div className="admin-stat-label">Offene Punkte</div>
                            <div className="mt-3 text-3xl font-semibold">
                              {plannerRunDetail.summary.unfilled_positions}
                            </div>
                          </CardContent>
                        </Card>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <Badge variant={plannerRunDetail.run.status === "applied" ? "default" : "outline"}>
                            {runStatusLabel(plannerRunDetail.run.status)}
                          </Badge>
                          <Badge variant="outline">
                            {hasPlannerRun ? `${plannerWarningsCount} Hinweise` : "Noch kein Lauf"}
                          </Badge>
                          <div className="text-sm text-slate-500">
                            Berechnet am {formatDateTimeLabel(plannerRunDetail.run.created_at)}
                          </div>
                          {plannerRunDetail.run.applied_at ? (
                            <div className="text-sm text-slate-500">
                              · Übernommen am {formatDateTimeLabel(plannerRunDetail.run.applied_at)}
                            </div>
                          ) : null}
                        </div>

                        {plannerRunDetail.warnings.length > 0 ? (
                          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                              <AlertCircle className="h-4 w-4" />
                              Hinweise zum Lauf
                            </div>
                            <div className="mt-3 space-y-2 text-sm text-amber-900">
                              {plannerRunDetail.warnings.map((warning, index) => (
                                <div key={`${warning.slot_id}-${index}`}>{warning.message}</div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">Verteilung pro MdB</div>
                            <div className="mt-1 text-sm text-slate-500">
                              Klick auf einen Kollegen öffnet die Detailansicht mit allen zugewiesenen Slots.
                            </div>
                          </div>
                          <Badge variant="outline">{assignedPeople.length} mit Einsatz</Badge>
                        </div>

                        <div className="mt-4 grid gap-3 lg:grid-cols-2">
                          {assignedPeople.map((person) => (
                            <button
                              key={person.user_id}
                              type="button"
                              onClick={() => setSelectedPersonDetailId(person.user_id)}
                              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-slate-400 hover:bg-white"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="text-base font-semibold text-slate-900">{person.name}</div>
                                  <div className="mt-1 text-sm text-slate-500">{person.email}</div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <Badge variant="outline">{person.week_total_slots} Slots diese Woche</Badge>
                                  {person.week_friday_last_slots > 0 ? (
                                    <Badge variant="outline">
                                      Freitag letzter Slot: {person.week_friday_last_slots}
                                    </Badge>
                                  ) : null}
                                </div>
                              </div>

                              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                                <div>
                                  <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Gesamt</div>
                                  <div className="mt-1 text-lg font-semibold">{person.week_total_slots}</div>
                                </div>
                                <div>
                                  <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Aktiv / Ruf</div>
                                  <div className="mt-1 text-lg font-semibold">
                                    {person.week_active_slots} / {person.week_ruf_slots}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Historie gesamt</div>
                                  <div className="mt-1 text-lg font-semibold">{person.history_total_slots}</div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>

                        {unassignedPeople.length > 0 ? (
                          <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-4 py-4">
                            <div className="text-sm font-semibold text-slate-900">Diese Woche ohne Slot</div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {unassignedPeople.map((person) => (
                                <Badge key={person.user_id} variant="outline">
                                  {person.name} · Historie {person.history_total_slots}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {plannerWorkspaceMode === "rules" ? (
        <Card className="admin-card border-slate-300">
          <CardHeader className="admin-card-header">
            <CardTitle className="text-base font-semibold">Präsenzregeln verwalten</CardTitle>
          </CardHeader>

          <CardContent className="admin-section p-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
            Neue Komplettbefreiungen und neue Sperren können optional rückwirkend angewendet
            werden. Dann wird die Person aus bestehenden Zuweisungen entfernt, ohne dass die
            Woche automatisch neu verteilt wird.
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="border border-slate-200 shadow-none">
              <CardContent className="p-5">
                <div className="admin-stat-label">MDBs im Planer</div>
                <div className="mt-3 text-3xl font-semibold">{plannerUsers.length}</div>
              </CardContent>
            </Card>

            <Card className="border border-slate-200 shadow-none">
              <CardContent className="p-5">
                <div className="admin-stat-label">Sperren der Auswahl</div>
                <div className="mt-3 text-3xl font-semibold">{totalPlannerRules}</div>
              </CardContent>
            </Card>

            <Card className="border border-slate-200 shadow-none">
              <CardContent className="p-5">
                <div className="admin-stat-label">Aktive Vorlage</div>
                <div className="mt-3 text-lg font-semibold text-slate-900">
                  {selectedTemplate?.name ?? "—"}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Users className="h-4 w-4" />
                  Personen auswählen
                </div>
                <div className="mt-3 space-y-3">
                  <div className="space-y-2">
                    <Label>Template</Label>
                    <Select
                      value={selectedTemplateId || "none"}
                      onValueChange={(value) => setSelectedTemplateId(value === "none" ? "" : value)}
                    >
                      <SelectTrigger className="admin-select-trigger">
                        <SelectValue placeholder="Template wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Template wählen</SelectItem>
                        {slotTemplates.map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.name}
                            {template.is_default ? " · Standard" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      className="admin-input pl-9"
                      placeholder="Person suchen"
                      value={plannerUserSearch}
                      onChange={(e) => setPlannerUserSearch(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="max-h-[720px] overflow-y-auto p-3">
                <div className="space-y-2">
                  {visiblePlannerUsers.map((user) => {
                    const isSelected = selectedPlannerUserId === user.id;
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => setSelectedPlannerUserId(user.id)}
                        className={[
                          "w-full rounded-xl border px-4 py-3 text-left transition",
                          isSelected
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white hover:border-slate-300",
                        ].join(" ")}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-medium">{plannerUserLabel(user)}</div>
                            <div className={`mt-1 text-sm ${isSelected ? "text-slate-300" : "text-slate-500"}`}>
                              {user.email}
                            </div>
                          </div>
                          {user.is_planner_exempt ? (
                            <Badge className={isSelected ? "bg-white text-slate-900" : ""}>befreit</Badge>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}

                  {!plannerUsersLoading && visiblePlannerUsers.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                      Keine Personen gefunden.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {selectedPlannerUser ? plannerUserLabel(selectedPlannerUser) : "Person auswählen"}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      {selectedPlannerUser
                        ? "Komplettbefreiung und gesperrte Standardslots direkt an einer Stelle pflegen."
                        : "Bitte links eine Person auswählen."}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="font-medium text-slate-900">Komplett befreit</div>
                        <div className="text-xs text-slate-500">
                          Person wird vom automatischen Wochenplan ausgenommen.
                        </div>
                      </div>
                      <Switch
                        checked={plannerExempt}
                        disabled={!selectedPlannerUserId || togglingPlannerExempt}
                        onCheckedChange={requestPlannerExemptChange}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[280px] flex-1 space-y-2">
                    <Label>Standardslot sperren</Label>
                    <Select
                      value={plannerRuleTemplateItemId || "none"}
                      onValueChange={(value) => setPlannerRuleTemplateItemId(value === "none" ? "" : value)}
                      disabled={!selectedPlannerUserId || availableRuleItems.length === 0}
                    >
                      <SelectTrigger className="admin-select-trigger">
                        <SelectValue placeholder="Standardslot auswählen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Standardslot auswählen</SelectItem>
                        {availableRuleItems.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {templateItemLabel(item)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    className="admin-btn-primary"
                    disabled={!selectedPlannerUserId || !plannerRuleTemplateItemId || addingPlannerRule}
                    onClick={requestPlannerRuleCreate}
                  >
                    {addingPlannerRule ? "Speichert…" : "Sperre hinzufügen"}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Aktuelle Sperren</div>
                    <div className="mt-1 text-sm text-slate-500">
                      So sieht man direkt, welche Standardslots eine Person nicht übernehmen darf.
                    </div>
                  </div>
                  <Badge variant="outline">{plannerRules.length} Sperren</Badge>
                </div>

                <div className="space-y-3">
                  {plannerRules.map((rule) => (
                    <div key={rule.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="font-medium text-slate-900">
                            {rule.weekday} · {rule.slot_code}
                          </div>
                          <div className="mt-1 text-sm text-slate-500">
                            {rule.template_name} · {slotTimeLabel(rule.start_time, rule.end_time, rule.open_end)}
                          </div>
                        </div>
                        <Button
                          className="admin-btn"
                          variant="outline"
                          disabled={deletingPlannerRuleId === rule.id}
                          onClick={() => void deletePlannerRule(rule.id)}
                        >
                          {deletingPlannerRuleId === rule.id ? "Löscht…" : "Entfernen"}
                        </Button>
                      </div>
                    </div>
                  ))}

                  {!plannerRulesLoading && selectedPlannerUserId && plannerRules.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                      Für diese Person sind aktuell keine Standardslots gesperrt.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      ) : null}

      <Dialog open={weekDialogOpen} onOpenChange={setWeekDialogOpen}>
        <DialogContent
          className="admin-dialog flex h-auto max-h-[90vh] min-w-0 flex-col overflow-hidden p-0"
          style={{ width: "90vw", maxWidth: "90vw" }}
        >
          <DialogHeader className="border-b border-slate-200 px-6 py-5">
            <DialogTitle>Sitzungswoche erstellen</DialogTitle>
          </DialogHeader>

          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid gap-4 xl:grid-cols-[180px_minmax(320px,1fr)_auto_auto]">
              <div className="space-y-2">
                <Label>Wochenstart</Label>
                <Input
                  className="admin-input"
                  type="date"
                  value={weekStart}
                  onChange={(e) => setWeekStart(e.target.value)}
                />
              </div>

              <div className="min-w-0 space-y-2">
                <Label>Standardslot-Template</Label>
                <Select
                  value={selectedTemplateId || "none"}
                  onValueChange={(value) => setSelectedTemplateId(value === "none" ? "" : value)}
                >
                  <SelectTrigger className="admin-select-trigger w-full min-w-0">
                    <SelectValue placeholder="Template wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Template wählen</SelectItem>
                    {slotTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                        {template.is_default ? " · Standard" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Button
                  className="admin-btn"
                  variant="outline"
                  onClick={() => void previewWeek()}
                  disabled={previewLoading || !weekStart}
                >
                  {previewLoading ? "Lädt…" : "Vorschau laden"}
                </Button>
              </div>

              <div className="flex items-end">
                <Button className="admin-btn" variant="outline" onClick={addWeekSlot} disabled={!weekStart}>
                  <Plus className="mr-2 h-4 w-4" />
                  Slot ergänzen
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
              {weekTemplateName ? (
                <>
                  Vorschau aus Template <span className="font-medium">{weekTemplateName}</span> für{" "}
                  <span className="font-medium">{formatDateLabel(weekStart)}</span>
                  {weekEnd ? <> bis <span className="font-medium">{formatDateLabel(weekEnd)}</span></> : null}
                </>
              ) : (
                "Bitte zuerst eine Sitzungswoche laden oder Slots manuell ergänzen."
              )}
            </div>

            <div className="admin-table overflow-x-auto">
              <div className="admin-table-header grid min-w-[980px] grid-cols-[120px_130px_130px_90px_130px_130px_100px_110px]">
                <div>Datum</div>
                <div>Wochentag</div>
                <div>Code</div>
                <div>Reihenfolge</div>
                <div>Start</div>
                <div>Ende</div>
                <div>Offen</div>
                <div>Aktion</div>
              </div>

              {weekSlots.map((slot, index) => (
                <div
                  key={`${slot.slot_date}-${index}`}
                  className="admin-table-row grid min-w-[980px] grid-cols-[120px_130px_130px_90px_130px_130px_100px_110px] items-center"
                >
                  <Input
                    className="admin-input"
                    type="date"
                    value={slot.slot_date}
                    onChange={(e) => updateWeekSlot(index, "slot_date", e.target.value)}
                  />
                  <Input
                    className="admin-input"
                    value={slot.weekday}
                    onChange={(e) => updateWeekSlot(index, "weekday", e.target.value)}
                  />
                  <Input
                    className="admin-input"
                    value={slot.slot_code}
                    onChange={(e) => updateWeekSlot(index, "slot_code", e.target.value)}
                  />
                  <Input
                    className="admin-input"
                    type="number"
                    value={slot.slot_order}
                    onChange={(e) => updateWeekSlot(index, "slot_order", Number(e.target.value))}
                  />
                  <Input
                    className="admin-input"
                    type="time"
                    value={slot.start_time}
                    onChange={(e) => updateWeekSlot(index, "start_time", e.target.value)}
                  />
                  <Input
                    className="admin-input"
                    type="time"
                    value={slot.end_time ?? ""}
                    onChange={(e) => updateWeekSlot(index, "end_time", e.target.value || null)}
                  />
                  <div className="flex justify-center">
                    <Switch
                      checked={slot.open_end}
                      onCheckedChange={(checked) => updateWeekSlot(index, "open_end", checked)}
                    />
                  </div>
                  <Button variant="outline" className="admin-btn" onClick={() => deleteWeekSlot(index)}>
                    Entfernen
                  </Button>
                </div>
              ))}

              {weekSlots.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500">
                  Noch keine Slots für diese Woche vorhanden.
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 px-6 py-4">
            <Button variant="outline" className="admin-btn" onClick={() => setWeekDialogOpen(false)}>
              Abbrechen
            </Button>

            <Button
              onClick={() => void createWeek()}
              disabled={creatingWeek || weekSlots.length === 0}
              className="admin-btn-primary"
            >
              {creatingWeek ? "Speichert…" : "Sitzungswoche anlegen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedPersonDetail)}
        onOpenChange={(open) => {
          if (!open) setSelectedPersonDetailId(null);
        }}
      >
        <DialogContent className="admin-dialog flex h-auto max-h-[90vh] w-[92vw] max-w-[1180px] flex-col overflow-hidden">
          <DialogHeader className="border-b border-slate-200 px-6 py-5">
            <DialogTitle>
              {selectedPersonDetail?.name ?? "Kollegen-Detail"}
              {selectedPersonDetail ? (
                <span className="ml-2 text-sm font-normal text-slate-500">
                  {selectedPersonDetail.email}
                </span>
              ) : null}
            </DialogTitle>
          </DialogHeader>

          {selectedPersonDetail ? (
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Card className="border border-slate-200 shadow-none">
                  <CardContent className="p-4">
                    <div className="admin-stat-label">Slots diese Woche</div>
                    <div className="mt-2 text-2xl font-semibold">{selectedPersonDetail.week_total_slots}</div>
                  </CardContent>
                </Card>
                <Card className="border border-slate-200 shadow-none">
                  <CardContent className="p-4">
                    <div className="admin-stat-label">Aktiv / Ruf</div>
                    <div className="mt-2 text-2xl font-semibold">
                      {selectedPersonDetail.week_active_slots} / {selectedPersonDetail.week_ruf_slots}
                    </div>
                  </CardContent>
                </Card>
                <Card className="border border-slate-200 shadow-none">
                  <CardContent className="p-4">
                    <div className="admin-stat-label">Spät-Statistik</div>
                    <div className="mt-2 text-2xl font-semibold">{selectedPersonDetail.week_late_slots}</div>
                  </CardContent>
                </Card>
                <Card className="border border-slate-200 shadow-none">
                  <CardContent className="p-4">
                    <div className="admin-stat-label">Historie gesamt</div>
                    <div className="mt-2 text-2xl font-semibold">{selectedPersonDetail.history_total_slots}</div>
                  </CardContent>
                </Card>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-4 py-3">
                  <div className="text-sm font-semibold text-slate-900">Zugewiesene Slots</div>
                  <div className="mt-1 text-sm text-slate-500">
                    So lässt sich sofort nachvollziehen, woher die Wochenzahl kommt.
                  </div>
                </div>

                <div className="space-y-3 p-4">
                  {selectedPersonDetail.assignedSlots.map((slot) => (
                    <div key={`${slot.slot_id}-${slot.assignment_type}`} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-slate-900">
                            {slot.weekday} · {formatDateLabel(slot.slot_date)} · {slot.slot_code}
                          </div>
                          <div className="mt-1 text-sm text-slate-500">{slot.time_label}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">{assignmentLabel(slot.assignment_type)}</Badge>
                          {slot.is_manual_fixed ? <Badge variant="outline">manuell fixiert</Badge> : null}
                        </div>
                      </div>
                      <div className="mt-3 text-xs text-slate-500">
                        {slot.reason_codes.map(reasonLabel).join(" · ")}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingRetroactiveChange)}
        onOpenChange={(open) => {
          if (!open) setPendingRetroactiveChange(null);
        }}
      >
        <DialogContent className="admin-dialog max-w-[620px]">
          <DialogHeader>
            <DialogTitle>Regel rückwirkend anwenden?</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm text-slate-600">
            <div>
              {pendingRetroactiveChange?.type === "exempt" ? (
                <>
                  <span className="font-medium text-slate-900">
                    {pendingRetroactiveChange.userLabel}
                  </span>{" "}
                  wird komplett vom Planer befreit.
                </>
              ) : (
                <>
                  Für{" "}
                  <span className="font-medium text-slate-900">
                    {pendingRetroactiveChange?.userLabel}
                  </span>{" "}
                  wird der Standardslot{" "}
                  <span className="font-medium text-slate-900">
                    {pendingRetroactiveChange?.type === "blocked"
                      ? pendingRetroactiveChange.slotLabel
                      : ""}
                  </span>{" "}
                  gesperrt.
                </>
              )}
            </div>

            <div>
              Soll die Änderung nur für künftige Planung gelten oder auch rückwirkend auf bereits
              vorhandene Wochen? Rückwirkend bedeutet: Die Person wird aus bestehenden
              Zuweisungen entfernt, ohne dass automatisch neu verteilt wird.
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="admin-btn"
              onClick={() => setPendingRetroactiveChange(null)}
            >
              Abbrechen
            </Button>
            <Button
              variant="outline"
              className="admin-btn"
              onClick={() => void applyPendingRetroactiveChange(false)}
            >
              Nur künftig speichern
            </Button>
            <Button
              className="admin-btn-primary"
              onClick={() => void applyPendingRetroactiveChange(true)}
            >
              Rückwirkend anwenden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}
