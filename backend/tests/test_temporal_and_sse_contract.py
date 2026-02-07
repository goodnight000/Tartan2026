from __future__ import annotations

import json
from datetime import timedelta

from memory.time_utils import to_iso, utc_now
from sse_utils import parse_sse_events


def _chat_payload(message: str) -> dict:
    return {
        "message": message,
        "session_key": "session-user-a",
        "client_context": {"timezone": "America/New_York", "location_text": "Pittsburgh"},
    }


def test_chat_stream_sse_contract_token_message_action_plan(client, auth_headers):
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("Find a nearby lab for me."),
    )
    assert response.status_code == 200
    assert "text/event-stream" in response.headers.get("content-type", "")

    events = parse_sse_events(response.text)
    event_types = [event.get("event") for event in events]
    assert "token" in event_types
    assert "message" in event_types
    assert "action_plan" in event_types
    assert set(event_types).issubset({"token", "message", "action_plan", "error"})

    token_event = next(event for event in events if event.get("event") == "token")
    token_payload = json.loads(token_event["data"])
    assert "delta" in token_payload

    plan_event = next(event for event in events if event.get("event") == "action_plan")
    plan = json.loads(plan_event["data"])
    assert {"tier", "tool", "params", "consent_prompt"}.issubset(plan.keys())


def test_temporal_reconfirm_due_after_48h(client, auth_headers, backend_module):
    client.post(
        "/symptoms",
        headers=auth_headers("user-a"),
        json={"symptom_text": "cough", "severity": 3},
    )
    old_time = to_iso(utc_now() - timedelta(hours=49))
    with backend_module.container.db.connection() as conn:
        conn.execute(
            """
            UPDATE symptom_states
            SET last_confirmed_at = ?, updated_at = ?
            WHERE user_id = ?
            """,
            (old_time, old_time, "user-a"),
        )

    # Triggers lazy temporal evaluation.
    client.get("/profile", headers=auth_headers("user-a"))

    with backend_module.container.db.connection() as conn:
        row = conn.execute(
            """
            SELECT status, reconfirm_due_at
            FROM symptom_states
            WHERE user_id = ?
            LIMIT 1
            """,
            ("user-a",),
        ).fetchone()
    assert row is not None
    assert row["status"] == "active"
    assert row["reconfirm_due_at"] is not None


def test_temporal_auto_resolves_unconfirmed_after_7d(client, auth_headers, backend_module):
    client.post(
        "/symptoms",
        headers=auth_headers("user-a"),
        json={"symptom_text": "fatigue", "severity": 2},
    )
    old_time = to_iso(utc_now() - timedelta(days=8))
    with backend_module.container.db.connection() as conn:
        conn.execute(
            """
            UPDATE symptom_states
            SET last_confirmed_at = ?, status = 'active', updated_at = ?
            WHERE user_id = ?
            """,
            (old_time, old_time, "user-a"),
        )

    client.get("/profile", headers=auth_headers("user-a"))

    with backend_module.container.db.connection() as conn:
        row = conn.execute(
            """
            SELECT status
            FROM symptom_states
            WHERE user_id = ?
            LIMIT 1
            """,
            ("user-a",),
        ).fetchone()
    assert row is not None
    assert row["status"] == "resolved_unconfirmed"


def test_inference_ttl_expires_within_24h(client, auth_headers, backend_module):
    response = client.post(
        "/actions/execute",
        headers=auth_headers("user-a"),
        json={
            "plan": {
                "tier": 1,
                "tool": "clinical_profile_upsert",
                "params": {
                    "entity_type": "inference",
                    "operation": "create",
                    "payload": {
                        "id": "inf-test-1",
                        "inference_key": "recent_risk_signal",
                        "value": {"signal": "elevated"},
                        "expires_at": to_iso(utc_now() - timedelta(hours=1)),
                    },
                    "source": "model_inference",
                    "confidence": 0.4,
                },
            },
            "user_confirmed": True,
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "success"

    client.get("/profile", headers=auth_headers("user-a"))

    with backend_module.container.db.connection() as conn:
        row = conn.execute(
            """
            SELECT status
            FROM inferences
            WHERE id = ?
            """,
            ("inf-test-1",),
        ).fetchone()
    assert row is not None
    assert row["status"] == "expired"
