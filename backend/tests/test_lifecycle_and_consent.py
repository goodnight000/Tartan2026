from __future__ import annotations

from memory import canonical_payload_hash


def _execute(client, headers, tool: str, params: dict, user_confirmed: bool = True):
    return client.post(
        "/actions/execute",
        headers=headers,
        json={
            "plan": {
                "tier": 2 if tool in {"appointment_book", "medication_refill_request"} else 1,
                "tool": tool,
                "params": params,
                "consent_prompt": "Proceed?",
            },
            "user_confirmed": user_confirmed,
        },
    )


def test_action_execute_requires_user_confirmation(client, auth_headers):
    response = _execute(
        client,
        auth_headers("user-a"),
        "appointment_book",
        {
            "provider_name": "Care Clinic",
            "slot_datetime": "2026-02-10T09:00:00Z",
            "location": "Pittsburgh",
            "mode": "simulated",
            "idempotency_key": "idem-confirm-required",
        },
        user_confirmed=False,
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "User not confirmed"


def test_transactional_tool_requires_consent_token(client, auth_headers):
    params = {
        "provider_name": "Care Clinic",
        "slot_datetime": "2026-02-10T09:00:00Z",
        "location": "Pittsburgh",
        "mode": "simulated",
        "idempotency_key": "idem-missing-token",
    }
    response = _execute(client, auth_headers("user-a"), "appointment_book", params)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "failure"
    assert body["result"]["errors"][0]["code"] == "missing_consent_token"
    assert body["result"]["lifecycle"] == ["planned", "awaiting_confirmation", "blocked"]


def test_lifecycle_and_consent_token_enforced(client, auth_headers, backend_module):
    base_payload = {
        "provider_name": "Care Clinic",
        "slot_datetime": "2026-02-10T09:00:00Z",
        "location": "Pittsburgh",
        "mode": "simulated",
        "idempotency_key": "idem-book-success",
    }
    payload_hash = canonical_payload_hash(base_payload)

    issue = _execute(
        client,
        auth_headers("user-a"),
        "consent_token_issue",
        {
            "action_type": "appointment_book",
            "payload_hash": payload_hash,
            "expires_in_seconds": 300,
        },
    )
    assert issue.status_code == 200
    assert issue.json()["status"] == "success"
    token = issue.json()["result"]["token"]

    execute = _execute(
        client,
        auth_headers("user-a"),
        "appointment_book",
        {**base_payload, "consent_token": token, "payload_hash": payload_hash},
    )
    assert execute.status_code == 200
    body = execute.json()
    assert body["status"] == "success"
    assert body["result"]["confirmation_id"].startswith("SIM-")
    assert body["result"]["lifecycle"] == [
        "planned",
        "awaiting_confirmation",
        "executing",
        "succeeded",
    ]

    reuse = _execute(
        client,
        auth_headers("user-a"),
        "appointment_book",
        {
            **base_payload,
            "idempotency_key": "idem-book-reuse",
            "consent_token": token,
            "payload_hash": payload_hash,
        },
    )
    assert reuse.status_code == 200
    reuse_body = reuse.json()
    assert reuse_body["status"] == "failure"
    assert reuse_body["result"]["errors"][0]["code"] == "invalid_consent_token"

    with backend_module.container.db.connection() as conn:
        row = conn.execute(
            """
            SELECT lifecycle_json
            FROM action_audit
            WHERE user_id = ? AND action_type = 'appointment_book'
            ORDER BY started_at DESC
            LIMIT 1
            """,
            ("user-a",),
        ).fetchone()
    assert row is not None


def test_before_tool_call_emergency_blocks_transactional_action(client, auth_headers):
    base_payload = {
        "provider_name": "Care Clinic",
        "slot_datetime": "2026-02-10T09:00:00Z",
        "location": "Pittsburgh",
        "mode": "simulated",
        "reason": "chest pain and trouble breathing now",
        "idempotency_key": "idem-emergency-block",
    }
    payload_hash = canonical_payload_hash(base_payload)
    issue = _execute(
        client,
        auth_headers("user-a"),
        "consent_token_issue",
        {
            "action_type": "appointment_book",
            "payload_hash": payload_hash,
            "expires_in_seconds": 300,
        },
    )
    token = issue.json()["result"]["token"]

    response = _execute(
        client,
        auth_headers("user-a"),
        "appointment_book",
        {**base_payload, "consent_token": token, "payload_hash": payload_hash},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "failure"
    assert body["result"]["errors"][0]["code"] == "emergency_transaction_block"


def test_appointment_book_returns_pending_when_required_fields_missing(client, auth_headers, backend_module):
    base_payload = {
        "provider_name": "Care Clinic",
        "slot_datetime": "2026-02-10T09:00:00Z",
        "mode": "simulated",
        "idempotency_key": "idem-book-missing-fields",
    }
    payload_hash = canonical_payload_hash(base_payload)
    issue = _execute(
        client,
        auth_headers("user-a"),
        "consent_token_issue",
        {
            "action_type": "appointment_book",
            "payload_hash": payload_hash,
            "expires_in_seconds": 300,
        },
    )
    token = issue.json()["result"]["token"]

    response = _execute(
        client,
        auth_headers("user-a"),
        "appointment_book",
        {**base_payload, "consent_token": token, "payload_hash": payload_hash},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["result"]["missing_fields"] == ["location"]
    assert body["result"]["lifecycle"] == ["planned", "awaiting_confirmation", "executing", "pending"]

    # Pending outcomes should not consume consent token.
    with backend_module.container.db.connection() as conn:
        row = conn.execute(
            "SELECT used_at FROM consent_tokens WHERE token = ?",
            (token,),
        ).fetchone()
    assert row is not None
    assert row["used_at"] is None


def test_idempotent_replay_returns_original_result_payload(client, auth_headers):
    params = {
        "zip_or_geo": "Pittsburgh",
        "max_distance_miles": 10,
        "budget_cap": 120,
        "preferred_time_window": "next_available",
        "in_network_preference": "prefer_in_network",
        "idempotency_key": "idem-lab-discovery-replay",
    }
    first = _execute(client, auth_headers("user-a"), "lab_clinic_discovery", params)
    assert first.status_code == 200
    first_body = first.json()
    assert first_body["status"] == "success"
    assert first_body["result"]["items"]

    replay = _execute(client, auth_headers("user-a"), "lab_clinic_discovery", params)
    assert replay.status_code == 200
    replay_body = replay.json()
    assert replay_body["status"] == "success"
    assert replay_body["result"]["replayed"] is True
    assert replay_body["result"]["items"] == first_body["result"]["items"]


def test_payload_hash_mismatch_is_rejected_even_with_valid_token(client, auth_headers):
    base_payload = {
        "provider_name": "Care Clinic",
        "slot_datetime": "2026-02-10T09:00:00Z",
        "location": "Pittsburgh",
        "mode": "simulated",
        "idempotency_key": "idem-hash-mismatch-base",
    }
    base_hash = canonical_payload_hash(base_payload)

    issue = _execute(
        client,
        auth_headers("user-a"),
        "consent_token_issue",
        {
            "action_type": "appointment_book",
            "payload_hash": base_hash,
            "expires_in_seconds": 300,
        },
    )
    assert issue.status_code == 200
    token = issue.json()["result"]["token"]

    tampered = {
        **base_payload,
        "location": "New York",
        "idempotency_key": "idem-hash-mismatch-tampered",
        "consent_token": token,
        "payload_hash": base_hash,
    }
    execute = _execute(client, auth_headers("user-a"), "appointment_book", tampered)
    assert execute.status_code == 200
    body = execute.json()
    assert body["status"] == "failure"
    assert body["result"]["errors"][0]["code"] == "invalid_consent_token"


def test_actions_execute_uses_message_text_for_emergency_block(client, auth_headers):
    base_payload = {
        "provider_name": "Care Clinic",
        "slot_datetime": "2026-02-10T09:00:00Z",
        "location": "Pittsburgh",
        "mode": "simulated",
        "idempotency_key": "idem-message-emergency",
    }
    payload_hash = canonical_payload_hash(base_payload)
    issue = _execute(
        client,
        auth_headers("user-a"),
        "consent_token_issue",
        {
            "action_type": "appointment_book",
            "payload_hash": payload_hash,
            "expires_in_seconds": 300,
        },
    )
    token = issue.json()["result"]["token"]

    response = client.post(
        "/actions/execute",
        headers=auth_headers("user-a"),
        json={
            "plan": {
                "tier": 2,
                "tool": "appointment_book",
                "params": {
                    **base_payload,
                    "consent_token": token,
                    "payload_hash": payload_hash,
                },
                "consent_prompt": "Proceed?",
            },
            "user_confirmed": True,
            "message_text": "I have chest pain and trouble breathing now.",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "failure"
    assert body["result"]["errors"][0]["code"] == "emergency_transaction_block"


def test_actions_execute_rejects_invalid_session_key(client, auth_headers):
    response = client.post(
        "/actions/execute",
        headers=auth_headers("user-a"),
        json={
            "plan": {
                "tier": 1,
                "tool": "lab_clinic_discovery",
                "params": {
                    "zip_or_geo": "Pittsburgh",
                    "idempotency_key": "idem-session-scope-guard",
                },
                "consent_prompt": "Proceed?",
            },
            "user_confirmed": True,
            "session_key": "x" * 140,
        },
    )
    assert response.status_code == 400
    assert "session scope" in response.json()["detail"].lower()


def test_empty_bearer_header_requires_auth_when_anon_disabled(client):
    response = client.get("/logs/actions", headers={"Authorization": "Bearer "})
    assert response.status_code == 401
