from __future__ import annotations

import os
from datetime import date
from typing import Optional, Literal
from uuid import UUID

import psycopg
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel

import firebase_admin
from firebase_admin import messaging

app = FastAPI(title="SPD Präsenzdienst API (Dev)")

DB_URL = os.environ.get(
    "DATABASE_URL", "postgresql://spd_app:change_me_strong@localhost:5432/spd_dev"
)

# -----------------------------
# Firebase helpers (lazy init)
# -----------------------------
_firebase_app = None


def _get_firebase_app():
    """
    Initialisiert firebase_admin genau einmal.
    Erwartet GOOGLE_APPLICATION_CREDENTIALS als Env-Var.
    """
    global _firebase_app
    if _firebase_app is None:
        _firebase_app = firebase_admin.initialize_app()
    return _firebase_app


def send_push_to_tokens(
    tokens: list[str],
    title: str,
    body: str,
    data: dict[str, str],
) -> int:
    """
    Sendet Push an mehrere Tokens (FCM).
    Gibt Anzahl erfolgreich gesendeter Pushes zurück.

    Firebase Admin Python: send_multicast gibt es nicht mehr -> send_each_for_multicast.
    Max 500 Tokens pro Request, daher chunking.
    """
    if not tokens:
        return 0

    _get_firebase_app()

    # FCM erlaubt max. 500 Tokens pro Multicast-Request
    CHUNK_SIZE = 500
    success_total = 0

    for i in range(0, len(tokens), CHUNK_SIZE):
        chunk = tokens[i : i + CHUNK_SIZE]

        msg = messaging.MulticastMessage(
            tokens=chunk,
            notification=messaging.Notification(title=title, body=body),
            data=data,
        )

        # ✅ richtige API in neueren firebase-admin Versionen
        resp = messaging.send_each_for_multicast(msg)
        success_total += resp.success_count

    return success_total


def get_all_push_tokens() -> list[str]:
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT token FROM user_push_tokens;")
            return [r[0] for r in cur.fetchall()]


# -----------------------------
# Models
# -----------------------------
class ExchangeCreate(BaseModel):
    slot_id: UUID
    mode: Literal["SWAP", "TAKEOVER"]
    from_user_id: UUID
    # optional beim Erstellen (Tauschbörse = OPEN)
    to_user_id: Optional[UUID] = None


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


# -----------------------------
# Health
# -----------------------------
@app.get("/health")
def health():
    return {"status": "ok"}


# -----------------------------
# Me
# -----------------------------
@app.get("/me")
def get_me(email: str):
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, first_name, last_name, group_id, role
                FROM users
                WHERE email = %s
            """, (email,))
            row = cur.fetchone()

            if not row:
                raise HTTPException(status_code=404, detail="User not found")

            return {
                "id": str(row[0]),
                "first_name": row[1],
                "last_name": row[2],
                "group": str(row[3]),
                "role": row[4],
            }


# -----------------------------
# Push Token
# -----------------------------
@app.post("/users/push-token")
def upsert_push_token(payload: PushTokenUpsert):
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
def debug_tokens():
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
def debug_push(payload: DebugPush):
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
def create_pgf_message(payload: PGFMessageCreate):
    """
    PGF erstellt eine Mitteilung.
    (Dev: ohne Auth)
    """
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pgf_messages (sender_name, content, urgency)
                VALUES (%s, %s, %s)
                RETURNING id, created_at;
                """,
                (payload.sender_name, payload.content, payload.urgency),
            )
            msg_id, created_at = cur.fetchone()
        conn.commit()

    # Push senden (best effort)
    tokens = get_all_push_tokens()
    push_success = 0
    push_error = None

    try:
        push_success = send_push_to_tokens(
            tokens=tokens,
            title="Fraktions-Mitteilung",
            body=f"{payload.sender_name}: {payload.content}",
            data={
                "type": "pgf_message",
                "message_id": str(msg_id),
                "sender": payload.sender_name,
                "content": payload.content,
                "urgency": payload.urgency,
            },
        )
    except Exception as e:
        # kein harter Fehler: Nachricht ist ja gespeichert
        push_error = str(e)

    return {
        "id": str(msg_id),
        "created_at": created_at.isoformat(),
        "sender_name": payload.sender_name,
        "content": payload.content,
        "urgency": payload.urgency,
        "push": {"targets": len(tokens), "success": push_success, "error": push_error},
    }


@app.get("/messages")
def list_messages(
    user_id: UUID = Query(...),
    limit: int = Query(50, ge=1, le=500),
):
    """
    Liste der Mitteilungen (neueste zuerst).
    """
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, created_at, sender_name, content, urgency
                FROM pgf_messages m
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM pgf_message_hidden h
                    WHERE h.message_id = m.id
                      AND h.user_id = %s
                )
                ORDER BY created_at DESC
                LIMIT %s;
                """,
                (user_id, limit),
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
def latest_message():
    """
    Neueste Mitteilung (praktisch fürs Banner/Polling).
    """
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, created_at, sender_name, content, urgency
                FROM pgf_messages
                ORDER BY created_at DESC
                LIMIT 1;
                """
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
def unread_message_count(user_id: UUID = Query(...)):
    """
    Anzahl ungelesener Mitteilungen für einen Nutzer.
    """
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*)
                FROM pgf_messages m
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM pgf_message_reads r
                    WHERE r.message_id = m.id
                      AND r.user_id = %s
                );
                """,
                (user_id,),
            )
            (count,) = cur.fetchone()

    return {"unread_count": int(count)}


@app.post("/messages/{message_id}/read")
def mark_message_as_read(message_id: UUID, user_id: UUID = Query(...)):
    """
    Markiert eine Mitteilung für einen Nutzer als gelesen.
    """
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
def get_message_detail(message_id: UUID, user_id: UUID = Query(...)):
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, created_at, sender_name, content, urgency
                FROM pgf_messages m
                WHERE m.id = %s
                  AND NOT EXISTS (
                    SELECT 1
                    FROM pgf_message_hidden h
                    WHERE h.message_id = m.id
                      AND h.user_id = %s
                  );
                """,
                (message_id, user_id),
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
def hide_message_for_user(message_id: UUID, user_id: UUID = Query(...)):
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
def hide_all_messages_for_user(user_id: UUID = Query(...)):
    """
    Blendet alle Mitteilungen für einen Nutzer aus.
    """
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pgf_message_hidden (message_id, user_id)
                SELECT id, %s
                FROM pgf_messages
                ON CONFLICT (message_id, user_id) DO NOTHING;
                """,
                (user_id,),
            )
        conn.commit()

    return {"status": "ok"}

@app.post("/messages/read-all")
def mark_all_messages_as_read(user_id: UUID = Query(...)):
    """
    Markiert alle vorhandenen Mitteilungen für einen Nutzer als gelesen.
    """
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pgf_message_reads (message_id, user_id)
                SELECT m.id, %s
                FROM pgf_messages m
                ON CONFLICT (message_id, user_id) DO NOTHING;
                """,
                (user_id,),
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
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id, s.slot_date, s.slot_code, s.weekday, s.start_time, s.end_time, s.open_end,
                       (SELECT code FROM groups g WHERE g.id = s.base_group_id) AS base_group
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
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id, s.slot_date, s.slot_code, s.weekday, s.start_time, s.end_time, s.open_end,
                       (SELECT code FROM groups g WHERE g.id = s.base_group_id) AS base_group
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
    Achtung: basiert auf v_slot_participants (bereits unter Berücksichtigung bestätigter Tausche).
    """
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  p.user_id,
                  u.first_name,
                  u.last_name,
                  g.code AS group_code
                FROM v_slot_participants p
                JOIN users u ON u.id = p.user_id
                JOIN groups g ON g.id = u.group_id
                WHERE p.slot_id = %s
                ORDER BY u.last_name, u.first_name;
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
        }
        for r in rows
    ]
    
@app.get("/slots/{slot_id}/attendance")
def get_attendance(slot_id: str):
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT 
                    u.id,
                    u.first_name,
                    u.last_name,
                    EXISTS (
                        SELECT 1 FROM attendance_checks ac
                        WHERE ac.slot_id = %s AND ac.user_id = u.id
                    ) as checked
                FROM users u
                WHERE u.is_active = true
                ORDER BY u.last_name
            """, (slot_id,))
            
            rows = cur.fetchall()

            return [
                {
                    "id": str(r[0]),
                    "first_name": r[1],
                    "last_name": r[2],
                    "checked": r[3],
                }
                for r in rows
            ]


@app.post("/slots/{slot_id}/attendance/toggle")
def toggle_attendance(slot_id: str, payload: dict):
    user_id = payload.get("user_id")
    actor = payload.get("actor_user_id")

    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            # prüfen ob schon vorhanden
            cur.execute("""
                SELECT id FROM attendance_checks
                WHERE slot_id = %s AND user_id = %s
            """, (slot_id, user_id))
            
            existing = cur.fetchone()

            if existing:
                cur.execute("""
                    DELETE FROM attendance_checks
                    WHERE slot_id = %s AND user_id = %s
                """, (slot_id, user_id))
            else:
                cur.execute("""
                    INSERT INTO attendance_checks (slot_id, user_id, checked_by)
                    VALUES (%s, %s, %s)
                """, (slot_id, user_id, actor))

        conn.commit()

    return {"ok": True}

import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../profile/me_store.dart';

class AttendanceStatsPage extends StatefulWidget {
  const AttendanceStatsPage({super.key, required this.meStore});

  final MeStore meStore;

  @override
  State<AttendanceStatsPage> createState() => _AttendanceStatsPageState();
}

class _AttendanceStatsPageState extends State<AttendanceStatsPage> {
  final api = ApiClient(AppConfig.apiBaseUrl);
  late Future<List<Map<String, dynamic>>> future;

  @override
  void initState() {
    super.initState();
    future = load();
  }

  Future<List<Map<String, dynamic>>> load() async {
    final res = await api.getJson('/attendance/stats') as List<dynamic>;
    return res.map((e) => e as Map<String, dynamic>).toList();
  }

  Future<void> refresh() async {
    setState(() {
      future = load();
    });
    await future;
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.meStore.isPgf) {
      return const Scaffold(
        body: Center(child: Text('Kein Zugriff')),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Sitzungsdienst-Statistik')),
      body: FutureBuilder<List<Map<String, dynamic>>>(
        future: future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snap.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  'Fehler:\n${snap.error}',
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }

          final stats = snap.data ?? [];

          return RefreshIndicator(
            onRefresh: refresh,
            child: ListView.separated(
              itemCount: stats.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, i) {
                final s = stats[i];
                final name = '${s['first_name']} ${s['last_name']}';
                final count = s['done_count'];

                return ListTile(
                  leading: CircleAvatar(
                    child: Text('${i + 1}'),
                  ),
                  title: Text(name),
                  trailing: Text(
                    '$count',
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

@app.get("/me/slots")
def my_slots(
    user_id: UUID = Query(...),
    from_date: date = Query(..., alias="from"),
    to_date: date = Query(..., alias="to"),
):
    """
    Liefert Slots, in denen user_id tatsächlich Dienst hat:
    - Basisgruppe des Slots enthält user
    - bestätigte SWAP/TAKEOVER entfernen ihn ggf. und/oder fügen ihn hinzu
    (über v_slot_participants)
    """
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id, s.slot_date, s.slot_code, s.weekday, s.start_time, s.end_time, s.open_end,
                       (SELECT code FROM groups g WHERE g.id = s.base_group_id) AS base_group
                FROM duty_slots s
                WHERE s.slot_date BETWEEN %s AND %s
                  AND EXISTS (
                    SELECT 1
                    FROM v_slot_participants p
                    WHERE p.slot_id = s.id
                      AND p.user_id = %s
                  )
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
        }
        for r in rows
    ]


# -----------------------------
# Exchanges: Market + Me
# -----------------------------
@app.get("/market/exchanges")
def market_exchanges(user_id: UUID = Query(...)):
    """
    Offene Tauschangebote (OPEN, to_user_id IS NULL), die NICHT vom user_id stammen.
    """
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
                  bg.code AS base_group,

                  fu.id AS from_id,
                  fu.first_name AS from_first,
                  fu.last_name AS from_last,
                  fg.code AS from_group

                FROM exchanges e
                JOIN duty_slots s ON s.id = e.slot_id
                JOIN groups bg ON bg.id = s.base_group_id

                JOIN users fu ON fu.id = e.from_user_id
                JOIN groups fg ON fg.id = fu.group_id

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
):
    """
    Liefert alle Tausche, bei denen user_id beteiligt ist (from oder to).
    Optional: Filter per status.
    """
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
                  bg.code AS base_group,

                  fu.id AS from_id,
                  fu.first_name AS from_first,
                  fu.last_name AS from_last,
                  fg.code AS from_group,

                  tu.id AS to_id,
                  tu.first_name AS to_first,
                  tu.last_name AS to_last,
                  tg.code AS to_group,

                  e.from_confirmed_at,
                  e.to_confirmed_at

                FROM exchanges e
                JOIN duty_slots s ON s.id = e.slot_id
                JOIN groups bg ON bg.id = s.base_group_id

                JOIN users fu ON fu.id = e.from_user_id
                JOIN groups fg ON fg.id = fu.group_id

                LEFT JOIN users tu ON tu.id = e.to_user_id
                LEFT JOIN groups tg ON tg.id = tu.group_id

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
def my_pending_exchanges(user_id: UUID = Query(...)):
    """
    Dev-Endpunkt: Tausche, bei denen der Nutzer bestätigen muss.
    (Später ersetzen wir user_id durch Auth/JWT.)

    Hinweis: In eurem neuen UI bestätigt praktisch nur noch der Anbieter final,
    weil accept bereits to_confirmed_at setzt.
    """
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
def create_exchange(payload: ExchangeCreate):
    """
    Erstellt ein Tauschangebot.
    Optional kann to_user_id schon gesetzt sein (Direkttausch).
    """
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
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
def accept_exchange(exchange_id: UUID, payload: ExchangeAccept):
    """
    Nimmt ein Angebot an:
    - setzt to_user_id
    - setzt to_confirmed_at = NOW() (Übernehmer ist direkt bestätigt)
    - status -> PENDING_CONFIRMATION (oder CONFIRMED wenn Anbieter schon bestätigt)
    """
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
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
def confirm_exchange(exchange_id: UUID, payload: ExchangeConfirm):
    """
    Bestätigt einen Tausch als from_user oder to_user.
    Sobald beide bestätigt haben, setzt der DB-Trigger status=CONFIRMED.
    (In eurem neuen Workflow bestätigt praktisch nur noch from_user final.)
    """
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
                "SELECT status::text, confirmed_at FROM exchanges WHERE id = %s;",
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
def cancel_exchange(exchange_id: UUID, payload: ExchangeCancel):
    """
    Abbrechen durch from_user oder to_user, solange nicht confirmed.
    (Beibehaltung deiner Logik mit cancelled_at + cancel_reason)
    """
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
                       (SELECT code FROM groups g WHERE g.id = fu.group_id) AS from_group,
                       e.to_user_id,
                       tu.first_name, tu.last_name,
                       (SELECT code FROM groups g WHERE g.id = tu.group_id) AS to_group,
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
