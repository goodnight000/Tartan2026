from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass
from typing import Any

from memory.database import SQLiteMemoryDB
from memory.time_utils import to_iso, utc_now


@dataclass
class ActionRecord:
    action_id: str
    status: str
    lifecycle: list[str]
    result_json: dict[str, Any] | None = None
    replayed: bool = False


class LifecycleError(Exception):
    pass


class ActionLifecycleService:
    _TRANSITIONS = {
        "planned": {"awaiting_confirmation", "executing", "blocked", "failed"},
        "awaiting_confirmation": {"executing", "expired", "blocked", "failed"},
        "executing": {"succeeded", "failed", "partial", "blocked", "expired", "pending"},
        "pending": {"succeeded", "failed", "partial", "blocked", "expired"},
        "succeeded": set(),
        "failed": set(),
        "partial": set(),
        "blocked": set(),
        "expired": set(),
    }

    def __init__(self, db: SQLiteMemoryDB) -> None:
        self._db = db

    def _replay_bucket(self) -> str:
        now = utc_now()
        return now.strftime("%Y-%m-%dT%H")

    def start(
        self,
        *,
        user_id: str,
        session_key: str,
        action_type: str,
        payload_hash: str,
        payload_json: dict[str, Any],
        idempotency_key: str,
        consent_token: str | None,
    ) -> ActionRecord:
        now = to_iso(utc_now())
        action_id = uuid.uuid4().hex
        lifecycle = ["planned"]
        payload_blob = json.dumps(payload_json, sort_keys=True, separators=(",", ":"))
        replay_bucket = self._replay_bucket()

        with self._db.connection() as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO action_audit (
                      id, user_id, session_key, action_type, payload_hash, payload_json,
                      idempotency_key, replay_window_bucket, consent_token, consent_snapshot_json,
                      status, lifecycle_json, result_json, error_code, error_message,
                      started_at, finished_at, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, ?)
                    """,
                    (
                        action_id,
                        user_id,
                        session_key,
                        action_type,
                        payload_hash,
                        payload_blob,
                        idempotency_key,
                        replay_bucket,
                        consent_token,
                        json.dumps({"token_present": bool(consent_token)}),
                        "planned",
                        json.dumps(lifecycle),
                        now,
                        now,
                        now,
                    ),
                )
                return ActionRecord(
                    action_id=action_id,
                    status="planned",
                    lifecycle=lifecycle,
                    result_json=None,
                    replayed=False,
                )
            except sqlite3.IntegrityError:
                row = conn.execute(
                    """
                    SELECT id, status, lifecycle_json, result_json
                    FROM action_audit
                    WHERE user_id = ? AND idempotency_key = ? AND replay_window_bucket = ?
                    LIMIT 1
                    """,
                    (user_id, idempotency_key, replay_bucket),
                ).fetchone()
                if not row:
                    raise
                return ActionRecord(
                    action_id=row["id"],
                    status=row["status"],
                    lifecycle=json.loads(row["lifecycle_json"]),
                    result_json=json.loads(row["result_json"]) if row["result_json"] else None,
                    replayed=True,
                )

    def transition(
        self,
        *,
        action_id: str,
        next_state: str,
        result: dict[str, Any] | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> list[str]:
        with self._db.connection() as conn:
            row = conn.execute(
                "SELECT status, lifecycle_json FROM action_audit WHERE id = ?",
                (action_id,),
            ).fetchone()
            if not row:
                raise LifecycleError(f"Action not found: {action_id}")
            current = row["status"]
            lifecycle = json.loads(row["lifecycle_json"])
            allowed_next = self._TRANSITIONS.get(current, set())
            if next_state not in allowed_next:
                raise LifecycleError(f"Invalid transition: {current} -> {next_state}")

            lifecycle.append(next_state)
            now = to_iso(utc_now())
            finished_at = now if next_state in {"succeeded", "failed", "partial", "blocked", "expired"} else None
            conn.execute(
                """
                UPDATE action_audit
                SET status = ?,
                    lifecycle_json = ?,
                    result_json = COALESCE(?, result_json),
                    error_code = COALESCE(?, error_code),
                    error_message = COALESCE(?, error_message),
                    finished_at = COALESCE(?, finished_at),
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    next_state,
                    json.dumps(lifecycle),
                    json.dumps(result, sort_keys=True) if result is not None else None,
                    error_code,
                    error_message,
                    finished_at,
                    now,
                    action_id,
                ),
            )
            return lifecycle
