from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import timedelta

from .time_utils import parse_iso, to_iso, utc_now


@dataclass
class TemporalResult:
    reconfirm_due_ids: list[str]
    resolved_unconfirmed_count: int
    inference_expired_count: int
    stale_health_signal_count: int


class TemporalLifecycleService:
    RECONFIRM_HOURS = 48
    AUTO_RESOLVE_DAYS = 7
    INFERENCE_TTL_HOURS = 24

    def apply(self, conn: sqlite3.Connection, user_id: str) -> TemporalResult:
        now = utc_now()
        reconfirm_due: list[str] = []
        resolved_count = 0

        rows = conn.execute(
            """
            SELECT id, status, last_confirmed_at
            FROM symptom_states
            WHERE user_id = ?
            """,
            (user_id,),
        ).fetchall()

        for row in rows:
            last_confirmed = parse_iso(row["last_confirmed_at"])
            if not last_confirmed:
                continue

            elapsed = now - last_confirmed
            if row["status"] == "active" and elapsed >= timedelta(days=self.AUTO_RESOLVE_DAYS):
                conn.execute(
                    """
                    UPDATE symptom_states
                    SET status = 'resolved_unconfirmed', updated_at = ?
                    WHERE id = ?
                    """,
                    (to_iso(now), row["id"]),
                )
                resolved_count += 1
                continue

            if row["status"] == "active" and elapsed >= timedelta(hours=self.RECONFIRM_HOURS):
                reconfirm_due.append(row["id"])
                conn.execute(
                    """
                    UPDATE symptom_states
                    SET reconfirm_due_at = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (to_iso(now), to_iso(now), row["id"]),
                )

        expired_count = conn.execute(
            """
            UPDATE inferences
            SET status = 'expired', updated_at = ?
            WHERE user_id = ?
              AND status = 'active'
              AND expires_at <= ?
            """,
            (to_iso(now), user_id, to_iso(now)),
        ).rowcount

        stale_signals = conn.execute(
            """
            UPDATE health_signals
            SET stale = 1, updated_at = ?
            WHERE user_id = ?
              AND stale = 0
              AND stale_after <= ?
            """,
            (to_iso(now), user_id, to_iso(now)),
        ).rowcount

        return TemporalResult(
            reconfirm_due_ids=reconfirm_due,
            resolved_unconfirmed_count=resolved_count,
            inference_expired_count=expired_count,
            stale_health_signal_count=stale_signals,
        )
