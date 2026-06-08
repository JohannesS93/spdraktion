from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, time
import random


@dataclass
class PlannerPersonStats:
    total_slots: int = 0
    active_slots: int = 0
    ruf_slots: int = 0
    late_slots: int = 0
    friday_last_slots: int = 0
    planned_weeks: int = 0


@dataclass
class PlannerWeekState:
    total_slots: int = 0
    active_slots: int = 0
    ruf_slots: int = 0
    late_slots: int = 0
    friday_last_slots: int = 0
    last_role: str | None = None
    last_slot_sequence: int | None = None


@dataclass
class PlannerPerson:
    id: str
    first_name: str | None
    last_name: str | None
    email: str
    is_exempt: bool
    blocked_template_item_ids: set[str] = field(default_factory=set)
    blocked_wednesday_count: int = 0
    stats: PlannerPersonStats = field(default_factory=PlannerPersonStats)

    @property
    def display_name(self) -> str:
        name = f"{self.first_name or ''} {self.last_name or ''}".strip()
        return name or self.email


@dataclass
class PlannerSlot:
    id: str
    slot_date: date
    weekday: str
    slot_code: str
    slot_order: int
    sequence_index: int
    template_item_id: str | None
    start_time: time
    end_time: time | None
    open_end: bool
    required_active_count: int
    required_ruf_count: int
    full_attendance: bool
    is_late_slot: bool
    is_last_slot_of_day: bool
    is_friday_last_slot: bool


@dataclass
class ExistingAssignment:
    slot_id: str
    user_id: str
    assignment_type: str
    source: str
    locked: bool


@dataclass
class PlannerSuggestion:
    slot_id: str
    user_id: str
    assignment_type: str
    score: float
    reason_codes: list[str]
    score_details: dict[str, float | int | str | bool]
    is_manual_fixed: bool
    is_late_slot: bool
    is_last_slot_of_day: bool
    is_friday_last_slot: bool


@dataclass
class PlannerWarning:
    slot_id: str
    warning_code: str
    message: str


@dataclass
class PlannerResult:
    suggestions: list[PlannerSuggestion]
    warnings: list[PlannerWarning]
    week_state: dict[str, PlannerWeekState]


def _state_for_user(state_by_user: dict[str, PlannerWeekState], user_id: str) -> PlannerWeekState:
    if user_id not in state_by_user:
        state_by_user[user_id] = PlannerWeekState()
    return state_by_user[user_id]


def _update_week_state(
    state_by_user: dict[str, PlannerWeekState],
    slot: PlannerSlot,
    user_id: str,
    assignment_type: str,
) -> None:
    state = _state_for_user(state_by_user, user_id)
    state.total_slots += 1
    if assignment_type == "ruf":
        state.ruf_slots += 1
    else:
        state.active_slots += 1
    if slot.is_late_slot:
        state.late_slots += 1
    if slot.is_friday_last_slot:
        state.friday_last_slots += 1
    state.last_role = assignment_type
    state.last_slot_sequence = slot.sequence_index


def _score_candidate(
    *,
    person: PlannerPerson,
    slot: PlannerSlot,
    assignment_type: str,
    state_by_user: dict[str, PlannerWeekState],
) -> tuple[float, list[str], dict[str, float | int | str | bool]]:
    state = state_by_user.get(person.id, PlannerWeekState())
    history = person.stats

    score = 1000.0

    total_load_penalty = (history.total_slots * 8.0) + (state.total_slots * 24.0)
    role_load_penalty = (
        (history.ruf_slots if assignment_type == "ruf" else history.active_slots) * 5.0
        + (state.ruf_slots if assignment_type == "ruf" else state.active_slots) * 14.0
    )
    score -= total_load_penalty + role_load_penalty

    late_penalty = 0.0
    friday_penalty = 0.0
    if slot.is_late_slot:
        late_penalty = (history.late_slots * 10.0) + (state.late_slots * 22.0)
        score -= late_penalty
    if slot.is_friday_last_slot:
        friday_penalty = (history.friday_last_slots * 28.0) + (state.friday_last_slots * 48.0)
        score -= friday_penalty

    back_to_back_penalty = 0.0
    role_variety_bonus = 0.0
    if state.last_slot_sequence is not None and state.last_slot_sequence == slot.sequence_index - 1:
        if state.last_role == assignment_type:
            back_to_back_penalty = 85.0
        else:
            role_variety_bonus = 18.0
        score -= back_to_back_penalty
        score += role_variety_bonus

    wednesday_compensation_bonus = 0.0
    if (
        assignment_type == "active"
        and slot.weekday.lower() != "mittwoch"
        and person.blocked_wednesday_count > 0
    ):
        wednesday_compensation_bonus = 14.0
        score += wednesday_compensation_bonus

    score_details: dict[str, float | int | str | bool] = {
        "history_total_slots": history.total_slots,
        "history_active_slots": history.active_slots,
        "history_ruf_slots": history.ruf_slots,
        "history_late_slots": history.late_slots,
        "history_friday_last_slots": history.friday_last_slots,
        "week_total_slots": state.total_slots,
        "week_active_slots": state.active_slots,
        "week_ruf_slots": state.ruf_slots,
        "week_late_slots": state.late_slots,
        "week_friday_last_slots": state.friday_last_slots,
        "back_to_back_penalty": back_to_back_penalty,
        "role_variety_bonus": role_variety_bonus,
        "wednesday_compensation_bonus": wednesday_compensation_bonus,
        "late_penalty": late_penalty,
        "friday_penalty": friday_penalty,
        "total_load_penalty": total_load_penalty,
        "role_load_penalty": role_load_penalty,
    }

    reason_codes: list[str] = []
    if state.total_slots == 0:
        reason_codes.append("LOW_WEEK_LOAD")
    if slot.is_friday_last_slot and history.friday_last_slots + state.friday_last_slots == 0:
        reason_codes.append("LOW_FRIDAY_LAST_LOAD")
    elif slot.is_late_slot and history.late_slots + state.late_slots == 0:
        reason_codes.append("LOW_LATE_LOAD")
    if role_variety_bonus > 0:
        reason_codes.append("ROLE_VARIETY")
    if wednesday_compensation_bonus > 0:
        reason_codes.append("WEDNESDAY_COMPENSATION")
    if not reason_codes:
        reason_codes.append("LOAD_BALANCING")

    return score, reason_codes, score_details


def _is_fixed_assignment(assignment: ExistingAssignment) -> bool:
    return assignment.locked or assignment.source == "manual"


def generate_plan(
    *,
    slots: list[PlannerSlot],
    people: list[PlannerPerson],
    existing_assignments: list[ExistingAssignment],
    random_seed: int,
) -> PlannerResult:
    rng = random.Random(random_seed)
    state_by_user: dict[str, PlannerWeekState] = {}
    people_by_id = {person.id: person for person in people}
    fixed_by_slot: dict[str, list[ExistingAssignment]] = {}

    for assignment in existing_assignments:
        if _is_fixed_assignment(assignment):
            fixed_by_slot.setdefault(assignment.slot_id, []).append(assignment)

    suggestions: list[PlannerSuggestion] = []
    warnings: list[PlannerWarning] = []

    for slot in slots:
        used_user_ids: set[str] = set()
        slot_assignments: list[PlannerSuggestion] = []
        fixed_assignments = fixed_by_slot.get(slot.id, [])

        active_fixed_count = 0
        ruf_fixed_count = 0

        for fixed_assignment in fixed_assignments:
            if fixed_assignment.user_id in used_user_ids:
                continue
            if fixed_assignment.user_id not in people_by_id:
                continue

            slot_assignments.append(
                PlannerSuggestion(
                    slot_id=slot.id,
                    user_id=fixed_assignment.user_id,
                    assignment_type=fixed_assignment.assignment_type,
                    score=9999.0,
                    reason_codes=["MANUAL_FIXED_ASSIGNMENT"],
                    score_details={"source": fixed_assignment.source, "locked": fixed_assignment.locked},
                    is_manual_fixed=True,
                    is_late_slot=slot.is_late_slot,
                    is_last_slot_of_day=slot.is_last_slot_of_day,
                    is_friday_last_slot=slot.is_friday_last_slot,
                )
            )
            used_user_ids.add(fixed_assignment.user_id)
            if fixed_assignment.assignment_type == "ruf":
                ruf_fixed_count += 1
            else:
                active_fixed_count += 1

        if active_fixed_count > slot.required_active_count:
            warnings.append(
                PlannerWarning(
                    slot_id=slot.id,
                    warning_code="FIXED_ACTIVE_OVERFLOW",
                    message=(
                        f"Slot {slot.slot_code} hat bereits {active_fixed_count} feste Aktiv-Zuweisungen "
                        f"bei Zielwert {slot.required_active_count}."
                    ),
                )
            )
        if ruf_fixed_count > slot.required_ruf_count:
            warnings.append(
                PlannerWarning(
                    slot_id=slot.id,
                    warning_code="FIXED_RUF_OVERFLOW",
                    message=(
                        f"Slot {slot.slot_code} hat bereits {ruf_fixed_count} feste Ruf-Zuweisungen "
                        f"bei Zielwert {slot.required_ruf_count}."
                    ),
                )
            )

        if slot.full_attendance:
            eligible_people = [
                person
                for person in people
                if not person.is_exempt
                and person.id not in used_user_ids
                and (not slot.template_item_id or slot.template_item_id not in person.blocked_template_item_ids)
            ]
            for person in eligible_people:
                slot_assignments.append(
                    PlannerSuggestion(
                        slot_id=slot.id,
                        user_id=person.id,
                        assignment_type="active",
                        score=2000.0,
                        reason_codes=["FULL_ATTENDANCE"],
                        score_details={"full_attendance": True},
                        is_manual_fixed=False,
                        is_late_slot=slot.is_late_slot,
                        is_last_slot_of_day=slot.is_last_slot_of_day,
                        is_friday_last_slot=slot.is_friday_last_slot,
                    )
                )
                used_user_ids.add(person.id)
        else:
            remaining_active = max(slot.required_active_count - active_fixed_count, 0)
            remaining_ruf = max(slot.required_ruf_count - ruf_fixed_count, 0)

            for assignment_type, remaining_count in (("active", remaining_active), ("ruf", remaining_ruf)):
                for _ in range(remaining_count):
                    candidate_rows: list[tuple[float, float, PlannerPerson, list[str], dict[str, float | int | str | bool]]] = []

                    for person in people:
                        if person.id in used_user_ids:
                            continue
                        if person.is_exempt:
                            continue
                        if slot.template_item_id and slot.template_item_id in person.blocked_template_item_ids:
                            continue

                        score, reason_codes, score_details = _score_candidate(
                            person=person,
                            slot=slot,
                            assignment_type=assignment_type,
                            state_by_user=state_by_user,
                        )
                        candidate_rows.append(
                            (score, rng.random(), person, reason_codes, score_details)
                        )

                    if not candidate_rows:
                        warnings.append(
                            PlannerWarning(
                                slot_id=slot.id,
                                warning_code="UNFILLED_POSITION",
                                message=(
                                    f"Für Slot {slot.slot_code} ({slot.slot_date.isoformat()}) konnte keine "
                                    f"{'Aktiv' if assignment_type == 'active' else 'Ruf'}-Besetzung gefunden werden."
                                ),
                            )
                        )
                        continue

                    candidate_rows.sort(key=lambda item: (item[0], item[1]), reverse=True)
                    best_score, _, best_person, reason_codes, score_details = candidate_rows[0]

                    slot_assignments.append(
                        PlannerSuggestion(
                            slot_id=slot.id,
                            user_id=best_person.id,
                            assignment_type=assignment_type,
                            score=best_score,
                            reason_codes=reason_codes,
                            score_details=score_details,
                            is_manual_fixed=False,
                            is_late_slot=slot.is_late_slot,
                            is_last_slot_of_day=slot.is_last_slot_of_day,
                            is_friday_last_slot=slot.is_friday_last_slot,
                        )
                    )
                    used_user_ids.add(best_person.id)

        for assignment in slot_assignments:
            _update_week_state(state_by_user, slot, assignment.user_id, assignment.assignment_type)
            suggestions.append(assignment)

    return PlannerResult(suggestions=suggestions, warnings=warnings, week_state=state_by_user)
