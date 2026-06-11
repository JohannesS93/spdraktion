from __future__ import annotations

import base64
from email import message_from_bytes
from email.header import decode_header
import html
import imaplib
from io import BytesIO
import json
import os
import re
import random
import threading
import time
import unicodedata
from datetime import date
from typing import Optional, Literal
from uuid import UUID
from zoneinfo import ZoneInfo
import xml.etree.ElementTree as ET

import firebase_admin
from firebase_admin import credentials, messaging
from firebase_admin import auth as firebase_auth
import psycopg
from datetime import datetime, timezone
from datetime import date, timedelta
from fastapi import FastAPI, HTTPException, Query, Header
from fastapi import UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import requests
import certifi
from pypdf import PdfReader
from pypdf import PdfWriter
import uuid
from planner_engine import (
    ExistingAssignment as PlannerExistingAssignment,
    PlannerPerson,
    PlannerPersonStats,
    PlannerSlot,
    generate_plan,
)


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.join(BASE_DIR, "uploads"))
os.makedirs(UPLOAD_DIR, exist_ok=True)
FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "spd-fraktion-intern")
EUROPE_BERLIN = ZoneInfo("Europe/Berlin")
BUNDESTAG_CONFERENCES_URL = "https://www.bundestag.de/static/appdata/plenum/v2/conferences.xml"
BUNDESTAG_SPEAKER_URL = "https://www.bundestag.de/static/appdata/plenum/v2/speaker.xml"
BUNDESTAG_ARTICLE_XML_URL = "https://www.bundestag.de/blueprint/servlet/content/{article_id}/asAppV2NewsarticleXml"
BUNDESTAG_TAGESORDNUNGEN_URL = "https://www.bundestag.de/parlament/plenum/tagesordnungen"
BUNDESTAG_LIVE_CACHE_SECONDS = 60
_bundestag_live_cache_lock = threading.Lock()
_bundestag_live_cache: dict[str, tuple[datetime, str]] = {}
_bundestag_live_bytes_cache: dict[str, tuple[datetime, bytes]] = {}
MAIL_IMPORT_IMAP_HOST = os.environ.get("MAIL_IMPORT_IMAP_HOST", "imap.strato.de")
MAIL_IMPORT_IMAP_PORT = int(os.environ.get("MAIL_IMPORT_IMAP_PORT", "993"))
MAIL_IMPORT_USERNAME = os.environ.get("MAIL_IMPORT_USERNAME", "").strip()
MAIL_IMPORT_PASSWORD = os.environ.get("MAIL_IMPORT_PASSWORD", "").strip()
MAIL_IMPORT_LOOKBACK_DAYS = int(os.environ.get("MAIL_IMPORT_LOOKBACK_DAYS", "14"))
MAIL_IMPORT_POLL_MINUTES = int(os.environ.get("MAIL_IMPORT_POLL_MINUTES", "5"))
PARLIAMENT_REMINDER_LOOKAHEAD_MINUTES = int(
    os.environ.get("PARLIAMENT_REMINDER_LOOKAHEAD_MINUTES", "60")
)
_mail_import_worker_started = False
_mail_import_worker_lock = threading.Lock()


def _load_firebase_credentials():
    cred_path = os.environ.get("FIREBASE_CRED_PATH")
    cred_b64 = os.environ.get("FIREBASE_CRED_B64")

    if cred_b64:
        try:
            decoded = base64.b64decode(cred_b64).decode("utf-8")
            payload = json.loads(decoded)
            return credentials.Certificate(payload)
        except Exception as exc:
            raise RuntimeError(
                "Invalid FIREBASE_CRED_B64 (must be base64-encoded service-account JSON)."
            ) from exc

    if cred_path:
        if not os.path.exists(cred_path):
            raise RuntimeError(f"FIREBASE_CRED_PATH file not found: {cred_path}")
        return credentials.Certificate(cred_path)

    raise RuntimeError(
        "Firebase admin credential missing. Set FIREBASE_CRED_PATH or FIREBASE_CRED_B64."
    )


def _initialize_firebase_app():
    if firebase_admin._apps:
        return firebase_admin.get_app()

    cred = _load_firebase_credentials()
    options = {"projectId": FIREBASE_PROJECT_ID} if FIREBASE_PROJECT_ID else None
    if options:
        return firebase_admin.initialize_app(cred, options)
    return firebase_admin.initialize_app(cred)


# Fail fast at startup when backend secrets are missing/misconfigured.
_initialize_firebase_app()

class SlotParticipantOverrideAdd(BaseModel):
    user_id: UUID


class SlotParticipantOverrideRemove(BaseModel):
    user_id: UUID


class SlotAssignmentUpsert(BaseModel):
    user_id: UUID
    assignment_type: Literal["active", "ruf"]


class MessageCreate(BaseModel):
    title: str
    content: str
    is_urgent: bool = False
    created_by_user_id: str

class AdminUserCreate(BaseModel):
    email: str
    first_name: str
    last_name: str
    role: Literal["admin", "staff", "mdb", "pgf"]
    is_mdb: bool = False
    assigned_mdb_user_id: Optional[UUID] = None
    is_faction_staff: bool = False
    is_active: bool = True
    is_planner_exempt: bool = False
    create_firebase_auth: bool = True
    firebase_password: Optional[str] = None


class AdminUserUpdate(BaseModel):
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: Optional[Literal["admin", "staff", "mdb", "pgf"]] = None
    is_mdb: Optional[bool] = None
    assigned_mdb_user_id: Optional[UUID] = None
    is_faction_staff: Optional[bool] = None
    is_active: Optional[bool] = None
    is_planner_exempt: Optional[bool] = None


class AdminStaffCreate(BaseModel):
    email: str
    first_name: str
    last_name: str
    assigned_mdb_user_id: Optional[UUID] = None
    is_faction_staff: bool = False
    is_active: bool = True
    create_firebase_auth: bool = True
    firebase_password: Optional[str] = None


class AdminStaffUpdate(BaseModel):
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    assigned_mdb_user_id: Optional[UUID] = None
    is_faction_staff: Optional[bool] = None
    is_active: Optional[bool] = None


class AdminUserOut(BaseModel):
    id: UUID
    email: str
    first_name: str | None
    last_name: str | None
    role: str | None
    is_mdb: bool
    assigned_mdb_user_id: UUID | None
    assigned_mdb_name: str | None
    is_faction_staff: bool
    is_active: bool
    is_planner_exempt: bool


class QuickInfoTopicCreate(BaseModel):
    title: str
    slug: str | None = None
    sort_order: int = 0
    is_active: bool = True


class QuickInfoTopicUpdate(BaseModel):
    title: str | None = None
    slug: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class QuickInfoBulletCreate(BaseModel):
    bullet_text: str
    sort_order: int = 0


class QuickInfoBulletUpdate(BaseModel):
    bullet_text: str | None = None
    sort_order: int | None = None

class LoginRequest(BaseModel):
    email: str


class LoginResponse(BaseModel):
    ok: bool
    user_id: str
    email: str
    role: str
    first_name: str | None = None
    last_name: str | None = None
    
class AdminSlotCreate(BaseModel):
    slot_date: date
    slot_code: str
    start_time: str
    end_time: str | None = None
    open_end: bool = False


class AdminSlotUpdate(BaseModel):
    slot_date: date | None = None
    slot_code: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    open_end: bool | None = None


class AdminSlotsBulkDelete(BaseModel):
    date_from: date
    date_to: date
    
class AdminGroupCreate(BaseModel):
    name: str


class AdminGroupUpdate(BaseModel):
    name: str


class AdminGroupMembersUpdate(BaseModel):
    user_ids: list[UUID]
    
    
class SlotWeekPreviewRequest(BaseModel):
    week_start: date
    template_id: UUID | None = None


class SlotWeekSlotInput(BaseModel):
    slot_date: date
    weekday: str
    slot_code: str
    slot_order: int
    start_time: str
    end_time: str | None = None
    open_end: bool = False
    template_item_id: UUID | None = None


class SlotWeekCreateRequest(BaseModel):
    week_start: date
    week_end: date
    template_id: UUID | None = None
    slots: list[SlotWeekSlotInput]


class SlotTemplateCreate(BaseModel):
    name: str
    is_default: bool = False
    default_active_count: int = 24
    default_ruf_count: int = 24


class SlotTemplateUpdate(BaseModel):
    name: str | None = None
    is_default: bool | None = None
    default_active_count: int | None = None
    default_ruf_count: int | None = None


class SlotTemplateItemCreate(BaseModel):
    weekday: str
    slot_code: str
    slot_order: int
    day_offset: int
    start_time: str
    end_time: str | None = None
    open_end: bool = False
    required_active_count: int | None = None
    required_ruf_count: int | None = None
    full_attendance: bool = False


class SlotTemplateItemUpdate(BaseModel):
    weekday: str | None = None
    slot_code: str | None = None
    slot_order: int | None = None
    day_offset: int | None = None
    start_time: str | None = None
    end_time: str | None = None
    open_end: bool | None = None
    required_active_count: int | None = None
    required_ruf_count: int | None = None
    full_attendance: bool | None = None


class SlotTemplateImportRequest(BaseModel):
    raw_text: str


class PersonSlotRuleCreate(BaseModel):
    template_item_id: UUID
    rule_type: Literal["blocked"] = "blocked"


class TemporaryPgfGrantCreate(BaseModel):
    user_id: UUID
    valid_from: datetime
    valid_until: datetime


class PlannerRunCreateRequest(BaseModel):
    week_start: date


class PlannerRunApplyRequest(BaseModel):
    overwrite_existing_planner_assignments: bool = True


DEFAULT_SLOT_TEMPLATE_ITEMS = [
    {"weekday": "Mittwoch", "slot_code": "S01", "slot_order": 1, "start_time": "13:00", "end_time": "15:30", "open_end": False, "day_offset": 2},
    {"weekday": "Mittwoch", "slot_code": "S02", "slot_order": 2, "start_time": "15:30", "end_time": "18:00", "open_end": False, "day_offset": 2},
    {"weekday": "Mittwoch", "slot_code": "S03", "slot_order": 3, "start_time": "18:00", "end_time": None, "open_end": True, "day_offset": 2},

    {"weekday": "Donnerstag", "slot_code": "S04", "slot_order": 4, "start_time": "09:00", "end_time": "11:30", "open_end": False, "day_offset": 3},
    {"weekday": "Donnerstag", "slot_code": "S05", "slot_order": 5, "start_time": "11:30", "end_time": "14:00", "open_end": False, "day_offset": 3},
    {"weekday": "Donnerstag", "slot_code": "S06", "slot_order": 6, "start_time": "14:00", "end_time": "16:30", "open_end": False, "day_offset": 3},
    {"weekday": "Donnerstag", "slot_code": "S07", "slot_order": 7, "start_time": "16:30", "end_time": "19:00", "open_end": False, "day_offset": 3},
    {"weekday": "Donnerstag", "slot_code": "S08", "slot_order": 8, "start_time": "21:30", "end_time": None, "open_end": True, "day_offset": 3},

    {"weekday": "Freitag", "slot_code": "S09", "slot_order": 9, "start_time": "09:00", "end_time": "11:30", "open_end": False, "day_offset": 4},
    {"weekday": "Freitag", "slot_code": "S10", "slot_order": 10, "start_time": "11:30", "end_time": "14:00", "open_end": False, "day_offset": 4},
    {"weekday": "Freitag", "slot_code": "S11", "slot_order": 11, "start_time": "14:00", "end_time": None, "open_end": True, "day_offset": 4},
]

WEEKDAY_TO_OFFSET = {
    "montag": ("Montag", 0),
    "mo": ("Montag", 0),
    "dienstag": ("Dienstag", 1),
    "di": ("Dienstag", 1),
    "mittwoch": ("Mittwoch", 2),
    "mi": ("Mittwoch", 2),
    "donnerstag": ("Donnerstag", 3),
    "do": ("Donnerstag", 3),
    "freitag": ("Freitag", 4),
    "fr": ("Freitag", 4),
    "samstag": ("Samstag", 5),
    "sa": ("Samstag", 5),
    "sonntag": ("Sonntag", 6),
    "so": ("Sonntag", 6),
}



app = FastAPI(title="SPD Präsenzdienst API (Dev)")

_cors_origins_env = os.environ.get("CORS_ORIGINS", "*").strip()
_cors_origins = (
    ["*"]
    if _cors_origins_env == "*"
    else [origin.strip() for origin in _cors_origins_env.split(",") if origin.strip()]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    # Mit wildcard-Origin dürfen keine Credentials aktiviert werden.
    allow_credentials=_cors_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup_background_jobs():
    _start_mail_import_worker()

DB_URL = os.environ.get(
    "DATABASE_URL", "postgresql://spd_app:change_me_strong@localhost:5432/spd_dev"
)

_DIRECT_SLOT_SCHEMA_READY = False
ASSIGNABLE_SLOT_ROLES = ("mdb", "pgf")
DEFAULT_REQUIRED_ACTIVE_COUNT = 24
DEFAULT_REQUIRED_RUF_COUNT = 24


def _role_implies_mdb(role: str | None) -> bool:
    return role in ("mdb", "pgf")


def _effective_is_mdb(role: str | None, explicit_value: bool | None) -> bool:
    if role == "staff":
        return False
    if _role_implies_mdb(role):
        return True
    return bool(explicit_value)


def ensure_user_mdb_schema():
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS is_mdb BOOLEAN NOT NULL DEFAULT false
                """
            )
            cur.execute(
                """
                UPDATE users
                SET is_mdb = true
                WHERE role IN ('mdb', 'pgf')
                  AND COALESCE(is_mdb, false) = false
                """
            )
            cur.execute(
                """
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS is_planner_exempt BOOLEAN NOT NULL DEFAULT false
                """
            )
        conn.commit()


def _seed_default_slot_template(cur) -> None:
    cur.execute("SELECT id FROM slot_templates WHERE is_default = true ORDER BY created_at ASC LIMIT 1")
    default_template = cur.fetchone()
    if default_template:
        template_id = default_template[0]
    else:
        cur.execute(
            """
            INSERT INTO slot_templates (
                id,
                name,
                is_default,
                is_active,
                default_active_count,
                default_ruf_count,
                created_at,
                updated_at
            )
            VALUES (
                gen_random_uuid(),
                'Standardslots',
                true,
                true,
                %s,
                %s,
                now(),
                now()
            )
            RETURNING id
            """,
            (DEFAULT_REQUIRED_ACTIVE_COUNT, DEFAULT_REQUIRED_RUF_COUNT),
        )
        template_id = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM slot_template_items WHERE template_id = %s", (template_id,))
    if cur.fetchone()[0] > 0:
        return

    for item in DEFAULT_SLOT_TEMPLATE_ITEMS:
        cur.execute(
            """
            INSERT INTO slot_template_items (
                id,
                template_id,
                weekday,
                slot_code,
                slot_order,
                day_offset,
                start_time,
                end_time,
                open_end,
                required_active_count,
                required_ruf_count,
                full_attendance,
                created_at,
                updated_at
            )
            VALUES (
                gen_random_uuid(),
                %s,
                %s,
                %s,
                %s,
                %s,
                %s::time,
                %s::time,
                %s,
                NULL,
                NULL,
                false,
                now(),
                now()
            )
            """,
            (
                template_id,
                item["weekday"],
                item["slot_code"],
                item["slot_order"],
                item["day_offset"],
                item["start_time"],
                item["end_time"],
                item["open_end"],
            ),
        )


def _slot_template_row_to_dict(row):
    return {
        "id": str(row[0]),
        "name": row[1],
        "is_default": bool(row[2]),
        "is_active": bool(row[3]),
        "default_active_count": int(row[4]) if row[4] is not None else DEFAULT_REQUIRED_ACTIVE_COUNT,
        "default_ruf_count": int(row[5]) if row[5] is not None else DEFAULT_REQUIRED_RUF_COUNT,
        "item_count": int(row[6]) if len(row) > 6 and row[6] is not None else 0,
    }


def _slot_template_item_row_to_dict(row):
    return {
        "id": str(row[0]),
        "template_id": str(row[1]),
        "weekday": row[2],
        "slot_code": row[3],
        "slot_order": int(row[4]),
        "day_offset": int(row[5]),
        "start_time": str(row[6]) if row[6] else None,
        "end_time": str(row[7]) if row[7] else None,
        "open_end": bool(row[8]),
        "required_active_count": int(row[9]) if row[9] is not None else None,
        "required_ruf_count": int(row[10]) if row[10] is not None else None,
        "full_attendance": bool(row[11]) if len(row) > 11 else False,
    }


def _planner_rule_row_to_dict(row):
    return {
        "id": str(row[0]),
        "user_id": str(row[1]),
        "template_item_id": str(row[2]),
        "rule_type": row[3],
        "template_name": row[4],
        "weekday": row[5],
        "slot_code": row[6],
        "slot_order": int(row[7]),
        "start_time": str(row[8]) if row[8] else None,
        "end_time": str(row[9]) if row[9] else None,
        "open_end": bool(row[10]),
    }


def _parse_slot_template_import(raw_text: str) -> list[dict]:
    lines = [line.strip() for line in raw_text.replace("\r", "").split("\n") if line.strip()]
    if not lines:
        raise HTTPException(status_code=400, detail="Importtext ist leer")

    imported_items: list[dict] = []
    slot_number = 1
    slot_prefix = "S"

    for line_number, line in enumerate(lines, start=1):
        if "\t" in line:
            columns = [column.strip() for column in line.split("\t")]
        elif ";" in line:
            columns = [column.strip() for column in line.split(";")]
        else:
            columns = [column.strip() for column in re.split(r"\s{2,}", line) if column.strip()]

        columns = [column for column in columns if column != ""]
        if len(columns) < 3:
            raise HTTPException(
                status_code=400,
                detail=f"Zeile {line_number} konnte nicht gelesen werden. Erwartet wird Wochentag plus mindestens ein Zeitfenster.",
            )

        first_key = columns[0].strip().lower()
        if first_key in WEEKDAY_TO_OFFSET:
            weekday_name, day_offset = WEEKDAY_TO_OFFSET[first_key]
            time_columns = columns[1:]
        else:
            slot_prefix_candidate = columns[0].strip().upper()
            if re.fullmatch(r"[A-Z]", slot_prefix_candidate):
                slot_prefix = slot_prefix_candidate
            weekday_key = columns[1].strip().lower()
            if weekday_key not in WEEKDAY_TO_OFFSET:
                raise HTTPException(
                    status_code=400,
                    detail=f"Zeile {line_number}: Unbekannter Wochentag '{columns[1]}'.",
                )
            weekday_name, day_offset = WEEKDAY_TO_OFFSET[weekday_key]
            time_columns = columns[2:]

        if not time_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Zeile {line_number} enthält keine Zeitfenster.",
            )

        for time_column in time_columns:
            cleaned_time = time_column.strip()
            if not cleaned_time:
                continue

            match = re.match(r"^(\d{1,2}:\d{2})\s*-\s*(Ende|\d{1,2}:\d{2})$", cleaned_time, flags=re.IGNORECASE)
            if not match:
                raise HTTPException(
                    status_code=400,
                    detail=f"Zeile {line_number}: Zeitfenster '{time_column}' hat nicht das erwartete Format 'HH:MM - HH:MM' oder 'HH:MM - Ende'.",
                )

            start_time = match.group(1)
            end_token = match.group(2)
            open_end = end_token.lower() == "ende"

            imported_items.append(
                {
                    "weekday": weekday_name,
                    "slot_code": f"{slot_prefix}{slot_number:02d}",
                    "slot_order": slot_number,
                    "day_offset": day_offset,
                    "start_time": start_time,
                    "end_time": None if open_end else end_token,
                    "open_end": open_end,
                }
            )
            slot_number += 1

    if not imported_items:
        raise HTTPException(status_code=400, detail="Aus dem Import konnten keine Slots erzeugt werden")

    return imported_items


def _get_default_slot_template_id(cur) -> UUID:
    cur.execute(
        """
        SELECT id
        FROM slot_templates
        WHERE is_default = true
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
        """
    )
    row = cur.fetchone()
    if row:
        return row[0]

    _seed_default_slot_template(cur)
    cur.execute(
        """
        SELECT id
        FROM slot_templates
        WHERE is_default = true
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
        """
    )
    seeded = cur.fetchone()
    if not seeded:
        raise HTTPException(status_code=500, detail="Kein Standardslot-Template verfuegbar")
    return seeded[0]


def _resolve_slot_template_id(cur, template_id: UUID | None) -> UUID:
    if template_id is None:
        return _get_default_slot_template_id(cur)

    cur.execute("SELECT id FROM slot_templates WHERE id = %s", (template_id,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Slot-Template nicht gefunden")
    return row[0]


def _load_slot_template_items(cur, template_id: UUID):
    cur.execute(
        """
        SELECT
            id,
            template_id,
            weekday,
            slot_code,
            slot_order,
            day_offset,
            start_time,
            end_time,
            COALESCE(open_end, false) AS open_end,
            required_active_count,
            required_ruf_count,
            COALESCE(full_attendance, false) AS full_attendance
        FROM slot_template_items
        WHERE template_id = %s
        ORDER BY day_offset ASC, slot_order ASC, start_time ASC, slot_code ASC
        """,
        (template_id,),
    )
    return cur.fetchall()


def ensure_direct_slot_assignment_schema():
    global _DIRECT_SLOT_SCHEMA_READY
    if _DIRECT_SLOT_SCHEMA_READY:
        return

    ensure_user_mdb_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS planning_runs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    week_start DATE,
                    week_end DATE,
                    status TEXT NOT NULL DEFAULT 'draft',
                    input_snapshot JSONB,
                    warnings JSONB,
                    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS slot_templates (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name TEXT NOT NULL,
                    is_default BOOLEAN NOT NULL DEFAULT false,
                    is_active BOOLEAN NOT NULL DEFAULT true,
                    default_active_count INTEGER NOT NULL DEFAULT 24,
                    default_ruf_count INTEGER NOT NULL DEFAULT 24,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS slot_template_items (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    template_id UUID NOT NULL REFERENCES slot_templates(id) ON DELETE CASCADE,
                    weekday TEXT NOT NULL,
                    slot_code TEXT NOT NULL,
                    slot_order INTEGER NOT NULL,
                    day_offset INTEGER NOT NULL,
                    start_time TIME NOT NULL,
                    end_time TIME,
                    open_end BOOLEAN NOT NULL DEFAULT false,
                    required_active_count INTEGER,
                    required_ruf_count INTEGER,
                    full_attendance BOOLEAN NOT NULL DEFAULT false,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                ALTER TABLE slot_templates
                ADD COLUMN IF NOT EXISTS default_active_count INTEGER NOT NULL DEFAULT 24
                """
            )
            cur.execute(
                """
                ALTER TABLE slot_templates
                ADD COLUMN IF NOT EXISTS default_ruf_count INTEGER NOT NULL DEFAULT 24
                """
            )
            cur.execute(
                """
                ALTER TABLE slot_template_items
                ADD COLUMN IF NOT EXISTS full_attendance BOOLEAN NOT NULL DEFAULT false
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS person_slot_rules (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    template_item_id UUID NOT NULL REFERENCES slot_template_items(id) ON DELETE CASCADE,
                    rule_type TEXT NOT NULL DEFAULT 'blocked',
                    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                    UNIQUE (user_id, template_item_id, rule_type)
                )
                """
            )
            cur.execute(
                """
                ALTER TABLE planning_runs
                ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES slot_templates(id) ON DELETE SET NULL
                """
            )
            cur.execute(
                """
                ALTER TABLE planning_runs
                ADD COLUMN IF NOT EXISTS random_seed INTEGER NOT NULL DEFAULT 0
                """
            )
            cur.execute(
                """
                ALTER TABLE planning_runs
                ADD COLUMN IF NOT EXISTS summary_json JSONB
                """
            )
            cur.execute(
                """
                ALTER TABLE planning_runs
                ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP WITH TIME ZONE
                """
            )
            cur.execute(
                """
                ALTER TABLE planning_runs
                ADD COLUMN IF NOT EXISTS applied_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS planning_run_suggestions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    planning_run_id UUID NOT NULL REFERENCES planning_runs(id) ON DELETE CASCADE,
                    slot_id UUID NOT NULL REFERENCES duty_slots(id) ON DELETE CASCADE,
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    assignment_type TEXT NOT NULL DEFAULT 'active',
                    score DOUBLE PRECISION NOT NULL DEFAULT 0,
                    reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
                    score_details JSONB NOT NULL DEFAULT '{}'::jsonb,
                    is_manual_fixed BOOLEAN NOT NULL DEFAULT false,
                    is_late_slot BOOLEAN NOT NULL DEFAULT false,
                    is_last_slot_of_day BOOLEAN NOT NULL DEFAULT false,
                    is_friday_last_slot BOOLEAN NOT NULL DEFAULT false,
                    required_active_count INTEGER NOT NULL DEFAULT 0,
                    required_ruf_count INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                    UNIQUE (planning_run_id, slot_id, user_id)
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS planner_person_week_stats (
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    week_start DATE NOT NULL,
                    week_end DATE,
                    planning_run_id UUID REFERENCES planning_runs(id) ON DELETE SET NULL,
                    total_slots INTEGER NOT NULL DEFAULT 0,
                    active_slots INTEGER NOT NULL DEFAULT 0,
                    ruf_slots INTEGER NOT NULL DEFAULT 0,
                    late_slots INTEGER NOT NULL DEFAULT 0,
                    friday_last_slots INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                    PRIMARY KEY (user_id, week_start)
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS planner_person_stats (
                    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    total_slots INTEGER NOT NULL DEFAULT 0,
                    active_slots INTEGER NOT NULL DEFAULT 0,
                    ruf_slots INTEGER NOT NULL DEFAULT 0,
                    late_slots INTEGER NOT NULL DEFAULT 0,
                    friday_last_slots INTEGER NOT NULL DEFAULT 0,
                    planned_weeks INTEGER NOT NULL DEFAULT 0,
                    last_planned_week_start DATE,
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_slot_template_items_unique_order
                ON slot_template_items(template_id, slot_order)
                """
            )
            cur.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_one_default_slot_template
                ON slot_templates((is_default))
                WHERE is_default = true
                """
            )
            cur.execute(
                """
                ALTER TABLE slot_assignments
                ADD COLUMN IF NOT EXISTS assignment_type TEXT NOT NULL DEFAULT 'active'
                """
            )
            cur.execute(
                """
                ALTER TABLE slot_assignments
                ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
                """
            )
            cur.execute(
                """
                ALTER TABLE slot_assignments
                ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false
                """
            )
            cur.execute(
                """
                ALTER TABLE slot_assignments
                ADD COLUMN IF NOT EXISTS notes TEXT
                """
            )
            cur.execute(
                """
                ALTER TABLE slot_assignments
                ADD COLUMN IF NOT EXISTS planning_run_id UUID REFERENCES planning_runs(id) ON DELETE SET NULL
                """
            )
            cur.execute(
                """
                ALTER TABLE slot_assignments
                ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
                """
            )
            cur.execute(
                """
                ALTER TABLE slot_assignments
                ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
                """
            )
            cur.execute(
                """
                ALTER TABLE duty_slots
                ADD COLUMN IF NOT EXISTS template_item_id UUID REFERENCES slot_template_items(id) ON DELETE SET NULL
                """
            )
            cur.execute(
                """
                DELETE FROM slot_assignments a
                USING slot_assignments b
                WHERE a.ctid < b.ctid
                  AND a.slot_id = b.slot_id
                  AND a.user_id = b.user_id
                """
            )
            cur.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_slot_assignments_slot_user_unique
                ON slot_assignments(slot_id, user_id)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_slot_assignments_user_id
                ON slot_assignments(user_id)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_slot_assignments_slot_id
                ON slot_assignments(slot_id)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_planning_runs_week_start
                ON planning_runs(week_start, created_at DESC)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_planning_run_suggestions_run_id
                ON planning_run_suggestions(planning_run_id)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_planner_person_week_stats_week_start
                ON planner_person_week_stats(week_start)
                """
            )
            cur.execute(
                """
                UPDATE slot_assignments
                SET assignment_type = CASE
                    WHEN assignment_type IN ('active', 'ruf') THEN assignment_type
                    ELSE 'active'
                END,
                    source = COALESCE(NULLIF(source, ''), 'manual'),
                    updated_at = COALESCE(updated_at, now())
                """
            )
            cur.execute(
                """
                INSERT INTO slot_assignments (id, slot_id, user_id, assignment_type, source)
                SELECT gen_random_uuid(), s.id, u.id, 'active', 'generated'
                FROM duty_slots s
                JOIN users u ON u.group_id = s.base_group_id
                WHERE s.base_group_id IS NOT NULL
                ON CONFLICT (slot_id, user_id) DO NOTHING
                """
            )
            _seed_default_slot_template(cur)
        conn.commit()

    _DIRECT_SLOT_SCHEMA_READY = True


def _normalise_assignment_type(value: str | None) -> str:
    return "ruf" if value == "ruf" else "active"


def _slot_row_to_dict(r):
    active_count = int(r[6]) if len(r) > 6 and r[6] is not None else 0
    ruf_count = int(r[7]) if len(r) > 7 and r[7] is not None else 0
    return {
        "id": str(r[0]),
        "slot_date": r[1].isoformat() if r[1] else None,
        "slot_code": r[2],
        "start_time": str(r[3]) if r[3] else None,
        "end_time": str(r[4]) if r[4] else None,
        "open_end": bool(r[5]),
        "active_count": active_count,
        "ruf_count": ruf_count,
    }


def _slot_week_row_to_dict(r):
    return {
        "week_start": r[0].isoformat() if r[0] else None,
        "week_end": r[1].isoformat() if r[1] else None,
        "slot_count": int(r[2]) if r[2] is not None else 0,
        "day_count": int(r[3]) if r[3] is not None else 0,
        "active_assignment_count": int(r[4]) if r[4] is not None else 0,
        "ruf_assignment_count": int(r[5]) if r[5] is not None else 0,
    }


def _slot_dict_from_row(r):
    return {
        "id": str(r[0]),
        "date": str(r[1]),
        "slot_code": r[2],
        "weekday": r[3],
        "start_time": str(r[4]) if r[4] else None,
        "end_time": str(r[5]) if r[5] else None,
        "open_end": bool(r[6]),
        "base_group": r[7] if len(r) > 7 else None,
    }


def _user_dict_from_row(r):
    return {
        "id": str(r[0]),
        "first_name": r[1],
        "last_name": r[2],
        "group": r[3],
    }


def _time_to_minutes(value) -> int:
    if value is None:
        return 0
    return value.hour * 60 + value.minute


def _slot_is_late(*, start_time, open_end: bool, is_last_slot_of_day: bool) -> bool:
    if open_end:
        return True
    if start_time and _time_to_minutes(start_time) >= (17 * 60 + 30):
        return True
    return is_last_slot_of_day


def _collect_week_slot_flags(cur, week_start: date) -> tuple[date | None, dict[str, dict[str, bool]]]:
    cur.execute(
        """
        SELECT
            s.id,
            s.slot_date,
            COALESCE(i.weekday, '') AS weekday,
            s.slot_code,
            COALESCE(i.slot_order, 0) AS slot_order,
            s.start_time,
            COALESCE(s.open_end, false) AS open_end
        FROM duty_slots s
        LEFT JOIN slot_template_items i
          ON i.id = s.template_item_id
        WHERE date_trunc('week', s.slot_date)::date = %s::date
        ORDER BY s.slot_date ASC, COALESCE(i.slot_order, 0) ASC, s.start_time ASC, s.slot_code ASC
        """,
        (week_start,),
    )
    rows = cur.fetchall()
    if not rows:
        return None, {}

    rows_by_date: dict[date, list[tuple]] = {}
    for row in rows:
        rows_by_date.setdefault(row[1], []).append(row)

    last_slot_ids_by_date: dict[date, str] = {}
    for slot_date, slot_rows in rows_by_date.items():
        last_row = max(
            slot_rows,
            key=lambda item: (
                int(item[4] or 0),
                _time_to_minutes(item[5]),
                item[3] or "",
            ),
        )
        last_slot_ids_by_date[slot_date] = str(last_row[0])

    slot_flags: dict[str, dict[str, bool]] = {}
    for row in rows:
        slot_id = str(row[0])
        slot_date = row[1]
        is_last_slot_of_day = last_slot_ids_by_date.get(slot_date) == slot_id
        weekday = row[2] or _weekday_name_for_date(slot_date)
        slot_flags[slot_id] = {
            "is_late_slot": _slot_is_late(
                start_time=row[5],
                open_end=bool(row[6]),
                is_last_slot_of_day=is_last_slot_of_day,
            ),
            "is_friday_last_slot": weekday.lower() == "freitag" and is_last_slot_of_day,
        }

    return max(row[1] for row in rows), slot_flags


def _rebuild_planner_stats_for_weeks(cur, week_starts: list[date]) -> None:
    unique_weeks = sorted({week_start for week_start in week_starts if week_start is not None})

    for week_start in unique_weeks:
        week_end, slot_flags = _collect_week_slot_flags(cur, week_start)

        cur.execute(
            """
            DELETE FROM planner_person_week_stats
            WHERE week_start = %s
            """,
            (week_start,),
        )

        if not slot_flags:
            continue

        cur.execute(
            """
            SELECT
                sa.user_id,
                COALESCE(sa.assignment_type, 'active') AS assignment_type,
                sa.slot_id
            FROM slot_assignments sa
            JOIN duty_slots s
              ON s.id = sa.slot_id
            WHERE date_trunc('week', s.slot_date)::date = %s::date
            """,
            (week_start,),
        )
        assignment_rows = cur.fetchall()
        if not assignment_rows:
            continue

        cur.execute(
            """
            SELECT id, week_end
            FROM planning_runs
            WHERE week_start = %s
              AND status = 'applied'
            ORDER BY applied_at DESC NULLS LAST, created_at DESC
            LIMIT 1
            """,
            (week_start,),
        )
        run_row = cur.fetchone()
        planning_run_id = run_row[0] if run_row else None
        effective_week_end = run_row[1] if run_row and run_row[1] else week_end

        summary_by_user: dict[str, dict[str, int]] = {}
        for user_id, assignment_type, slot_id in assignment_rows:
            user_key = str(user_id)
            flags = slot_flags.get(str(slot_id), {})
            summary = summary_by_user.setdefault(
                user_key,
                {
                    "total_slots": 0,
                    "active_slots": 0,
                    "ruf_slots": 0,
                    "late_slots": 0,
                    "friday_last_slots": 0,
                },
            )
            summary["total_slots"] += 1
            if _normalise_assignment_type(assignment_type) == "ruf":
                summary["ruf_slots"] += 1
            else:
                summary["active_slots"] += 1
            if flags.get("is_late_slot"):
                summary["late_slots"] += 1
            if flags.get("is_friday_last_slot"):
                summary["friday_last_slots"] += 1

        for user_id, summary in summary_by_user.items():
            cur.execute(
                """
                INSERT INTO planner_person_week_stats (
                    user_id,
                    week_start,
                    week_end,
                    planning_run_id,
                    total_slots,
                    active_slots,
                    ruf_slots,
                    late_slots,
                    friday_last_slots,
                    created_at,
                    updated_at
                )
                VALUES (
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    now(),
                    now()
                )
                """,
                (
                    user_id,
                    week_start,
                    effective_week_end,
                    planning_run_id,
                    summary["total_slots"],
                    summary["active_slots"],
                    summary["ruf_slots"],
                    summary["late_slots"],
                    summary["friday_last_slots"],
                ),
            )

    _refresh_planner_person_stats(cur)


def _retroactively_remove_user_assignments(
    cur,
    *,
    user_id: UUID | str,
    template_item_id: UUID | str | None = None,
) -> dict[str, object]:
    params: list[UUID | str] = [user_id]
    template_filter = ""
    if template_item_id is not None:
        template_filter = "AND s.template_item_id = %s"
        params.append(template_item_id)

    cur.execute(
        f"""
        DELETE FROM slot_assignments sa
        USING duty_slots s
        WHERE sa.slot_id = s.id
          AND sa.user_id = %s
          {template_filter}
        RETURNING date_trunc('week', s.slot_date)::date
        """,
        params,
    )
    deleted_rows = cur.fetchall()
    affected_weeks = sorted({row[0] for row in deleted_rows if row and row[0] is not None})

    if affected_weeks:
        _rebuild_planner_stats_for_weeks(cur, affected_weeks)

    return {
        "removed_assignment_count": len(deleted_rows),
        "affected_week_count": len(affected_weeks),
        "affected_weeks": [value.isoformat() for value in affected_weeks],
    }


def _seed_for_week(week_start: date) -> int:
    return int(f"{week_start.year:04d}{week_start.month:02d}{week_start.day:02d}") + random.randint(1, 9999)


def _planner_stats_row_to_dict(row):
    return {
        "user_id": str(row[0]),
        "total_slots": int(row[1] or 0),
        "active_slots": int(row[2] or 0),
        "ruf_slots": int(row[3] or 0),
        "late_slots": int(row[4] or 0),
        "friday_last_slots": int(row[5] or 0),
        "planned_weeks": int(row[6] or 0),
        "last_planned_week_start": row[7].isoformat() if row[7] else None,
    }


def _planner_run_row_to_dict(row):
    summary_value = row[9]
    if isinstance(summary_value, str):
        try:
            summary_value = json.loads(summary_value)
        except json.JSONDecodeError:
            summary_value = {}
    return {
        "id": str(row[0]),
        "week_start": row[1].isoformat() if row[1] else None,
        "week_end": row[2].isoformat() if row[2] else None,
        "status": row[3],
        "template_id": str(row[4]) if row[4] else None,
        "template_name": row[5],
        "random_seed": int(row[6] or 0),
        "created_at": row[7].isoformat() if row[7] else None,
        "applied_at": row[8].isoformat() if row[8] else None,
        "summary": summary_value if summary_value else {},
    }


def _load_planner_run_detail(cur, run_id: UUID | str):
    cur.execute(
        """
        SELECT
            r.id,
            r.week_start,
            r.week_end,
            r.status,
            r.template_id,
            t.name,
            COALESCE(r.random_seed, 0),
            r.created_at,
            r.applied_at,
            COALESCE(r.summary_json, '{}'::jsonb),
            COALESCE(r.input_snapshot, '{}'::jsonb),
            COALESCE(r.warnings, '[]'::jsonb)
        FROM planning_runs r
        LEFT JOIN slot_templates t
          ON t.id = r.template_id
        WHERE r.id = %s
        """,
        (run_id,),
    )
    run_row = cur.fetchone()
    if not run_row:
        raise HTTPException(status_code=404, detail="Planer-Lauf nicht gefunden")

    cur.execute(
        """
        SELECT
            s.id,
            s.slot_date,
            COALESCE(i.weekday, '') AS weekday,
            s.slot_code,
            COALESCE(i.slot_order, 0) AS slot_order,
            s.start_time,
            s.end_time,
            COALESCE(s.open_end, false) AS open_end,
            COALESCE(prs.required_active_count, 0) AS required_active_count,
            COALESCE(prs.required_ruf_count, 0) AS required_ruf_count,
            COALESCE(i.full_attendance, false) AS full_attendance,
            COALESCE(prs.is_late_slot, false) AS is_late_slot,
            COALESCE(prs.is_last_slot_of_day, false) AS is_last_slot_of_day,
            COALESCE(prs.is_friday_last_slot, false) AS is_friday_last_slot,
            prs.assignment_type,
            prs.score,
            COALESCE(prs.reason_codes, '[]'::jsonb),
            COALESCE(prs.score_details, '{}'::jsonb),
            COALESCE(prs.is_manual_fixed, false) AS is_manual_fixed,
            u.id,
            u.email,
            u.first_name,
            u.last_name
        FROM planning_run_suggestions prs
        JOIN duty_slots s
          ON s.id = prs.slot_id
        LEFT JOIN slot_template_items i
          ON i.id = s.template_item_id
        JOIN users u
          ON u.id = prs.user_id
        WHERE prs.planning_run_id = %s
        ORDER BY s.slot_date ASC, COALESCE(i.slot_order, 0) ASC, s.start_time ASC, s.slot_code ASC, prs.assignment_type ASC, u.last_name NULLS LAST, u.first_name NULLS LAST
        """,
        (run_id,),
    )
    suggestion_rows = cur.fetchall()

    run = _planner_run_row_to_dict(run_row[:10])
    input_snapshot = run_row[10] or {}
    if isinstance(input_snapshot, str):
        try:
            input_snapshot = json.loads(input_snapshot)
        except json.JSONDecodeError:
            input_snapshot = {}
    warnings = run_row[11] or []
    if isinstance(warnings, str):
        try:
            warnings = json.loads(warnings)
        except json.JSONDecodeError:
            warnings = []

    summary = run.get("summary") or {}
    people_snapshot = {
        entry["id"]: entry
        for entry in input_snapshot.get("people", [])
    }
    person_summaries = {
        entry["user_id"]: entry
        for entry in summary.get("people", [])
    }
    slot_summary_map: dict[str, dict] = {}

    for row in suggestion_rows:
        slot_id = str(row[0])
        slot_entry = slot_summary_map.setdefault(
            slot_id,
            {
                "slot_id": slot_id,
                "slot_date": row[1].isoformat() if row[1] else None,
                "weekday": row[2],
                "slot_code": row[3],
                "slot_order": int(row[4] or 0),
                "start_time": str(row[5]) if row[5] else None,
                "end_time": str(row[6]) if row[6] else None,
                "open_end": bool(row[7]),
                "required_active_count": int(row[8] or 0),
                "required_ruf_count": int(row[9] or 0),
                "full_attendance": bool(row[10]),
                "is_late_slot": bool(row[11]),
                "is_last_slot_of_day": bool(row[12]),
                "is_friday_last_slot": bool(row[13]),
                "assignments": [],
            },
        )

        user_id = str(row[19])
        person_snapshot = people_snapshot.get(user_id, {})
        slot_entry["assignments"].append(
            {
                "user_id": user_id,
                "name": (
                    f"{row[21] or ''} {row[22] or ''}".strip()
                    or row[20]
                ),
                "email": row[20],
                "assignment_type": row[14],
                "score": float(row[15] or 0),
                "reason_codes": json.loads(row[16]) if isinstance(row[16], str) else (row[16] or []),
                "score_details": json.loads(row[17]) if isinstance(row[17], str) else (row[17] or {}),
                "is_manual_fixed": bool(row[18]),
                "history_total_slots": int(person_snapshot.get("history_total_slots", 0)),
                "history_late_slots": int(person_snapshot.get("history_late_slots", 0)),
                "history_friday_last_slots": int(person_snapshot.get("history_friday_last_slots", 0)),
            }
        )

    return {
        "run": run,
        "summary": summary,
        "people": list(person_summaries.values()),
        "slots": list(slot_summary_map.values()),
        "warnings": warnings,
    }


def _upsert_slot_assignment(
    cur,
    slot_id: UUID | str,
    user_id: UUID | str,
    assignment_type: str,
    *,
    source: str = "manual",
    locked: bool = False,
    planning_run_id: UUID | str | None = None,
):
    cur.execute(
        """
        INSERT INTO slot_assignments (
            id, slot_id, user_id, assignment_type, source, locked, planning_run_id, created_at, updated_at
        )
        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, now(), now())
        ON CONFLICT (slot_id, user_id)
        DO UPDATE SET
            assignment_type = EXCLUDED.assignment_type,
            source = EXCLUDED.source,
            locked = EXCLUDED.locked,
            planning_run_id = EXCLUDED.planning_run_id,
            updated_at = now()
        """,
        (slot_id, user_id, _normalise_assignment_type(assignment_type), source, locked, planning_run_id),
    )


def _delete_slot_assignment(cur, slot_id: UUID | str, user_id: UUID | str):
    cur.execute(
        """
        DELETE FROM slot_assignments
        WHERE slot_id = %s
          AND user_id = %s
        """,
        (slot_id, user_id),
    )


def _swap_slot_assignments(
    cur,
    *,
    slot_a_id: UUID | str,
    slot_a_from_user_id: UUID | str,
    slot_a_to_user_id: UUID | str,
    slot_b_id: UUID | str,
    slot_b_from_user_id: UUID | str,
    slot_b_to_user_id: UUID | str,
    source: str = "exchange",
):
    cur.execute(
        """
        SELECT assignment_type
        FROM slot_assignments
        WHERE slot_id = %s AND user_id = %s
        """,
        (slot_a_id, slot_a_from_user_id),
    )
    row_a = cur.fetchone()
    if not row_a:
        raise HTTPException(status_code=400, detail="Ausgangszuweisung für Slot A fehlt")

    cur.execute(
        """
        SELECT assignment_type
        FROM slot_assignments
        WHERE slot_id = %s AND user_id = %s
        """,
        (slot_b_id, slot_b_from_user_id),
    )
    row_b = cur.fetchone()
    if not row_b:
        raise HTTPException(status_code=400, detail="Ausgangszuweisung für Slot B fehlt")

    assignment_type_a = _normalise_assignment_type(row_a[0])
    assignment_type_b = _normalise_assignment_type(row_b[0])

    _delete_slot_assignment(cur, slot_a_id, slot_a_from_user_id)
    _delete_slot_assignment(cur, slot_b_id, slot_b_from_user_id)
    _upsert_slot_assignment(
        cur,
        slot_a_id,
        slot_a_to_user_id,
        assignment_type_a,
        source=source,
    )
    _upsert_slot_assignment(
        cur,
        slot_b_id,
        slot_b_to_user_id,
        assignment_type_b,
        source=source,
    )

def get_current_user_from_firebase(authorization: str | None):
    _get_firebase_app()

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.replace("Bearer ", "").strip()

    try:
        decoded = firebase_auth.verify_id_token(token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid firebase token: {e}")

    firebase_uid = decoded.get("uid")
    email = decoded.get("email")

    if not firebase_uid or not email:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, email, first_name, last_name, role, COALESCE(is_active, true), firebase_uid
                FROM users
                WHERE lower(email) = lower(%s)
                """,
                (email,),
            )
            row = cur.fetchone()

            if not row:
                raise HTTPException(status_code=403, detail="User not found in DB")

            if not row[5]:
                raise HTTPException(status_code=403, detail="User inactive")

            if row[6] is None:
                cur.execute(
                    "UPDATE users SET firebase_uid = %s WHERE id = %s",
                    (firebase_uid, row[0]),
                )
                conn.commit()
            elif row[6] != firebase_uid:
                raise HTTPException(status_code=403, detail="UID mismatch")

    # Fetch group_id and assigned_mdb_user_id for session
    with psycopg.connect(DB_URL) as conn2:
        with conn2.cursor() as cur2:
            cur2.execute(
                "SELECT group_id, assigned_mdb_user_id FROM users WHERE id = %s",
                (row[0],),
            )
            extra = cur2.fetchone()

    return {
        "id": str(row[0]),
        "email": row[1],
        "first_name": row[2],
        "last_name": row[3],
        "role": row[4],
        "group_id": str(extra[0]) if extra and extra[0] else None,
        "assigned_mdb_user_id": str(extra[1]) if extra and extra[1] else None,
    }


def _resolve_actor_scope(authorization: str | None):
    auth_user = get_current_user_from_firebase(authorization)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    email,
                    first_name,
                    last_name,
                    role,
                    group_id,
                    assigned_mdb_user_id
                FROM users
                WHERE id = %s
                """,
                (auth_user["id"],),
            )
            actor_row = cur.fetchone()
            if not actor_row:
                raise HTTPException(status_code=403, detail="User not found")

            actor = {
                "id": str(actor_row[0]),
                "email": actor_row[1],
                "first_name": actor_row[2],
                "last_name": actor_row[3],
                "role": actor_row[4],
                "group_id": str(actor_row[5]) if actor_row[5] else None,
                "assigned_mdb_user_id": str(actor_row[6]) if actor_row[6] else None,
            }

            principal_id = actor["id"]
            if actor["role"] == "staff":
                if not actor["assigned_mdb_user_id"]:
                    raise HTTPException(
                        status_code=403,
                        detail="Mitarbeiter ist keinem MdB zugewiesen",
                    )
                principal_id = actor["assigned_mdb_user_id"]

            cur.execute(
                """
                SELECT
                    id,
                    email,
                    first_name,
                    last_name,
                    role,
                    group_id
                FROM users
                WHERE id = %s
                """,
                (principal_id,),
            )
            principal_row = cur.fetchone()
            if not principal_row:
                raise HTTPException(status_code=404, detail="Principal user not found")

            principal = {
                "id": str(principal_row[0]),
                "email": principal_row[1],
                "first_name": principal_row[2],
                "last_name": principal_row[3],
                "role": principal_row[4],
                "group_id": str(principal_row[5]) if principal_row[5] else None,
            }

    return {
        "actor": actor,
        "principal": principal,
        "is_admin": actor["role"] in ("admin", "pgf"),
    }


def require_admin(authorization: str | None):
    scope = _resolve_actor_scope(authorization)
    if not scope["is_admin"]:
        raise HTTPException(status_code=403, detail="Admin or PGF required")
    return scope["actor"]


def ensure_temporary_pgf_grants_table():
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS temporary_pgf_grants (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    valid_from TIMESTAMPTZ NOT NULL,
                    valid_until TIMESTAMPTZ NOT NULL,
                    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_temporary_pgf_grants_user_id
                ON temporary_pgf_grants(user_id)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_temporary_pgf_grants_valid_from
                ON temporary_pgf_grants(valid_from)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_temporary_pgf_grants_valid_until
                ON temporary_pgf_grants(valid_until)
                """
            )
        conn.commit()


def _parse_bundestag_timestamp(value: str | None) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y%m%d%H%M%S").replace(tzinfo=EUROPE_BERLIN)
    except ValueError:
        return None


def _parse_iso_datetime(value: str) -> datetime:
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail="Parameter 'at' muss ISO-8601 sein, z. B. 2026-06-11T15:45:00+02:00",
        ) from exc

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=EUROPE_BERLIN)
    return parsed.astimezone(EUROPE_BERLIN)


def _iso_or_none(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _bundestag_fetch_xml(url: str) -> str:
    now = datetime.now(timezone.utc)
    with _bundestag_live_cache_lock:
        cached = _bundestag_live_cache.get(url)
        if cached and (now - cached[0]).total_seconds() < BUNDESTAG_LIVE_CACHE_SECONDS:
            return cached[1]

    try:
        resp = requests.get(url, timeout=15, verify=certifi.where())
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Bundestag-Live-Daten konnten nicht geladen werden: {exc}",
        ) from exc

    text = resp.text
    with _bundestag_live_cache_lock:
        _bundestag_live_cache[url] = (now, text)
    return text


def _bundestag_fetch_bytes(url: str) -> bytes:
    now = datetime.now(timezone.utc)
    with _bundestag_live_cache_lock:
        cached = _bundestag_live_bytes_cache.get(url)
        if cached and (now - cached[0]).total_seconds() < BUNDESTAG_LIVE_CACHE_SECONDS:
            return cached[1]

    try:
        resp = requests.get(url, timeout=20, verify=certifi.where())
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Bundestag-Dokument konnte nicht geladen werden: {exc}",
        ) from exc

    content = resp.content
    with _bundestag_live_cache_lock:
        _bundestag_live_bytes_cache[url] = (now, content)
    return content


def _bundestag_xml_text(parent: ET.Element, tag: str) -> str:
    child = parent.find(tag)
    if child is None or child.text is None:
        return ""
    return child.text.strip()


def _parse_bundestag_conferences() -> list[dict]:
    xml_text = _bundestag_fetch_xml(BUNDESTAG_CONFERENCES_URL)

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Bundestag-Live-Daten sind ungueltig formatiert: {exc}",
        ) from exc

    sessions: list[dict] = []
    for session_el in root.findall("tagesordnung"):
        points: list[dict] = []
        for point_el in session_el.findall("./diskussionspunkte/diskussionspunkt"):
            start_at = _parse_bundestag_timestamp(_bundestag_xml_text(point_el, "startzeit"))
            end_at = _parse_bundestag_timestamp(_bundestag_xml_text(point_el, "endzeit"))
            points.append(
                {
                    "start_at": start_at,
                    "end_at": end_at,
                    "status": _bundestag_xml_text(point_el, "status"),
                    "title": _bundestag_xml_text(point_el, "titel"),
                    "article_id": _bundestag_xml_text(point_el, "articleId") or None,
                    "top": _bundestag_xml_text(point_el, "top") or None,
                }
            )

        session_date_text = _bundestag_xml_text(session_el, "date")
        session_date = None
        if session_date_text:
            try:
                session_date = datetime.strptime(session_date_text, "%d.%m.%Y").date()
            except ValueError:
                session_date = None

        sessions.append(
            {
                "date": session_date,
                "date_text": session_date_text or None,
                "active": _bundestag_xml_text(session_el, "active") == "1",
                "session_number": _bundestag_xml_text(session_el, "sitzungsnummer") or None,
                "name": _bundestag_xml_text(session_el, "name") or None,
                "points": points,
            }
        )

    return sessions


def _parse_bundestag_speaker() -> dict:
    xml_text = _bundestag_fetch_xml(BUNDESTAG_SPEAKER_URL)

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Bundestag-Sprecherdaten sind ungueltig formatiert: {exc}",
        ) from exc

    speakers: list[dict] = []
    speakers_parent = root.find("speakers")
    if speakers_parent is not None:
        for speaker_el in speakers_parent.findall("speaker"):
            speakers.append(
                {
                    "topic": _bundestag_xml_text(speaker_el, "topic") or None,
                    "start_at": _parse_bundestag_timestamp(_bundestag_xml_text(speaker_el, "startTime")),
                    "state": _bundestag_xml_text(speaker_el, "state") or None,
                    "name": _bundestag_xml_text(speaker_el, "name") or None,
                    "party": _bundestag_xml_text(speaker_el, "party") or None,
                    "function": _bundestag_xml_text(speaker_el, "function") or None,
                    "fraktion": _bundestag_xml_text(speaker_el, "fraktion") or None,
                    "mdb_id": _bundestag_xml_text(speaker_el, "mdbId") or None,
                }
            )

    return {
        "live": _bundestag_xml_text(root, "live").lower() == "true",
        "topic_number": _bundestag_xml_text(root, "topicNumber") or None,
        "topic": (_bundestag_xml_text(speakers_parent.find("speaker"), "topic") if speakers_parent is not None and speakers_parent.find("speaker") is not None else None) or None,
        "speakers": speakers,
    }


def _parse_bundestag_article_detail(article_id: str) -> dict | None:
    normalized_id = (article_id or "").strip()
    if not normalized_id:
        return None

    xml_text = _bundestag_fetch_xml(
        BUNDESTAG_ARTICLE_XML_URL.format(article_id=normalized_id)
    )

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None

    return {
        "article_id": normalized_id,
        "title": _bundestag_xml_text(root, "title") or None,
        "date": _bundestag_xml_text(root, "date") or None,
        "source_url": _bundestag_xml_text(root, "sourceURL") or None,
        "text_html": _bundestag_xml_text(root, "text") or "",
    }


def _strip_html_text(value: str) -> str:
    text = re.sub(r"<br\s*/?>", " ", value, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _article_mentions_roll_call(article_detail: dict | None) -> bool:
    if not article_detail:
        return False

    haystacks = [
        (article_detail.get("title") or "").lower(),
        _strip_html_text(article_detail.get("text_html") or "").lower(),
    ]
    return any("namentlich" in item for item in haystacks)


def _find_ablaufplan_pdf_url() -> str | None:
    html_text = _bundestag_fetch_xml(BUNDESTAG_TAGESORDNUNGEN_URL)
    match = re.search(
        r'href="(https://www\.bundestag\.de/resource/blob/[^"]+/Ablaufplan-[^"]+\.pdf)"',
        html_text,
        re.IGNORECASE,
    )
    if not match:
        return None
    return html.unescape(match.group(1))


def _parse_ablaufplan_roll_calls() -> list[dict]:
    pdf_url = _find_ablaufplan_pdf_url()
    if not pdf_url:
        return []

    pdf_bytes = _bundestag_fetch_bytes(pdf_url)
    try:
        reader = PdfReader(BytesIO(pdf_bytes))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception:
        return []

    date_map = {
        "Januar": 1,
        "Februar": 2,
        "März": 3,
        "April": 4,
        "Mai": 5,
        "Juni": 6,
        "Juli": 7,
        "August": 8,
        "September": 9,
        "Oktober": 10,
        "November": 11,
        "Dezember": 12,
    }

    roll_calls: list[dict] = []
    current_date = None
    last_row = None

    for raw_line in text.splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if not line:
            continue

        date_match = re.match(
            r"^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag), (\d{1,2})\. ([A-Za-zÄÖÜäöüß]+) (\d{4})",
            line,
        )
        if date_match:
            day = int(date_match.group(2))
            month = date_map.get(date_match.group(3))
            year = int(date_match.group(4))
            if month:
                current_date = date(year, month, day)
            continue

        row_match = re.match(
            r"^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2}) Uhr .*? TOP ([A-Z0-9 ,]+?) (.+)$",
            line,
        )
        if row_match and current_date is not None:
            start_hhmm, end_hhmm, top, title = row_match.groups()
            start_hour, start_minute = map(int, start_hhmm.split(":"))
            end_hour, end_minute = map(int, end_hhmm.split(":"))
            last_row = {
                "top": f"TOP {top.strip()}",
                "title": title.strip(),
                "start_at": datetime(
                    current_date.year,
                    current_date.month,
                    current_date.day,
                    start_hour,
                    start_minute,
                    tzinfo=EUROPE_BERLIN,
                ),
                "end_at": datetime(
                    current_date.year,
                    current_date.month,
                    current_date.day,
                    end_hour,
                    end_minute,
                    tzinfo=EUROPE_BERLIN,
                ),
                "pdf_url": pdf_url,
            }
            continue

        if last_row and "Namentliche Abstimmung" in line:
            detail = dict(last_row)
            detail["note"] = line
            duration_match = re.search(r"(\d+)\s*Minuten", line, re.IGNORECASE)
            if duration_match:
                detail["duration_minutes"] = int(duration_match.group(1))
            location_match = re.search(r",\s*([^,]+)\.?$", line)
            if location_match:
                detail["location"] = location_match.group(1).strip().rstrip(".")
            roll_calls.append(detail)
            last_row = None

    return roll_calls


def _point_effective_end(point: dict) -> datetime | None:
    end_at = point.get("end_at")
    start_at = point.get("start_at")
    if end_at and start_at and end_at < start_at:
        return start_at
    return end_at or start_at


def _find_current_and_next_point(
    sessions: list[dict],
    effective_at: datetime,
) -> tuple[dict | None, dict | None, dict | None]:
    current_session = None
    current_point = None
    next_point = None

    flat_points: list[tuple[dict, dict]] = []
    for session in sessions:
        for point in session["points"]:
            if point.get("start_at") is None:
                continue
            flat_points.append((session, point))

    flat_points.sort(key=lambda item: item[1]["start_at"])

    for index, (session, point) in enumerate(flat_points):
        start_at = point.get("start_at")
        end_at = _point_effective_end(point)
        if start_at is None:
            continue

        if end_at and start_at <= effective_at < end_at:
            current_session = session
            current_point = point
            if index + 1 < len(flat_points):
                next_point = flat_points[index + 1][1]
            break

        if start_at > effective_at:
            next_point = point
            break

    if current_session is None and current_point is None and next_point is not None:
        for session, point in flat_points:
            if point is next_point:
                current_session = session
                break

    return current_session, current_point, next_point


def _serialize_parliament_point(point: dict | None) -> dict | None:
    if point is None:
        return None
    return {
        "top": point.get("top"),
        "title": point.get("title"),
        "status": point.get("status"),
        "article_id": point.get("article_id"),
        "start_at": _iso_or_none(point.get("start_at")),
        "end_at": _iso_or_none(point.get("end_at")),
    }


def _find_next_roll_call_point(
    sessions: list[dict],
    effective_at: datetime,
) -> dict | None:
    roll_call_schedule = _parse_ablaufplan_roll_calls()
    schedule_by_top: dict[str, dict] = {}
    for item in roll_call_schedule:
        top_key = (item.get("top") or "").strip().upper()
        if top_key:
            schedule_by_top[top_key] = item

    candidates: list[dict] = []
    for session in sessions:
        for point in session["points"]:
            article_id = point.get("article_id")
            start_at = point.get("start_at")
            end_at = _point_effective_end(point)
            if not article_id or start_at is None or end_at is None:
                continue
            if end_at < effective_at:
                continue

            detail = _parse_bundestag_article_detail(article_id)
            if not _article_mentions_roll_call(detail):
                continue

            candidate = dict(point)
            candidate["article_detail"] = detail
            schedule = schedule_by_top.get((point.get("top") or "").strip().upper())
            if schedule:
                candidate["roll_call_schedule"] = schedule
            candidates.append(candidate)

    if not candidates:
        return None

    def candidate_start(item: dict) -> datetime:
        schedule = item.get("roll_call_schedule") or {}
        return schedule.get("start_at") or item["start_at"]

    filtered = [
        item
        for item in candidates
        if (_point_effective_end(item.get("roll_call_schedule") or item) or item["start_at"]) >= effective_at
    ]
    if filtered:
        candidates = filtered

    candidates.sort(key=candidate_start)
    return candidates[0]


def _serialize_roll_call(point: dict | None) -> dict | None:
    if point is None:
        return None

    detail = point.get("article_detail") or {}
    schedule = point.get("roll_call_schedule") or {}
    return {
        "top": point.get("top"),
        "title": point.get("title"),
        "article_id": point.get("article_id"),
        "start_at": _iso_or_none(schedule.get("start_at") or point.get("start_at")),
        "end_at": _iso_or_none(schedule.get("end_at") or point.get("end_at")),
        "duration_minutes": schedule.get("duration_minutes"),
        "location": schedule.get("location"),
        "schedule_note": schedule.get("note"),
        "pdf_url": schedule.get("pdf_url"),
        "source_url": detail.get("source_url"),
        "article_title": detail.get("title"),
    }


def _serialize_roll_call_event(item: dict | None) -> dict | None:
    if item is None:
        return None
    return {
        "top": item.get("top"),
        "title": item.get("title"),
        "article_id": item.get("article_id"),
        "start_at": _iso_or_none(item.get("start_at")),
        "end_at": _iso_or_none(item.get("end_at")),
        "duration_minutes": item.get("duration_minutes"),
        "location": item.get("location"),
        "schedule_note": item.get("note"),
        "pdf_url": item.get("pdf_url"),
        "source_url": item.get("source_url"),
        "article_title": item.get("article_title"),
    }


def _serialize_service_slot(slot: dict | None) -> dict | None:
    if slot is None:
        return None
    return {
        "slot_id": str(slot["slot_id"]),
        "date": slot["date"].isoformat() if isinstance(slot.get("date"), date) else str(slot.get("date")),
        "weekday": slot.get("weekday"),
        "slot_code": slot.get("slot_code"),
        "start_time": slot.get("start_time").isoformat() if slot.get("start_time") else None,
        "end_time": slot.get("end_time").isoformat() if slot.get("end_time") else None,
        "assignment_type": _normalise_assignment_type(slot.get("assignment_type")),
    }


def _lookup_next_assigned_slot_for_user(
    user_id: str,
    *,
    effective_at: datetime,
) -> dict | None:
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    s.id,
                    s.slot_date,
                    s.weekday,
                    s.slot_code,
                    s.start_time,
                    s.end_time,
                    sa.assignment_type
                FROM slot_assignments sa
                JOIN duty_slots s
                  ON s.id = sa.slot_id
                WHERE sa.user_id = %s
                  AND (s.slot_date::timestamp + s.start_time) >= %s
                ORDER BY s.slot_date ASC, s.start_time ASC
                LIMIT 1
                """,
                (user_id, effective_at.replace(tzinfo=None)),
            )
            row = cur.fetchone()

    if not row:
        return None

    return {
        "slot_id": row[0],
        "date": row[1],
        "weekday": row[2],
        "slot_code": row[3],
        "start_time": row[4],
        "end_time": row[5],
        "assignment_type": row[6],
    }


def _build_parliament_live_payload(at: datetime | None = None) -> dict:
    speaker = _parse_bundestag_speaker()
    sessions = _parse_bundestag_conferences()
    effective_at = at or datetime.now(EUROPE_BERLIN)
    current_session, current_point, next_point = _find_current_and_next_point(
        sessions,
        effective_at,
    )
    weekly_roll_calls = _build_kurzuebersicht_roll_call_events()
    next_roll_call = None
    for item in weekly_roll_calls:
        roll_call_at = item.get("end_at") or item.get("start_at")
        if roll_call_at and roll_call_at >= effective_at:
            next_roll_call = item
            break
    if next_roll_call is None:
        next_roll_call = _find_next_roll_call_point(sessions, effective_at)

    session_running = current_point is not None
    if at is None and speaker["live"]:
        session_running = True

    return {
        "mode": "simulated" if at else "live",
        "source": {
            "conferences_url": BUNDESTAG_CONFERENCES_URL,
            "speaker_url": BUNDESTAG_SPEAKER_URL,
            "cache_ttl_seconds": BUNDESTAG_LIVE_CACHE_SECONDS,
        },
        "generated_at": datetime.now(EUROPE_BERLIN).isoformat(),
        "effective_at": effective_at.isoformat(),
        "speaker_live": speaker["live"],
        "speaker_topic_number": speaker["topic_number"],
        "speaker_names": [item["name"] for item in speaker["speakers"] if item.get("name")],
        "session_running": session_running,
        "current_session": {
            "date": current_session.get("date").isoformat() if current_session and current_session.get("date") else None,
            "date_text": current_session.get("date_text") if current_session else None,
            "session_number": current_session.get("session_number") if current_session else None,
            "name": current_session.get("name") if current_session else None,
            "active": bool(current_session.get("active")) if current_session else False,
        }
        if current_session
        else None,
        "session_days": [
            {
                "date": session.get("date").isoformat() if session.get("date") else None,
                "date_text": session.get("date_text"),
                "session_number": session.get("session_number"),
                "name": session.get("name"),
                "active": bool(session.get("active")),
                "selected": bool(
                    current_session
                    and session.get("date")
                    and current_session.get("date")
                    and session.get("date") == current_session.get("date")
                ),
            }
            for session in sessions
            if session.get("date")
        ],
        "current_top": _serialize_parliament_point(current_point),
        "next_top": _serialize_parliament_point(next_point),
        "next_roll_call": (
            _serialize_roll_call_event(next_roll_call)
            if isinstance(next_roll_call, dict) and next_roll_call.get("source")
            else _serialize_roll_call(next_roll_call)
        ),
        "weekly_roll_calls": [_serialize_roll_call_event(item) for item in weekly_roll_calls],
        "agenda_points": [
            _serialize_parliament_point(point)
            for point in (current_session.get("points") if current_session else [])
        ],
    }


def _user_can_manage_slot_attendance(
    cur,
    *,
    slot_id: UUID | str,
    user_id: UUID | str,
    role: str | None,
) -> bool:
    if role in ("admin", "pgf"):
        return True

    cur.execute(
        """
        SELECT
            (s.slot_date::timestamp + s.start_time) AT TIME ZONE 'Europe/Berlin' AS slot_start_at,
            CASE
                WHEN s.open_end = true THEN NULL
                WHEN s.end_time IS NOT NULL THEN (s.slot_date::timestamp + s.end_time) AT TIME ZONE 'Europe/Berlin'
                ELSE NULL
            END AS slot_end_at
        FROM duty_slots s
        WHERE s.id = %s
        LIMIT 1
        """,
        (slot_id,),
    )
    slot_row = cur.fetchone()
    if not slot_row:
        return False

    slot_start_at = slot_row[0]
    slot_end_at = slot_row[1]
    if slot_end_at is None:
        slot_end_at = slot_start_at + timedelta(hours=12)

    cur.execute(
        """
        SELECT 1
        FROM temporary_pgf_grants g
        WHERE g.user_id = %s
          AND g.valid_from <= now()
          AND g.valid_until >= now()
          AND g.valid_from < %s
          AND g.valid_until > %s
        LIMIT 1
        """,
        (user_id, slot_end_at, slot_start_at),
    )
    return cur.fetchone() is not None


def require_self_or_admin(target_user_id: UUID | str, authorization: str | None):
    actor = get_current_user_from_firebase(authorization)
    if actor["role"] in ("admin", "pgf") or actor["id"] == str(target_user_id):
        return actor
    raise HTTPException(status_code=403, detail="Forbidden")


def _debug_endpoint_enabled() -> bool:
    return os.environ.get("ENABLE_DEBUG_ENDPOINTS", "0") == "1"

def _get_firebase_app():
    return _initialize_firebase_app()


def send_push_to_tokens(
    tokens: list[str],
    title: str,
    body: str,
    data: dict | None = None,
    badge: int | None = None,
):
    _get_firebase_app()

    if not tokens:
        print("PUSH: keine Tokens", flush=True)
        return {"success": 0, "failure": 0}

    # We always send visible notifications for now.
    # Reason: background data-only pushes require extra client-side handling and are not reliable.
    show_notification = True

    notification = (
        messaging.Notification(
            title=title,
            body=body,
        )
        if show_notification
        else None
    )

    apns = None
    if badge is not None or not show_notification:
        apns = messaging.APNSConfig(
            headers={"apns-priority": "5"} if not show_notification else None,
            payload=messaging.APNSPayload(
                aps=messaging.Aps(
                    badge=badge,
                    sound="default" if show_notification else None,
                    content_available=(not show_notification),
                )
            ),
        )

    message = messaging.MulticastMessage(
        notification=notification,
        data={k: str(v) for k, v in (data or {}).items()},
        tokens=tokens,
        android=messaging.AndroidConfig(
            priority="high",
        ),
        apns=apns,
    )

    response = messaging.send_each_for_multicast(message)

    print(
        f"PUSH RESULT success={response.success_count} failure={response.failure_count}",
        flush=True,
    )

    for i, r in enumerate(response.responses):
        if not r.success:
            print(
                f"PUSH TOKEN FAILED token={tokens[i]} error={r.exception}",
                flush=True,
            )

    # Some tokens can be stale or belong to a different Firebase project/app.
    # Prune only the clearly mismatched ones to prevent repeated failures.
    for i, r in enumerate(response.responses):
        if r.success:
            continue
        exc_name = type(r.exception).__name__ if r.exception is not None else ""
        if exc_name == "ThirdPartyAuthError" and (
            "missing required authentication credential" in str(r.exception).lower()
        ):
            try:
                with psycopg.connect(DB_URL) as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "DELETE FROM user_push_tokens WHERE token = %s",
                            (tokens[i],),
                        )
                    conn.commit()
                print(f"PUSH TOKEN PRUNED token={tokens[i]}", flush=True)
            except Exception as exc:
                print(f"PUSH TOKEN PRUNE FAILED token={tokens[i]} error={exc}", flush=True)

    return {
        "success": response.success_count,
        "failure": response.failure_count,
    }

def _admin_user_row_to_dict(r):
    return {
        "id": str(r[0]),
        "email": r[1],
        "first_name": r[2],
        "last_name": r[3],
        "role": r[4],
        "is_mdb": bool(r[5]),
        "assigned_mdb_user_id": str(r[6]) if r[6] else None,
        "assigned_mdb_name": r[7],
        "is_faction_staff": bool(r[8]),
        "is_active": bool(r[9]),
        "is_planner_exempt": bool(r[10]) if len(r) > 10 else False,
    }


def _normalize_email(value: str) -> str:
    return value.strip().lower()


def _display_name(first_name: str | None, last_name: str | None) -> str | None:
    name = f"{(first_name or '').strip()} {(last_name or '').strip()}".strip()
    return name or None


def _resolve_or_create_firebase_user(
    *,
    email: str,
    first_name: str | None,
    last_name: str | None,
    is_active: bool,
    password: str | None,
) -> tuple[str, bool]:
    _get_firebase_app()
    display_name = _display_name(first_name, last_name)

    try:
        existing = firebase_auth.get_user_by_email(email)
        firebase_auth.update_user(
            existing.uid,
            display_name=display_name,
            disabled=not is_active,
        )
        return existing.uid, False
    except firebase_auth.UserNotFoundError:
        if not password:
            raise HTTPException(
                status_code=400,
                detail="Firebase user not found. Please provide firebase_password.",
            )
        try:
            created = firebase_auth.create_user(
                email=email,
                password=password,
                display_name=display_name,
                disabled=not is_active,
            )
            return created.uid, True
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Firebase user could not be created: {exc}",
            ) from exc

def get_all_push_tokens() -> list[str]:
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT token FROM user_push_tokens;")
            return [r[0] for r in cur.fetchall()]


def get_all_push_targets() -> list[dict[str, str]]:
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT user_id::text, token, platform
                FROM user_push_tokens
                ORDER BY updated_at DESC;
                """
            )
            rows = cur.fetchall()

    return [
        {"user_id": r[0], "token": r[1], "platform": r[2]}
        for r in rows
    ]


def get_push_tokens_for_users(user_ids: list[str]) -> list[str]:
    if not user_ids:
        return []

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT token
                FROM user_push_tokens
                WHERE user_id = ANY(%s::uuid[])
                """,
                (user_ids,),
            )
            return [r[0] for r in cur.fetchall()]


def ensure_message_recipient_table():
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS pgf_message_recipients (
                    message_id UUID REFERENCES pgf_messages(id) ON DELETE CASCADE,
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    PRIMARY KEY (message_id, user_id)
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_pgf_message_recipients_user_id
                ON pgf_message_recipients(user_id)
                """
            )
        conn.commit()


def create_message(
    *,
    sender_name: str,
    content: str,
    urgency: str,
    recipient_ids: list[str] | None = None,
):
    ensure_message_recipient_table()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pgf_messages (sender_name, content, urgency)
                VALUES (%s, %s, %s)
                RETURNING id, created_at;
                """,
                (sender_name, content, urgency),
            )
            msg_id, created_at = cur.fetchone()

            if recipient_ids:
                for user_id in recipient_ids:
                    cur.execute(
                        """
                        INSERT INTO pgf_message_recipients (message_id, user_id)
                        VALUES (%s, %s)
                        ON CONFLICT DO NOTHING
                        """,
                        (msg_id, user_id),
                    )
        conn.commit()

    return msg_id, created_at

# -----------------------------
# Models
# -----------------------------
class ExchangeCreate(BaseModel):
    slot_id: UUID
    mode: Literal["SWAP", "TAKEOVER"]
    from_user_id: UUID
    # optional beim Erstellen (Tauschbörse = OPEN)
    to_user_id: Optional[UUID] = None


class ExchangeRequestCreate(BaseModel):
    offered_slot_id: UUID
    alternative_slot_ids: list[UUID]
    note: Optional[str] = None


class ExchangeRequestSearch(BaseModel):
    offered_slot_id: UUID
    alternative_slot_ids: list[UUID]


class ExchangeMatchCreate(BaseModel):
    other_exchange_id: UUID


class ExchangeMatchConfirm(BaseModel):
    actor_user_id: UUID | None = None


class ExchangeMatchCancel(BaseModel):
    reason: Optional[str] = None


class ExchangeAccept(BaseModel):
    to_user_id: UUID


class ExchangeConfirm(BaseModel):
    actor_user_id: UUID


class ExchangeCancel(BaseModel):
    actor_user_id: UUID
    reason: Optional[str] = None


class PGFMessageCreate(BaseModel):
    sender_name: str
    content: str
    urgency: Literal["information", "mittel", "hoch"]


class PGFMessageOut(BaseModel):
    id: UUID
    created_at: str
    sender_name: str
    content: str
    urgency: Literal["information", "mittel", "hoch"]


class PushTokenUpsert(BaseModel):
    user_id: UUID
    token: str
    platform: Literal["ios", "android"] = "ios"


class DebugPush(BaseModel):
    title: str = "Fraktions-Mitteilung"
    body: str = "Test"
    urgency: Literal["information", "mittel", "hoch"] = "information"


class FeedbackCreate(BaseModel):
    kind: Literal["improvement", "error", "general"] = "improvement"
    title: str
    content: str
    context: str | None = None


class FeedbackUpdate(BaseModel):
    status: Literal["open", "in_review", "done", "dismissed"]
    admin_note: str | None = None


def send_attendance_reminders():
    now = datetime.now(timezone.utc)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
    SELECT
        p.slot_id,
        p.user_id,
        u.first_name,
        u.last_name
    FROM v_slot_participants p
    JOIN duty_slots s
      ON s.id = p.slot_id
    JOIN users u
      ON u.id = p.user_id
    LEFT JOIN attendance_checks ac
      ON ac.slot_id = p.slot_id
     AND ac.user_id = p.user_id
    LEFT JOIN attendance_reminders_sent ars
      ON ars.slot_id = p.slot_id
     AND ars.user_id = p.user_id
    WHERE ac.user_id IS NULL
      AND ars.user_id IS NULL
      AND s.slot_date = (now() AT TIME ZONE 'Europe/Berlin')::date
      AND (s.slot_date::timestamp + s.start_time)
            <= ((now() AT TIME ZONE 'Europe/Berlin') - interval '30 minutes')
      AND (
            s.open_end = true
            OR (s.slot_date::timestamp + s.end_time)
                 >= (now() AT TIME ZONE 'Europe/Berlin')
          )
    """,
            )
            rows = cur.fetchall()

            sent_count = 0

            for slot_id, user_id, first_name, last_name in rows:
                cur.execute(
                    """
                    SELECT token
                    FROM user_push_tokens
                    WHERE user_id = %s
                    """,
                    (str(user_id),),
                )
                tokens = [r[0] for r in cur.fetchall()]

                if tokens:
                    send_push_to_tokens(
                        tokens=tokens,
                        title="Sitzungsdienst fehlt",
                        body="Du bist eingeteilt, aber noch nicht eingecheckt.",
                        data={
                            "type": "attendance_reminder",
                            "slot_id": str(slot_id),
                            "user_id": str(user_id),
                        },
                    )

                cur.execute(
                    """
                    INSERT INTO attendance_reminders_sent (slot_id, user_id)
                    VALUES (%s, %s)
                    ON CONFLICT (slot_id, user_id) DO NOTHING
                    """,
                    (str(slot_id), str(user_id)),
                )

                sent_count += 1

        conn.commit()

    return {"sent": sent_count}


# -----------------------------
# Health
# -----------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/parliament/live")
def parliament_live(at: str | None = Query(default=None)):
    effective_at = _parse_iso_datetime(at) if at else None
    return _build_parliament_live_payload(at=effective_at)


@app.get("/me/live-info")
def get_my_live_info(
    at: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    scope = _resolve_actor_scope(authorization)
    actor = scope["actor"]
    principal = scope["principal"]
    effective_at = _parse_iso_datetime(at) if at else None
    payload = _build_parliament_live_payload(at=effective_at)
    comparison_at = effective_at or datetime.now(EUROPE_BERLIN)

    next_pgf_duty = None
    if actor["role"] == "pgf":
        next_pgf_duty = _serialize_service_slot(
            _lookup_next_assigned_slot_for_user(
                actor["id"],
                effective_at=comparison_at,
            )
        )

    payload["viewer"] = {
        "user_id": actor["id"],
        "role": actor["role"],
        "principal_user_id": principal["id"],
        "principal_name": " ".join(
            [part for part in [principal.get("first_name"), principal.get("last_name")] if part]
        ).strip()
        or principal.get("email")
        or principal["id"],
    }
    payload["next_pgf_duty"] = next_pgf_duty
    next_speech, next_speech_source = _build_next_speech_for_user(
        principal["id"],
        effective_at=comparison_at,
        parliament_payload=payload,
    )
    payload["next_speech"] = next_speech
    payload["next_speech_source"] = next_speech_source
    return payload


@app.get("/me/faction-speakers")
def get_my_faction_speakers(
    at: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    _resolve_actor_scope(authorization)
    effective_at = _parse_iso_datetime(at) if at else None
    parliament_payload = _build_parliament_live_payload(at=effective_at)
    return {
        "generated_at": datetime.now(EUROPE_BERLIN).isoformat(),
        "effective_at": (effective_at or datetime.now(EUROPE_BERLIN)).isoformat(),
        "speeches": _build_faction_speech_entries(parliament_payload=parliament_payload),
    }


def ensure_mail_import_tables():
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS mail_import_events (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    mailbox_uid TEXT NOT NULL,
                    message_id TEXT,
                    subject TEXT NOT NULL,
                    attachment_name TEXT NOT NULL,
                    attachment_category TEXT NOT NULL,
                    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
                    skip_reason TEXT,
                    imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    UNIQUE (mailbox_uid, attachment_name, attachment_category)
                )
                """
            )
            cur.execute(
                """
                ALTER TABLE mail_import_events
                ADD COLUMN IF NOT EXISTS skip_reason TEXT
                """
            )
        conn.commit()


def _decode_mime_header(value: str | None) -> str:
    if not value:
        return ""

    parts = []
    for item, encoding in decode_header(value):
        if isinstance(item, bytes):
            parts.append(item.decode(encoding or "utf-8", errors="replace"))
        else:
            parts.append(item)
    return "".join(parts).strip()


def _mail_import_enabled() -> bool:
    return bool(MAIL_IMPORT_USERNAME and MAIL_IMPORT_PASSWORD)


def _normalize_text_key(value: str | None) -> str:
    if not value:
        return ""

    normalized = unicodedata.normalize("NFKD", value)
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    normalized = normalized.lower()
    normalized = normalized.replace("ß", "ss")
    normalized = re.sub(r"\b(?:dr|prof|professor|psts|bm|bmin|bk)\.?\b", " ", normalized)
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def _is_probable_kurzuebersicht_name(value: str | None) -> bool:
    haystack = _normalize_text_key(value)
    if not haystack:
        return False
    return (
        "kurzuebersicht" in haystack
        or "aktuelle ku" in haystack
        or re.search(r"(^| )ku($| )", haystack) is not None
    )


def _extract_pdf_page_texts(pdf_bytes: bytes) -> list[str]:
    reader = PdfReader(BytesIO(pdf_bytes))
    return [page.extract_text() or "" for page in reader.pages]


def _parse_kurzuebersicht_stand(value: str | None) -> datetime | None:
    if not value:
        return None

    month_map = {
        "januar": 1,
        "februar": 2,
        "märz": 3,
        "maerz": 3,
        "april": 4,
        "mai": 5,
        "juni": 6,
        "juli": 7,
        "august": 8,
        "september": 9,
        "oktober": 10,
        "november": 11,
        "dezember": 12,
    }

    match = re.search(
        r"Stand:\s*(\d{1,2})\.\s*([A-Za-zÄÖÜäöüß]+)\s*(\d{4}),\s*(\d{1,2})[:.](\d{2})\s*Uhr",
        value,
        flags=re.IGNORECASE,
    )
    if not match:
        return None

    month_key = _normalize_text_key(match.group(2))
    month = month_map.get(month_key)
    if not month:
        return None

    return datetime(
        int(match.group(3)),
        month,
        int(match.group(1)),
        int(match.group(4)),
        int(match.group(5)),
        tzinfo=EUROPE_BERLIN,
    )


def _extract_kurzuebersicht_header_metadata(text: str) -> dict | None:
    normalized_text = text.replace("\u00a0", " ")
    title_match = re.search(
        r"Kurzübersicht über Plenarthemen (?:vom|am)\s+(.+)",
        normalized_text,
        flags=re.IGNORECASE,
    )
    stand = _parse_kurzuebersicht_stand(normalized_text)
    if not title_match or stand is None:
        return None

    title_line = re.sub(r"\s+", " ", title_match.group(0)).strip()
    return {
        "title_line": title_line,
        "stand": stand,
    }


def _format_kurzuebersicht_title(stand: datetime) -> str:
    month_names = {
        1: "Jan",
        2: "Feb",
        3: "Mrz",
        4: "Apr",
        5: "Mai",
        6: "Jun",
        7: "Jul",
        8: "Aug",
        9: "Sep",
        10: "Okt",
        11: "Nov",
        12: "Dez",
    }
    calendar_week = stand.isocalendar().week
    month_label = month_names.get(stand.month, f"{stand.month:02d}")
    return f"KÜ {calendar_week} Stand {stand.day:02d}-{month_label} {stand.hour:02d}Uhr"


def _all_active_user_ids() -> list[str]:
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id::text
                FROM users
                WHERE COALESCE(is_active, true) = true
                ORDER BY
                    COALESCE(last_name, '') ASC,
                    COALESCE(first_name, '') ASC,
                    email ASC
                """
            )
            return [row[0] for row in cur.fetchall()]


def _resolve_document_recipient_ids(scope: str) -> list[str]:
    normalized_scope = (scope or "").strip().lower()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            if normalized_scope == "all":
                cur.execute(
                    """
                    SELECT id::text
                    FROM users
                    WHERE COALESCE(is_active, true) = true
                    ORDER BY
                        COALESCE(last_name, '') ASC,
                        COALESCE(first_name, '') ASC,
                        email ASC
                    """
                )
            elif normalized_scope == "mdb":
                cur.execute(
                    """
                    SELECT id::text
                    FROM users
                    WHERE COALESCE(is_active, true) = true
                      AND (
                        role = 'mdb'
                        OR COALESCE(is_mdb, false) = true
                      )
                    ORDER BY
                        COALESCE(last_name, '') ASC,
                        COALESCE(first_name, '') ASC,
                        email ASC
                    """
                )
            elif normalized_scope == "pgf":
                cur.execute(
                    """
                    SELECT id::text
                    FROM users
                    WHERE COALESCE(is_active, true) = true
                      AND role = 'pgf'
                    ORDER BY
                        COALESCE(last_name, '') ASC,
                        COALESCE(first_name, '') ASC,
                        email ASC
                    """
                )
            else:
                raise HTTPException(status_code=400, detail="Ungültiger Empfängerkreis")

            return [row[0] for row in cur.fetchall()]


def _persist_document_record(
    *,
    title: str,
    category: str,
    original_filename: str,
    mime_type: str | None,
    content_bytes: bytes,
    recipient_ids: list[str],
    uploaded_by_user_id: str | None = None,
):
    file_id = str(uuid.uuid4())
    stored_filename = f"{file_id}_{original_filename}"
    file_path = os.path.join(UPLOAD_DIR, stored_filename)

    with open(file_path, "wb") as buffer:
        buffer.write(content_bytes)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO documents (
                    id,
                    title,
                    filename_original,
                    stored_filename,
                    mime_type,
                    category,
                    file_size,
                    uploaded_by_user_id
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING id
                """,
                (
                    file_id,
                    title,
                    original_filename,
                    stored_filename,
                    mime_type,
                    category,
                    len(content_bytes),
                    uploaded_by_user_id,
                ),
            )
            doc_id = cur.fetchone()[0]

            for uid in recipient_ids:
                cur.execute(
                    """
                    INSERT INTO document_recipients (document_id, user_id)
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (doc_id, uid),
                )
        conn.commit()

    return str(doc_id)


def _notify_new_document(
    *,
    title: str,
    recipient_ids: list[str],
):
    if not recipient_ids:
        return

    message_content = f"Neue Datei verfugbar: {title}"
    msg_id, _ = create_message(
        sender_name="Dateien",
        content=message_content,
        urgency="information",
        recipient_ids=recipient_ids,
    )

    tokens = get_push_tokens_for_users(recipient_ids)
    try:
        send_push_to_tokens(
            tokens=tokens,
            title="Neue Datei",
            body=title,
            data={
                "type": "pgf_message",
                "message_id": str(msg_id),
                "sender": "Dateien",
                "content": message_content,
                "urgency": "information",
            },
        )
    except Exception as e:
        print(f"DOCUMENT PUSH FAILED title={title} error={e}", flush=True)


def _classify_mail_attachment(subject: str, filename: str) -> str | None:
    if _is_probable_kurzuebersicht_name(filename) or _is_probable_kurzuebersicht_name(subject):
        return "kurzuebersicht"
    return None


def _build_import_title(category: str, subject: str, filename: str) -> str:
    cleaned_subject = re.sub(r"\s+", " ", subject).strip()
    cleaned_filename = re.sub(r"\.[^.]+$", "", filename).strip()
    if category == "kurzuebersicht":
        return cleaned_filename or cleaned_subject or "Kurzübersicht"
    return cleaned_subject or cleaned_filename or "Datei aus Mailimport"


def _load_latest_document_record(category: str) -> dict | None:
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    title,
                    filename_original,
                    mime_type,
                    stored_filename,
                    created_at
                FROM documents
                WHERE category = %s
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (category,),
            )
            row = cur.fetchone()

    if not row:
        return None

    return {
        "id": str(row[0]),
        "title": row[1],
        "filename": row[2],
        "mime_type": row[3],
        "stored_filename": row[4],
        "created_at": row[5].isoformat() if row[5] else None,
    }


def _extract_document_bytes(document: dict | None) -> bytes | None:
    if not document:
        return None

    stored_filename = (document.get("stored_filename") or "").strip()
    if not stored_filename:
        return None

    file_path = os.path.join(UPLOAD_DIR, stored_filename)
    if not os.path.exists(file_path):
        return None

    with open(file_path, "rb") as handle:
        return handle.read()


def _load_latest_kurzuebersicht_stand() -> datetime | None:
    document = _load_latest_document_record("kurzuebersicht")
    if not document:
        return None

    title = document.get("title") or ""
    title_match = re.search(r"Stand\s+(\d{2})-([A-Za-z]{3})\s+(\d{2})Uhr", title)
    if title_match:
        month_map = {
            "Jan": 1,
            "Feb": 2,
            "Mrz": 3,
            "Apr": 4,
            "Mai": 5,
            "Jun": 6,
            "Jul": 7,
            "Aug": 8,
            "Sep": 9,
            "Okt": 10,
            "Nov": 11,
            "Dez": 12,
        }
        month = month_map.get(title_match.group(2))
        created_at = document.get("created_at")
        if month and created_at:
            created_dt = _parse_iso_datetime(created_at)
            if created_dt is not None:
                return datetime(
                    created_dt.year,
                    month,
                    int(title_match.group(1)),
                    int(title_match.group(3)),
                    0,
                    tzinfo=EUROPE_BERLIN,
                )

    document_bytes = _extract_document_bytes(document)
    if not document_bytes:
        return None

    try:
        first_page = _extract_pdf_page_texts(document_bytes)[0]
    except Exception:
        return None

    metadata = _extract_kurzuebersicht_header_metadata(first_page)
    return metadata["stand"] if metadata else None


def _attachment_already_imported(
    *,
    mailbox_uid: str,
    attachment_name: str,
    attachment_category: str,
) -> bool:
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT document_id
                FROM mail_import_events
                WHERE mailbox_uid = %s
                  AND attachment_name = %s
                  AND attachment_category = %s
                LIMIT 1
                """,
                (mailbox_uid, attachment_name, attachment_category),
            )
            row = cur.fetchone()

    if row is None:
        return False

    if row[0] is None and attachment_category == "kurzuebersicht":
        if _load_latest_document_record("kurzuebersicht") is None:
            return False

    return True


def _record_mail_import_event(
    *,
    mailbox_uid: str,
    message_id: str | None,
    subject: str,
    attachment_name: str,
    attachment_category: str,
    document_id: str | None,
    skip_reason: str | None = None,
):
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO mail_import_events (
                    mailbox_uid,
                    message_id,
                    subject,
                    attachment_name,
                    attachment_category,
                    document_id,
                    skip_reason
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (mailbox_uid, attachment_name, attachment_category) DO UPDATE
                SET
                    document_id = EXCLUDED.document_id,
                    skip_reason = EXCLUDED.skip_reason,
                    subject = EXCLUDED.subject,
                    message_id = EXCLUDED.message_id
                """,
                (
                    mailbox_uid,
                    message_id,
                    subject,
                    attachment_name,
                    attachment_category,
                    document_id,
                    skip_reason,
                ),
            )
        conn.commit()


def _prepare_kurzuebersicht_pdf(payload: bytes) -> dict | None:
    page_texts = _extract_pdf_page_texts(payload)
    if not page_texts:
        return None

    metadata = _extract_kurzuebersicht_header_metadata(page_texts[0])
    if not metadata:
        return None

    reader = PdfReader(BytesIO(payload))
    writer = PdfWriter()
    for index, page_text in enumerate(page_texts):
        normalized = page_text.replace("\u00a0", " ")
        if index > 0 and re.search(r"(^|\n)\s*Tagesordnung\s*(\n|$)", normalized, flags=re.IGNORECASE):
            break
        writer.add_page(reader.pages[index])

    buffer = BytesIO()
    writer.write(buffer)
    pdf_bytes = buffer.getvalue()
    stand = metadata["stand"]
    title = _format_kurzuebersicht_title(stand)
    return {
        "category": "kurzuebersicht",
        "title": title,
        "filename": f"{title}.pdf",
        "mime_type": "application/pdf",
        "content_bytes": pdf_bytes,
        "stand": stand,
    }


def _prepare_ausgezeichnete_tagesordnung_pdf(payload: bytes, stand: datetime | None = None) -> dict | None:
    page_texts = _extract_pdf_page_texts(payload)
    if not page_texts:
        return None

    start_index = None
    for index, page_text in enumerate(page_texts):
        normalized = page_text.replace("\u00a0", " ")
        if re.search(r"(^|\n)\s*Tagesordnung\s*(\n|$)", normalized, flags=re.IGNORECASE):
            start_index = index
            break

    if start_index is None:
        return None

    reader = PdfReader(BytesIO(payload))
    writer = PdfWriter()
    for index in range(start_index, len(reader.pages)):
        writer.add_page(reader.pages[index])

    buffer = BytesIO()
    writer.write(buffer)
    pdf_bytes = buffer.getvalue()
    title = (
        f"Ausgezeichnete TO {stand.strftime('%d-%b %HUhr')}"
        if stand is not None
        else "Ausgezeichnete Tagesordnung"
    )
    return {
        "category": "ausgezeichnete_tagesordnung",
        "title": title,
        "filename": f"{title}.pdf",
        "mime_type": "application/pdf",
        "content_bytes": pdf_bytes,
        "stand": stand,
    }


def _prepare_mail_attachment(subject: str, filename: str, payload: bytes, mime_type: str | None) -> list[dict]:
    lower_filename = (filename or "").lower()
    lower_mime = (mime_type or "").lower()

    candidates: list[dict] = []
    try:
        if lower_filename.endswith(".pdf") or lower_mime == "application/pdf":
            kurzuebersicht_candidate = _prepare_kurzuebersicht_pdf(payload)
            if kurzuebersicht_candidate:
                latest_stand = _load_latest_kurzuebersicht_stand()
                if latest_stand is not None and kurzuebersicht_candidate["stand"] <= latest_stand:
                    kurzuebersicht_candidate["skip_reason"] = "stand_not_newer"
                candidates.append(kurzuebersicht_candidate)

                tagesordnung_candidate = _prepare_ausgezeichnete_tagesordnung_pdf(
                    payload,
                    stand=kurzuebersicht_candidate.get("stand"),
                )
                if tagesordnung_candidate:
                    latest_tagesordnung = _load_latest_document_record("ausgezeichnete_tagesordnung")
                    if latest_tagesordnung and latest_tagesordnung.get("title") == tagesordnung_candidate["title"]:
                        tagesordnung_candidate["skip_reason"] = "stand_not_newer"
                    candidates.append(tagesordnung_candidate)
    except Exception as exc:
        print(f"MAIL IMPORT PREP FAILED filename={filename} error={exc}", flush=True)
        return []

    if not candidates:
        print(
            f"MAIL IMPORT SKIP filename={filename} reason=no_supported_document_found subject={subject}",
            flush=True,
        )
    return candidates


def run_mail_import_once():
    ensure_mail_import_tables()

    if not _mail_import_enabled():
        raise HTTPException(
            status_code=500,
            detail="Mail-Import ist nicht konfiguriert. MAIL_IMPORT_USERNAME und MAIL_IMPORT_PASSWORD fehlen.",
        )

    recipient_ids = _all_active_user_ids()
    if not recipient_ids:
        return {"processed_messages": 0, "imported_documents": 0, "imported": []}

    imported: list[dict] = []
    processed_messages = 0
    since_date = (datetime.now(EUROPE_BERLIN) - timedelta(days=MAIL_IMPORT_LOOKBACK_DAYS)).strftime("%d-%b-%Y")

    with imaplib.IMAP4_SSL(MAIL_IMPORT_IMAP_HOST, MAIL_IMPORT_IMAP_PORT) as imap:
        imap.login(MAIL_IMPORT_USERNAME, MAIL_IMPORT_PASSWORD)
        imap.select("INBOX")
        status, data = imap.uid("search", None, f'(SINCE "{since_date}")')
        if status != "OK":
            raise HTTPException(status_code=502, detail="IMAP-Suche fehlgeschlagen")

        uids = [item for item in (data[0] or b"").split() if item]
        for uid_bytes in uids[-50:]:
            mailbox_uid = uid_bytes.decode("utf-8", errors="ignore")
            fetch_status, fetch_data = imap.uid("fetch", uid_bytes, "(RFC822)")
            if fetch_status != "OK" or not fetch_data:
                continue

            raw_email = None
            for part in fetch_data:
                if isinstance(part, tuple) and len(part) > 1:
                    raw_email = part[1]
                    break
            if raw_email is None:
                continue

            processed_messages += 1
            msg = message_from_bytes(raw_email)
            subject = _decode_mime_header(msg.get("Subject"))

            message_id = (msg.get("Message-ID") or "").strip() or None

            for part in msg.walk():
                if part.get_content_maintype() == "multipart":
                    continue

                filename = _decode_mime_header(part.get_filename())
                if not filename:
                    continue

                lower_filename = filename.lower()
                if not (
                    lower_filename.endswith(".pdf")
                    or "kurz" in _normalize_text_key(subject)
                    or "tagesordnung" in _normalize_text_key(subject)
                ):
                    continue

                payload = part.get_payload(decode=True) or b""
                if not payload:
                    continue

                mime_type = part.get_content_type() or "application/octet-stream"
                prepared_items = _prepare_mail_attachment(subject, filename, payload, mime_type)
                if not prepared_items:
                    continue

                for prepared in prepared_items:
                    if _attachment_already_imported(
                        mailbox_uid=mailbox_uid,
                        attachment_name=filename,
                        attachment_category=prepared["category"],
                    ):
                        continue

                    if prepared.get("skip_reason") == "stand_not_newer":
                        _record_mail_import_event(
                            mailbox_uid=mailbox_uid,
                            message_id=message_id,
                            subject=subject,
                            attachment_name=filename,
                            attachment_category=prepared["category"],
                            document_id=None,
                            skip_reason="stand_not_newer",
                        )
                        continue

                    title = prepared["title"]
                    document_id = _persist_document_record(
                        title=title,
                        category=prepared["category"],
                        original_filename=prepared["filename"],
                        mime_type=prepared["mime_type"],
                        content_bytes=prepared["content_bytes"],
                        recipient_ids=recipient_ids,
                        uploaded_by_user_id=None,
                    )
                    _record_mail_import_event(
                        mailbox_uid=mailbox_uid,
                        message_id=message_id,
                        subject=subject,
                        attachment_name=filename,
                        attachment_category=prepared["category"],
                        document_id=document_id,
                        skip_reason=None,
                    )
                    _notify_new_document(
                        title=title,
                        recipient_ids=recipient_ids,
                    )
                    imported.append(
                        {
                            "document_id": document_id,
                            "category": prepared["category"],
                            "title": title,
                            "filename": prepared["filename"],
                            "mailbox_uid": mailbox_uid,
                            "stand": prepared["stand"].isoformat() if prepared.get("stand") else None,
                        }
                    )

    return {
        "processed_messages": processed_messages,
        "imported_documents": len(imported),
        "imported": imported,
    }


def _normalize_kurzuebersicht_line(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\u00a0", " ")).strip()


def _parse_kurzuebersicht_date(value: str) -> date | None:
    date_match = re.match(
        r"^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag), (\d{1,2})\. ([A-Za-zÄÖÜäöüß]+) (\d{4})$",
        value,
    )
    if not date_match:
        return None

    month_map = {
        "Januar": 1,
        "Februar": 2,
        "März": 3,
        "April": 4,
        "Mai": 5,
        "Juni": 6,
        "Juli": 7,
        "August": 8,
        "September": 9,
        "Oktober": 10,
        "November": 11,
        "Dezember": 12,
    }

    month = month_map.get(date_match.group(3))
    if not month:
        return None

    return date(int(date_match.group(4)), month, int(date_match.group(2)))


def _parse_tagesordnung_date(value: str) -> date | None:
    normalized = _normalize_kurzuebersicht_line(value)
    date_match = re.search(
        r"(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag),?\s+(?:dem|den)?\s*(\d{1,2})\.\s*([A-Za-zÄÖÜäöüß]+)\s*(\d{4})",
        normalized,
    )
    if not date_match:
        return None

    month_map = {
        "Januar": 1,
        "Februar": 2,
        "März": 3,
        "April": 4,
        "Mai": 5,
        "Juni": 6,
        "Juli": 7,
        "August": 8,
        "September": 9,
        "Oktober": 10,
        "November": 11,
        "Dezember": 12,
    }
    month = month_map.get(date_match.group(3))
    if not month:
        return None

    return date(int(date_match.group(4)), month, int(date_match.group(2)))


def _is_kurzuebersicht_time_line(value: str) -> bool:
    return re.match(r"^(?:ca\.\s*)?\d{1,2}:\d{2}$", value) is not None


def _is_kurzuebersicht_top_line(value: str) -> bool:
    return re.match(r"^(?:ZP\s+)?\d+(?:\+\d+)?[a-z]?$", value) is not None


def _is_kurzuebersicht_duration_line(value: str) -> bool:
    compact = value.replace(" ", "")
    return (
        re.match(r"^(?:\+)?\d+\s*Min\.$", value) is not None
        or compact in {"Aussprache", "Kernzeit"}
        or "Ausschuss-" in value
        or "vorsitzende" in value.lower()
    )


def _is_probable_speaker_line(value: str) -> bool:
    candidate = re.sub(r"\s+\d+$", "", value).strip()
    if not candidate or len(candidate) > 110:
        return False
    if candidate.lower().startswith("ca. "):
        return False
    if candidate in {"Namentliche Abstimmung", "weitere Beratungen", "wird abgesetzt"}:
        return False
    if candidate.startswith(("Aktuelle Stunde", "Vereinbarte Debatte", "Unterrichtung", "Befragung", "Fragestunde")):
        return False
    if re.search(r"\b(Minuten|parallel zum Plenum|Durchführung der Namentlichen Abstimmung)\b", candidate):
        return False

    speaker_pattern = re.compile(
        r"^(?:Dr\.|Prof\.|Prof\. Dr\.|PStS|BM['’]?in|BM|BK|N\. N\.|[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'’.-]+)"
        r"(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'’.-]+)+(?:\s*\([^)]*\))?(?:\s*\*.*)?$"
    )
    return speaker_pattern.match(candidate) is not None


def _clean_kurzuebersicht_speaker_name(value: str) -> str:
    cleaned = re.sub(r"\s+\d+$", "", value).strip()
    cleaned = re.sub(r"\s*\([^)]*\)\s*$", "", cleaned).strip()
    cleaned = re.sub(r"\s*\*.*$", "", cleaned).strip()
    return cleaned


def _load_name_directory() -> dict[str, dict]:
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id::text,
                    first_name,
                    last_name,
                    email,
                    role
                FROM users
                WHERE COALESCE(is_active, true) = true
                ORDER BY
                    COALESCE(last_name, '') ASC,
                    COALESCE(first_name, '') ASC,
                    email ASC
                """
            )
            rows = cur.fetchall()

    directory: dict[str, dict] = {}
    for row in rows:
        full_name = " ".join(part for part in [row[1], row[2]] if part).strip()
        if not full_name:
            continue
        directory[_normalize_text_key(full_name)] = {
            "user_id": row[0],
            "full_name": full_name,
            "email": row[3],
            "role": row[4],
        }
    return directory


def _parse_kurzuebersicht_entries(pdf_bytes: bytes) -> list[dict]:
    reader = PdfReader(BytesIO(pdf_bytes))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    lines = [_normalize_kurzuebersicht_line(line) for line in text.splitlines()]
    lines = [line for line in lines if line]

    entries: list[dict] = []
    current_date: date | None = None
    i = 0
    while i < len(lines):
        line = lines[i]
        parsed_date = _parse_kurzuebersicht_date(line) or _parse_tagesordnung_date(line)
        if parsed_date is not None:
            current_date = parsed_date
            i += 1
            continue

        if current_date is None or not _is_kurzuebersicht_time_line(line):
            i += 1
            continue

        start_label = line.replace("ca. ", "").strip()
        top_labels: list[str] = []
        block_lines: list[str] = []
        i += 1

        while i < len(lines):
            current = lines[i]
            if _parse_kurzuebersicht_date(current) is not None or _is_kurzuebersicht_time_line(current):
                break
            if current.startswith("21. Wahlperiode") or current == "Tagesordnung":
                i += 1
                continue
            if _is_kurzuebersicht_duration_line(current):
                i += 1
                continue
            if _is_kurzuebersicht_top_line(current):
                top_labels.append(current)
                i += 1
                continue
            break

        while i < len(lines):
            current = lines[i]
            if _parse_kurzuebersicht_date(current) is not None or _is_kurzuebersicht_time_line(current):
                break
            if current.startswith("21. Wahlperiode") or current == "Tagesordnung":
                i += 1
                continue
            if re.match(r"^\d+$", current):
                i += 1
                continue
            if not _is_kurzuebersicht_duration_line(current):
                block_lines.append(current)
            i += 1

        title_lines: list[str] = []
        speaker_lines: list[str] = []
        notes: list[str] = []
        speaker_mode = False

        for block_line in block_lines:
            if block_line in {"Namentliche Abstimmung", "weitere Beratungen", "wird abgesetzt"}:
                notes.append(block_line)
                speaker_mode = True
                continue
            if block_line.lower().startswith("ca. ") and "durchführung der namentlichen abstimmung" in block_line.lower():
                notes.append(block_line)
                speaker_mode = True
                continue
            if _is_probable_speaker_line(block_line):
                speaker_mode = True
                speaker_lines.append(block_line)
                continue
            if speaker_mode:
                notes.append(block_line)
            else:
                title_lines.append(block_line)

        title = " ".join(title_lines).strip() or None
        speakers = [_clean_kurzuebersicht_speaker_name(item) for item in speaker_lines if item.strip()]
        if not title and not speakers:
            continue

        start_at = datetime.combine(
            current_date,
            datetime.strptime(start_label, "%H:%M").time(),
            tzinfo=EUROPE_BERLIN,
        )
        entries.append(
            {
                "date": current_date.isoformat(),
                "start_at": start_at.isoformat(),
                "time_label": line,
                "top_labels": top_labels,
                "title": title,
                "speakers": speakers,
                "notes": notes,
            }
        )

    return entries


def _build_latest_kurzuebersicht_payload() -> dict | None:
    document = _load_latest_document_record("kurzuebersicht")
    pdf_bytes = _extract_document_bytes(document)
    if not document or not pdf_bytes:
        return None

    entries = _parse_kurzuebersicht_entries(pdf_bytes)
    directory = _load_name_directory()
    enriched_entries: list[dict] = []
    for entry in entries:
        matched_speakers = []
        unmatched_speakers = []
        for speaker_name in entry["speakers"]:
            match = directory.get(_normalize_text_key(speaker_name))
            if match:
                matched_speakers.append(
                    {
                        "name": speaker_name,
                        "user_id": match["user_id"],
                        "matched_full_name": match["full_name"],
                        "role": match["role"],
                        "email": match["email"],
                    }
                )
            else:
                unmatched_speakers.append(speaker_name)

        enriched_entries.append(
            {
                **entry,
                "matched_speakers": matched_speakers,
                "unmatched_speakers": unmatched_speakers,
            }
        )

    return {
        "document": {
            "id": document["id"],
            "title": document["title"],
            "filename": document["filename"],
            "created_at": document["created_at"],
        },
        "entries": enriched_entries,
    }


def _parse_ausgezeichnete_tagesordnung_roll_calls(pdf_bytes: bytes) -> list[dict]:
    try:
        reader = PdfReader(BytesIO(pdf_bytes))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception:
        return []

    lines = [_normalize_kurzuebersicht_line(line) for line in text.splitlines()]
    lines = [line for line in lines if line]

    events: list[dict] = []
    current_date: date | None = None
    current_top: str | None = None
    current_title_lines: list[str] = []

    def flush_title_line(line: str) -> None:
        if (
            not line
            or line.startswith("Drucksache")
            or line.startswith("Überweisungsvorschlag")
            or line.startswith("Beratung")
            or line.startswith("Ablehnung")
            or line.startswith("Zustimmung")
            or line.startswith("21. Wahlperiode")
            or line in {"Namentliche", "Abstimmung"}
        ):
            return
        current_title_lines.append(line)

    def current_title() -> str:
        return " ".join(current_title_lines).strip() or "Namentliche Abstimmung"

    i = 0
    while i < len(lines):
        line = lines[i]
        parsed_date = _parse_kurzuebersicht_date(line)
        if parsed_date is not None:
            current_date = parsed_date
            current_top = None
            current_title_lines = []
            i += 1
            continue

        top_match = re.match(r"^((?:ZP\s*)?\d+)\.?(?:\s*[–-])?\s+(.*)$", line, flags=re.IGNORECASE)
        if top_match:
            raw_top, remainder = top_match.groups()
            current_top = re.sub(r"\s+", " ", raw_top.upper()).strip()
            current_title_lines = []
            flush_title_line(remainder)
            i += 1
            continue

        if current_date is None:
            i += 1
            continue

        combined_line = line
        if line == "Namentliche" and i + 1 < len(lines) and lines[i + 1] == "Abstimmung":
            combined_line = "Namentliche Abstimmung"
            i += 1

        if "namentliche abstimmung" in combined_line.lower() or "namentlichen abstimmung" in combined_line.lower():
            match = re.search(
                r"(?:ca\.\s*)?(\d{1,2}:\d{2})\s+bis\s+(\d{1,2}:\d{2}).*?Namentlichen Abstimmung zu\s+((?:ZP|TOP)\s*\d+[a-z]?)",
                combined_line,
                flags=re.IGNORECASE,
            )
            start_at = None
            end_at = None
            top_label = current_top
            if match:
                start_label, end_label, explicit_top_label = match.groups()
                top_label = re.sub(r"\s+", " ", explicit_top_label.upper()).strip()
                start_at = datetime.combine(
                    current_date,
                    datetime.strptime(start_label, "%H:%M").time(),
                    tzinfo=EUROPE_BERLIN,
                )
                end_at = datetime.combine(
                    current_date,
                    datetime.strptime(end_label, "%H:%M").time(),
                    tzinfo=EUROPE_BERLIN,
                )
            duration_match = re.search(r"\((\d+)\s*Minuten[^)]*\)", combined_line, flags=re.IGNORECASE)
            events.append(
                {
                    "date": current_date.isoformat(),
                    "top": top_label,
                    "title": current_title(),
                    "start_at": start_at,
                    "end_at": end_at,
                    "duration_minutes": int(duration_match.group(1)) if duration_match else None,
                    "note": combined_line,
                    "pdf_url": None,
                    "source": "ausgezeichnete_tagesordnung",
                }
            )
            i += 1
            continue

        if current_top:
            flush_title_line(line)
        i += 1

    return events


def _build_latest_ausgezeichnete_tagesordnung_payload() -> dict | None:
    document = _load_latest_document_record("ausgezeichnete_tagesordnung")
    pdf_bytes = _extract_document_bytes(document)
    if not document or not pdf_bytes:
        return None

    return {
        "document": {
            "id": document["id"],
            "title": document["title"],
            "filename": document["filename"],
            "created_at": document["created_at"],
        },
        "roll_calls": _parse_ausgezeichnete_tagesordnung_roll_calls(pdf_bytes),
    }


def _normalize_parliament_top_labels(value: str | None) -> list[str]:
    raw = re.sub(r"\s+", " ", (value or "").strip().upper())
    if not raw:
        return []

    labels: list[str] = []

    def push_label(prefix: str | None, number: str) -> None:
        labels.append(f"ZP {number}" if prefix == "ZP" else number)

    for part in [item.strip() for item in raw.split(",") if item.strip()]:
        range_match = re.match(r"^(TOP|ZP)?\s*(\d+)\s*[-–]\s*(\d+)$", part)
        if range_match:
            prefix = range_match.group(1)
            start = int(range_match.group(2))
            end = int(range_match.group(3))
            if end >= start:
                for current in range(start, end + 1):
                    push_label(prefix, str(current))
                continue

        plus_match = re.match(r"^(TOP|ZP)?\s*(\d+)\+(\d+)$", part)
        if plus_match:
            prefix = plus_match.group(1)
            push_label(prefix, plus_match.group(2))
            push_label(prefix, plus_match.group(3))
            continue

        simple_match = re.match(r"^(TOP|ZP)?\s*(\d+[A-Z]?)$", part)
        if simple_match:
            push_label(simple_match.group(1), simple_match.group(2))
            continue

        labels.append(part.replace("TOP ", "").replace("ZP ", "ZP "))

    return list(dict.fromkeys(labels))


def _match_live_point_for_kurzuebersicht_entry(entry: dict, parliament_payload: dict | None) -> dict | None:
    if not parliament_payload:
        return None

    top_labels = {
        normalized
        for label in (entry.get("top_labels") or [])
        for normalized in _normalize_parliament_top_labels(label)
    }
    if not top_labels:
        return None

    candidates = []
    for key in ("current_top", "next_top"):
        point = parliament_payload.get(key) or {}
        if point:
            candidates.append(point)
    candidates.extend(parliament_payload.get("agenda_points") or [])

    for point in candidates:
        point_labels = set(_normalize_parliament_top_labels(point.get("top")))
        if point_labels & top_labels:
            return point

    return None


def _find_session_point_for_kurzuebersicht_entry(entry: dict, sessions: list[dict]) -> dict | None:
    top_labels = {
        normalized
        for label in (entry.get("top_labels") or [])
        for normalized in _normalize_parliament_top_labels(label)
    }
    entry_date = entry.get("date")
    if not top_labels or not entry_date:
        return None

    for session in sessions:
        session_date = session.get("date")
        if session_date is None or session_date.isoformat() != entry_date:
            continue
        for point in session.get("points") or []:
            point_labels = set(_normalize_parliament_top_labels(point.get("top")))
            if point_labels & top_labels:
                return point

    return None


def _find_session_point_for_top_label(
    top_label: str | None,
    entry_date: str | None,
    sessions: list[dict],
) -> dict | None:
    normalized_labels = set(_normalize_parliament_top_labels(top_label))
    if not normalized_labels or not entry_date:
        return None

    for session in sessions:
        session_date = session.get("date")
        if session_date is None or session_date.isoformat() != entry_date:
            continue
        for point in session.get("points") or []:
            point_labels = set(_normalize_parliament_top_labels(point.get("top")))
            if point_labels & normalized_labels:
                return point

    return None


def _build_kurzuebersicht_roll_call_events() -> list[dict]:
    latest_payload = _build_latest_kurzuebersicht_payload()
    events: list[dict] = []
    sessions = _parse_bundestag_conferences()
    if latest_payload:
        for entry in latest_payload["entries"]:
            top_labels = entry.get("top_labels") or []
            title = entry.get("title")
            point = _find_session_point_for_kurzuebersicht_entry(entry, sessions)
            primary_top = (top_labels[0] if top_labels else None) or None

            note_roll_calls = []
            for note in entry.get("notes") or []:
                match = re.search(
                    r"ca\.\s*(\d{1,2}:\d{2})\s+bis\s+(\d{1,2}:\d{2}).*?Namentlichen Abstimmung zu\s+((?:ZP|TOP)\s*\d+[a-z]?)",
                    note,
                    re.IGNORECASE,
                )
                if not match:
                    continue
                start_label, end_label, top_label = match.groups()
                entry_date = datetime.fromisoformat(entry["start_at"]).date()
                start_at = datetime.combine(
                    entry_date,
                    datetime.strptime(start_label, "%H:%M").time(),
                    tzinfo=EUROPE_BERLIN,
                )
                end_at = datetime.combine(
                    entry_date,
                    datetime.strptime(end_label, "%H:%M").time(),
                    tzinfo=EUROPE_BERLIN,
                )
                duration_match = re.search(r"(\d+)\s*Minuten", note, re.IGNORECASE)
                note_roll_calls.append(
                    {
                        "top": re.sub(r"\s+", " ", top_label.upper()).strip(),
                        "title": title,
                        "start_at": start_at,
                        "end_at": end_at,
                        "duration_minutes": int(duration_match.group(1)) if duration_match else None,
                        "note": note,
                        "pdf_url": latest_payload["document"].get("filename"),
                        "source": "kurzuebersicht_note",
                    }
                )

            if note_roll_calls:
                events.extend(note_roll_calls)
                continue

            title_and_notes = " ".join(
                [title or "", *[note for note in (entry.get("notes") or []) if note]]
            ).lower()
            if "namentliche abstimmung" not in title_and_notes:
                continue

            end_at = _point_effective_end(point) if point else None
            start_at = point.get("start_at") if point else datetime.fromisoformat(entry["start_at"])
            events.append(
                {
                    "top": primary_top,
                    "title": title,
                    "start_at": start_at,
                    "end_at": end_at or start_at,
                    "duration_minutes": None,
                    "note": None,
                    "pdf_url": None,
                    "source": "kurzuebersicht_entry",
                }
            )

    tagesordnung_payload = _build_latest_ausgezeichnete_tagesordnung_payload()
    if tagesordnung_payload:
        for item in tagesordnung_payload["roll_calls"]:
            point = _find_session_point_for_top_label(
                item.get("top"),
                item.get("date"),
                sessions,
            )
            events.append(
                {
                    **item,
                    "start_at": item.get("start_at") or ((point or {}).get("start_at")),
                    "end_at": item.get("end_at") or _point_effective_end(point or {}),
                    "pdf_url": tagesordnung_payload["document"].get("filename"),
                }
            )

    deduped: dict[tuple[str, str, str], dict] = {}
    for item in events:
        key = (
            (item.get("top") or "").strip().upper(),
            _iso_or_none(item.get("start_at")) or "",
            _iso_or_none(item.get("end_at")) or "",
        )
        deduped[key] = item

    return sorted(
        deduped.values(),
        key=lambda item: (_iso_or_none(item.get("start_at")) or _iso_or_none(item.get("end_at")) or ""),
    )


def _build_live_speaker_lookup(parliament_payload: dict | None) -> dict[tuple[str, str], dict]:
    if parliament_payload and parliament_payload.get("mode") != "live":
        return {}

    speaker_payload = _parse_bundestag_speaker()
    if not speaker_payload.get("live"):
        return {}

    live_topic_number = (speaker_payload.get("topic_number") or "").strip().upper()
    normalized_live_topics = _normalize_parliament_top_labels(live_topic_number)
    lookup: dict[tuple[str, str], dict] = {}
    for speaker in speaker_payload.get("speakers") or []:
        speaker_name = (speaker.get("name") or "").strip()
        if not speaker_name:
            continue

        speaker_key = _normalize_text_key(speaker_name)
        for topic_number in normalized_live_topics or [live_topic_number]:
            key = (speaker_key, topic_number)
            lookup[key] = speaker

    return lookup


def _build_faction_speech_entries(parliament_payload: dict | None = None) -> list[dict]:
    latest_payload = _build_latest_kurzuebersicht_payload()
    if not latest_payload:
        return []

    sessions = _parse_bundestag_conferences()
    live_speaker_lookup = _build_live_speaker_lookup(parliament_payload)
    speeches: list[dict] = []
    for entry in latest_payload["entries"]:
        session_point = _find_session_point_for_kurzuebersicht_entry(entry, sessions)
        live_point = _match_live_point_for_kurzuebersicht_entry(entry, parliament_payload)
        effective_start_value = (
            (live_point or {}).get("start_at")
            or (session_point or {}).get("start_at")
            or entry.get("start_at")
        )
        effective_start_at = (
            _iso_or_none(effective_start_value)
            if isinstance(effective_start_value, datetime)
            else effective_start_value
        )
        top_labels = entry.get("top_labels") or []
        primary_top_label = (top_labels[0] if top_labels else None) or ""
        normalized_top_candidates = {
            normalized
            for label in top_labels
            for normalized in _normalize_parliament_top_labels(label)
        }
        for speaker in entry.get("matched_speakers") or []:
            live_speaker = None
            for top_label in normalized_top_candidates:
                live_speaker = live_speaker_lookup.get(
                    (_normalize_text_key(speaker["name"]), top_label)
                )
                if live_speaker:
                    break
            speeches.append(
                {
                    "user_id": speaker["user_id"],
                    "speaker_name": speaker["matched_full_name"],
                    "source_speaker_name": speaker["name"],
                    "role": speaker.get("role"),
                    "email": speaker.get("email"),
                    "top_labels": top_labels,
                    "top": primary_top_label or None,
                    "title": entry.get("title"),
                    "planned_start_at": entry.get("start_at"),
                    "effective_start_at": _iso_or_none(live_speaker.get("start_at")) if live_speaker and live_speaker.get("start_at") else effective_start_at,
                    "live_matched": live_speaker is not None or live_point is not None,
                    "has_live_time": live_speaker is not None and live_speaker.get("start_at") is not None,
                    "live_state": live_speaker.get("state") if live_speaker else None,
                    "notes": entry.get("notes") or [],
                }
            )
        for speaker_name in entry.get("unmatched_speakers") or []:
            live_speaker = None
            for top_label in normalized_top_candidates:
                live_speaker = live_speaker_lookup.get(
                    (_normalize_text_key(speaker_name), top_label)
                )
                if live_speaker:
                    break
            speeches.append(
                {
                    "user_id": None,
                    "speaker_name": speaker_name,
                    "source_speaker_name": speaker_name,
                    "role": None,
                    "email": None,
                    "top_labels": top_labels,
                    "top": primary_top_label or None,
                    "title": entry.get("title"),
                    "planned_start_at": entry.get("start_at"),
                    "effective_start_at": _iso_or_none(live_speaker.get("start_at")) if live_speaker and live_speaker.get("start_at") else effective_start_at,
                    "live_matched": live_speaker is not None or live_point is not None,
                    "has_live_time": live_speaker is not None and live_speaker.get("start_at") is not None,
                    "live_state": live_speaker.get("state") if live_speaker else None,
                    "notes": entry.get("notes") or [],
                }
            )

    speeches.sort(
        key=lambda item: (
            item.get("effective_start_at")
            or item.get("planned_start_at")
            or ""
        )
    )
    return speeches


def _build_next_speech_for_user(
    user_id: str,
    *,
    effective_at: datetime,
    parliament_payload: dict | None,
) -> tuple[dict | None, str]:
    speeches = _build_faction_speech_entries(parliament_payload=parliament_payload)
    if not speeches:
        return None, "kurzuebersicht_unavailable"

    future_candidates = []
    current_candidate = None
    for speech in speeches:
        if speech.get("user_id") != user_id:
            continue

        start_raw = speech.get("effective_start_at") or speech.get("planned_start_at")
        start_at = _parse_iso_datetime(start_raw) if start_raw else None
        if start_at is None:
            continue

        top_labels = {
            normalized
            for label in (speech.get("top_labels") or [])
            for normalized in _normalize_parliament_top_labels(label)
        }
        current_top = (parliament_payload or {}).get("current_top") or {}
        current_top_labels = set(_normalize_parliament_top_labels(current_top.get("top")))
        if current_top_labels and current_top_labels & top_labels:
            current_candidate = speech
            break

        if start_at >= effective_at:
            future_candidates.append((start_at, speech))

    chosen = current_candidate or (future_candidates[0][1] if future_candidates else None)
    if not chosen:
        return None, "kurzuebersicht_no_upcoming_speech"

    source = "kurzuebersicht_planned_top"
    if chosen.get("live_matched"):
        source = "kurzuebersicht_live_top"

    payload = {
        "user_id": chosen["user_id"],
        "speaker_name": chosen["speaker_name"],
        "top": chosen.get("top"),
        "top_labels": chosen.get("top_labels") or [],
        "title": chosen.get("title"),
        "start_at": chosen.get("effective_start_at") or chosen.get("planned_start_at"),
        "planned_start_at": chosen.get("planned_start_at"),
        "live_matched": chosen.get("live_matched", False),
        "notes": chosen.get("notes") or [],
    }
    return payload, source


def _mail_import_worker_loop():
    while True:
        try:
            result = run_mail_import_once()
            print(
                "MAIL IMPORT POLL processed={processed} imported={imported}".format(
                    processed=result.get("processed_messages", 0),
                    imported=result.get("imported_documents", 0),
                ),
                flush=True,
            )
        except Exception as exc:
            print(f"MAIL IMPORT POLL FAILED error={exc}", flush=True)

        sleep_seconds = max(MAIL_IMPORT_POLL_MINUTES, 1) * 60
        time.sleep(sleep_seconds)


def _start_mail_import_worker():
    global _mail_import_worker_started

    if not _mail_import_enabled() or MAIL_IMPORT_POLL_MINUTES <= 0:
        return

    with _mail_import_worker_lock:
        if _mail_import_worker_started:
            return
        thread = threading.Thread(target=_mail_import_worker_loop, name="mail-import-poller", daemon=True)
        thread.start()
        _mail_import_worker_started = True
        print(
            f"MAIL IMPORT POLL STARTED interval_minutes={MAIL_IMPORT_POLL_MINUTES}",
            flush=True,
        )


def ensure_parliament_reminder_tables():
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS parliament_reminders_sent (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    reminder_type TEXT NOT NULL,
                    reminder_key TEXT NOT NULL,
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    UNIQUE(reminder_type, reminder_key, user_id)
                )
                """
            )
        conn.commit()


def _parliament_reminder_already_sent(
    *,
    reminder_type: str,
    reminder_key: str,
    user_id: str,
) -> bool:
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 1
                FROM parliament_reminders_sent
                WHERE reminder_type = %s
                  AND reminder_key = %s
                  AND user_id = %s
                LIMIT 1
                """,
                (reminder_type, reminder_key, user_id),
            )
            return cur.fetchone() is not None


def _record_parliament_reminder_sent(
    *,
    reminder_type: str,
    reminder_key: str,
    user_id: str,
):
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO parliament_reminders_sent (
                    reminder_type,
                    reminder_key,
                    user_id
                )
                VALUES (%s, %s, %s)
                ON CONFLICT (reminder_type, reminder_key, user_id) DO NOTHING
                """,
                (reminder_type, reminder_key, user_id),
            )
        conn.commit()


def _push_targets_for_active_users() -> list[tuple[str, list[str]]]:
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    u.id::text,
                    array_agg(DISTINCT upt.token ORDER BY upt.token) AS tokens
                FROM users u
                JOIN user_push_tokens upt
                  ON upt.user_id = u.id
                WHERE COALESCE(u.is_active, true) = true
                GROUP BY u.id
                """
            )
            rows = cur.fetchall()

    return [(row[0], [token for token in (row[1] or []) if token]) for row in rows]


def send_parliament_reminders():
    ensure_parliament_reminder_tables()

    now = datetime.now(EUROPE_BERLIN)
    lookahead_end = now + timedelta(minutes=PARLIAMENT_REMINDER_LOOKAHEAD_MINUTES)
    payload = _build_parliament_live_payload(at=now)
    next_roll_call = payload.get("next_roll_call") or {}
    reminders_sent: list[dict] = []

    start_raw = next_roll_call.get("start_at")
    if start_raw:
        start_at = datetime.fromisoformat(start_raw)
        if now <= start_at <= lookahead_end:
            reminder_key = f"{next_roll_call.get('top') or 'no-top'}::{start_at.isoformat()}"
            title = "Namentliche Abstimmung in Kürze"
            body = " · ".join(
                part
                for part in [
                    next_roll_call.get("top"),
                    next_roll_call.get("title"),
                    f"Start voraussichtlich {start_at.astimezone(EUROPE_BERLIN).strftime('%H:%M')} Uhr",
                ]
                if part
            )

            for user_id, tokens in _push_targets_for_active_users():
                if not tokens:
                    continue
                if _parliament_reminder_already_sent(
                    reminder_type="roll_call",
                    reminder_key=reminder_key,
                    user_id=user_id,
                ):
                    continue

                send_push_to_tokens(
                    tokens=tokens,
                    title=title,
                    body=body,
                    data={
                        "type": "parliament_roll_call",
                        "top": next_roll_call.get("top") or "",
                        "title": next_roll_call.get("title") or "",
                        "start_at": start_at.isoformat(),
                    },
                )
                _record_parliament_reminder_sent(
                    reminder_type="roll_call",
                    reminder_key=reminder_key,
                    user_id=user_id,
                )
                reminders_sent.append(
                    {
                        "reminder_type": "roll_call",
                        "user_id": user_id,
                        "top": next_roll_call.get("top"),
                        "start_at": start_at.isoformat(),
                    }
                )

    return {
        "now": now.isoformat(),
        "lookahead_minutes": PARLIAMENT_REMINDER_LOOKAHEAD_MINUTES,
        "sent": reminders_sent,
        "count": len(reminders_sent),
    }


def ensure_feedback_table():
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS feedback_entries (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    kind TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'open',
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    context TEXT,
                    admin_note TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_feedback_entries_status_created_at
                ON feedback_entries(status, created_at DESC)
                """
            )
        conn.commit()


@app.post("/feedback")
def create_feedback(
    payload: FeedbackCreate,
    authorization: str | None = Header(default=None),
):
    actor = get_current_user_from_firebase(authorization)
    ensure_feedback_table()

    title = payload.title.strip()
    content = payload.content.strip()
    context_value = payload.context.strip() if payload.context else None
    if not title:
        raise HTTPException(status_code=400, detail="Titel fehlt")
    if not content:
        raise HTTPException(status_code=400, detail="Inhalt fehlt")

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO feedback_entries (
                    user_id,
                    kind,
                    title,
                    content,
                    context
                )
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, status, created_at
                """,
                (actor["id"], payload.kind, title, content, context_value),
            )
            row = cur.fetchone()
        conn.commit()

    return {
        "id": str(row[0]),
        "status": row[1],
        "created_at": row[2].isoformat() if row[2] else None,
    }


@app.get("/admin/feedback")
def admin_list_feedback(authorization: str | None = Header(default=None)):
    require_admin(authorization)
    ensure_feedback_table()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    f.id,
                    f.kind,
                    f.status,
                    f.title,
                    f.content,
                    f.context,
                    f.admin_note,
                    f.created_at,
                    f.updated_at,
                    u.id,
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.role
                FROM feedback_entries f
                JOIN users u
                  ON u.id = f.user_id
                ORDER BY
                    CASE f.status
                        WHEN 'open' THEN 0
                        WHEN 'in_review' THEN 1
                        WHEN 'done' THEN 2
                        ELSE 3
                    END,
                    f.created_at DESC
                """
            )
            rows = cur.fetchall()

    return [
        {
            "id": str(r[0]),
            "kind": r[1],
            "status": r[2],
            "title": r[3],
            "content": r[4],
            "context": r[5],
            "admin_note": r[6],
            "created_at": r[7].isoformat() if r[7] else None,
            "updated_at": r[8].isoformat() if r[8] else None,
            "user": {
                "id": str(r[9]),
                "email": r[10],
                "first_name": r[11],
                "last_name": r[12],
                "role": r[13],
            },
        }
        for r in rows
    ]


@app.patch("/admin/feedback/{feedback_id}")
def admin_update_feedback(
    feedback_id: UUID,
    payload: FeedbackUpdate,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_feedback_table()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE feedback_entries
                SET status = %s,
                    admin_note = %s,
                    updated_at = now()
                WHERE id = %s
                RETURNING id
                """,
                (payload.status, payload.admin_note, feedback_id),
            )
            row = cur.fetchone()
        conn.commit()

    if not row:
        raise HTTPException(status_code=404, detail="Rückmeldung nicht gefunden")

    return {"ok": True, "id": str(row[0])}


@app.post("/debug/attendance-reminders")
def debug_attendance_reminders(authorization: str | None = Header(default=None)):
    require_admin(authorization)
    if not _debug_endpoint_enabled():
        raise HTTPException(status_code=404, detail="Not found")
    return send_attendance_reminders()


@app.post("/admin/parliament-reminders/run")
def admin_run_parliament_reminders(authorization: str | None = Header(default=None)):
    require_admin(authorization)
    return send_parliament_reminders()

@app.post("/documents/upload")
def upload_document(
    title: str = Form(...),
    category: str = Form(...),
    recipient_scope: str = Form(...),
    recipient_user_ids: str | None = Form(default=None),
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    user = get_current_user_from_firebase(authorization)
    ensure_message_recipient_table()

    if user["role"] not in ("admin", "pgf"):
        raise HTTPException(status_code=403, detail="Not allowed")

    if recipient_scope:
        recipient_ids = _resolve_document_recipient_ids(recipient_scope)
    elif recipient_user_ids:
        recipient_ids = json.loads(recipient_user_ids)
    else:
        raise HTTPException(status_code=400, detail="Empfängerkreis fehlt")

    if not recipient_ids:
        raise HTTPException(status_code=400, detail="Keine aktiven Empfänger gefunden")

    file_bytes = file.file.read()
    document_id = _persist_document_record(
        title=title,
        category=category,
        original_filename=file.filename or "upload.bin",
        mime_type=file.content_type,
        content_bytes=file_bytes,
        recipient_ids=recipient_ids,
        uploaded_by_user_id=user["id"],
    )
    _notify_new_document(
        title=title,
        recipient_ids=recipient_ids,
    )

    return {"id": document_id}


@app.post("/admin/mail-import/run")
def admin_run_mail_import(authorization: str | None = Header(default=None)):
    require_admin(authorization)
    return run_mail_import_once()


@app.get("/admin/kurzuebersicht/latest")
def admin_get_latest_kurzuebersicht(authorization: str | None = Header(default=None)):
    require_admin(authorization)
    payload = _build_latest_kurzuebersicht_payload()
    if not payload:
        raise HTTPException(status_code=404, detail="Keine Kurzübersicht vorhanden")
    return payload


@app.get("/admin/kurzuebersicht/faction-speakers")
def admin_get_kurzuebersicht_faction_speakers(
    at: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    effective_at = _parse_iso_datetime(at) if at else None
    parliament_payload = _build_parliament_live_payload(at=effective_at)
    return {
        "generated_at": datetime.now(EUROPE_BERLIN).isoformat(),
        "effective_at": (effective_at or datetime.now(EUROPE_BERLIN)).isoformat(),
        "speeches": _build_faction_speech_entries(parliament_payload=parliament_payload),
    }

# -----------------------------
# Me
# -----------------------------
@app.get("/me")
def get_me(email: str | None = None, authorization: str | None = Header(default=None)):
    actor = get_current_user_from_firebase(authorization)
    email_lookup = (email or actor["email"]).strip()
    if not email_lookup:
        raise HTTPException(status_code=400, detail="Email required")
    if actor["role"] not in ("admin", "pgf") and email_lookup.lower() != actor["email"].lower():
        raise HTTPException(status_code=403, detail="Forbidden")

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    """
                    SELECT id, first_name, last_name, group_id, role
                    FROM users
                    WHERE lower(email) = lower(%s)
                """,
                    (email_lookup,),
                )
                row = cur.fetchone()

                if not row:
                    raise HTTPException(status_code=404, detail="User not found")

                return {
                    "id": str(row[0]),
                    "first_name": row[1],
                    "last_name": row[2],
                    "group": str(row[3]) if row[3] else None,
                    "role": row[4],
                }
            except psycopg.errors.UndefinedColumn:
                # Fallback for older local dev databases that do not yet have
                # the newer users.group_id column.
                conn.rollback()
                cur.execute(
                    """
                    SELECT id, first_name, last_name, role
                    FROM users
                    WHERE lower(email) = lower(%s)
                """,
                    (email_lookup,),
                )
                row = cur.fetchone()

                if not row:
                    raise HTTPException(status_code=404, detail="User not found")

                return {
                    "id": str(row[0]),
                    "first_name": row[1],
                    "last_name": row[2],
                    "group": None,
                    "role": row[3],
                }


# -----------------------------
# Push Token
# -----------------------------
@app.post("/users/push-token")
def upsert_push_token(
    payload: PushTokenUpsert,
    authorization: str | None = Header(default=None),
):
    actor = get_current_user_from_firebase(authorization)
    if actor["role"] not in ("admin", "pgf") and actor["id"] != str(payload.user_id):
        raise HTTPException(status_code=403, detail="Forbidden")

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO user_push_tokens (user_id, token, platform)
                VALUES (%s, %s, %s)
                ON CONFLICT (token) DO UPDATE
                  SET user_id = EXCLUDED.user_id,
                      platform = EXCLUDED.platform,
                      updated_at = now();
                """,
                (payload.user_id, payload.token, payload.platform),
            )
        conn.commit()
    return {"status": "ok"}


# -----------------------------
# Debug Token
# -----------------------------
@app.get("/debug/tokens")
def debug_tokens(authorization: str | None = Header(default=None)):
    require_admin(authorization)
    if not _debug_endpoint_enabled():
        raise HTTPException(status_code=404, detail="Not found")

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  user_id::text,
                  token,
                  platform,
                  updated_at
                FROM user_push_tokens
                ORDER BY updated_at DESC
                LIMIT 50;
                """
            )
            rows = cur.fetchall()

    return [
        {
            "user_id": r[0],
            "token": r[1],
            "platform": r[2],
            "updated_at": r[3].isoformat() if r[3] else None,
        }
        for r in rows
    ]


# -----------------------------
# Debug push (no DB insert)
# -----------------------------
@app.post("/debug/push")
def debug_push(payload: DebugPush, authorization: str | None = Header(default=None)):
    require_admin(authorization)
    if not _debug_endpoint_enabled():
        raise HTTPException(status_code=404, detail="Not found")

    tokens = get_all_push_tokens()

    try:
        success = send_push_to_tokens(
            tokens=tokens,
            title=payload.title,
            body=payload.body,
            data={
                "type": "pgf_message",
                "message_id": "debug",
                "sender": "Debug",
                "content": payload.body,
                "urgency": payload.urgency,
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"push failed: {e}")

    return {"targets": len(tokens), "success": success}


# -----------------------------
# Messages (PGF)
# -----------------------------


@app.post("/pgf/messages")
def create_pgf_message(
    payload: PGFMessageCreate,
    authorization: str | None = Header(default=None),
):
    """
    PGF erstellt eine Mitteilung.
    (Dev: ohne Auth)
    """
    require_admin(authorization)

    msg_id, created_at = create_message(
        sender_name=payload.sender_name,
        content=payload.content,
        urgency=payload.urgency,
    )

    # Push senden (best effort) - pro Ziel mit passendem Badge-Wert
    targets = get_all_push_targets()
    push_success = 0
    push_error = None

    try:
        for target in targets:
            badge = get_unread_message_count(UUID(target["user_id"]))
            result = send_push_to_tokens(
                tokens=[target["token"]],
                title="Fraktions-Mitteilung",
                body=f"{payload.sender_name}: {payload.content}",
                data={
                    "type": "pgf_message",
                    "message_id": str(msg_id),
                    "sender": payload.sender_name,
                    "content": payload.content,
                    "urgency": payload.urgency,
                },
                badge=badge,
            )
            push_success += result["success"]
    except Exception as e:
        # kein harter Fehler: Nachricht ist ja gespeichert
        push_error = str(e)

    return {
        "id": str(msg_id),
        "created_at": created_at.isoformat(),
        "sender_name": payload.sender_name,
        "content": payload.content,
        "urgency": payload.urgency,
        "push": {"targets": len(targets), "success": push_success, "error": push_error},
    }


@app.get("/pgf/messages")
def list_pgf_messages(
    limit: int = Query(50, ge=1, le=500),
    authorization: str | None = Header(default=None),
):
    """
    Liste aller gesendeten PGF-Mitteilungen (neueste zuerst).
    Sichtbar für Admin/PGF.
    """
    require_admin(authorization)
    ensure_message_recipient_table()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, created_at, sender_name, content, urgency
                FROM pgf_messages
                ORDER BY created_at DESC
                LIMIT %s;
                """,
                (limit,),
            )
            rows = cur.fetchall()

    return [
        {
            "id": str(r[0]),
            "created_at": r[1].isoformat(),
            "sender_name": r[2],
            "content": r[3],
            "urgency": r[4],
        }
        for r in rows
    ]


@app.delete("/pgf/messages/{message_id}")
def delete_pgf_message(
    message_id: UUID,
    authorization: str | None = Header(default=None),
):
    """
    Entfernt eine PGF-Mitteilung.
    (DB: hard delete, damit sie auf Geräten nach dem nächsten Sync verschwindet.)
    """
    require_admin(authorization)
    ensure_message_recipient_table()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM pgf_messages WHERE id = %s RETURNING id;", (message_id,))
            row = cur.fetchone()
        conn.commit()

    if not row:
        raise HTTPException(status_code=404, detail="Message not found")

    # No push on delete (explicit product decision).
    # Clients will remove the message on the next refresh/resume.
    return {"status": "ok"}


@app.delete("/pgf/messages")
def delete_pgf_messages_in_range(
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
    authorization: str | None = Header(default=None),
):
    """
    Entfernt PGF-Mitteilungen in einem Datumsbereich (inkl. Start/Ende).
    Sichtbar für Admin/PGF.

    Hinweis: Wir interpretieren die Tage in Europe/Berlin, damit "von/bis" für die Nutzer stimmt.
    """
    require_admin(authorization)
    ensure_message_recipient_table()

    if date_from > date_to:
        raise HTTPException(status_code=400, detail="'from' must be <= 'to'")

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM pgf_messages
                WHERE (created_at AT TIME ZONE 'Europe/Berlin')::date BETWEEN %s AND %s
                RETURNING id;
                """,
                (date_from, date_to),
            )
            deleted_ids = [str(r[0]) for r in cur.fetchall()]
        conn.commit()

    # No push on delete (explicit product decision).
    # Clients will remove messages on the next refresh/resume.
    return {"status": "ok", "deleted": len(deleted_ids)}


@app.get("/messages")
def list_messages(
    user_id: UUID = Query(...),
    limit: int = Query(50, ge=1, le=500),
    authorization: str | None = Header(default=None),
):
    """
    Liste der Mitteilungen (neueste zuerst).
    """
    ensure_message_recipient_table()
    require_self_or_admin(user_id, authorization)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, created_at, sender_name, content, urgency
                FROM pgf_messages m
                WHERE (
                    NOT EXISTS (
                        SELECT 1
                        FROM pgf_message_recipients mr
                        WHERE mr.message_id = m.id
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM pgf_message_recipients mr
                        WHERE mr.message_id = m.id
                          AND mr.user_id = %s
                    )
                )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM pgf_message_hidden h
                    WHERE h.message_id = m.id
                      AND h.user_id = %s
                )
                ORDER BY created_at DESC
                LIMIT %s;
                """,
                (user_id, user_id, limit),
            )
            rows = cur.fetchall()

    return [
        {
            "id": str(r[0]),
            "created_at": r[1].isoformat(),
            "sender_name": r[2],
            "content": r[3],
            "urgency": r[4],
        }
        for r in rows
    ]


@app.get("/messages/latest")
def latest_message(user_id: UUID = Query(...), authorization: str | None = Header(default=None)):
    """
    Neueste Mitteilung (praktisch fürs Banner/Polling).
    """
    ensure_message_recipient_table()
    require_self_or_admin(user_id, authorization)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, created_at, sender_name, content, urgency
                FROM pgf_messages m
                WHERE (
                    NOT EXISTS (
                        SELECT 1
                        FROM pgf_message_recipients mr
                        WHERE mr.message_id = m.id
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM pgf_message_recipients mr
                        WHERE mr.message_id = m.id
                          AND mr.user_id = %s
                    )
                )
                ORDER BY created_at DESC
                LIMIT 1;
                """,
                (user_id,),
            )
            row = cur.fetchone()

    if not row:
        return None

    return {
        "id": str(row[0]),
        "created_at": row[1].isoformat(),
        "sender_name": row[2],
        "content": row[3],
        "urgency": row[4],
    }


@app.get("/messages/unread-count")
def unread_message_count(user_id: UUID = Query(...), authorization: str | None = Header(default=None)):
    """
    Anzahl ungelesener Mitteilungen für einen Nutzer.
    """
    ensure_message_recipient_table()
    require_self_or_admin(user_id, authorization)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*)
                FROM pgf_messages m
                WHERE (
                    NOT EXISTS (
                        SELECT 1
                        FROM pgf_message_recipients mr
                        WHERE mr.message_id = m.id
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM pgf_message_recipients mr
                        WHERE mr.message_id = m.id
                          AND mr.user_id = %s
                    )
                )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM pgf_message_reads r
                    WHERE r.message_id = m.id
                      AND r.user_id = %s
                )
                AND NOT EXISTS (
                    SELECT 1
                    FROM pgf_message_hidden h
                    WHERE h.message_id = m.id
                      AND h.user_id = %s
                );
                """,
                (user_id, user_id, user_id),
            )
            (count,) = cur.fetchone()

    return {"unread_count": int(count)}


def get_unread_message_count(user_id: UUID) -> int:
    ensure_message_recipient_table()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*)
                FROM pgf_messages m
                WHERE (
                    NOT EXISTS (
                        SELECT 1
                        FROM pgf_message_recipients mr
                        WHERE mr.message_id = m.id
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM pgf_message_recipients mr
                        WHERE mr.message_id = m.id
                          AND mr.user_id = %s
                    )
                )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM pgf_message_reads r
                    WHERE r.message_id = m.id
                      AND r.user_id = %s
                )
                AND NOT EXISTS (
                    SELECT 1
                    FROM pgf_message_hidden h
                    WHERE h.message_id = m.id
                      AND h.user_id = %s
                );
                """,
                (user_id, user_id, user_id),
            )
            (count,) = cur.fetchone()

    return int(count)


@app.post("/messages/{message_id}/read")
def mark_message_as_read(
    message_id: UUID,
    user_id: UUID = Query(...),
    authorization: str | None = Header(default=None),
):
    """
    Markiert eine Mitteilung für einen Nutzer als gelesen.
    """
    require_self_or_admin(user_id, authorization)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pgf_message_reads (message_id, user_id)
                VALUES (%s, %s)
                ON CONFLICT (message_id, user_id) DO NOTHING;
                """,
                (message_id, user_id),
            )
        conn.commit()

    return {"status": "ok"}


@app.get("/messages/{message_id}/detail")
def get_message_detail(
    message_id: UUID,
    user_id: UUID = Query(...),
    authorization: str | None = Header(default=None),
):
    ensure_message_recipient_table()
    require_self_or_admin(user_id, authorization)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, created_at, sender_name, content, urgency
                FROM pgf_messages m
                WHERE m.id = %s
                  AND (
                    NOT EXISTS (
                        SELECT 1
                        FROM pgf_message_recipients mr
                        WHERE mr.message_id = m.id
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM pgf_message_recipients mr
                        WHERE mr.message_id = m.id
                          AND mr.user_id = %s
                    )
                  )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM pgf_message_hidden h
                    WHERE h.message_id = m.id
                      AND h.user_id = %s
                  );
                """,
                (message_id, user_id, user_id),
            )
            row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="message not found")

    return {
        "id": str(row[0]),
        "created_at": row[1].isoformat(),
        "sender_name": row[2],
        "content": row[3],
        "urgency": row[4],
    }


@app.post("/messages/{message_id}/hide")
def hide_message_for_user(
    message_id: UUID,
    user_id: UUID = Query(...),
    authorization: str | None = Header(default=None),
):
    require_self_or_admin(user_id, authorization)
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pgf_message_hidden (message_id, user_id)
                VALUES (%s, %s)
                ON CONFLICT (message_id, user_id) DO NOTHING;
                """,
                (message_id, user_id),
            )
        conn.commit()

    return {"status": "ok"}


@app.post("/messages/hide-all")
def hide_all_messages_for_user(authorization: str | None = Header(default=None)):
    current_user = get_current_user_from_firebase(authorization)
    user_id = UUID(current_user["id"])
    ensure_message_recipient_table()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pgf_message_hidden (message_id, user_id)
                SELECT m.id, %s
                FROM pgf_messages m
                WHERE (
                    NOT EXISTS (
                        SELECT 1
                        FROM pgf_message_recipients mr
                        WHERE mr.message_id = m.id
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM pgf_message_recipients mr
                        WHERE mr.message_id = m.id
                          AND mr.user_id = %s
                    )
                )
                ON CONFLICT (message_id, user_id) DO NOTHING;
                """,
                (user_id, user_id),
            )
        conn.commit()
   
    return {"status": "ok"}


@app.post("/messages/read-all")
def mark_all_messages_as_read(
    user_id: UUID = Query(...),
    authorization: str | None = Header(default=None),
):
    """
    Markiert alle vorhandenen Mitteilungen für einen Nutzer als gelesen.
    """
    ensure_message_recipient_table()
    require_self_or_admin(user_id, authorization)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pgf_message_reads (message_id, user_id)
                SELECT m.id, %s
                FROM pgf_messages m
                WHERE (
                    NOT EXISTS (
                        SELECT 1
                        FROM pgf_message_recipients mr
                        WHERE mr.message_id = m.id
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM pgf_message_recipients mr
                        WHERE mr.message_id = m.id
                          AND mr.user_id = %s
                    )
                )
                ON CONFLICT (message_id, user_id) DO NOTHING;
                """,
                (user_id, user_id),
            )
        conn.commit()

    return {"status": "ok"}


@app.get("/messages/{message_id}")
def get_message(message_id: UUID):
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, created_at, sender_name, content, urgency
                FROM pgf_messages
                WHERE id = %s;
                """,
                (message_id,),
            )
            row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="message not found")

    return {
        "id": str(row[0]),
        "created_at": row[1].isoformat(),
        "sender_name": row[2],
        "content": row[3],
        "urgency": row[4],
    }


# -----------------------------
# Slots
# -----------------------------
@app.get("/slots")
def list_slots(
    from_date: date = Query(..., alias="from"),
    to_date: date = Query(..., alias="to"),
):
    """
    Liste Slots in einem Zeitraum.
    """
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    s.id,
                    s.slot_date,
                    s.slot_code,
                    s.weekday,
                    s.start_time,
                    s.end_time,
                    s.open_end,
                    NULL::text AS base_group
                FROM duty_slots s
                WHERE s.slot_date BETWEEN %s AND %s
                ORDER BY s.slot_date, s.slot_code;
                """,
                (from_date, to_date),
            )
            rows = cur.fetchall()

    return [
        {
            "id": str(r[0]),
            "date": str(r[1]),
            "slot_code": r[2],
            "weekday": r[3],
            "start_time": str(r[4]),
            "end_time": (str(r[5]) if r[5] else None),
            "open_end": r[6],
            "base_group": r[7],
        }
        for r in rows
    ]


@app.get("/slots/sample")
def sample_slots():
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    s.id,
                    s.slot_date,
                    s.slot_code,
                    s.weekday,
                    s.start_time,
                    s.end_time,
                    s.open_end,
                    NULL::text AS base_group
                FROM duty_slots s
                ORDER BY s.slot_date, s.slot_code
                LIMIT 5;
                """
            )
            rows = cur.fetchall()
    return [
        {
            "id": str(r[0]),
            "date": str(r[1]),
            "slot_code": r[2],
            "weekday": r[3],
            "start_time": str(r[4]),
            "end_time": (str(r[5]) if r[5] else None),
            "open_end": r[6],
            "base_group": r[7],
        }
        for r in rows
    ]


@app.get("/slots/{slot_id}/participants")
def slot_participants(slot_id: UUID):
    """
    Teilnehmerliste eines Slots (inkl. Gruppen-Code).
    Direkte Slot-Zuweisungen.
    """
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  sa.user_id,
                  u.first_name,
                  u.last_name,
                  NULL::text AS group_code,
                  sa.assignment_type
                FROM slot_assignments sa
                JOIN users u ON u.id = sa.user_id
                WHERE sa.slot_id = %s
                ORDER BY
                  CASE sa.assignment_type WHEN 'active' THEN 0 ELSE 1 END,
                  u.last_name,
                  u.first_name;
                """,
                (slot_id,),
            )
            rows = cur.fetchall()

    return [
        {
            "user_id": str(r[0]),
            "first_name": r[1],
            "last_name": r[2],
            "group_code": r[3],
            "assignment_type": _normalise_assignment_type(r[4]),
        }
        for r in rows
    ]


@app.get("/slots/{slot_id}/attendance-access")
def get_slot_attendance_access(
    slot_id: UUID,
    authorization: str | None = Header(default=None),
):
    actor = get_current_user_from_firebase(authorization)
    ensure_direct_slot_assignment_schema()
    ensure_temporary_pgf_grants_table()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM duty_slots WHERE id = %s", (slot_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Slot not found")

            cur.execute("SELECT role FROM users WHERE id = %s", (actor["id"],))
            actor_row = cur.fetchone()
            if not actor_row:
                raise HTTPException(status_code=403, detail="User not found")

            can_manage = _user_can_manage_slot_attendance(
                cur,
                slot_id=slot_id,
                user_id=actor["id"],
                role=actor_row[0],
            )

    return {
        "slot_id": str(slot_id),
        "can_manage_attendance": can_manage,
    }


@app.get("/slots/{slot_id}/attendance")
def get_attendance(slot_id: str, authorization: str | None = Header(default=None)):
    actor = get_current_user_from_firebase(authorization)
    ensure_direct_slot_assignment_schema()
    ensure_temporary_pgf_grants_table()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT role FROM users WHERE id = %s", (actor["id"],))
            actor_row = cur.fetchone()
            if not actor_row:
                raise HTTPException(status_code=403, detail="User not found")
            if not _user_can_manage_slot_attendance(
                cur,
                slot_id=slot_id,
                user_id=actor["id"],
                role=actor_row[0],
            ):
                raise HTTPException(status_code=403, detail="Attendance permission required")

            cur.execute(
                """
                SELECT 
                    sa.user_id,
                    u.first_name,
                    u.last_name,
                    sa.assignment_type,
                    EXISTS (
                        SELECT 1 FROM attendance_checks ac
                        WHERE ac.slot_id = %s AND ac.user_id = sa.user_id
                    ) as checked
                FROM slot_assignments sa
                JOIN users u ON u.id = sa.user_id
                WHERE sa.slot_id = %s
                ORDER BY
                    CASE sa.assignment_type WHEN 'active' THEN 0 ELSE 1 END,
                    u.last_name
            """,
                (slot_id, slot_id),
            )

            rows = cur.fetchall()

            return [
                {
                    "id": str(r[0]),
                    "first_name": r[1],
                    "last_name": r[2],
                    "assignment_type": _normalise_assignment_type(r[3]),
                    "checked": r[4],
                }
                for r in rows
            ]


@app.post("/slots/{slot_id}/attendance/toggle")
def toggle_attendance(
    slot_id: str,
    payload: dict,
    authorization: str | None = Header(default=None),
):
    actor = get_current_user_from_firebase(authorization)
    ensure_temporary_pgf_grants_table()

    user_id = payload.get("user_id")
    checked_by = actor["id"]

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT role FROM users WHERE id = %s", (actor["id"],))
            actor_row = cur.fetchone()
            if not actor_row:
                raise HTTPException(status_code=403, detail="User not found")
            if not _user_can_manage_slot_attendance(
                cur,
                slot_id=slot_id,
                user_id=actor["id"],
                role=actor_row[0],
            ):
                raise HTTPException(status_code=403, detail="Attendance permission required")

            # prüfen ob schon vorhanden
            cur.execute(
                """
                SELECT id FROM attendance_checks
                WHERE slot_id = %s AND user_id = %s
            """,
                (slot_id, user_id),
            )

            existing = cur.fetchone()

            if existing:
                cur.execute(
                    """
                    DELETE FROM attendance_checks
                    WHERE slot_id = %s AND user_id = %s
                """,
                    (slot_id, user_id),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO attendance_checks (slot_id, user_id, checked_by)
                    VALUES (%s, %s, %s)
                """,
                    (slot_id, user_id, checked_by),
                )

        conn.commit()

    return {"ok": True}


@app.get("/attendance/stats")
def attendance_stats(
    from_date: str | None = None,
    to_date: str | None = None,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                WITH planned AS (
                    SELECT
                        sa.user_id,
                        COUNT(*) AS planned_count
                    FROM slot_assignments sa
                    JOIN duty_slots s ON s.id = sa.slot_id
                    WHERE (%s::date IS NULL OR s.slot_date >= %s::date)
                      AND (%s::date IS NULL OR s.slot_date <= %s::date)
                    GROUP BY sa.user_id
                ),
                done AS (
                    SELECT
                        ac.user_id,
                        COUNT(*) AS done_count
                    FROM attendance_checks ac
                    JOIN duty_slots s ON s.id = ac.slot_id
                    WHERE (%s::date IS NULL OR s.slot_date >= %s::date)
                      AND (%s::date IS NULL OR s.slot_date <= %s::date)
                    GROUP BY ac.user_id
                )
                SELECT
                    u.id,
                    u.first_name,
                    u.last_name,
                    COALESCE(pl.planned_count, 0) AS planned_count,
                    COALESCE(dn.done_count, 0) AS done_count
                FROM users u
                LEFT JOIN planned pl ON pl.user_id = u.id
                LEFT JOIN done dn ON dn.user_id = u.id
                WHERE COALESCE(pl.planned_count, 0) > 0
                ORDER BY
                    COALESCE(dn.done_count, 0) DESC,
                    COALESCE(pl.planned_count, 0) DESC,
                    u.last_name,
                    u.first_name
                """,
                (
                    from_date,
                    from_date,
                    to_date,
                    to_date,
                    from_date,
                    from_date,
                    to_date,
                    to_date,
                ),
            )
            rows = cur.fetchall()

    result = []
    for r in rows:
        planned_count = int(r[3])
        done_count = int(r[4])
        completion_rate = (
            round((done_count / planned_count) * 100, 1) if planned_count > 0 else 0.0
        )

        result.append(
            {
                "user_id": str(r[0]),
                "first_name": r[1],
                "last_name": r[2],
                "planned_count": planned_count,
                "done_count": done_count,
                "completion_rate": completion_rate,
            }
        )

    return result


@app.get("/admin/stats/planned-services")
def admin_planned_services_stats(
    from_date: str | None = None,
    to_date: str | None = None,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    u.id,
                    u.first_name,
                    u.last_name,
                    u.email,
                    s.slot_date,
                    COALESCE(i.weekday, to_char(s.slot_date, 'TMDay')) AS weekday,
                    s.slot_code,
                    s.start_time,
                    s.end_time,
                    COALESCE(s.open_end, false) AS open_end,
                    COALESCE(sa.assignment_type, 'active') AS assignment_type
                FROM slot_assignments sa
                JOIN users u
                  ON u.id = sa.user_id
                JOIN duty_slots s
                  ON s.id = sa.slot_id
                LEFT JOIN slot_template_items i
                  ON i.id = s.template_item_id
                WHERE (%s::date IS NULL OR s.slot_date >= %s::date)
                  AND (%s::date IS NULL OR s.slot_date <= %s::date)
                ORDER BY
                    COALESCE(u.last_name, '') ASC,
                    COALESCE(u.first_name, '') ASC,
                    s.slot_date ASC,
                    s.start_time ASC,
                    s.slot_code ASC,
                    sa.assignment_type ASC
                """,
                (from_date, from_date, to_date, to_date),
            )
            rows = cur.fetchall()

    result_by_user: dict[str, dict] = {}
    for row in rows:
        user_id = str(row[0])
        entry = result_by_user.setdefault(
            user_id,
            {
                "user_id": user_id,
                "first_name": row[1],
                "last_name": row[2],
                "email": row[3],
                "active_count": 0,
                "ruf_count": 0,
                "total_count": 0,
                "services": [],
                "_distinct_active_slots": set(),
                "_distinct_all_slots": set(),
            },
        )

        slot_date = row[4].isoformat() if row[4] else None
        slot_key = f"{slot_date}:{row[6]}"
        assignment_type = "ruf" if row[10] == "ruf" else "active"

        if assignment_type == "active":
            entry["active_count"] += 1
            entry["_distinct_active_slots"].add(slot_key)
        else:
            entry["ruf_count"] += 1

        entry["_distinct_all_slots"].add(f"{slot_key}:{assignment_type}")
        entry["services"].append(
            {
                "slot_date": slot_date,
                "weekday": (row[5] or "").strip(),
                "slot_code": row[6],
                "start_time": str(row[7]) if row[7] else None,
                "end_time": str(row[8]) if row[8] else None,
                "open_end": bool(row[9]),
                "assignment_type": assignment_type,
            }
        )

    result: list[dict] = []
    for entry in result_by_user.values():
        entry["total_count"] = len(entry["_distinct_active_slots"])
        del entry["_distinct_active_slots"]
        del entry["_distinct_all_slots"]
        result.append(entry)

    return result


@app.get("/me/slots")
def my_slots(
    user_id: UUID = Query(...),
    from_date: date = Query(..., alias="from"),
    to_date: date = Query(..., alias="to"),
    authorization: str | None = Header(default=None),
):
    """
    Liefert Slots, in denen user_id direkt eingeteilt ist.
    """
    require_self_or_admin(user_id, authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    s.id,
                    s.slot_date,
                    s.slot_code,
                    s.weekday,
                    s.start_time,
                    s.end_time,
                    s.open_end,
                    NULL::text AS base_group,
                    sa.assignment_type
                FROM duty_slots s
                JOIN slot_assignments sa
                  ON sa.slot_id = s.id
                WHERE s.slot_date BETWEEN %s AND %s
                  AND sa.user_id = %s
                ORDER BY s.slot_date, s.slot_code;
                """,
                (from_date, to_date, user_id),
            )
            rows = cur.fetchall()

    return [
        {
            "id": str(r[0]),
            "date": str(r[1]),
            "slot_code": r[2],
            "weekday": r[3],
            "start_time": str(r[4]),
            "end_time": (str(r[5]) if r[5] else None),
            "open_end": r[6],
            "base_group": r[7],
            "assignment_type": _normalise_assignment_type(r[8]),
        }
        for r in rows
    ]

@app.get("/me/upcoming-slots")
def get_my_upcoming_slots(
    user_id: UUID = Query(...),
    authorization: str | None = Header(default=None),
):
    require_self_or_admin(user_id, authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    s.id,
                    s.slot_date,
                    s.start_time,
                    s.end_time,
                    s.slot_code,
                    s.weekday,
                    sa.assignment_type
                FROM slot_assignments sa
                JOIN duty_slots s ON s.id = sa.slot_id
                WHERE sa.user_id = %s
                  AND (
                    (s.slot_date::timestamp + s.start_time)
                    >= (now() AT TIME ZONE 'Europe/Berlin')
                  )
                ORDER BY s.slot_date, s.start_time
                LIMIT 20
                """,
                (str(user_id),),
            )

            rows = cur.fetchall()

    result = []
    for r in rows:
        result.append(
            {
                "slot_id": str(r[0]),
                "date": str(r[1]),
                "start_time": str(r[2]),
                "end_time": str(r[3]) if r[3] else None,
                "slot_code": r[4],
                "weekday": r[5],
                "assignment_type": _normalise_assignment_type(r[6]),
            }
        )

    return result

@app.get("/pgf/current-session")
def get_current_session(authorization: str | None = Header(default=None)):
    actor = get_current_user_from_firebase(authorization)
    ensure_direct_slot_assignment_schema()
    ensure_temporary_pgf_grants_table()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            # 1. laufenden Slot finden
            cur.execute(
                """
                SELECT id, slot_date, start_time, end_time, slot_code
                FROM duty_slots
                WHERE
                  (slot_date::timestamp + start_time)
                    <= (now() AT TIME ZONE 'Europe/Berlin')
                  AND (
                    open_end = true OR
                    (slot_date::timestamp + end_time)
                      >= (now() AT TIME ZONE 'Europe/Berlin')
                  )
                ORDER BY slot_date, start_time
                LIMIT 1
                """
            )

            slot = cur.fetchone()

            # 2. fallback: nächster Slot heute
            if not slot:
                cur.execute(
                    """
                    SELECT id, slot_date, start_time, end_time, slot_code
                    FROM duty_slots
                    WHERE slot_date = (now() AT TIME ZONE 'Europe/Berlin')::date
                      AND (slot_date::timestamp + start_time)
                        >= (now() AT TIME ZONE 'Europe/Berlin')
                    ORDER BY start_time
                    LIMIT 1
                    """
                )
                slot = cur.fetchone()

            if not slot:
                return {"slot": None, "participants": []}

            slot_id = slot[0]
            cur.execute("SELECT role FROM users WHERE id = %s", (actor["id"],))
            actor_row = cur.fetchone()
            if not actor_row:
                raise HTTPException(status_code=403, detail="User not found")
            if not _user_can_manage_slot_attendance(
                cur,
                slot_id=slot_id,
                user_id=actor["id"],
                role=actor_row[0],
            ):
                raise HTTPException(status_code=403, detail="Attendance permission required")

            # 3. Teilnehmer laden
            cur.execute(
                """
                SELECT
                    u.id,
                    u.first_name,
                    u.last_name,
                    sa.assignment_type,
                    CASE WHEN ac.user_id IS NOT NULL THEN true ELSE false END AS is_checked
                FROM slot_assignments sa
                JOIN users u ON u.id = sa.user_id
                LEFT JOIN attendance_checks ac
                  ON ac.slot_id = sa.slot_id
                 AND ac.user_id = sa.user_id
                WHERE sa.slot_id = %s
                ORDER BY
                    CASE sa.assignment_type WHEN 'active' THEN 0 ELSE 1 END,
                    u.last_name,
                    u.first_name
                """,
                (slot_id,),
            )

            participants = cur.fetchall()

    return {
        "slot": {
            "id": str(slot[0]),
            "date": str(slot[1]),
            "start_time": str(slot[2]),
            "end_time": str(slot[3]) if slot[3] else None,
            "slot_code": slot[4],
        },
        "participants": [
            {
                "user_id": str(p[0]),
                "first_name": p[1],
                "last_name": p[2],
                "assignment_type": _normalise_assignment_type(p[3]),
                "is_checked": p[4],
            }
            for p in participants
        ],
    }


@app.get("/admin/slots/{slot_id}/temporary-pgf-grants")
def admin_list_temporary_pgf_grants_for_slot(
    slot_id: UUID,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_temporary_pgf_grants_table()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    (slot_date::timestamp + start_time) AT TIME ZONE 'Europe/Berlin' AS slot_start_at,
                    CASE
                        WHEN open_end = true THEN NULL
                        WHEN end_time IS NOT NULL THEN (slot_date::timestamp + end_time) AT TIME ZONE 'Europe/Berlin'
                        ELSE NULL
                    END AS slot_end_at
                FROM duty_slots
                WHERE id = %s
                """,
                (slot_id,),
            )
            slot_row = cur.fetchone()
            if not slot_row:
                raise HTTPException(status_code=404, detail="Slot not found")
            slot_start_at = slot_row[0]
            slot_end_at = slot_row[1] or (slot_start_at + timedelta(hours=12))

            cur.execute(
                """
                SELECT
                    g.id,
                    g.user_id,
                    u.first_name,
                    u.last_name,
                    u.email,
                    g.valid_from,
                    g.valid_until,
                    g.created_at,
                    g.granted_by,
                    gb.first_name,
                    gb.last_name
                FROM temporary_pgf_grants g
                JOIN users u ON u.id = g.user_id
                LEFT JOIN users gb ON gb.id = g.granted_by
                WHERE g.valid_from < %s
                  AND g.valid_until > %s
                ORDER BY g.valid_from ASC, u.last_name, u.first_name, u.email
                """,
                (slot_end_at, slot_start_at),
            )
            rows = cur.fetchall()

    return [
        {
            "id": str(r[0]),
            "user_id": str(r[1]),
            "first_name": r[2],
            "last_name": r[3],
            "email": r[4],
            "valid_from": r[5].isoformat() if r[5] else None,
            "valid_until": r[6].isoformat() if r[6] else None,
            "created_at": r[7].isoformat() if r[7] else None,
            "granted_by": None
            if r[8] is None
            else {
                "id": str(r[8]),
                "first_name": r[9],
                "last_name": r[10],
            },
        }
        for r in rows
    ]


@app.post("/admin/slots/{slot_id}/temporary-pgf-grants")
def admin_create_temporary_pgf_grant_for_slot(
    slot_id: UUID,
    payload: TemporaryPgfGrantCreate,
    authorization: str | None = Header(default=None),
):
    actor = require_admin(authorization)
    ensure_temporary_pgf_grants_table()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM duty_slots WHERE id = %s", (slot_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Slot not found")

            cur.execute(
                """
                SELECT role, COALESCE(is_active, true)
                FROM users
                WHERE id = %s
                """,
                (payload.user_id,),
            )
            user_row = cur.fetchone()
            if not user_row:
                raise HTTPException(status_code=404, detail="User not found")
            if user_row[0] != "mdb":
                raise HTTPException(status_code=400, detail="Nur MDBs können temporäre PGF-Rechte erhalten")
            if not bool(user_row[1]):
                raise HTTPException(status_code=400, detail="Nutzer ist inaktiv")
            if payload.valid_until <= payload.valid_from:
                raise HTTPException(status_code=400, detail="Ende muss nach Beginn liegen")

            cur.execute(
                """
                INSERT INTO temporary_pgf_grants (user_id, valid_from, valid_until, granted_by)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (payload.user_id, payload.valid_from, payload.valid_until, actor["id"]),
            )
            grant_id = cur.fetchone()[0]
        conn.commit()

    return {"ok": True, "id": str(grant_id)}


@app.delete("/admin/slots/{slot_id}/temporary-pgf-grants/{grant_id}")
def admin_delete_temporary_pgf_grant_for_slot(
    slot_id: UUID,
    grant_id: UUID,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_temporary_pgf_grants_table()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM temporary_pgf_grants
                WHERE id = %s
                RETURNING id
                """,
                (grant_id,),
            )
            deleted = cur.fetchone()
        conn.commit()

    if not deleted:
        raise HTTPException(status_code=404, detail="Grant not found")

    return {"ok": True}


def ensure_exchange_request_tables():
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS exchange_alternative_slots (
                    exchange_id UUID REFERENCES exchanges(id) ON DELETE CASCADE,
                    slot_id UUID REFERENCES duty_slots(id) ON DELETE CASCADE,
                    PRIMARY KEY (exchange_id, slot_id)
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS exchange_matches (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    request_a_id UUID REFERENCES exchanges(id) ON DELETE CASCADE,
                    request_b_id UUID REFERENCES exchanges(id) ON DELETE CASCADE,
                    status TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION',
                    created_by_user_id UUID REFERENCES users(id),
                    a_confirmed_at TIMESTAMPTZ,
                    b_confirmed_at TIMESTAMPTZ,
                    confirmed_at TIMESTAMPTZ,
                    cancelled_at TIMESTAMPTZ,
                    cancel_reason TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    UNIQUE (request_a_id, request_b_id),
                    CHECK (request_a_id <> request_b_id)
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_exchange_alternative_slots_slot_id
                ON exchange_alternative_slots(slot_id)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_exchange_matches_requests
                ON exchange_matches(request_a_id, request_b_id)
                """
            )
        conn.commit()

def _exchange_request_dict(row, alternatives=None, match=None):
    return {
        "exchange_id": str(row[0]),
        "status": row[1],
        "created_at": row[2].isoformat() if row[2] else None,
        "slot": _slot_dict_from_row(row[3:11]),
        "from_user": _user_dict_from_row(row[11:15]),
        "alternatives": alternatives or [],
        "match": match,
    }


def _request_principal_from_auth(authorization: str | None):
    auth_user = get_current_user_from_firebase(authorization)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, email, first_name, last_name, role, assigned_mdb_user_id
                FROM users
                WHERE id = %s
                """,
                (auth_user["id"],),
            )
            row = cur.fetchone()

            if not row:
                raise HTTPException(status_code=403, detail="User not found")

            actor = {
                "id": str(row[0]),
                "email": row[1],
                "first_name": row[2],
                "last_name": row[3],
                "role": row[4],
                "assigned_mdb_user_id": str(row[5]) if row[5] else None,
            }

            if actor["role"] == "staff":
                if not actor["assigned_mdb_user_id"]:
                    raise HTTPException(
                        status_code=403,
                        detail="Mitarbeiter ist keinem MdB zugewiesen",
                    )
                principal_id = actor["assigned_mdb_user_id"]
            else:
                principal_id = actor["id"]

            cur.execute(
                """
                SELECT u.id, u.first_name, u.last_name, NULL::text
                FROM users u
                WHERE u.id = %s
                """,
                (principal_id,),
            )
            principal_row = cur.fetchone()

            if not principal_row:
                raise HTTPException(status_code=404, detail="MdB not found")

    return actor, _user_dict_from_row(principal_row)


def _validate_exchange_request_slots(cur, principal_id: str, offered_slot_id: UUID, alternative_slot_ids: list[UUID]):
    if not alternative_slot_ids:
        raise HTTPException(status_code=400, detail="Mindestens eine Alternative auswählen")

    if str(offered_slot_id) in {str(s) for s in alternative_slot_ids}:
        raise HTTPException(status_code=400, detail="Angebotener Slot darf keine Alternative sein")

    cur.execute(
        """
        SELECT EXISTS (
          SELECT 1 FROM slot_assignments
          WHERE slot_id = %s AND user_id = %s
        )
        """,
        (offered_slot_id, principal_id),
    )
    if not cur.fetchone()[0]:
        raise HTTPException(status_code=400, detail="Der angebotene Slot ist kein eigener Dienst")

    cur.execute(
        """
        SELECT slot_id
        FROM slot_assignments
        WHERE user_id = %s AND slot_id = ANY(%s::uuid[])
        """,
        (principal_id, alternative_slot_ids),
    )
    already_assigned = [str(r[0]) for r in cur.fetchall()]
    if already_assigned:
        raise HTTPException(
            status_code=400,
            detail="Alternativen dürfen keine bereits zugewiesenen Dienste sein",
        )


def _load_exchange_requests(cur, principal_id: str):
    cur.execute(
        """
        SELECT
          e.id, e.status::text, e.created_at,
          s.id, s.slot_date, s.slot_code, s.weekday, s.start_time, s.end_time,
          s.open_end, NULL::text,
          fu.id, fu.first_name, fu.last_name, NULL::text
        FROM exchanges e
        JOIN duty_slots s ON s.id = e.slot_id
        JOIN users fu ON fu.id = e.from_user_id
        WHERE e.from_user_id = %s
          AND EXISTS (
            SELECT 1
            FROM exchange_alternative_slots eas
            WHERE eas.exchange_id = e.id
          )
        ORDER BY s.slot_date, s.start_time, e.created_at DESC
        """,
        (principal_id,),
    )
    rows = cur.fetchall()

    if not rows:
        return []

    exchange_ids = [r[0] for r in rows]
    cur.execute(
        """
        SELECT
          eas.exchange_id,
          s.id, s.slot_date, s.slot_code, s.weekday, s.start_time, s.end_time,
          s.open_end, NULL::text
        FROM exchange_alternative_slots eas
        JOIN duty_slots s ON s.id = eas.slot_id
        WHERE eas.exchange_id = ANY(%s::uuid[])
        ORDER BY s.slot_date, s.start_time
        """,
        (exchange_ids,),
    )
    alt_by_exchange = {}
    for r in cur.fetchall():
        alt_by_exchange.setdefault(str(r[0]), []).append(_slot_dict_from_row(r[1:9]))

    cur.execute(
        """
        SELECT id, request_a_id, request_b_id, status, a_confirmed_at, b_confirmed_at, confirmed_at
        FROM exchange_matches
        WHERE request_a_id = ANY(%s::uuid[]) OR request_b_id = ANY(%s::uuid[])
        ORDER BY created_at DESC
        """,
        (exchange_ids, exchange_ids),
    )
    match_by_exchange = {}
    for r in cur.fetchall():
        match = {
            "id": str(r[0]),
            "request_a_id": str(r[1]),
            "request_b_id": str(r[2]),
            "status": r[3],
            "a_confirmed_at": r[4].isoformat() if r[4] else None,
            "b_confirmed_at": r[5].isoformat() if r[5] else None,
            "confirmed_at": r[6].isoformat() if r[6] else None,
        }
        match_by_exchange[str(r[1])] = match
        match_by_exchange[str(r[2])] = match

    return [
        _exchange_request_dict(
            r,
            alternatives=alt_by_exchange.get(str(r[0]), []),
            match=match_by_exchange.get(str(r[0])),
        )
        for r in rows
    ]


def _find_exchange_matches(cur, principal_id: str, offered_slot_id: UUID, alternative_slot_ids: list[UUID], exclude_exchange_id: UUID | None = None):
    cur.execute(
        """
        SELECT
          e.id, e.status::text, e.created_at,
          s.id, s.slot_date, s.slot_code, s.weekday, s.start_time, s.end_time,
          s.open_end, NULL::text,
          fu.id, fu.first_name, fu.last_name, NULL::text
        FROM exchanges e
        JOIN exchange_alternative_slots other_alt
          ON other_alt.exchange_id = e.id
         AND other_alt.slot_id = %s
        JOIN duty_slots s ON s.id = e.slot_id
        JOIN users fu ON fu.id = e.from_user_id
        WHERE e.status::text = 'OPEN'
          AND e.from_user_id <> %s
          AND e.slot_id = ANY(%s::uuid[])
          AND (%s::uuid IS NULL OR e.id <> %s::uuid)
        ORDER BY s.slot_date, s.start_time, e.created_at DESC
        """,
        (offered_slot_id, principal_id, alternative_slot_ids, exclude_exchange_id, exclude_exchange_id),
    )
    rows = cur.fetchall()
    return [_exchange_request_dict(r) for r in rows]


# -----------------------------
# Exchanges: Market + Me
# -----------------------------
@app.get("/exchange-requests/context")
def exchange_request_context(authorization: str | None = Header(default=None)):
    actor, principal = _request_principal_from_auth(authorization)
    ensure_exchange_request_tables()

    today = date.today()
    to_date = today + timedelta(days=120)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id, s.slot_date, s.slot_code, s.weekday, s.start_time, s.end_time,
                       s.open_end, NULL::text
                FROM duty_slots s
                WHERE s.slot_date BETWEEN %s AND %s
                  AND EXISTS (
                    SELECT 1 FROM slot_assignments sa
                    WHERE sa.slot_id = s.id AND sa.user_id = %s
                  )
                ORDER BY s.slot_date, s.start_time
                """,
                (today, to_date, principal["id"]),
            )
            my_slots = [_slot_dict_from_row(r) for r in cur.fetchall()]

            cur.execute(
                """
                SELECT s.id, s.slot_date, s.slot_code, s.weekday, s.start_time, s.end_time,
                       s.open_end, NULL::text
                FROM duty_slots s
                WHERE s.slot_date BETWEEN %s AND %s
                  AND NOT EXISTS (
                    SELECT 1 FROM slot_assignments sa
                    WHERE sa.slot_id = s.id AND sa.user_id = %s
                  )
                ORDER BY s.slot_date, s.start_time
                """,
                (today, to_date, principal["id"]),
            )
            available_slots = [_slot_dict_from_row(r) for r in cur.fetchall()]
            requests = _load_exchange_requests(cur, principal["id"])

    return {
        "actor": actor,
        "principal": principal,
        "my_slots": my_slots,
        "available_slots": available_slots,
        "requests": requests,
    }


@app.post("/exchange-requests/search")
def search_exchange_requests(
    payload: ExchangeRequestSearch,
    authorization: str | None = Header(default=None),
):
    _, principal = _request_principal_from_auth(authorization)
    alternative_slot_ids = list(dict.fromkeys(payload.alternative_slot_ids))

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            _validate_exchange_request_slots(
                cur,
                principal["id"],
                payload.offered_slot_id,
                alternative_slot_ids,
            )
            matches = _find_exchange_matches(
                cur,
                principal["id"],
                payload.offered_slot_id,
                alternative_slot_ids,
            )

    return {"matches": matches}


@app.post("/exchange-requests")
def create_exchange_request(
    payload: ExchangeRequestCreate,
    authorization: str | None = Header(default=None),
):
    actor, principal = _request_principal_from_auth(authorization)
    ensure_exchange_request_tables()
    alternative_slot_ids = list(dict.fromkeys(payload.alternative_slot_ids))

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            _validate_exchange_request_slots(
                cur,
                principal["id"],
                payload.offered_slot_id,
                alternative_slot_ids,
            )

            cur.execute(
                """
                INSERT INTO exchanges (slot_id, mode, from_user_id, created_by_user_id, status)
                VALUES (%s, 'SWAP'::exchange_mode, %s, %s, 'OPEN'::exchange_status)
                RETURNING id, status::text
                """,
                (payload.offered_slot_id, principal["id"], actor["id"]),
            )
            exchange_id, status = cur.fetchone()

            for slot_id in alternative_slot_ids:
                cur.execute(
                    """
                    INSERT INTO exchange_alternative_slots (exchange_id, slot_id)
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (exchange_id, slot_id),
                )

            matches = _find_exchange_matches(
                cur,
                principal["id"],
                payload.offered_slot_id,
                alternative_slot_ids,
                exclude_exchange_id=exchange_id,
            )
        conn.commit()

    return {
        "exchange_id": str(exchange_id),
        "status": status,
        "matches": matches,
    }


@app.get("/exchange-requests/overview")
def exchange_requests_overview(authorization: str | None = Header(default=None)):
    actor, principal = _request_principal_from_auth(authorization)
    ensure_exchange_request_tables()
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            requests = _load_exchange_requests(cur, principal["id"])

            cur.execute(
                """
                SELECT
                  m.id, m.status, m.a_confirmed_at, m.b_confirmed_at, m.confirmed_at,
                  a.id, a.status::text, a.created_at,
                  aslot.id, aslot.slot_date, aslot.slot_code, aslot.weekday, aslot.start_time, aslot.end_time,
                  aslot.open_end, NULL::text,
                  au.id, au.first_name, au.last_name, NULL::text,
                  b.id, b.status::text, b.created_at,
                  bslot.id, bslot.slot_date, bslot.slot_code, bslot.weekday, bslot.start_time, bslot.end_time,
                  bslot.open_end, NULL::text,
                  bu.id, bu.first_name, bu.last_name, NULL::text
                FROM exchange_matches m
                JOIN exchanges a ON a.id = m.request_a_id
                JOIN exchanges b ON b.id = m.request_b_id
                JOIN duty_slots aslot ON aslot.id = a.slot_id
                JOIN users au ON au.id = a.from_user_id
                JOIN duty_slots bslot ON bslot.id = b.slot_id
                JOIN users bu ON bu.id = b.from_user_id
                WHERE a.from_user_id = %s OR b.from_user_id = %s
                ORDER BY m.created_at DESC
                """,
                (principal["id"], principal["id"]),
            )
            match_rows = cur.fetchall()

    matches = []
    for r in match_rows:
        matches.append(
            {
                "id": str(r[0]),
                "status": r[1],
                "a_confirmed_at": r[2].isoformat() if r[2] else None,
                "b_confirmed_at": r[3].isoformat() if r[3] else None,
                "confirmed_at": r[4].isoformat() if r[4] else None,
                "request_a": _exchange_request_dict(r[5:20]),
                "request_b": _exchange_request_dict(r[20:35]),
            }
        )

    return {
        "actor": actor,
        "principal": principal,
        "requests": requests,
        "matches": matches,
    }


@app.post("/exchange-requests/{exchange_id}/match")
def create_exchange_match(
    exchange_id: UUID,
    payload: ExchangeMatchCreate,
    authorization: str | None = Header(default=None),
):
    actor, principal = _request_principal_from_auth(authorization)
    ensure_exchange_request_tables()
    ensure_direct_slot_assignment_schema()

    request_a_id, request_b_id = sorted([exchange_id, payload.other_exchange_id], key=str)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT e.id, e.from_user_id, e.slot_id, e.status::text
                FROM exchanges e
                WHERE e.id IN (%s, %s)
                """,
                (exchange_id, payload.other_exchange_id),
            )
            exchange_rows = cur.fetchall()
            if len(exchange_rows) != 2:
                raise HTTPException(status_code=404, detail="Tauschgesuch nicht gefunden")

            by_id = {str(r[0]): r for r in exchange_rows}
            own = by_id.get(str(exchange_id))
            other = by_id.get(str(payload.other_exchange_id))

            if str(own[1]) != principal["id"]:
                raise HTTPException(status_code=403, detail="Nur eigene Gesuche können verknüpft werden")
            if own[3] != "OPEN" or other[3] != "OPEN":
                raise HTTPException(status_code=400, detail="Gesuch ist nicht mehr offen")

            cur.execute(
                """
                SELECT EXISTS (
                    SELECT 1 FROM exchange_alternative_slots
                    WHERE exchange_id = %s AND slot_id = %s
                )
                """,
                (exchange_id, other[2]),
            )
            own_accepts_other = cur.fetchone()[0]

            cur.execute(
                """
                SELECT EXISTS (
                    SELECT 1 FROM exchange_alternative_slots
                    WHERE exchange_id = %s AND slot_id = %s
                )
                """,
                (payload.other_exchange_id, own[2]),
            )
            other_accepts_own = cur.fetchone()[0]

            if not own_accepts_other or not other_accepts_own:
                raise HTTPException(status_code=400, detail="Diese Gesuche passen nicht zusammen")

            cur.execute(
                """
                INSERT INTO exchange_matches (
                    request_a_id, request_b_id, created_by_user_id,
                    a_confirmed_at, b_confirmed_at
                )
                VALUES (
                    %s, %s, %s,
                    CASE WHEN %s = %s THEN now() ELSE NULL END,
                    CASE WHEN %s = %s THEN now() ELSE NULL END
                )
                ON CONFLICT (request_a_id, request_b_id)
                DO UPDATE SET status = exchange_matches.status
                RETURNING id, status
                """,
                (
                    request_a_id,
                    request_b_id,
                    actor["id"],
                    exchange_id,
                    request_a_id,
                    exchange_id,
                    request_b_id,
                ),
            )
            match_id, status = cur.fetchone()

            cur.execute(
                """
                UPDATE exchanges
                SET status = 'PENDING_CONFIRMATION'::exchange_status
                WHERE id IN (%s, %s)
                """,
                (exchange_id, payload.other_exchange_id),
            )
        conn.commit()

    return {"match_id": str(match_id), "status": status}


@app.post("/exchange-matches/{match_id}/confirm")
def confirm_exchange_match(
    match_id: UUID,
    payload: ExchangeMatchConfirm,
    authorization: str | None = Header(default=None),
):
    _, principal = _request_principal_from_auth(authorization)
    ensure_exchange_request_tables()
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT m.request_a_id, m.request_b_id, m.status,
                       a.from_user_id, a.slot_id,
                       b.from_user_id, b.slot_id
                FROM exchange_matches m
                JOIN exchanges a ON a.id = m.request_a_id
                JOIN exchanges b ON b.id = m.request_b_id
                WHERE m.id = %s
                """,
                (match_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Match nicht gefunden")

            request_a_id, request_b_id, status, a_user, a_slot, b_user, b_slot = row
            if status != "PENDING_CONFIRMATION":
                raise HTTPException(status_code=400, detail=f"Match ist {status}")

            if str(a_user) == principal["id"]:
                cur.execute(
                    "UPDATE exchange_matches SET a_confirmed_at = COALESCE(a_confirmed_at, now()) WHERE id = %s",
                    (match_id,),
                )
            elif str(b_user) == principal["id"]:
                cur.execute(
                    "UPDATE exchange_matches SET b_confirmed_at = COALESCE(b_confirmed_at, now()) WHERE id = %s",
                    (match_id,),
                )
            else:
                raise HTTPException(status_code=403, detail="Nicht beteiligt")

            cur.execute(
                """
                SELECT a_confirmed_at, b_confirmed_at
                FROM exchange_matches
                WHERE id = %s
                """,
                (match_id,),
            )
            a_confirmed_at, b_confirmed_at = cur.fetchone()

            if a_confirmed_at and b_confirmed_at:
                _swap_slot_assignments(
                    cur,
                    slot_a_id=a_slot,
                    slot_a_from_user_id=a_user,
                    slot_a_to_user_id=b_user,
                    slot_b_id=b_slot,
                    slot_b_from_user_id=b_user,
                    slot_b_to_user_id=a_user,
                )

                cur.execute(
                    """
                    UPDATE exchange_matches
                    SET status = 'CONFIRMED', confirmed_at = now()
                    WHERE id = %s
                    """,
                    (match_id,),
                )
                cur.execute(
                    """
                    UPDATE exchanges
                    SET status = 'CONFIRMED'::exchange_status, confirmed_at = now()
                    WHERE id IN (%s, %s)
                    """,
                    (request_a_id, request_b_id),
                )

        conn.commit()

    return {"match_id": str(match_id), "ok": True}


@app.post("/exchange-matches/{match_id}/cancel")
def cancel_exchange_match(
    match_id: UUID,
    payload: ExchangeMatchCancel,
    authorization: str | None = Header(default=None),
):
    _, principal = _request_principal_from_auth(authorization)
    ensure_exchange_request_tables()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT m.request_a_id, m.request_b_id, m.status, a.from_user_id, b.from_user_id
                FROM exchange_matches m
                JOIN exchanges a ON a.id = m.request_a_id
                JOIN exchanges b ON b.id = m.request_b_id
                WHERE m.id = %s
                """,
                (match_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Match nicht gefunden")

            request_a_id, request_b_id, status, a_user, b_user = row
            if principal["id"] not in (str(a_user), str(b_user)):
                raise HTTPException(status_code=403, detail="Nicht beteiligt")
            if status == "CONFIRMED":
                raise HTTPException(status_code=400, detail="Bestätigter Tausch kann nicht abgebrochen werden")

            cur.execute(
                """
                UPDATE exchange_matches
                SET status = 'CANCELLED', cancelled_at = now(), cancel_reason = %s
                WHERE id = %s
                """,
                (payload.reason, match_id),
            )
            cur.execute(
                """
                UPDATE exchanges
                SET status = 'OPEN'::exchange_status
                WHERE id IN (%s, %s) AND status = 'PENDING_CONFIRMATION'::exchange_status
                """,
                (request_a_id, request_b_id),
            )
        conn.commit()

    return {"match_id": str(match_id), "status": "CANCELLED"}


@app.get("/market/exchanges")
def market_exchanges(user_id: UUID = Query(...), authorization: str | None = Header(default=None)):
    """
    Offene Tauschangebote (OPEN, to_user_id IS NULL), die NICHT vom user_id stammen.
    """
    require_self_or_admin(user_id, authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  e.id,
                  e.status::text,
                  e.mode::text,

                  s.id AS slot_id,
                  s.slot_date,
                  s.slot_code,
                  s.weekday,
                  s.start_time,
                  s.end_time,
                  s.open_end,
                  NULL::text AS base_group,

                  fu.id AS from_id,
                  fu.first_name AS from_first,
                  fu.last_name AS from_last,
                  NULL::text AS from_group

                FROM exchanges e
                JOIN duty_slots s ON s.id = e.slot_id

                JOIN users fu ON fu.id = e.from_user_id

                WHERE e.status::text = 'OPEN'
                  AND e.to_user_id IS NULL
                  AND e.from_user_id <> %s

                ORDER BY s.slot_date, s.slot_code, e.id DESC;
                """,
                (user_id,),
            )
            rows = cur.fetchall()

    return [
        {
            "exchange_id": str(r[0]),
            "status": r[1],
            "mode": r[2],
            "slot": {
                "id": str(r[3]),
                "date": str(r[4]),
                "slot_code": r[5],
                "weekday": r[6],
                "start_time": str(r[7]),
                "end_time": (str(r[8]) if r[8] else None),
                "open_end": r[9],
                "base_group": r[10],
            },
            "from_user": {
                "id": str(r[11]),
                "first_name": r[12],
                "last_name": r[13],
                "group": r[14],
            },
            "to_user": None,
            "confirmations": {
                "from_confirmed_at": None,
                "to_confirmed_at": None,
            },
        }
        for r in rows
    ]


@app.get("/me/exchanges")
def my_exchanges(
    user_id: UUID = Query(...),
    status: Optional[str] = Query(None),
    authorization: str | None = Header(default=None),
):
    """
    Liefert alle Tausche, bei denen user_id beteiligt ist (from oder to).
    Optional: Filter per status.
    """
    require_self_or_admin(user_id, authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  e.id,
                  e.status::text,
                  e.mode::text,

                  s.id AS slot_id,
                  s.slot_date,
                  s.slot_code,
                  s.weekday,
                  s.start_time,
                  s.end_time,
                  s.open_end,
                  NULL::text AS base_group,

                  fu.id AS from_id,
                  fu.first_name AS from_first,
                  fu.last_name AS from_last,
                  NULL::text AS from_group,

                  tu.id AS to_id,
                  tu.first_name AS to_first,
                  tu.last_name AS to_last,
                  NULL::text AS to_group,

                  e.from_confirmed_at,
                  e.to_confirmed_at

                FROM exchanges e
                JOIN duty_slots s ON s.id = e.slot_id

                JOIN users fu ON fu.id = e.from_user_id

                LEFT JOIN users tu ON tu.id = e.to_user_id

                WHERE (e.from_user_id = %s OR e.to_user_id = %s)
                  AND (COALESCE(%s::text, '') = '' OR e.status::text = %s::text)

                ORDER BY s.slot_date, s.slot_code, e.id DESC;
                """,
                (user_id, user_id, status, status),
            )
            rows = cur.fetchall()

    out = []
    for r in rows:
        out.append(
            {
                "exchange_id": str(r[0]),
                "status": r[1],
                "mode": r[2],
                "slot": {
                    "id": str(r[3]),
                    "date": str(r[4]),
                    "slot_code": r[5],
                    "weekday": r[6],
                    "start_time": str(r[7]),
                    "end_time": (str(r[8]) if r[8] else None),
                    "open_end": r[9],
                    "base_group": r[10],
                },
                "from_user": {
                    "id": str(r[11]),
                    "first_name": r[12],
                    "last_name": r[13],
                    "group": r[14],
                },
                "to_user": (
                    None
                    if r[15] is None
                    else {
                        "id": str(r[15]),
                        "first_name": r[16],
                        "last_name": r[17],
                        "group": r[18],
                    }
                ),
                "confirmations": {
                    "from_confirmed_at": (str(r[19]) if r[19] else None),
                    "to_confirmed_at": (str(r[20]) if r[20] else None),
                },
            }
        )
    return out


@app.get("/me/exchanges/pending")
def my_pending_exchanges(
    user_id: UUID = Query(...),
    authorization: str | None = Header(default=None),
):
    """
    Dev-Endpunkt: Tausche, bei denen der Nutzer bestätigen muss.
    (Später ersetzen wir user_id durch Auth/JWT.)

    Hinweis: In eurem neuen UI bestätigt praktisch nur noch der Anbieter final,
    weil accept bereits to_confirmed_at setzt.
    """
    require_self_or_admin(user_id, authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT e.id,
                       e.slot_id,
                       s.slot_date,
                       s.slot_code,
                       e.mode::text,
                       e.status::text,
                       e.from_user_id,
                       e.to_user_id,
                       e.from_confirmed_at,
                       e.to_confirmed_at
                FROM exchanges e
                JOIN duty_slots s ON s.id = e.slot_id
                WHERE e.status IN ('OPEN'::exchange_status,'PENDING_CONFIRMATION'::exchange_status)
                  AND (
                    (e.from_user_id = %s AND e.from_confirmed_at IS NULL)
                    OR
                    (e.to_user_id = %s AND e.to_confirmed_at IS NULL)
                  )
                ORDER BY s.slot_date, s.slot_code;
                """,
                (user_id, user_id),
            )
            rows = cur.fetchall()

    return [
        {
            "exchange_id": str(r[0]),
            "slot": {"id": str(r[1]), "date": str(r[2]), "slot_code": r[3]},
            "mode": r[4],
            "status": r[5],
            "from_user_id": str(r[6]) if r[6] else None,
            "to_user_id": str(r[7]) if r[7] else None,
            "needs_confirmation_as": (
                "from_user" if (r[6] == user_id and r[8] is None) else "to_user"
            ),
        }
        for r in rows
    ]


# -----------------------------
# Exchanges: CRUD / Actions
# -----------------------------
@app.post("/exchanges")
def create_exchange(
    payload: ExchangeCreate,
    authorization: str | None = Header(default=None),
):
    """
    Erstellt ein Tauschangebot.
    Optional kann to_user_id schon gesetzt sein (Direkttausch).
    """
    actor = get_current_user_from_firebase(authorization)
    ensure_direct_slot_assignment_schema()
    if actor["role"] not in ("admin", "pgf") and actor["id"] != str(payload.from_user_id):
        raise HTTPException(status_code=403, detail="Forbidden")

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT EXISTS (
                    SELECT 1 FROM slot_assignments
                    WHERE slot_id = %s AND user_id = %s
                )
                """,
                (payload.slot_id, payload.from_user_id),
            )
            if not cur.fetchone()[0]:
                raise HTTPException(status_code=400, detail="Anbietende Person ist diesem Slot nicht zugeordnet")

            cur.execute(
                """
                INSERT INTO exchanges (slot_id, mode, from_user_id, to_user_id, created_by_user_id, status)
                VALUES (%s, %s, %s, %s, %s,
                        CASE
                          WHEN %s::uuid IS NULL THEN 'OPEN'::exchange_status
                          ELSE 'PENDING_CONFIRMATION'::exchange_status
                        END)
                RETURNING id, status::text;
                """,
                (
                    payload.slot_id,
                    payload.mode,
                    payload.from_user_id,
                    payload.to_user_id,
                    payload.from_user_id,
                    payload.to_user_id,
                ),
            )
            ex_id, status = cur.fetchone()
        conn.commit()

    return {"exchange_id": str(ex_id), "status": status}


@app.post("/exchanges/{exchange_id}/accept")
def accept_exchange(
    exchange_id: UUID,
    payload: ExchangeAccept,
    authorization: str | None = Header(default=None),
):
    """
    Nimmt ein Angebot an:
    - setzt to_user_id
    - setzt to_confirmed_at = NOW() (Übernehmer ist direkt bestätigt)
    - status -> PENDING_CONFIRMATION (oder CONFIRMED wenn Anbieter schon bestätigt)
    """
    actor = get_current_user_from_firebase(authorization)
    ensure_direct_slot_assignment_schema()
    if actor["role"] not in ("admin", "pgf") and actor["id"] != str(payload.to_user_id):
        raise HTTPException(status_code=403, detail="Forbidden")

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT slot_id, from_user_id
                FROM exchanges
                WHERE id = %s
                """,
                (exchange_id,),
            )
            exchange_row = cur.fetchone()
            if not exchange_row:
                raise HTTPException(status_code=404, detail="not found or not open")

            cur.execute(
                """
                SELECT EXISTS (
                    SELECT 1 FROM slot_assignments
                    WHERE slot_id = %s AND user_id = %s
                )
                """,
                (exchange_row[0], payload.to_user_id),
            )
            if cur.fetchone()[0]:
                raise HTTPException(status_code=400, detail="Übernehmende Person ist diesem Slot bereits zugeordnet")

            cur.execute(
                """
                UPDATE exchanges
                SET
                  to_user_id = %s,
                  to_confirmed_at = NOW(),
                  status = CASE
                      WHEN from_confirmed_at IS NOT NULL THEN 'CONFIRMED'::exchange_status
                      ELSE 'PENDING_CONFIRMATION'::exchange_status
                  END
                WHERE id = %s
                  AND status = 'OPEN'::exchange_status
                  AND to_user_id IS NULL
                RETURNING id, status::text;
                """,
                (payload.to_user_id, exchange_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="not found or not open")
        conn.commit()

    return {"exchange_id": str(row[0]), "status": row[1]}


@app.post("/exchanges/{exchange_id}/confirm")
def confirm_exchange(
    exchange_id: UUID,
    payload: ExchangeConfirm,
    authorization: str | None = Header(default=None),
):
    """
    Bestätigt einen Tausch als from_user oder to_user.
    Sobald beide bestätigt haben, setzt der DB-Trigger status=CONFIRMED.
    (In eurem neuen Workflow bestätigt praktisch nur noch from_user final.)
    """
    actor = get_current_user_from_firebase(authorization)
    ensure_direct_slot_assignment_schema()
    if actor["role"] not in ("admin", "pgf") and actor["id"] != str(payload.actor_user_id):
        raise HTTPException(status_code=403, detail="Forbidden")

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT from_user_id, to_user_id, status::text FROM exchanges WHERE id = %s;",
                (exchange_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="exchange not found")

            from_user_id, to_user_id, status = row

            if status not in ("OPEN", "PENDING_CONFIRMATION"):
                raise HTTPException(
                    status_code=400, detail=f"cannot confirm in status {status}"
                )

            if to_user_id is None:
                raise HTTPException(
                    status_code=400, detail="exchange has no to_user yet"
                )

            if payload.actor_user_id == from_user_id:
                cur.execute(
                    """
                    UPDATE exchanges
                    SET from_confirmed_at = COALESCE(from_confirmed_at, now())
                    WHERE id = %s;
                    """,
                    (exchange_id,),
                )
            elif payload.actor_user_id == to_user_id:
                cur.execute(
                    """
                    UPDATE exchanges
                    SET to_confirmed_at = COALESCE(to_confirmed_at, now())
                    WHERE id = %s;
                    """,
                    (exchange_id,),
                )
            else:
                raise HTTPException(
                    status_code=403, detail="actor is neither from_user nor to_user"
                )

            cur.execute(
                "SELECT status::text, confirmed_at, slot_id, from_user_id, to_user_id, from_confirmed_at, to_confirmed_at FROM exchanges WHERE id = %s;",
                (exchange_id,),
            )
            status2, confirmed_at, slot_id, from_user_id, to_user_id, from_confirmed_at, to_confirmed_at = cur.fetchone()

            if from_confirmed_at and to_confirmed_at and status2 != "CONFIRMED":
                cur.execute(
                    """
                    SELECT assignment_type
                    FROM slot_assignments
                    WHERE slot_id = %s AND user_id = %s
                    """,
                    (slot_id, from_user_id),
                )
                assignment_row = cur.fetchone()
                if not assignment_row:
                    raise HTTPException(status_code=400, detail="Ausgangszuweisung fehlt")

                assignment_type = _normalise_assignment_type(assignment_row[0])
                _delete_slot_assignment(cur, slot_id, from_user_id)
                _upsert_slot_assignment(
                    cur,
                    slot_id,
                    to_user_id,
                    assignment_type,
                    source="exchange",
                )
                cur.execute(
                    """
                    UPDATE exchanges
                    SET status = 'CONFIRMED'::exchange_status,
                        confirmed_at = COALESCE(confirmed_at, now())
                    WHERE id = %s
                    RETURNING status::text, confirmed_at
                    """,
                    (exchange_id,),
                )
                status2, confirmed_at = cur.fetchone()

        conn.commit()

    return {
        "exchange_id": str(exchange_id),
        "status": status2,
        "confirmed_at": (confirmed_at.isoformat() if confirmed_at else None),
    }


@app.post("/exchanges/{exchange_id}/cancel")
def cancel_exchange(
    exchange_id: UUID,
    payload: ExchangeCancel,
    authorization: str | None = Header(default=None),
):
    """
    Abbrechen durch from_user oder to_user, solange nicht confirmed.
    (Beibehaltung deiner Logik mit cancelled_at + cancel_reason)
    """
    actor = get_current_user_from_firebase(authorization)
    if actor["role"] not in ("admin", "pgf") and actor["id"] != str(payload.actor_user_id):
        raise HTTPException(status_code=403, detail="Forbidden")

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT from_user_id, to_user_id, status::text FROM exchanges WHERE id = %s;",
                (exchange_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="exchange not found")

            from_user, to_user, status = row
            if status in ("CONFIRMED", "CANCELLED", "EXPIRED"):
                raise HTTPException(
                    status_code=400, detail=f"cannot cancel in status {status}"
                )

            if payload.actor_user_id not in (from_user, to_user):
                raise HTTPException(status_code=403, detail="not a participant")

            cur.execute(
                """
                UPDATE exchanges
                SET status = 'CANCELLED'::exchange_status,
                    cancelled_at = now(),
                    cancel_reason = %s
                WHERE id = %s
                RETURNING status::text, cancelled_at;
                """,
                (payload.reason, exchange_id),
            )
            status2, cancelled_at = cur.fetchone()

        conn.commit()

    return {
        "exchange_id": str(exchange_id),
        "status": status2,
        "cancelled_at": cancelled_at.isoformat() if cancelled_at else None,
    }


# -----------------------------
# Slot history (optional)
# -----------------------------
@app.get("/slots/{slot_id}/exchanges")
def list_slot_exchanges(slot_id: UUID):
    """
    Tausch-Historie für einen Slot.
    """
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT e.id,
                       e.mode::text,
                       e.status::text,
                       e.created_at,
                       e.from_user_id,
                       fu.first_name, fu.last_name,
                       NULL::text AS from_group,
                       e.to_user_id,
                       tu.first_name, tu.last_name,
                       NULL::text AS to_group,
                       e.from_confirmed_at,
                       e.to_confirmed_at,
                       e.confirmed_at
                FROM exchanges e
                JOIN users fu ON fu.id = e.from_user_id
                LEFT JOIN users tu ON tu.id = e.to_user_id
                WHERE e.slot_id = %s
                ORDER BY e.created_at DESC;
                """,
                (slot_id,),
            )
            rows = cur.fetchall()

    out = []
    for r in rows:
        out.append(
            {
                "exchange_id": str(r[0]),
                "mode": r[1],
                "status": r[2],
                "created_at": (r[3].isoformat() if r[3] else None),
                "from_user": {
                    "id": str(r[4]) if r[4] else None,
                    "first_name": r[5],
                    "last_name": r[6],
                    "group": r[7],
                },
                "to_user": (
                    None
                    if r[8] is None
                    else {
                        "id": str(r[8]),
                        "first_name": r[9],
                        "last_name": r[10],
                        "group": r[11],
                    }
                ),
                "confirmations": {
                    "from_confirmed_at": (r[12].isoformat() if r[12] else None),
                    "to_confirmed_at": (r[13].isoformat() if r[13] else None),
                    "confirmed_at": (r[14].isoformat() if r[14] else None),
                },
            }
        )
    return out

@app.get("/admin/users")
def admin_list_users(
    authorization: str | None = Header(default=None),
    role: str | None = None,
    q: str | None = None,
    is_mdb: bool | None = None,
):
    require_admin(authorization)
    ensure_user_mdb_schema()
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    u.id,
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.role,
                    COALESCE(u.is_mdb, false) AS is_mdb,
                    u.assigned_mdb_user_id,
                    CASE
                        WHEN m.id IS NOT NULL THEN COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')
                        ELSE NULL
                    END AS assigned_mdb_name,
                    COALESCE(u.is_faction_staff, false) AS is_faction_staff,
                    COALESCE(u.is_active, true) AS is_active,
                    COALESCE(u.is_planner_exempt, false) AS is_planner_exempt
                FROM users u
                LEFT JOIN users m
                    ON m.id = u.assigned_mdb_user_id
                WHERE (%s::text IS NULL OR u.role = %s::text)
                  AND (%s::boolean IS NULL OR COALESCE(u.is_mdb, false) = %s::boolean)
                  AND (
                        %s::text IS NULL
                        OR u.email ILIKE %s::text
                        OR u.first_name ILIKE %s::text
                        OR u.last_name ILIKE %s::text
                      )
                ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST, u.email
                """,
                (
                    role, role,
                    is_mdb, is_mdb,
                    q,
                    f"%{q}%" if q else None,
                    f"%{q}%" if q else None,
                    f"%{q}%" if q else None,
                ),
            )
            rows = cur.fetchall()

    return [_admin_user_row_to_dict(r) for r in rows]


@app.get("/admin/users/{user_id}")
def admin_get_user(user_id: UUID, authorization: str | None = Header(default=None)):
    require_admin(authorization)
    ensure_user_mdb_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    u.id,
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.role,
                    COALESCE(u.is_mdb, false) AS is_mdb,
                    u.assigned_mdb_user_id,
                    CASE
                        WHEN m.id IS NOT NULL THEN COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')
                        ELSE NULL
                    END AS assigned_mdb_name,
                    COALESCE(u.is_faction_staff, false) AS is_faction_staff,
                    COALESCE(u.is_active, true) AS is_active,
                    COALESCE(u.is_planner_exempt, false) AS is_planner_exempt
                FROM users u
                LEFT JOIN users m
                    ON m.id = u.assigned_mdb_user_id
                WHERE u.id = %s
                """,
                (user_id,),
            )
            row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    return _admin_user_row_to_dict(row)


@app.post("/admin/users")
def admin_create_user(
    payload: AdminUserCreate,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_user_mdb_schema()
    normalized_email = _normalize_email(payload.email)
    effective_is_mdb = _effective_is_mdb(payload.role, payload.is_mdb)

    if payload.is_faction_staff and payload.assigned_mdb_user_id is not None:
        raise HTTPException(
            status_code=400,
            detail="Fraktionsmitarbeiter darf nicht gleichzeitig einem MDB zugewiesen sein",
        )
    if payload.is_faction_staff and effective_is_mdb:
        raise HTTPException(
            status_code=400,
            detail="Fraktionsmitarbeiter kann nicht gleichzeitig MDB sein",
        )

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM users WHERE lower(email) = lower(%s)",
                (normalized_email,),
            )
            if cur.fetchone():
                raise HTTPException(status_code=400, detail="Email already exists")

    firebase_uid: str | None = None
    firebase_created = False
    if payload.create_firebase_auth:
        firebase_uid, firebase_created = _resolve_or_create_firebase_user(
            email=normalized_email,
            first_name=payload.first_name,
            last_name=payload.last_name,
            is_active=payload.is_active,
            password=payload.firebase_password,
        )

    with psycopg.connect(DB_URL) as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO users (
                        id,
                        email,
                        first_name,
                        last_name,
                        role,
                        is_mdb,
                        group_id,
                        assigned_mdb_user_id,
                        is_faction_staff,
                        is_active,
                        is_planner_exempt,
                        firebase_uid
                    )
                    VALUES (
                        gen_random_uuid(),
                        %s, %s, %s, %s, %s, NULL, %s, %s, %s, %s, %s
                    )
                    RETURNING id
                    """,
                    (
                        normalized_email,
                        payload.first_name,
                        payload.last_name,
                        payload.role,
                        effective_is_mdb,
                        payload.assigned_mdb_user_id,
                        payload.is_faction_staff,
                        payload.is_active,
                        payload.is_planner_exempt,
                        firebase_uid,
                    ),
                )
                new_id = cur.fetchone()[0]
                conn.commit()
        except Exception:
            if firebase_created and firebase_uid:
                try:
                    firebase_auth.delete_user(firebase_uid)
                except Exception:
                    pass
            raise

    return {
        "ok": True,
        "id": str(new_id),
        "firebase_uid": firebase_uid,
        "firebase_created": firebase_created,
    }


def ensure_quick_info_tables():
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS quick_info_topics (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    title TEXT NOT NULL,
                    slug TEXT UNIQUE,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    is_active BOOLEAN NOT NULL DEFAULT true,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS quick_info_bullets (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    topic_id UUID NOT NULL REFERENCES quick_info_topics(id) ON DELETE CASCADE,
                    bullet_text TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute("SELECT COUNT(*) FROM quick_info_topics")
            topic_count = cur.fetchone()[0]

            if topic_count == 0:
                seed_topics = [
                    (
                        "Rentenniveau",
                        "rentenniveau",
                        10,
                        [
                            "Sicherheit im Alter braucht Verlässlichkeit statt kurzfristiger Kürzungen.",
                            "Stabile Renten sind kein Luxus, sondern eine Frage der sozialen Ordnung.",
                            "Wer lebenslang gearbeitet hat, muss von seiner Rente gut leben können.",
                            "Demografischer Wandel braucht Finanzierung, aber nicht auf Kosten der Rentner.",
                            "Private Vorsorge kann ergänzen, ersetzt aber keine starke gesetzliche Rente.",
                        ],
                    ),
                    (
                        "Mindestlohn",
                        "mindestlohn",
                        20,
                        [
                            "Arbeit muss sich spürbar lohnen, sonst verliert der Staat Vertrauen.",
                            "Ein fairer Mindestlohn stärkt Beschäftigte und die Binnenwirtschaft.",
                            "Wer Vollzeit arbeitet, darf nicht arm trotz Arbeit bleiben.",
                            "Lohnuntergrenzen schaffen Fairness im Wettbewerb.",
                            "Der Mindestlohn ist ein Schutzinstrument, kein Ersatz für Tarifbindung.",
                        ],
                    ),
                    (
                        "Wohnen",
                        "wohnen",
                        30,
                        [
                            "Bezahlbares Wohnen ist die soziale Frage in den Städten.",
                            "Mehr Bau braucht schnellere Verfahren und weniger Hürden.",
                            "Mieter brauchen Schutz vor Sprüngen bei den Wohnkosten.",
                            "Wohnen ist Infrastruktur und keine reine Marktnische.",
                            "Neue Wohnungen müssen dort entstehen, wo Menschen leben und arbeiten.",
                        ],
                    ),
                    (
                        "Bürokratieabbau",
                        "buerokratieabbau",
                        40,
                        [
                            "Der Staat muss einfacher werden, ohne Kontrolle zu verlieren.",
                            "Schnellere Verfahren helfen Bürgern, Unternehmen und Verwaltung.",
                            "Digitale Prozesse sparen Zeit und schaffen Vertrauen.",
                            "Gute Gesetze sind verständlich, anwendbar und überprüfbar.",
                            "Weniger Formulare heißt mehr Zeit für die eigentliche Arbeit.",
                        ],
                    ),
                    (
                        "Sondervermögen Infrastruktur",
                        "sondervermoegen-infrastruktur",
                        50,
                        [
                            "Investitionen müssen sichtbar bei Schulen, Schienen, Netzen und Energie ankommen.",
                            "Infrastruktur ist kein Nebenthema, sondern Basis für Wachstum und Alltag.",
                            "Geld allein reicht nicht, wenn Planungs- und Genehmigungswege zu lang bleiben.",
                            "Klimaschutz und Modernisierung gehören zusammen.",
                            "Die Kommunikation sollte immer auf konkrete Verbesserungen vor Ort zielen.",
                        ],
                    ),
                ]

                for title, slug, sort_order, bullets in seed_topics:
                    cur.execute(
                        """
                        INSERT INTO quick_info_topics (title, slug, sort_order, is_active)
                        VALUES (%s, %s, %s, true)
                        RETURNING id
                        """,
                        (title, slug, sort_order),
                    )
                    topic_id = cur.fetchone()[0]

                    for idx, bullet in enumerate(bullets, start=1):
                        cur.execute(
                            """
                            INSERT INTO quick_info_bullets (topic_id, bullet_text, sort_order)
                            VALUES (%s, %s, %s)
                            """,
                            (topic_id, bullet, idx),
                        )

            conn.commit()

@app.patch("/admin/users/{user_id}")
def admin_update_user(
    user_id: UUID,
    payload: AdminUserUpdate,
    authorization: str | None = Header(default=None),
    apply_retroactively: bool = Query(default=False),
):
    require_admin(authorization)
    ensure_user_mdb_schema()

    retroactive_cleanup: dict[str, object] | None = None

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, email, first_name, last_name, firebase_uid, COALESCE(is_active, true), role, COALESCE(is_mdb, false), COALESCE(is_faction_staff, false), COALESCE(is_planner_exempt, false)
                FROM users
                WHERE id = %s
                """,
                (user_id,),
            )
            current = cur.fetchone()
            if not current:
                raise HTTPException(status_code=404, detail="User not found")

            current_email = current[1]
            current_first_name = current[2]
            current_last_name = current[3]
            current_firebase_uid = current[4]
            current_is_active = bool(current[5])
            current_role = current[6]
            current_is_mdb = bool(current[7])
            current_is_faction_staff = bool(current[8])
            current_is_planner_exempt = bool(current[9])
            target_role = payload.role if payload.role is not None else current_role
            target_is_mdb = _effective_is_mdb(target_role, payload.is_mdb if payload.is_mdb is not None else current_is_mdb)
            target_is_faction_staff = (
                payload.is_faction_staff if payload.is_faction_staff is not None else current_is_faction_staff
            )
            target_assigned_mdb_user_id = payload.assigned_mdb_user_id if payload.assigned_mdb_user_id is not None else None
            if payload.assigned_mdb_user_id is None:
                cur.execute("SELECT assigned_mdb_user_id FROM users WHERE id = %s", (user_id,))
                existing_assigned_row = cur.fetchone()
                target_assigned_mdb_user_id = existing_assigned_row[0] if existing_assigned_row else None
            if target_role != "staff":
                target_assigned_mdb_user_id = None

            updates = []
            values = []

            if payload.email is not None:
                normalized_email = _normalize_email(payload.email)
                cur.execute(
                    "SELECT 1 FROM users WHERE lower(email) = lower(%s) AND id <> %s",
                    (normalized_email, user_id),
                )
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="Email already exists")
                updates.append("email = %s")
                values.append(normalized_email)

            if payload.first_name is not None:
                updates.append("first_name = %s")
                values.append(payload.first_name)

            if payload.last_name is not None:
                updates.append("last_name = %s")
                values.append(payload.last_name)

            if payload.role is not None:
                updates.append("role = %s")
                values.append(payload.role)

            if payload.is_mdb is not None or payload.role is not None:
                updates.append("is_mdb = %s")
                values.append(target_is_mdb)

            if payload.assigned_mdb_user_id is not None or payload.role is not None:
                updates.append("assigned_mdb_user_id = %s")
                values.append(target_assigned_mdb_user_id)

            if payload.is_faction_staff is not None:
                updates.append("is_faction_staff = %s")
                values.append(payload.is_faction_staff)

            if payload.is_active is not None:
                updates.append("is_active = %s")
                values.append(payload.is_active)

            if payload.is_planner_exempt is not None and payload.is_planner_exempt != current_is_planner_exempt:
                updates.append("is_planner_exempt = %s")
                values.append(payload.is_planner_exempt)

            if target_is_faction_staff and target_assigned_mdb_user_id is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Fraktionsmitarbeiter darf nicht gleichzeitig einem MDB zugewiesen sein",
                )
            if target_is_faction_staff and target_is_mdb:
                raise HTTPException(
                    status_code=400,
                    detail="Fraktionsmitarbeiter kann nicht gleichzeitig MDB sein",
                )
            if target_role == "staff" and target_assigned_mdb_user_id is None:
                raise HTTPException(status_code=400, detail="Mitarbeiter muss einem MDB zugewiesen werden")

            if current_firebase_uid:
                target_email = (
                    _normalize_email(payload.email)
                    if payload.email is not None
                    else current_email
                )
                target_first_name = (
                    payload.first_name
                    if payload.first_name is not None
                    else current_first_name
                )
                target_last_name = (
                    payload.last_name
                    if payload.last_name is not None
                    else current_last_name
                )
                target_is_active = (
                    bool(payload.is_active)
                    if payload.is_active is not None
                    else current_is_active
                )

                try:
                    firebase_auth.update_user(
                        current_firebase_uid,
                        email=target_email,
                        display_name=_display_name(target_first_name, target_last_name),
                        disabled=not target_is_active,
                    )
                except Exception as exc:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Firebase user could not be updated: {exc}",
                    ) from exc

            if not updates:
                return admin_get_user(user_id, authorization)

            values.append(user_id)

            cur.execute(
                f"""
                UPDATE users
                SET {", ".join(updates)}
                WHERE id = %s
                """,
                values,
            )

            if (
                apply_retroactively
                and payload.is_planner_exempt is True
                and payload.is_planner_exempt != current_is_planner_exempt
            ):
                retroactive_cleanup = _retroactively_remove_user_assignments(cur, user_id=user_id)

            conn.commit()

    response = admin_get_user(user_id, authorization)
    if retroactive_cleanup:
        response["retroactive_cleanup"] = retroactive_cleanup
    return response


@app.delete("/admin/users/{user_id}")
def admin_delete_user(user_id: UUID, authorization: str | None = Header(default=None)):
    require_admin(authorization)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, email, firebase_uid FROM users WHERE id = %s",
                (user_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="User not found")

            if row[2]:
                try:
                    firebase_auth.delete_user(row[2])
                except Exception as exc:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Firebase user could not be deleted: {exc}",
                    ) from exc

            cur.execute(
                "UPDATE users SET assigned_mdb_user_id = NULL WHERE assigned_mdb_user_id = %s",
                (user_id,),
            )
            cur.execute(
                "DELETE FROM user_push_tokens WHERE user_id = %s",
                (user_id,),
            )
            cur.execute(
                "DELETE FROM slot_assignments WHERE user_id = %s",
                (user_id,),
            )
            cur.execute(
                "DELETE FROM pgf_message_reads WHERE user_id = %s",
                (user_id,),
            )
            cur.execute(
                "DELETE FROM pgf_message_hidden WHERE user_id = %s",
                (user_id,),
            )
            cur.execute(
                "DELETE FROM attendance_checks WHERE user_id = %s OR checked_by = %s",
                (user_id, user_id),
            )
            cur.execute(
                "DELETE FROM attendance_reminders_sent WHERE user_id = %s",
                (user_id,),
            )
            cur.execute(
                """
                DELETE FROM exchanges
                WHERE from_user_id = %s
                   OR to_user_id = %s
                   OR created_by_user_id = %s
                """,
                (user_id, user_id, user_id),
            )
            cur.execute(
                "DELETE FROM users WHERE id = %s",
                (user_id,),
            )
            conn.commit()

    return {"ok": True, "deleted_user_id": str(user_id)}


@app.post("/admin/users/{user_id}/password-reset-link")
def admin_create_password_reset_link(
    user_id: UUID,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT email FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    email = _normalize_email(row[0] or "")
    if not email:
        raise HTTPException(status_code=400, detail="User has no email")

    _get_firebase_app()
    try:
        reset_link = firebase_auth.generate_password_reset_link(email)
    except firebase_auth.UserNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="Firebase user not found for this email",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Reset link could not be generated: {exc}",
        ) from exc

    return {
        "ok": True,
        "user_id": str(user_id),
        "email": email,
        "reset_link": reset_link,
    }


@app.post("/auth/login")
def auth_login(payload: LoginRequest):
    if os.environ.get("ENABLE_LEGACY_EMAIL_LOGIN", "0") != "1":
        raise HTTPException(status_code=404, detail="Not found")

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, email, role, first_name, last_name, COALESCE(is_active, true)
                FROM users
                WHERE lower(email) = lower(%s)
                """,
                (payload.email,),
            )
            row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    if not row[5]:
        raise HTTPException(status_code=403, detail="User is inactive")

    return {
        "ok": True,
        "user_id": str(row[0]),
        "email": row[1],
        "role": row[2],
        "first_name": row[3],
        "last_name": row[4],
    }
    
@app.get("/auth/me")
def auth_me(authorization: str | None = Header(default=None)):
    return get_current_user_from_firebase(authorization)

@app.get("/admin/staff")
def admin_list_staff(
    authorization: str | None = Header(default=None),
    assigned_mdb_user_id: UUID | None = None,
    faction_only: bool | None = None,
    q: str | None = None,
):
    scope = _resolve_actor_scope(authorization)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            scoped_assigned_mdb_user_id: str | None
            scoped_faction_only: bool | None
            if scope["is_admin"]:
                scoped_assigned_mdb_user_id = (
                    str(assigned_mdb_user_id) if assigned_mdb_user_id else None
                )
                scoped_faction_only = faction_only
            else:
                scoped_assigned_mdb_user_id = scope["principal"]["id"]
                scoped_faction_only = False

            cur.execute(
                """
                SELECT
                    u.id,
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.role,
                    u.assigned_mdb_user_id,
                    CASE
                        WHEN m.id IS NOT NULL THEN COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')
                        ELSE NULL
                    END AS assigned_mdb_name,
                    COALESCE(u.is_faction_staff, false) AS is_faction_staff,
                    COALESCE(u.is_active, true) AS is_active
                FROM users u
                LEFT JOIN users m
                    ON m.id = u.assigned_mdb_user_id
                WHERE u.role = 'staff'
                  AND (%s::uuid IS NULL OR u.assigned_mdb_user_id = %s::uuid)
                  AND (%s::boolean IS NULL OR u.is_faction_staff = %s::boolean)
                  AND (
                        %s::text IS NULL
                        OR u.email ILIKE %s::text
                        OR u.first_name ILIKE %s::text
                        OR u.last_name ILIKE %s::text
                      )
                ORDER BY
                    u.is_faction_staff DESC,
                    assigned_mdb_name NULLS LAST,
                    u.last_name NULLS LAST,
                    u.first_name NULLS LAST
                """,
                (
                    scoped_assigned_mdb_user_id,
                    scoped_assigned_mdb_user_id,
                    scoped_faction_only,
                    scoped_faction_only,
                    q,
                    f"%{q}%" if q else None,
                    f"%{q}%" if q else None,
                    f"%{q}%" if q else None,
                ),
            )
            rows = cur.fetchall()

    return [_admin_user_row_to_dict(r) for r in rows]


@app.post("/admin/staff")
def admin_create_staff(
    payload: AdminStaffCreate,
    authorization: str | None = Header(default=None),
):
    scope = _resolve_actor_scope(authorization)
    actor = scope["actor"]
    principal = scope["principal"]

    normalized_email = _normalize_email(payload.email)
    is_admin = scope["is_admin"]

    target_assigned_mdb_user_id = (
        str(payload.assigned_mdb_user_id) if is_admin and payload.assigned_mdb_user_id else principal["id"]
    )
    target_is_faction_staff = payload.is_faction_staff if is_admin else False

    if target_is_faction_staff and target_assigned_mdb_user_id is not None:
        raise HTTPException(
            status_code=400,
            detail="Fraktionsmitarbeiter darf nicht gleichzeitig einem MdB zugewiesen sein",
        )
    if not target_is_faction_staff and target_assigned_mdb_user_id is None:
        raise HTTPException(status_code=400, detail="Mitarbeiter muss einem MdB zugewiesen sein")

    if target_assigned_mdb_user_id:
        with psycopg.connect(DB_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, role
                    FROM users
                    WHERE id = %s
                    """,
                    (target_assigned_mdb_user_id,),
                )
                mdb_row = cur.fetchone()
                if not mdb_row:
                    raise HTTPException(status_code=400, detail="Zugewiesener MdB nicht gefunden")
                if mdb_row[1] != "mdb":
                    raise HTTPException(status_code=400, detail="Zugewiesener Nutzer ist kein MdB")

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM users WHERE lower(email) = lower(%s)",
                (normalized_email,),
            )
            if cur.fetchone():
                raise HTTPException(status_code=400, detail="Email already exists")

    firebase_uid: str | None = None
    firebase_created = False
    if payload.create_firebase_auth:
        firebase_uid, firebase_created = _resolve_or_create_firebase_user(
            email=normalized_email,
            first_name=payload.first_name,
            last_name=payload.last_name,
            is_active=payload.is_active,
            password=payload.firebase_password,
        )

    with psycopg.connect(DB_URL) as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO users (
                        id,
                        email,
                        first_name,
                        last_name,
                        role,
                        group_id,
                        assigned_mdb_user_id,
                        is_faction_staff,
                        is_active,
                        firebase_uid
                    )
                    VALUES (
                        gen_random_uuid(),
                        %s, %s, %s, 'staff', %s, %s, %s, %s, %s
                    )
                    RETURNING id
                    """,
                    (
                        normalized_email,
                        payload.first_name,
                        payload.last_name,
                        None,
                        target_assigned_mdb_user_id,
                        target_is_faction_staff,
                        payload.is_active,
                        firebase_uid,
                    ),
                )
                new_staff_id = cur.fetchone()[0]
                conn.commit()
        except Exception:
            if firebase_created and firebase_uid:
                try:
                    firebase_auth.delete_user(firebase_uid)
                except Exception:
                    pass
            raise

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    u.id,
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.role,
                    u.assigned_mdb_user_id,
                    CASE
                        WHEN m.id IS NOT NULL THEN COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')
                        ELSE NULL
                    END AS assigned_mdb_name,
                    COALESCE(u.is_faction_staff, false) AS is_faction_staff,
                    COALESCE(u.is_active, true) AS is_active
                FROM users u
                LEFT JOIN users m ON m.id = u.assigned_mdb_user_id
                WHERE u.id = %s
                """,
                (new_staff_id,),
            )
            row = cur.fetchone()

    return {
        "ok": True,
        "created_by_user_id": actor["id"],
        "staff": _admin_user_row_to_dict(row),
    }


@app.patch("/admin/staff/{staff_id}")
def admin_update_staff(
    staff_id: UUID,
    payload: AdminStaffUpdate,
    authorization: str | None = Header(default=None),
):
    scope = _resolve_actor_scope(authorization)
    is_admin = scope["is_admin"]

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    u.id,
                    u.role,
                    u.assigned_mdb_user_id,
                    u.is_faction_staff,
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.firebase_uid,
                    COALESCE(u.is_active, true)
                FROM users u
                WHERE u.id = %s
                """,
                (staff_id,),
            )
            current = cur.fetchone()
            if not current:
                raise HTTPException(status_code=404, detail="Staff user not found")
            if current[1] != "staff":
                raise HTTPException(status_code=400, detail="User is not staff")

            if not is_admin:
                if str(current[2]) != scope["principal"]["id"]:
                    raise HTTPException(status_code=403, detail="Nur eigene Mitarbeiter dürfen bearbeitet werden")

            current_email = current[4]
            current_first_name = current[5]
            current_last_name = current[6]
            current_firebase_uid = current[7]
            current_is_active = bool(current[8])

            updates = []
            values = []

            if payload.email is not None:
                normalized_email = _normalize_email(payload.email)
                cur.execute(
                    "SELECT 1 FROM users WHERE lower(email) = lower(%s) AND id <> %s",
                    (normalized_email, staff_id),
                )
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="Email already exists")
                updates.append("email = %s")
                values.append(normalized_email)

            if payload.first_name is not None:
                updates.append("first_name = %s")
                values.append(payload.first_name)

            if payload.last_name is not None:
                updates.append("last_name = %s")
                values.append(payload.last_name)

            target_assigned_mdb_user_id = (
                str(current[2]) if current[2] else None
            )
            target_is_faction_staff = bool(current[3])

            if is_admin:
                if payload.assigned_mdb_user_id is not None:
                    target_assigned_mdb_user_id = str(payload.assigned_mdb_user_id)
                    updates.append("assigned_mdb_user_id = %s")
                    values.append(payload.assigned_mdb_user_id)

                if payload.is_faction_staff is not None:
                    target_is_faction_staff = payload.is_faction_staff
                    updates.append("is_faction_staff = %s")
                    values.append(payload.is_faction_staff)
            else:
                target_assigned_mdb_user_id = scope["principal"]["id"]
                target_is_faction_staff = False
                updates.append("assigned_mdb_user_id = %s")
                values.append(scope["principal"]["id"])
                updates.append("is_faction_staff = %s")
                values.append(False)

            if payload.is_active is not None:
                updates.append("is_active = %s")
                values.append(payload.is_active)

            if target_is_faction_staff and target_assigned_mdb_user_id is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Fraktionsmitarbeiter darf nicht gleichzeitig einem MdB zugewiesen sein",
                )
            if not target_is_faction_staff and target_assigned_mdb_user_id is None:
                raise HTTPException(status_code=400, detail="Mitarbeiter muss einem MdB zugewiesen sein")

            if target_assigned_mdb_user_id:
                cur.execute(
                    """
                    SELECT id, role
                    FROM users
                    WHERE id = %s
                    """,
                    (target_assigned_mdb_user_id,),
                )
                mdb_row = cur.fetchone()
                if not mdb_row:
                    raise HTTPException(status_code=400, detail="Zugewiesener MdB nicht gefunden")
                if mdb_row[1] != "mdb":
                    raise HTTPException(status_code=400, detail="Zugewiesener Nutzer ist kein MdB")

            if current_firebase_uid:
                target_email = (
                    _normalize_email(payload.email)
                    if payload.email is not None
                    else current_email
                )
                target_first_name = (
                    payload.first_name
                    if payload.first_name is not None
                    else current_first_name
                )
                target_last_name = (
                    payload.last_name
                    if payload.last_name is not None
                    else current_last_name
                )
                target_is_active = (
                    bool(payload.is_active)
                    if payload.is_active is not None
                    else current_is_active
                )

                try:
                    firebase_auth.update_user(
                        current_firebase_uid,
                        email=target_email,
                        display_name=_display_name(target_first_name, target_last_name),
                        disabled=not target_is_active,
                    )
                except Exception as exc:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Firebase user could not be updated: {exc}",
                    ) from exc

            if not updates:
                updates.append("id = id")

            values.append(staff_id)
            cur.execute(
                f"""
                UPDATE users
                SET {", ".join(updates)}
                WHERE id = %s
                """,
                values,
            )
            conn.commit()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    u.id,
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.role,
                    u.assigned_mdb_user_id,
                    CASE
                        WHEN m.id IS NOT NULL THEN COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')
                        ELSE NULL
                    END AS assigned_mdb_name,
                    COALESCE(u.is_faction_staff, false) AS is_faction_staff,
                    COALESCE(u.is_active, true) AS is_active
                FROM users u
                LEFT JOIN users m ON m.id = u.assigned_mdb_user_id
                WHERE u.id = %s
                """,
                (staff_id,),
            )
            row = cur.fetchone()

    return {"ok": True, "staff": _admin_user_row_to_dict(row)}

@app.get("/admin/slot-templates")
def admin_list_slot_templates(authorization: str | None = Header(default=None)):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            _get_default_slot_template_id(cur)
            cur.execute(
                """
                SELECT
                    t.id,
                    t.name,
                    COALESCE(t.is_default, false) AS is_default,
                    COALESCE(t.is_active, true) AS is_active,
                    COALESCE(t.default_active_count, %s) AS default_active_count,
                    COALESCE(t.default_ruf_count, %s) AS default_ruf_count,
                    COUNT(i.id) AS item_count
                FROM slot_templates t
                LEFT JOIN slot_template_items i
                  ON i.template_id = t.id
                GROUP BY t.id, t.name, t.is_default, t.is_active, t.default_active_count, t.default_ruf_count
                ORDER BY t.is_default DESC, t.name ASC
                """,
                (DEFAULT_REQUIRED_ACTIVE_COUNT, DEFAULT_REQUIRED_RUF_COUNT),
            )
            template_rows = cur.fetchall()
            cur.execute(
                """
                SELECT
                    id,
                    template_id,
                    weekday,
                    slot_code,
                    slot_order,
                    day_offset,
                    start_time,
                    end_time,
                    COALESCE(open_end, false) AS open_end,
                    required_active_count,
                    required_ruf_count,
                    COALESCE(full_attendance, false) AS full_attendance
                FROM slot_template_items
                ORDER BY template_id, day_offset ASC, slot_order ASC, start_time ASC, slot_code ASC
                """
            )
            item_rows = cur.fetchall()

    items_by_template: dict[str, list[dict]] = {}
    for row in item_rows:
        item = _slot_template_item_row_to_dict(row)
        items_by_template.setdefault(item["template_id"], []).append(item)

    return [
        {
            **_slot_template_row_to_dict(row),
            "items": items_by_template.get(str(row[0]), []),
        }
        for row in template_rows
    ]


@app.post("/admin/slot-templates")
def admin_create_slot_template(
    payload: SlotTemplateCreate,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            if payload.is_default:
                cur.execute("UPDATE slot_templates SET is_default = false WHERE is_default = true")

            cur.execute(
                """
                INSERT INTO slot_templates (
                    id,
                    name,
                    is_default,
                    is_active,
                    default_active_count,
                    default_ruf_count,
                    created_at,
                    updated_at
                )
                VALUES (
                    gen_random_uuid(),
                    %s,
                    %s,
                    true,
                    %s,
                    %s,
                    now(),
                    now()
                )
                RETURNING id, name, is_default, is_active, default_active_count, default_ruf_count
                """,
                (
                    payload.name.strip(),
                    payload.is_default,
                    payload.default_active_count,
                    payload.default_ruf_count,
                ),
            )
            row = cur.fetchone()
            conn.commit()

    return {
        "ok": True,
        "template": {
            **_slot_template_row_to_dict((*row, 0)),
            "items": [],
        },
    }


@app.patch("/admin/slot-templates/{template_id}")
def admin_update_slot_template(
    template_id: UUID,
    payload: SlotTemplateUpdate,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM slot_templates WHERE id = %s", (template_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Slot-Template nicht gefunden")

            updates = []
            values = []

            if payload.name is not None:
                updates.append("name = %s")
                values.append(payload.name.strip())

            if payload.is_default is not None:
                if payload.is_default:
                    cur.execute(
                        "UPDATE slot_templates SET is_default = false WHERE is_default = true AND id <> %s",
                        (template_id,),
                    )
                updates.append("is_default = %s")
                values.append(payload.is_default)
            if payload.default_active_count is not None:
                updates.append("default_active_count = %s")
                values.append(payload.default_active_count)
            if payload.default_ruf_count is not None:
                updates.append("default_ruf_count = %s")
                values.append(payload.default_ruf_count)

            if not updates:
                cur.execute(
                    """
                    SELECT id, name, is_default, is_active, default_active_count, default_ruf_count, 0
                    FROM slot_templates
                    WHERE id = %s
                    """,
                    (template_id,),
                )
                row = cur.fetchone()
            else:
                values.append(template_id)
                cur.execute(
                    f"""
                    UPDATE slot_templates
                    SET {", ".join(updates)}, updated_at = now()
                    WHERE id = %s
                    RETURNING id, name, is_default, is_active, default_active_count, default_ruf_count
                    """,
                    values,
                )
                updated = cur.fetchone()
                row = (*updated, 0)
                conn.commit()

    return {"ok": True, "template": {**_slot_template_row_to_dict(row), "items": []}}


@app.delete("/admin/slot-templates/{template_id}")
def admin_delete_slot_template(
    template_id: UUID,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, COALESCE(is_default, false) AS is_default
                FROM slot_templates
                WHERE id = %s
                """,
                (template_id,),
            )
            template_row = cur.fetchone()
            if not template_row:
                raise HTTPException(status_code=404, detail="Slot-Template nicht gefunden")

            cur.execute("SELECT COUNT(*) FROM slot_templates")
            template_count = int(cur.fetchone()[0] or 0)
            if template_count <= 1:
                raise HTTPException(
                    status_code=400,
                    detail="Mindestens ein Slot-Template muss bestehen bleiben",
                )

            was_default = bool(template_row[1])

            cur.execute("DELETE FROM slot_templates WHERE id = %s", (template_id,))

            if was_default:
                cur.execute(
                    """
                    SELECT id
                    FROM slot_templates
                    ORDER BY updated_at DESC, created_at DESC
                    LIMIT 1
                    """
                )
                replacement = cur.fetchone()
                if replacement:
                    cur.execute(
                        "UPDATE slot_templates SET is_default = true, updated_at = now() WHERE id = %s",
                        (replacement[0],),
                    )

            conn.commit()

    return {"ok": True, "deleted_id": str(template_id)}


@app.post("/admin/slot-templates/{template_id}/items")
def admin_create_slot_template_item(
    template_id: UUID,
    payload: SlotTemplateItemCreate,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            _resolve_slot_template_id(cur, template_id)
            cur.execute(
                """
                INSERT INTO slot_template_items (
                    id,
                    template_id,
                    weekday,
                    slot_code,
                    slot_order,
                    day_offset,
                    start_time,
                    end_time,
                    open_end,
                    required_active_count,
                    required_ruf_count,
                    full_attendance,
                    created_at,
                    updated_at
                )
                VALUES (
                    gen_random_uuid(),
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s::time,
                    %s::time,
                    %s,
                    %s,
                    %s,
                    %s,
                    now(),
                    now()
                )
                RETURNING
                    id,
                    template_id,
                    weekday,
                    slot_code,
                    slot_order,
                    day_offset,
                    start_time,
                    end_time,
                    COALESCE(open_end, false),
                    required_active_count,
                    required_ruf_count,
                    COALESCE(full_attendance, false)
                """,
                (
                    template_id,
                    payload.weekday,
                    payload.slot_code,
                    payload.slot_order,
                    payload.day_offset,
                    payload.start_time,
                    payload.end_time,
                    payload.open_end,
                    payload.required_active_count,
                    payload.required_ruf_count,
                    payload.full_attendance,
                ),
            )
            row = cur.fetchone()
            conn.commit()

    return {"ok": True, "item": _slot_template_item_row_to_dict(row)}


@app.post("/admin/slot-templates/{template_id}/import")
def admin_import_slot_template_items(
    template_id: UUID,
    payload: SlotTemplateImportRequest,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    imported_items = _parse_slot_template_import(payload.raw_text)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            _resolve_slot_template_id(cur, template_id)
            cur.execute(
                """
                SELECT COUNT(*)
                FROM person_slot_rules r
                JOIN slot_template_items i
                  ON i.id = r.template_item_id
                WHERE i.template_id = %s
                """,
                (template_id,),
            )
            deleted_rules_count = int(cur.fetchone()[0] or 0)

            cur.execute("DELETE FROM slot_template_items WHERE template_id = %s", (template_id,))

            for item in imported_items:
                cur.execute(
                    """
                    INSERT INTO slot_template_items (
                        id,
                        template_id,
                        weekday,
                        slot_code,
                        slot_order,
                        day_offset,
                        start_time,
                        end_time,
                        open_end,
                        required_active_count,
                        required_ruf_count,
                        full_attendance,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        gen_random_uuid(),
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s::time,
                        %s::time,
                        %s,
                        NULL,
                        NULL,
                        false,
                        now(),
                        now()
                    )
                    """,
                    (
                        template_id,
                        item["weekday"],
                        item["slot_code"],
                        item["slot_order"],
                        item["day_offset"],
                        item["start_time"],
                        item["end_time"],
                        item["open_end"],
                    ),
                )

            conn.commit()

    return {
        "ok": True,
        "template_id": str(template_id),
        "imported_items_count": len(imported_items),
        "deleted_rules_count": deleted_rules_count,
    }


@app.patch("/admin/slot-template-items/{item_id}")
def admin_update_slot_template_item(
    item_id: UUID,
    payload: SlotTemplateItemUpdate,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM slot_template_items WHERE id = %s", (item_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Standardslot nicht gefunden")

            provided_fields = payload.model_fields_set
            updates = []
            values = []

            if "weekday" in provided_fields:
                updates.append("weekday = %s")
                values.append(payload.weekday)
            if "slot_code" in provided_fields:
                updates.append("slot_code = %s")
                values.append(payload.slot_code)
            if "slot_order" in provided_fields:
                updates.append("slot_order = %s")
                values.append(payload.slot_order)
            if "day_offset" in provided_fields:
                updates.append("day_offset = %s")
                values.append(payload.day_offset)
            if "start_time" in provided_fields:
                updates.append("start_time = %s::time")
                values.append(payload.start_time)
            if "end_time" in provided_fields:
                updates.append("end_time = %s::time")
                values.append(payload.end_time)
            if "open_end" in provided_fields:
                updates.append("open_end = %s")
                values.append(payload.open_end)
            if "required_active_count" in provided_fields:
                updates.append("required_active_count = %s")
                values.append(payload.required_active_count)
            if "required_ruf_count" in provided_fields:
                updates.append("required_ruf_count = %s")
                values.append(payload.required_ruf_count)
            if "full_attendance" in provided_fields:
                updates.append("full_attendance = %s")
                values.append(payload.full_attendance)

            if not updates:
                cur.execute(
                    """
                    SELECT
                        id,
                        template_id,
                        weekday,
                        slot_code,
                        slot_order,
                        day_offset,
                        start_time,
                        end_time,
                        COALESCE(open_end, false),
                        required_active_count,
                        required_ruf_count,
                        COALESCE(full_attendance, false)
                    FROM slot_template_items
                    WHERE id = %s
                    """,
                    (item_id,),
                )
                row = cur.fetchone()
            else:
                values.append(item_id)
                cur.execute(
                    f"""
                    UPDATE slot_template_items
                    SET {", ".join(updates)}, updated_at = now()
                    WHERE id = %s
                    RETURNING
                        id,
                        template_id,
                        weekday,
                        slot_code,
                        slot_order,
                        day_offset,
                        start_time,
                        end_time,
                        COALESCE(open_end, false),
                        required_active_count,
                        required_ruf_count,
                        COALESCE(full_attendance, false)
                    """,
                    values,
                )
                row = cur.fetchone()
                conn.commit()

    return {"ok": True, "item": _slot_template_item_row_to_dict(row)}


@app.delete("/admin/slot-template-items/{item_id}")
def admin_delete_slot_template_item(
    item_id: UUID,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM slot_template_items WHERE id = %s RETURNING id", (item_id,))
            deleted = cur.fetchone()
            if not deleted:
                raise HTTPException(status_code=404, detail="Standardslot nicht gefunden")
            conn.commit()

    return {"ok": True, "deleted_id": str(item_id)}


@app.get("/admin/users/{user_id}/planner-rules")
def admin_get_user_planner_rules(
    user_id: UUID,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, COALESCE(is_planner_exempt, false)
                FROM users
                WHERE id = %s
                """,
                (user_id,),
            )
            user_row = cur.fetchone()
            if not user_row:
                raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")

            cur.execute(
                """
                SELECT
                    r.id,
                    r.user_id,
                    r.template_item_id,
                    r.rule_type,
                    t.name,
                    i.weekday,
                    i.slot_code,
                    i.slot_order,
                    i.start_time,
                    i.end_time,
                    COALESCE(i.open_end, false) AS open_end
                FROM person_slot_rules r
                JOIN slot_template_items i
                  ON i.id = r.template_item_id
                JOIN slot_templates t
                  ON t.id = i.template_id
                WHERE r.user_id = %s
                ORDER BY t.name ASC, i.day_offset ASC, i.slot_order ASC
                """,
                (user_id,),
            )
            rows = cur.fetchall()

    return {
        "user_id": str(user_row[0]),
        "is_planner_exempt": bool(user_row[1]),
        "rules": [_planner_rule_row_to_dict(row) for row in rows],
    }


@app.post("/admin/users/{user_id}/planner-rules")
def admin_create_user_planner_rule(
    user_id: UUID,
    payload: PersonSlotRuleCreate,
    authorization: str | None = Header(default=None),
    apply_retroactively: bool = Query(default=False),
):
    actor = require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    retroactive_cleanup: dict[str, object] | None = None

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE id = %s", (user_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")

            cur.execute(
                """
                SELECT id
                FROM slot_template_items
                WHERE id = %s
                """,
                (payload.template_item_id,),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Standardslot nicht gefunden")

            cur.execute(
                """
                INSERT INTO person_slot_rules (
                    id,
                    user_id,
                    template_item_id,
                    rule_type,
                    created_by_user_id,
                    created_at
                )
                VALUES (
                    gen_random_uuid(),
                    %s,
                    %s,
                    %s,
                    %s,
                    now()
                )
                ON CONFLICT (user_id, template_item_id, rule_type) DO NOTHING
                """,
                (user_id, payload.template_item_id, payload.rule_type, actor["id"]),
            )

            if apply_retroactively:
                retroactive_cleanup = _retroactively_remove_user_assignments(
                    cur,
                    user_id=user_id,
                    template_item_id=payload.template_item_id,
                )

            conn.commit()

    response = admin_get_user_planner_rules(user_id, authorization)
    if retroactive_cleanup:
        response["retroactive_cleanup"] = retroactive_cleanup
    return response


@app.delete("/admin/planner-rules/{rule_id}")
def admin_delete_user_planner_rule(
    rule_id: UUID,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM person_slot_rules WHERE id = %s RETURNING user_id", (rule_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Planer-Regel nicht gefunden")
            conn.commit()

    return {"ok": True, "user_id": str(row[0]), "deleted_rule_id": str(rule_id)}


def _weekday_name_for_date(value: date) -> str:
    weekday_names = [
        "Montag",
        "Dienstag",
        "Mittwoch",
        "Donnerstag",
        "Freitag",
        "Samstag",
        "Sonntag",
    ]
    return weekday_names[value.weekday()]


def _load_planner_week_context(cur, week_start: date):
    cur.execute(
        """
        SELECT
            s.id,
            s.slot_date,
            COALESCE(i.weekday, '') AS weekday,
            s.slot_code,
            COALESCE(i.slot_order, 0) AS slot_order,
            s.start_time,
            s.end_time,
            COALESCE(s.open_end, false) AS open_end,
            s.template_item_id,
            i.template_id,
            COALESCE(i.required_active_count, t.default_active_count, %s) AS required_active_count,
            COALESCE(i.required_ruf_count, t.default_ruf_count, %s) AS required_ruf_count,
            COALESCE(i.full_attendance, false) AS full_attendance
        FROM duty_slots s
        LEFT JOIN slot_template_items i
          ON i.id = s.template_item_id
        LEFT JOIN slot_templates t
          ON t.id = i.template_id
        WHERE date_trunc('week', s.slot_date)::date = %s::date
        ORDER BY s.slot_date ASC, COALESCE(i.slot_order, 0) ASC, s.start_time ASC, s.slot_code ASC
        """,
        (DEFAULT_REQUIRED_ACTIVE_COUNT, DEFAULT_REQUIRED_RUF_COUNT, week_start),
    )
    slot_rows = cur.fetchall()
    if not slot_rows:
        raise HTTPException(status_code=404, detail="Für diese Woche sind noch keine Slots angelegt")

    slots: list[PlannerSlot] = []
    template_ids: list[UUID] = []
    rows_by_date: dict[date, list[tuple]] = {}
    for row in slot_rows:
        rows_by_date.setdefault(row[1], []).append(row)
        if row[9]:
            template_ids.append(row[9])

    last_slot_ids_by_date: dict[date, str] = {}
    for slot_date, rows in rows_by_date.items():
        last_row = max(
            rows,
            key=lambda item: (
                int(item[4] or 0),
                _time_to_minutes(item[5]),
                item[3] or "",
            ),
        )
        last_slot_ids_by_date[slot_date] = str(last_row[0])

    for index, row in enumerate(slot_rows):
        slot_date = row[1]
        slot_id = str(row[0])
        is_last_slot_of_day = last_slot_ids_by_date.get(slot_date) == slot_id
        weekday = row[2] or _weekday_name_for_date(slot_date)
        is_friday_last_slot = weekday.lower() == "freitag" and is_last_slot_of_day
        slots.append(
            PlannerSlot(
                id=slot_id,
                slot_date=slot_date,
                weekday=weekday,
                slot_code=row[3],
                slot_order=int(row[4] or index + 1),
                sequence_index=index,
                template_item_id=str(row[8]) if row[8] else None,
                start_time=row[5],
                end_time=row[6],
                open_end=bool(row[7]),
                required_active_count=int(row[10] or DEFAULT_REQUIRED_ACTIVE_COUNT),
                required_ruf_count=int(row[11] or DEFAULT_REQUIRED_RUF_COUNT),
                full_attendance=bool(row[12]),
                is_late_slot=_slot_is_late(
                    start_time=row[5],
                    open_end=bool(row[7]),
                    is_last_slot_of_day=is_last_slot_of_day,
                ),
                is_last_slot_of_day=is_last_slot_of_day,
                is_friday_last_slot=is_friday_last_slot,
            )
        )

    template_id = template_ids[0] if template_ids else _get_default_slot_template_id(cur)
    week_end = max(slot.slot_date for slot in slots)

    cur.execute(
        """
        SELECT
            u.id,
            u.email,
            u.first_name,
            u.last_name,
            COALESCE(u.is_planner_exempt, false) AS is_planner_exempt,
            COALESCE(ps.total_slots, 0) AS total_slots,
            COALESCE(ps.active_slots, 0) AS active_slots,
            COALESCE(ps.ruf_slots, 0) AS ruf_slots,
            COALESCE(ps.late_slots, 0) AS late_slots,
            COALESCE(ps.friday_last_slots, 0) AS friday_last_slots,
            COALESCE(ps.planned_weeks, 0) AS planned_weeks
        FROM users u
        LEFT JOIN planner_person_stats ps
          ON ps.user_id = u.id
        WHERE COALESCE(u.is_active, true) = true
          AND COALESCE(u.is_mdb, false) = true
        ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST, u.email ASC
        """
    )
    user_rows = cur.fetchall()

    cur.execute(
        """
        SELECT
            r.user_id,
            r.template_item_id,
            i.weekday
        FROM person_slot_rules r
        JOIN slot_template_items i
          ON i.id = r.template_item_id
        WHERE i.template_id = %s
        """,
        (template_id,),
    )
    rule_rows = cur.fetchall()

    blocked_by_user: dict[str, set[str]] = {}
    blocked_wednesday_count: dict[str, int] = {}
    for user_id, template_item_id, weekday in rule_rows:
        user_key = str(user_id)
        blocked_by_user.setdefault(user_key, set()).add(str(template_item_id))
        if (weekday or "").lower() == "mittwoch":
            blocked_wednesday_count[user_key] = blocked_wednesday_count.get(user_key, 0) + 1

    people: list[PlannerPerson] = []
    people_snapshot: list[dict] = []
    for row in user_rows:
        user_id = str(row[0])
        person = PlannerPerson(
            id=user_id,
            email=row[1],
            first_name=row[2],
            last_name=row[3],
            is_exempt=bool(row[4]),
            blocked_template_item_ids=blocked_by_user.get(user_id, set()),
            blocked_wednesday_count=blocked_wednesday_count.get(user_id, 0),
            stats=PlannerPersonStats(
                total_slots=int(row[5] or 0),
                active_slots=int(row[6] or 0),
                ruf_slots=int(row[7] or 0),
                late_slots=int(row[8] or 0),
                friday_last_slots=int(row[9] or 0),
                planned_weeks=int(row[10] or 0),
            ),
        )
        people.append(person)
        people_snapshot.append(
            {
                "id": user_id,
                "name": person.display_name,
                "email": person.email,
                "is_exempt": person.is_exempt,
                "blocked_rules_count": len(person.blocked_template_item_ids),
                "blocked_wednesday_count": person.blocked_wednesday_count,
                "history_total_slots": person.stats.total_slots,
                "history_active_slots": person.stats.active_slots,
                "history_ruf_slots": person.stats.ruf_slots,
                "history_late_slots": person.stats.late_slots,
                "history_friday_last_slots": person.stats.friday_last_slots,
                "planned_weeks": person.stats.planned_weeks,
            }
        )

    cur.execute(
        """
        SELECT
            sa.slot_id,
            sa.user_id,
            COALESCE(sa.assignment_type, 'active') AS assignment_type,
            COALESCE(sa.source, 'manual') AS source,
            COALESCE(sa.locked, false) AS locked
        FROM slot_assignments sa
        JOIN duty_slots s
          ON s.id = sa.slot_id
        WHERE date_trunc('week', s.slot_date)::date = %s::date
        """,
        (week_start,),
    )
    existing_rows = cur.fetchall()
    existing_assignments = [
        PlannerExistingAssignment(
            slot_id=str(row[0]),
            user_id=str(row[1]),
            assignment_type=_normalise_assignment_type(row[2]),
            source=row[3] or "manual",
            locked=bool(row[4]),
        )
        for row in existing_rows
    ]

    return {
        "template_id": template_id,
        "week_end": week_end,
        "slots": slots,
        "people": people,
        "people_snapshot": people_snapshot,
        "existing_assignments": existing_assignments,
    }


def _refresh_planner_person_stats(cur):
    cur.execute("DELETE FROM planner_person_stats")
    cur.execute(
        """
        INSERT INTO planner_person_stats (
            user_id,
            total_slots,
            active_slots,
            ruf_slots,
            late_slots,
            friday_last_slots,
            planned_weeks,
            last_planned_week_start,
            updated_at
        )
        SELECT
            user_id,
            COALESCE(SUM(total_slots), 0) AS total_slots,
            COALESCE(SUM(active_slots), 0) AS active_slots,
            COALESCE(SUM(ruf_slots), 0) AS ruf_slots,
            COALESCE(SUM(late_slots), 0) AS late_slots,
            COALESCE(SUM(friday_last_slots), 0) AS friday_last_slots,
            COUNT(*) AS planned_weeks,
            MAX(week_start) AS last_planned_week_start,
            now()
        FROM planner_person_week_stats
        GROUP BY user_id
        """
    )


@app.get("/admin/planner/runs")
def admin_list_planner_runs(
    authorization: str | None = Header(default=None),
    week_start: date | None = None,
    limit: int = Query(default=10, ge=1, le=50),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    r.id,
                    r.week_start,
                    r.week_end,
                    r.status,
                    r.template_id,
                    t.name,
                    COALESCE(r.random_seed, 0),
                    r.created_at,
                    r.applied_at,
                    COALESCE(r.summary_json, '{}'::jsonb)
                FROM planning_runs r
                LEFT JOIN slot_templates t
                  ON t.id = r.template_id
                WHERE (%s::date IS NULL OR r.week_start = %s::date)
                ORDER BY r.created_at DESC
                LIMIT %s
                """,
                (week_start, week_start, limit),
            )
            rows = cur.fetchall()

    return [_planner_run_row_to_dict(row) for row in rows]


@app.get("/admin/planner/runs/{run_id}")
def admin_get_planner_run(
    run_id: UUID,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            return _load_planner_run_detail(cur, run_id)


@app.post("/admin/planner/runs")
def admin_create_planner_run(
    payload: PlannerRunCreateRequest,
    authorization: str | None = Header(default=None),
):
    actor = require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            context = _load_planner_week_context(cur, payload.week_start)
            random_seed = _seed_for_week(payload.week_start)
            result = generate_plan(
                slots=context["slots"],
                people=context["people"],
                existing_assignments=context["existing_assignments"],
                random_seed=random_seed,
            )

            slot_meta_by_id = {slot.id: slot for slot in context["slots"]}
            summary_by_user: dict[str, dict] = {}
            for suggestion in result.suggestions:
                entry = summary_by_user.setdefault(
                    suggestion.user_id,
                    {
                        "slot_ids": set(),
                        "active_slots": 0,
                        "ruf_slots": 0,
                        "late_slot_ids": set(),
                        "friday_last_slot_ids": set(),
                    },
                )
                entry["slot_ids"].add(suggestion.slot_id)
                if suggestion.assignment_type == "ruf":
                    entry["ruf_slots"] += 1
                else:
                    entry["active_slots"] += 1
                slot_meta = slot_meta_by_id.get(suggestion.slot_id)
                if slot_meta and slot_meta.is_late_slot:
                    entry["late_slot_ids"].add(suggestion.slot_id)
                if slot_meta and slot_meta.is_friday_last_slot:
                    entry["friday_last_slot_ids"].add(suggestion.slot_id)

            people_summary = []
            assigned_user_ids: set[str] = set()
            for person in context["people"]:
                calculated_summary = summary_by_user.get(person.id)
                summary_entry = {
                    "user_id": person.id,
                    "name": person.display_name,
                    "email": person.email,
                    "is_exempt": person.is_exempt,
                    "blocked_rules_count": len(person.blocked_template_item_ids),
                    "blocked_wednesday_count": person.blocked_wednesday_count,
                    "week_total_slots": len(calculated_summary["slot_ids"]) if calculated_summary else 0,
                    "week_active_slots": calculated_summary["active_slots"] if calculated_summary else 0,
                    "week_ruf_slots": calculated_summary["ruf_slots"] if calculated_summary else 0,
                    "week_late_slots": len(calculated_summary["late_slot_ids"]) if calculated_summary else 0,
                    "week_friday_last_slots": len(calculated_summary["friday_last_slot_ids"]) if calculated_summary else 0,
                    "history_total_slots": person.stats.total_slots,
                    "history_active_slots": person.stats.active_slots,
                    "history_ruf_slots": person.stats.ruf_slots,
                    "history_late_slots": person.stats.late_slots,
                    "history_friday_last_slots": person.stats.friday_last_slots,
                    "planned_weeks": person.stats.planned_weeks,
                }
                if summary_entry["week_total_slots"] > 0:
                    assigned_user_ids.add(person.id)
                people_summary.append(summary_entry)

            people_summary.sort(
                key=lambda item: (
                    -item["week_total_slots"],
                    -item["week_friday_last_slots"],
                    item["name"].lower(),
                )
            )

            warnings = [
                {
                    "slot_id": warning.slot_id,
                    "warning_code": warning.warning_code,
                    "message": warning.message,
                }
                for warning in result.warnings
            ]
            summary = {
                "slot_count": len(context["slots"]),
                "assignment_count": len(result.suggestions),
                "people_with_assignments": len(assigned_user_ids),
                "late_assignment_count": sum(1 for suggestion in result.suggestions if suggestion.is_late_slot),
                "friday_last_assignment_count": sum(
                    1 for suggestion in result.suggestions if suggestion.is_friday_last_slot
                ),
                "unfilled_positions": sum(
                    1 for warning in warnings if warning["warning_code"] == "UNFILLED_POSITION"
                ),
                "people": people_summary,
            }
            input_snapshot = {
                "template_id": str(context["template_id"]),
                "people": context["people_snapshot"],
                "slots": [
                    {
                        "slot_id": slot.id,
                        "slot_date": slot.slot_date.isoformat(),
                        "weekday": slot.weekday,
                        "slot_code": slot.slot_code,
                        "slot_order": slot.slot_order,
                        "start_time": str(slot.start_time),
                        "end_time": str(slot.end_time) if slot.end_time else None,
                        "open_end": slot.open_end,
                        "required_active_count": slot.required_active_count,
                        "required_ruf_count": slot.required_ruf_count,
                        "full_attendance": slot.full_attendance,
                        "is_late_slot": slot.is_late_slot,
                        "is_last_slot_of_day": slot.is_last_slot_of_day,
                        "is_friday_last_slot": slot.is_friday_last_slot,
                    }
                    for slot in context["slots"]
                ],
            }

            cur.execute(
                """
                INSERT INTO planning_runs (
                    id,
                    week_start,
                    week_end,
                    status,
                    template_id,
                    random_seed,
                    input_snapshot,
                    summary_json,
                    warnings,
                    created_by_user_id,
                    created_at
                )
                VALUES (
                    gen_random_uuid(),
                    %s,
                    %s,
                    'ready',
                    %s,
                    %s,
                    %s::jsonb,
                    %s::jsonb,
                    %s::jsonb,
                    %s,
                    now()
                )
                RETURNING id
                """,
                (
                    payload.week_start,
                    context["week_end"],
                    context["template_id"],
                    random_seed,
                    json.dumps(input_snapshot),
                    json.dumps(summary),
                    json.dumps(warnings),
                    actor["id"],
                ),
            )
            run_id = cur.fetchone()[0]

            for suggestion in result.suggestions:
                slot_meta = next(slot for slot in context["slots"] if slot.id == suggestion.slot_id)
                cur.execute(
                    """
                    INSERT INTO planning_run_suggestions (
                        id,
                        planning_run_id,
                        slot_id,
                        user_id,
                        assignment_type,
                        score,
                        reason_codes,
                        score_details,
                        is_manual_fixed,
                        is_late_slot,
                        is_last_slot_of_day,
                        is_friday_last_slot,
                        required_active_count,
                        required_ruf_count,
                        created_at
                    )
                    VALUES (
                        gen_random_uuid(),
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s::jsonb,
                        %s::jsonb,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        now()
                    )
                    """,
                    (
                        run_id,
                        suggestion.slot_id,
                        suggestion.user_id,
                        suggestion.assignment_type,
                        suggestion.score,
                        json.dumps(suggestion.reason_codes),
                        json.dumps(suggestion.score_details),
                        suggestion.is_manual_fixed,
                        suggestion.is_late_slot,
                        suggestion.is_last_slot_of_day,
                        suggestion.is_friday_last_slot,
                        slot_meta.required_active_count,
                        slot_meta.required_ruf_count,
                    ),
                )

            conn.commit()

            return _load_planner_run_detail(cur, run_id)


@app.post("/admin/planner/runs/{run_id}/apply")
def admin_apply_planner_run(
    run_id: UUID,
    payload: PlannerRunApplyRequest,
    authorization: str | None = Header(default=None),
):
    actor = require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    week_start,
                    week_end
                FROM planning_runs
                WHERE id = %s
                """,
                (run_id,),
            )
            run_row = cur.fetchone()
            if not run_row:
                raise HTTPException(status_code=404, detail="Planer-Lauf nicht gefunden")

            week_start = run_row[0]
            week_end = run_row[1]

            cur.execute(
                """
                SELECT DISTINCT slot_id, user_id, assignment_type
                FROM planning_run_suggestions
                WHERE planning_run_id = %s
                """,
                (run_id,),
            )
            suggestion_rows = cur.fetchall()
            slot_ids = list({row[0] for row in suggestion_rows})

            if payload.overwrite_existing_planner_assignments and slot_ids:
                cur.execute(
                    """
                    DELETE FROM slot_assignments
                    WHERE slot_id = ANY(%s)
                      AND COALESCE(source, 'manual') IN ('planner', 'generated')
                      AND COALESCE(locked, false) = false
                    """,
                    (slot_ids,),
                )

            for slot_id, user_id, assignment_type in suggestion_rows:
                _upsert_slot_assignment(
                    cur,
                    slot_id,
                    user_id,
                    assignment_type,
                    source="planner",
                    locked=False,
                    planning_run_id=run_id,
                )

            cur.execute(
                """
                UPDATE planning_runs
                SET status = 'applied',
                    applied_at = now(),
                    applied_by_user_id = %s
                WHERE id = %s
                """,
                (actor["id"], run_id),
            )
            _rebuild_planner_stats_for_weeks(cur, [week_start])
            conn.commit()

            return _load_planner_run_detail(cur, run_id)


@app.get("/admin/slots")
def admin_list_slots(
    authorization: str | None = Header(default=None),
    slot_date_from: date | None = None,
    slot_date_to: date | None = None,
    q: str | None = None,
):
    scope = _resolve_actor_scope(authorization)
    ensure_direct_slot_assignment_schema()
    is_admin = scope["is_admin"]
    principal_id = scope["principal"]["id"]

    effective_slot_date_from = slot_date_from
    if not is_admin:
        today = date.today()
        if effective_slot_date_from is None or effective_slot_date_from < today:
            effective_slot_date_from = today

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            if is_admin:
                cur.execute(
                    """
                    SELECT
                        s.id,
                        s.slot_date,
                        s.slot_code,
                        s.start_time,
                        s.end_time,
                        COALESCE(s.open_end, false) AS open_end,
                        COALESCE(sa.active_count, 0) AS active_count,
                        COALESCE(sa.ruf_count, 0) AS ruf_count
                    FROM duty_slots s
                    LEFT JOIN LATERAL (
                        SELECT
                            COUNT(*) FILTER (WHERE assignment_type = 'active') AS active_count,
                            COUNT(*) FILTER (WHERE assignment_type = 'ruf') AS ruf_count
                        FROM slot_assignments
                        WHERE slot_id = s.id
                    ) sa ON true
                    WHERE (%s::date IS NULL OR s.slot_date >= %s::date)
                      AND (%s::date IS NULL OR s.slot_date <= %s::date)
                      AND (
                            %s::text IS NULL
                            OR s.slot_code ILIKE %s::text
                          )
                    ORDER BY s.slot_date ASC, s.start_time ASC, s.slot_code ASC
                    """,
                    (
                        effective_slot_date_from, effective_slot_date_from,
                        slot_date_to, slot_date_to,
                        q,
                        f"%{q}%" if q else None,
                    ),
                )
            else:
                cur.execute(
                    """
                    SELECT
                        s.id,
                        s.slot_date,
                        s.slot_code,
                        s.start_time,
                        s.end_time,
                        COALESCE(s.open_end, false) AS open_end,
                        COALESCE(sa.active_count, 0) AS active_count,
                        COALESCE(sa.ruf_count, 0) AS ruf_count
                    FROM duty_slots s
                    LEFT JOIN LATERAL (
                        SELECT
                            COUNT(*) FILTER (WHERE assignment_type = 'active') AS active_count,
                            COUNT(*) FILTER (WHERE assignment_type = 'ruf') AS ruf_count
                        FROM slot_assignments
                        WHERE slot_id = s.id
                    ) sa ON true
                    WHERE (%s::date IS NULL OR s.slot_date >= %s::date)
                      AND (%s::date IS NULL OR s.slot_date <= %s::date)
                      AND EXISTS (
                            SELECT 1
                            FROM slot_assignments sa2
                            WHERE sa2.slot_id = s.id
                              AND sa2.user_id = %s::uuid
                          )
                      AND (
                            %s::text IS NULL
                            OR s.slot_code ILIKE %s::text
                          )
                    ORDER BY s.slot_date ASC, s.start_time ASC, s.slot_code ASC
                    """,
                    (
                        effective_slot_date_from, effective_slot_date_from,
                        slot_date_to, slot_date_to,
                        principal_id,
                        q,
                        f"%{q}%" if q else None,
                    ),
                )
            rows = cur.fetchall()

    return [_slot_row_to_dict(r) for r in rows]


@app.get("/admin/slot-weeks")
def admin_list_slot_weeks(
    authorization: str | None = Header(default=None),
    slot_date_from: date | None = None,
):
    scope = _resolve_actor_scope(authorization)
    ensure_direct_slot_assignment_schema()
    is_admin = scope["is_admin"]
    principal_id = scope["principal"]["id"]

    effective_slot_date_from = slot_date_from
    if not is_admin:
        today = date.today()
        if effective_slot_date_from is None or effective_slot_date_from < today:
            effective_slot_date_from = today

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            if is_admin:
                cur.execute(
                    """
                    SELECT
                        date_trunc('week', s.slot_date)::date AS week_start,
                        MAX(s.slot_date) AS week_end,
                        COUNT(*) AS slot_count,
                        COUNT(DISTINCT s.slot_date) AS day_count,
                        COALESCE(SUM(sa.active_count), 0) AS active_assignment_count,
                        COALESCE(SUM(sa.ruf_count), 0) AS ruf_assignment_count
                    FROM duty_slots s
                    LEFT JOIN LATERAL (
                        SELECT
                            COUNT(*) FILTER (WHERE assignment_type = 'active') AS active_count,
                            COUNT(*) FILTER (WHERE assignment_type = 'ruf') AS ruf_count
                        FROM slot_assignments
                        WHERE slot_id = s.id
                    ) sa ON true
                    WHERE (%s::date IS NULL OR s.slot_date >= %s::date)
                    GROUP BY date_trunc('week', s.slot_date)::date
                    ORDER BY week_start ASC
                    """,
                    (effective_slot_date_from, effective_slot_date_from),
                )
            else:
                cur.execute(
                    """
                    SELECT
                        date_trunc('week', s.slot_date)::date AS week_start,
                        MAX(s.slot_date) AS week_end,
                        COUNT(*) AS slot_count,
                        COUNT(DISTINCT s.slot_date) AS day_count,
                        COALESCE(SUM(sa.active_count), 0) AS active_assignment_count,
                        COALESCE(SUM(sa.ruf_count), 0) AS ruf_assignment_count
                    FROM duty_slots s
                    LEFT JOIN LATERAL (
                        SELECT
                            COUNT(*) FILTER (WHERE assignment_type = 'active') AS active_count,
                            COUNT(*) FILTER (WHERE assignment_type = 'ruf') AS ruf_count
                        FROM slot_assignments
                        WHERE slot_id = s.id
                    ) sa ON true
                    WHERE (%s::date IS NULL OR s.slot_date >= %s::date)
                      AND EXISTS (
                            SELECT 1
                            FROM slot_assignments sa2
                            WHERE sa2.slot_id = s.id
                              AND sa2.user_id = %s::uuid
                          )
                    GROUP BY date_trunc('week', s.slot_date)::date
                    ORDER BY week_start ASC
                    """,
                    (effective_slot_date_from, effective_slot_date_from, principal_id),
                )
            rows = cur.fetchall()

    return [_slot_week_row_to_dict(r) for r in rows]


@app.post("/admin/slots")
def admin_create_slot(
    payload: AdminSlotCreate,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO duty_slots (
                    id,
                    slot_date,
                    slot_code,
                    start_time,
                    end_time,
                    open_end
                )
                VALUES (
                    gen_random_uuid(),
                    %s, %s, %s::time, %s::time, %s
                )
                RETURNING
                    id,
                    slot_date,
                    slot_code,
                    start_time,
                    end_time,
                    COALESCE(open_end, false)
                """,
                (
                    payload.slot_date,
                    payload.slot_code,
                    payload.start_time,
                    payload.end_time,
                    payload.open_end,
                ),
            )
            row = cur.fetchone()
            conn.commit()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    s.id,
                    s.slot_date,
                    s.slot_code,
                    s.start_time,
                    s.end_time,
                    COALESCE(s.open_end, false),
                    COALESCE(sa.active_count, 0) AS active_count,
                    COALESCE(sa.ruf_count, 0) AS ruf_count
                FROM duty_slots s
                LEFT JOIN LATERAL (
                    SELECT
                        COUNT(*) FILTER (WHERE assignment_type = 'active') AS active_count,
                        COUNT(*) FILTER (WHERE assignment_type = 'ruf') AS ruf_count
                    FROM slot_assignments
                    WHERE slot_id = s.id
                ) sa ON true
                WHERE s.id = %s
                """,
                (row[0],),
            )
            full_row = cur.fetchone()

    return _slot_row_to_dict(full_row)


@app.patch("/admin/slots/{slot_id}")
def admin_update_slot(
    slot_id: UUID,
    payload: AdminSlotUpdate,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM duty_slots WHERE id = %s", (slot_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Slot not found")

            updates = []
            values = []

            if payload.slot_date is not None:
                updates.append("slot_date = %s")
                values.append(payload.slot_date)

            if payload.slot_code is not None:
                updates.append("slot_code = %s")
                values.append(payload.slot_code)

            if payload.start_time is not None:
                updates.append("start_time = %s::time")
                values.append(payload.start_time)

            if payload.end_time is not None:
                updates.append("end_time = %s::time")
                values.append(payload.end_time)

            if payload.open_end is not None:
                updates.append("open_end = %s")
                values.append(payload.open_end)

            if not updates:
                cur.execute(
                    """
                    SELECT
                        s.id,
                        s.slot_date,
                        s.slot_code,
                        s.start_time,
                        s.end_time,
                        COALESCE(s.open_end, false),
                        COALESCE(sa.active_count, 0) AS active_count,
                        COALESCE(sa.ruf_count, 0) AS ruf_count
                    FROM duty_slots s
                    LEFT JOIN LATERAL (
                        SELECT
                            COUNT(*) FILTER (WHERE assignment_type = 'active') AS active_count,
                            COUNT(*) FILTER (WHERE assignment_type = 'ruf') AS ruf_count
                        FROM slot_assignments
                        WHERE slot_id = s.id
                    ) sa ON true
                    WHERE s.id = %s
                    """,
                    (slot_id,),
                )
                return _slot_row_to_dict(cur.fetchone())

            values.append(slot_id)

            cur.execute(
                f"""
                UPDATE duty_slots
                SET {", ".join(updates)}
                WHERE id = %s
                """,
                values,
            )
            conn.commit()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    s.id,
                    s.slot_date,
                    s.slot_code,
                    s.start_time,
                    s.end_time,
                    COALESCE(s.open_end, false),
                    COALESCE(sa.active_count, 0) AS active_count,
                    COALESCE(sa.ruf_count, 0) AS ruf_count
                FROM duty_slots s
                LEFT JOIN LATERAL (
                    SELECT
                        COUNT(*) FILTER (WHERE assignment_type = 'active') AS active_count,
                        COUNT(*) FILTER (WHERE assignment_type = 'ruf') AS ruf_count
                    FROM slot_assignments
                    WHERE slot_id = s.id
                ) sa ON true
                WHERE s.id = %s
                """,
                (slot_id,),
            )
            row = cur.fetchone()

    return _slot_row_to_dict(row)


@app.delete("/admin/slots/{slot_id}")
def admin_delete_slot(
    slot_id: UUID,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM duty_slots WHERE id = %s", (slot_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Slot not found")

            cur.execute("DELETE FROM slot_assignments WHERE slot_id = %s", (slot_id,))
            cur.execute("DELETE FROM attendance_checks WHERE slot_id = %s", (slot_id,))
            cur.execute("DELETE FROM attendance_reminders_sent WHERE slot_id = %s", (slot_id,))
            cur.execute("DELETE FROM exchanges WHERE slot_id = %s", (slot_id,))
            cur.execute("DELETE FROM duty_slots WHERE id = %s", (slot_id,))
            conn.commit()

    return {"ok": True, "deleted_slot_id": str(slot_id)}


@app.post("/admin/slots/bulk-delete")
def admin_bulk_delete_slots(
    payload: AdminSlotsBulkDelete,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    if payload.date_to < payload.date_from:
        raise HTTPException(status_code=400, detail="date_to must be on or after date_from")

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id
                FROM duty_slots
                WHERE slot_date BETWEEN %s AND %s
                """,
                (payload.date_from, payload.date_to),
            )
            slot_ids = [row[0] for row in cur.fetchall()]

            if not slot_ids:
                return {
                    "ok": True,
                    "deleted_slots_count": 0,
                    "date_from": payload.date_from.isoformat(),
                    "date_to": payload.date_to.isoformat(),
                }

            cur.execute("DELETE FROM slot_assignments WHERE slot_id = ANY(%s)", (slot_ids,))
            cur.execute("DELETE FROM attendance_checks WHERE slot_id = ANY(%s)", (slot_ids,))
            cur.execute(
                "DELETE FROM attendance_reminders_sent WHERE slot_id = ANY(%s)",
                (slot_ids,),
            )
            cur.execute("DELETE FROM exchanges WHERE slot_id = ANY(%s)", (slot_ids,))
            cur.execute("DELETE FROM duty_slots WHERE id = ANY(%s)", (slot_ids,))
            conn.commit()

    return {
        "ok": True,
        "deleted_slots_count": len(slot_ids),
        "date_from": payload.date_from.isoformat(),
        "date_to": payload.date_to.isoformat(),
    }


def _groups_management_removed() -> None:
    raise HTTPException(
        status_code=410,
        detail="Die Gruppenverwaltung wurde entfernt. Bitte direkte Slot-Zuweisungen und Mitarbeiter-Zuordnungen verwenden.",
    )

@app.get("/admin/groups")
def admin_list_groups_with_count(authorization: str | None = Header(default=None)):
    _groups_management_removed()


@app.post("/admin/groups")
def admin_create_group(
    payload: AdminGroupCreate,
    authorization: str | None = Header(default=None),
):
    _groups_management_removed()


@app.patch("/admin/groups/{group_id}")
def admin_update_group(
    group_id: UUID,
    payload: AdminGroupUpdate,
    authorization: str | None = Header(default=None),
):
    _groups_management_removed()


@app.delete("/admin/groups/{group_id}")
def admin_delete_group(
    group_id: UUID,
    authorization: str | None = Header(default=None),
):
    _groups_management_removed()


@app.get("/admin/groups/{group_id}/members")
def admin_group_members(
    group_id: UUID,
    authorization: str | None = Header(default=None),
):
    _groups_management_removed()


@app.put("/admin/groups/{group_id}/members")
def admin_set_group_members(
    group_id: UUID,
    payload: AdminGroupMembersUpdate,
    authorization: str | None = Header(default=None),
):
    _groups_management_removed()

@app.post("/admin/slot-weeks/preview")
def admin_preview_slot_week(
    payload: SlotWeekPreviewRequest,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    week_start = payload.week_start

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            template_id = _resolve_slot_template_id(cur, payload.template_id)
            cur.execute(
                """
                SELECT id, name
                FROM slot_templates
                WHERE id = %s
                """,
                (template_id,),
            )
            template_row = cur.fetchone()
            item_rows = _load_slot_template_items(cur, template_id)

    if not item_rows:
        raise HTTPException(status_code=400, detail="Das gewaehlte Slot-Template enthaelt keine Standardslots")

    week_end = week_start + timedelta(days=max(int(row[5]) for row in item_rows))
    slots = []
    for row in item_rows:
        slot_date = week_start + timedelta(days=int(row[5]))
        slots.append(
            {
                "template_item_id": str(row[0]),
                "slot_date": slot_date.isoformat(),
                "weekday": row[2],
                "slot_code": row[3],
                "slot_order": int(row[4]),
                "start_time": str(row[6]) if row[6] else None,
                "end_time": str(row[7]) if row[7] else None,
                "open_end": bool(row[8]),
            }
        )

    return {
        "template_id": str(template_row[0]) if template_row else None,
        "template_name": template_row[1] if template_row else None,
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "slots": slots,
    }
    
@app.post("/admin/slot-weeks/create")
def admin_create_slot_week(
    payload: SlotWeekCreateRequest,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    created_slots = []

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            for slot in payload.slots:
                cur.execute(
                    """
                    INSERT INTO duty_slots (
                        id,
                        slot_date,
                        weekday,
                        slot_code,
                        start_time,
                        end_time,
                        open_end,
                        template_item_id
                    )
                    VALUES (
                        gen_random_uuid(),
                        %s,
                        %s,
                        %s,
                        %s::time,
                        %s::time,
                        %s,
                        %s
                    )
                    RETURNING id
                    """,
                    (
                        slot.slot_date,
                        slot.weekday,
                        slot.slot_code,
                        slot.start_time,
                        slot.end_time,
                        slot.open_end,
                        slot.template_item_id,
                    ),
                )
                created_slots.append(str(cur.fetchone()[0]))

            conn.commit()

    return {
        "ok": True,
        "template_id": str(payload.template_id) if payload.template_id else None,
        "week_start": payload.week_start.isoformat(),
        "week_end": payload.week_end.isoformat(),
        "created_slot_ids": created_slots,
    }   
    
@app.get("/admin/slots/{slot_id}/participants")
def admin_slot_participants(
    slot_id: UUID,
    authorization: str | None = Header(default=None),
):
    scope = _resolve_actor_scope(authorization)
    ensure_direct_slot_assignment_schema()
    if not scope["is_admin"]:
        with psycopg.connect(DB_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM slot_assignments sa
                        WHERE sa.slot_id = %s
                          AND sa.user_id = %s::uuid
                    )
                    """,
                    (slot_id, scope["principal"]["id"]),
                )
                is_allowed = cur.fetchone()[0]

        if not is_allowed:
            raise HTTPException(status_code=403, detail="Slot liegt nicht im eigenen Präsenzdienst-Scope")

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    s.id,
                    s.slot_code,
                    s.slot_date
                FROM duty_slots s
                WHERE s.id = %s
                """,
                (slot_id,),
            )
            slot_row = cur.fetchone()

            if not slot_row:
                raise HTTPException(status_code=404, detail="Slot not found")

            cur.execute(
                """
                SELECT
                    u.id,
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.role,
                    sa.assignment_type
                FROM users u
                LEFT JOIN slot_assignments sa
                  ON sa.slot_id = %s
                 AND sa.user_id = u.id
                WHERE COALESCE(u.is_active, true) = true
                  AND COALESCE(u.is_mdb, false) = true
                ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST, u.email
                """,
                (slot_id,),
            )
            users = cur.fetchall()

    return {
        "slot": {
            "id": str(slot_row[0]),
            "slot_code": slot_row[1],
            "slot_date": slot_row[2].isoformat() if slot_row[2] else None,
        },
        "participants": [
            {
                "id": str(r[0]),
                "email": r[1],
                "first_name": r[2],
                "last_name": r[3],
                "role": r[4],
                "assignment_type": _normalise_assignment_type(r[5]) if r[5] else None,
                "is_effectively_assigned": bool(r[5]),
            }
            for r in users
        ],
    }
    
@app.post("/admin/slots/{slot_id}/participants/add")
def admin_add_slot_participant(
    slot_id: UUID,
    payload: SlotAssignmentUpsert,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM duty_slots WHERE id = %s", (slot_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Slot not found")

            cur.execute(
                """
                SELECT role, COALESCE(is_active, true), COALESCE(is_mdb, false)
                FROM users
                WHERE id = %s
                """,
                (payload.user_id,),
            )
            user_row = cur.fetchone()
            if not user_row:
                raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
            if not bool(user_row[2]):
                raise HTTPException(status_code=400, detail="Nutzer kann keinem Slot zugewiesen werden")
            if not bool(user_row[1]):
                raise HTTPException(status_code=400, detail="Inaktiver Nutzer kann keinem Slot zugewiesen werden")

            _upsert_slot_assignment(
                cur,
                slot_id,
                payload.user_id,
                payload.assignment_type,
                source="manual",
            )
            conn.commit()

    return {"ok": True}

@app.post("/admin/slots/{slot_id}/participants/remove")
def admin_remove_slot_participant(
    slot_id: UUID,
    payload: SlotParticipantOverrideRemove,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM duty_slots WHERE id = %s", (slot_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Slot not found")

            _delete_slot_assignment(cur, slot_id, payload.user_id)
            conn.commit()

    return {"ok": True}

@app.delete("/admin/slots/{slot_id}/participants/{user_id}/override")
def admin_clear_slot_participant_override(
    slot_id: UUID,
    user_id: UUID,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_direct_slot_assignment_schema()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            _delete_slot_assignment(cur, slot_id, user_id)
            conn.commit()

    return {"ok": True}


@app.get("/documents")
def list_documents(authorization: str | None = Header(default=None)):
    user = get_current_user_from_firebase(authorization)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    d.id,
                    d.title,
                    d.filename_original,
                    d.mime_type,
                    d.category,
                    d.created_at
                FROM documents d
                JOIN document_recipients r
                  ON r.document_id = d.id
                WHERE r.user_id = %s
                ORDER BY d.created_at DESC
                """,
                (user["id"],),
            )
            rows = cur.fetchall()

    return [
        {
            "id": str(r[0]),
            "title": r[1],
            "filename": r[2],
            "mime_type": r[3],
            "category": r[4],
            "created_at": r[5].isoformat(),
        }
        for r in rows
    ]


@app.get("/admin/documents")
def admin_list_documents(authorization: str | None = Header(default=None)):
    require_admin(authorization)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    d.id,
                    d.title,
                    d.filename_original,
                    d.mime_type,
                    d.category,
                    d.created_at,
                    d.uploaded_by_user_id,
                    COALESCE(u.first_name, '') || CASE
                        WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL THEN ' '
                        ELSE ''
                    END || COALESCE(u.last_name, '') AS uploaded_by_name,
                    COUNT(r.user_id) AS recipient_count
                FROM documents d
                LEFT JOIN users u
                  ON u.id = d.uploaded_by_user_id
                LEFT JOIN document_recipients r
                  ON r.document_id = d.id
                GROUP BY
                    d.id,
                    d.title,
                    d.filename_original,
                    d.mime_type,
                    d.category,
                    d.created_at,
                    d.uploaded_by_user_id,
                    u.first_name,
                    u.last_name
                ORDER BY d.created_at DESC
                """
            )
            rows = cur.fetchall()

    return [
        {
            "id": str(r[0]),
            "title": r[1],
            "filename": r[2],
            "mime_type": r[3],
            "category": r[4],
            "created_at": r[5].isoformat() if r[5] else None,
            "uploaded_by_user_id": str(r[6]) if r[6] else None,
            "uploaded_by_name": (r[7] or "").strip() or None,
            "recipient_count": int(r[8] or 0),
        }
        for r in rows
    ]


@app.delete("/admin/documents/{doc_id}")
def admin_delete_document(
    doc_id: UUID,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT stored_filename
                FROM documents
                WHERE id = %s
                """,
                (doc_id,),
            )
            row = cur.fetchone()

            if not row:
                raise HTTPException(status_code=404, detail="Document not found")

            stored_filename = row[0]

            cur.execute(
                "DELETE FROM document_recipients WHERE document_id = %s",
                (doc_id,),
            )
            cur.execute(
                "DELETE FROM documents WHERE id = %s",
                (doc_id,),
            )
        conn.commit()

    if stored_filename:
        file_path = os.path.join(UPLOAD_DIR, stored_filename)
        if os.path.exists(file_path):
            os.remove(file_path)

    return {"ok": True, "deleted_document_id": str(doc_id)}
    
@app.get("/documents/{doc_id}/download")
def download_document(doc_id: UUID, authorization: str | None = Header(default=None)):
    user = get_current_user_from_firebase(authorization)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.stored_filename, d.filename_original, d.mime_type
                FROM documents d
                JOIN document_recipients r
                  ON r.document_id = d.id
                WHERE d.id = %s AND r.user_id = %s
                """,
                (doc_id, user["id"]),
            )
            row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404)

    file_path = os.path.join(UPLOAD_DIR, row[0])
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Document file not found")

    return FileResponse(
        file_path,
        filename=row[1],
        media_type=row[2] or "application/octet-stream",
    )


def _quick_info_topics_query(include_inactive: bool = False):
    return (
        """
        SELECT
            t.id,
            t.title,
            t.slug,
            t.sort_order,
            t.is_active,
            COALESCE(
                json_agg(
                    json_build_object(
                        'id', b.id,
                        'bullet_text', b.bullet_text,
                        'sort_order', b.sort_order
                    )
                    ORDER BY b.sort_order ASC, b.created_at ASC
                ) FILTER (WHERE b.id IS NOT NULL),
                '[]'::json
            ) AS bullets
        FROM quick_info_topics t
        LEFT JOIN quick_info_bullets b
          ON b.topic_id = t.id
        """
        + ("" if include_inactive else " WHERE t.is_active = true ")
        + """
        GROUP BY t.id, t.title, t.slug, t.sort_order, t.is_active
        ORDER BY t.sort_order ASC, t.created_at ASC
        """
    )


@app.get("/quick-infos")
def list_quick_infos():
    ensure_quick_info_tables()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(_quick_info_topics_query())
            rows = cur.fetchall()

    return [
        {
            "id": str(r[0]),
            "title": r[1],
            "slug": r[2],
            "sort_order": int(r[3] or 0),
            "is_active": bool(r[4]),
            "bullets": [
                {
                    "id": str(item["id"]),
                    "bullet_text": item["bullet_text"],
                    "sort_order": int(item["sort_order"] or 0),
                }
                for item in (r[5] or [])
            ],
        }
        for r in rows
    ]


@app.get("/admin/quick-infos/topics")
def admin_list_quick_info_topics(authorization: str | None = Header(default=None)):
    require_admin(authorization)
    ensure_quick_info_tables()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(_quick_info_topics_query(include_inactive=True))
            rows = cur.fetchall()

    return [
        {
            "id": str(r[0]),
            "title": r[1],
            "slug": r[2],
            "sort_order": int(r[3] or 0),
            "is_active": bool(r[4]),
            "bullets": [
                {
                    "id": str(item["id"]),
                    "bullet_text": item["bullet_text"],
                    "sort_order": int(item["sort_order"] or 0),
                }
                for item in (r[5] or [])
            ],
        }
        for r in rows
    ]


@app.post("/admin/quick-infos/topics")
def admin_create_quick_info_topic(
    payload: QuickInfoTopicCreate,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_quick_info_tables()

    slug = (payload.slug or "").strip() or None

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO quick_info_topics (title, slug, sort_order, is_active)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (payload.title, slug, payload.sort_order, payload.is_active),
            )
            topic_id = cur.fetchone()[0]
            conn.commit()

    return {"ok": True, "id": str(topic_id)}


@app.patch("/admin/quick-infos/topics/{topic_id}")
def admin_update_quick_info_topic(
    topic_id: UUID,
    payload: QuickInfoTopicUpdate,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_quick_info_tables()

    sets = []
    values = []

    if payload.title is not None:
        sets.append("title = %s")
        values.append(payload.title)
    if payload.slug is not None:
        sets.append("slug = %s")
        values.append((payload.slug or "").strip() or None)
    if payload.sort_order is not None:
        sets.append("sort_order = %s")
        values.append(payload.sort_order)
    if payload.is_active is not None:
        sets.append("is_active = %s")
        values.append(payload.is_active)

    if not sets:
        return {"ok": True}

    values.append(topic_id)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE quick_info_topics
                SET {", ".join(sets)},
                    updated_at = now()
                WHERE id = %s
                """,
                values,
            )
            conn.commit()

    return {"ok": True}


@app.delete("/admin/quick-infos/topics/{topic_id}")
def admin_delete_quick_info_topic(
    topic_id: UUID,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_quick_info_tables()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM quick_info_topics WHERE id = %s",
                (topic_id,),
            )
            conn.commit()

    return {"ok": True}


@app.get("/admin/quick-infos/topics/{topic_id}/bullets")
def admin_list_quick_info_bullets(
    topic_id: UUID,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_quick_info_tables()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, bullet_text, sort_order
                FROM quick_info_bullets
                WHERE topic_id = %s
                ORDER BY sort_order ASC, created_at ASC
                """,
                (topic_id,),
            )
            rows = cur.fetchall()

    return [
        {
            "id": str(r[0]),
            "bullet_text": r[1],
            "sort_order": int(r[2] or 0),
        }
        for r in rows
    ]


@app.post("/admin/quick-infos/topics/{topic_id}/bullets")
def admin_create_quick_info_bullet(
    topic_id: UUID,
    payload: QuickInfoBulletCreate,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_quick_info_tables()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO quick_info_bullets (topic_id, bullet_text, sort_order)
                VALUES (%s, %s, %s)
                RETURNING id
                """,
                (topic_id, payload.bullet_text, payload.sort_order),
            )
            bullet_id = cur.fetchone()[0]
            conn.commit()

    return {"ok": True, "id": str(bullet_id)}


@app.patch("/admin/quick-infos/bullets/{bullet_id}")
def admin_update_quick_info_bullet(
    bullet_id: UUID,
    payload: QuickInfoBulletUpdate,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_quick_info_tables()

    sets = []
    values = []

    if payload.bullet_text is not None:
        sets.append("bullet_text = %s")
        values.append(payload.bullet_text)
    if payload.sort_order is not None:
        sets.append("sort_order = %s")
        values.append(payload.sort_order)

    if not sets:
        return {"ok": True}

    values.append(bullet_id)

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE quick_info_bullets
                SET {", ".join(sets)},
                    updated_at = now()
                WHERE id = %s
                """,
                values,
            )
            conn.commit()

    return {"ok": True}


@app.delete("/admin/quick-infos/bullets/{bullet_id}")
def admin_delete_quick_info_bullet(
    bullet_id: UUID,
    authorization: str | None = Header(default=None),
):
    require_admin(authorization)
    ensure_quick_info_tables()

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM quick_info_bullets WHERE id = %s",
                (bullet_id,),
            )
            conn.commit()

    return {"ok": True}
