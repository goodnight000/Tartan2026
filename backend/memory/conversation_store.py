from __future__ import annotations

import json
import uuid
from datetime import timedelta
from typing import Any

from .database import SQLiteMemoryDB
from .time_utils import to_iso, utc_now


def _json_dumps(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


class ConversationStore:
    def __init__(self, db: SQLiteMemoryDB) -> None:
        self._db = db

    def upsert_preference(
        self,
        *,
        user_id: str,
        key: str,
        value: dict[str, Any],
        source: str = "user_direct",
        confidence: float = 1.0,
    ) -> None:
        now = to_iso(utc_now())
        with self._db.connection() as conn:
            existing = conn.execute(
                """
                SELECT id
                FROM conversation_preferences
                WHERE user_id = ? AND key = ?
                LIMIT 1
                """,
                (user_id, key),
            ).fetchone()
            pref_id = existing["id"] if existing else uuid.uuid4().hex
            conn.execute(
                """
                INSERT INTO conversation_preferences (
                  id, user_id, key, value_json, source, confidence, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  value_json = excluded.value_json,
                  source = excluded.source,
                  confidence = excluded.confidence,
                  updated_at = excluded.updated_at
                """,
                (pref_id, user_id, key, _json_dumps(value), source, confidence, now, now),
            )

    def add_summary(
        self,
        *,
        user_id: str,
        session_key: str,
        summary_text: str,
        tags: list[str] | None = None,
    ) -> None:
        now = to_iso(utc_now())
        with self._db.connection() as conn:
            conn.execute(
                """
                INSERT INTO conversation_summaries (
                  id, user_id, session_key, summary_text, tags_json, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (uuid.uuid4().hex, user_id, session_key, summary_text, _json_dumps(tags or []), now, now),
            )

    def recall(
        self,
        *,
        user_id: str,
        session_key: str,
        query: str | None = None,
        lookback_days: int = 30,
        limit: int = 5,
    ) -> dict[str, Any]:
        lookback_start = to_iso(utc_now() - timedelta(days=max(1, lookback_days)))
        query_text = (query or "").strip().lower()
        params: list[Any] = [user_id, lookback_start]
        sql = """
            SELECT session_key, summary_text, tags_json, created_at
            FROM conversation_summaries
            WHERE user_id = ?
              AND created_at >= ?
        """
        if query_text:
            sql += " AND lower(summary_text) LIKE ?"
            params.append(f"%{query_text}%")
        sql += " ORDER BY CASE WHEN session_key = ? THEN 0 ELSE 1 END, created_at DESC LIMIT ?"
        params.extend([session_key, max(1, limit)])

        with self._db.connection() as conn:
            summaries = [
                {
                    "session_key": row["session_key"],
                    "summary_text": row["summary_text"],
                    "tags": json.loads(row["tags_json"]),
                    "created_at": row["created_at"],
                }
                for row in conn.execute(sql, tuple(params)).fetchall()
            ]
            preferences = [
                {
                    "key": row["key"],
                    "value": json.loads(row["value_json"]),
                    "source": row["source"],
                    "confidence": row["confidence"],
                    "updated_at": row["updated_at"],
                }
                for row in conn.execute(
                    """
                    SELECT key, value_json, source, confidence, updated_at
                    FROM conversation_preferences
                    WHERE user_id = ?
                    ORDER BY updated_at DESC
                    LIMIT 20
                    """,
                    (user_id,),
                ).fetchall()
            ]
        return {"summaries": summaries, "preferences": preferences}
