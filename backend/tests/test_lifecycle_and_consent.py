from __future__ import annotations

import json
from datetime import timedelta

from memory import canonical_payload_hash
from memory.time_utils import parse_iso, to_iso, utc_now


def _execute(client, headers, tool: str, params: dict, user_confirmed: bool = True):
    return client.post(
        "/actions/execute",
        headers=headers,
        json={
            "plan": {
                "tier": 2 if tool in {"appointment_book", "medical_purchase", "medication_refill_request"} else 1,
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


def test_appointment_book_defaults_to_live_mode_when_external_web_enabled(
    client, auth_headers, monkeypatch, backend_module
):
    monkeypatch.setenv("CAREPILOT_DISABLE_EXTERNAL_WEB", "false")
    monkeypatch.setattr(
        backend_module.container.toolset.browser_automation,
        "submit_appointment",
        lambda **_: {
            "status": "succeeded",
            "external_ref": "WEB-TEST-12345",
            "automation": {"title": "Booking Confirmation"},
        },
    )
    base_payload = {
        "provider_name": "Care Clinic",
        "slot_datetime": "2026-02-10T09:00:00Z",
        "location": "Pittsburgh",
        "booking_url": "https://example.com/book",
        "full_name": "Jane Doe",
        "email": "jane@example.com",
        "phone": "+14125551212",
        "idempotency_key": "idem-book-default-live",
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
    assert body["result"]["execution_mode"] == "live"
    assert body["result"]["confirmation_id"] == "WEB-TEST-12345"
    assert body["result"]["summary"] == "Booking confirmed"
    assert body["result"]["lifecycle"] == ["planned", "awaiting_confirmation", "executing", "succeeded"]


def test_medical_purchase_requires_consent_token(client, auth_headers):
    params = {
        "item_name": "at-home blood test kit",
        "quantity": 1,
        "purchase_url": "https://example.com/kit",
        "mode": "simulated",
        "idempotency_key": "idem-purchase-missing-token",
    }
    response = _execute(client, auth_headers("user-a"), "medical_purchase", params)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "failure"
    assert body["result"]["errors"][0]["code"] == "missing_consent_token"
    assert body["result"]["lifecycle"] == ["planned", "awaiting_confirmation", "blocked"]


def test_medical_purchase_succeeds_with_consent(client, auth_headers):
    base_payload = {
        "item_name": "at-home blood test kit",
        "quantity": 1,
        "purchase_url": "https://example.com/kit",
        "mode": "simulated",
        "idempotency_key": "idem-purchase-success",
    }
    payload_hash = canonical_payload_hash(base_payload)
    issue = _execute(
        client,
        auth_headers("user-a"),
        "consent_token_issue",
        {
            "action_type": "medical_purchase",
            "payload_hash": payload_hash,
            "expires_in_seconds": 300,
        },
    )
    assert issue.status_code == 200
    token = issue.json()["result"]["token"]

    response = _execute(
        client,
        auth_headers("user-a"),
        "medical_purchase",
        {**base_payload, "consent_token": token, "payload_hash": payload_hash},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["result"]["confirmation_id"].startswith("SIMPUR-")
    assert body["result"]["lifecycle"] == ["planned", "awaiting_confirmation", "executing", "succeeded"]


def test_appointment_book_persists_booking_defaults_key(client, auth_headers, backend_module):
    base_payload = {
        "provider_name": "Care Clinic",
        "slot_datetime": "2026-02-10T09:00:00Z",
        "location": "Pittsburgh",
        "mode": "simulated",
        "full_name": "Jane Doe",
        "email": "jane@example.com",
        "phone": "+14125551212",
        "idempotency_key": "idem-appointment-defaults-key",
    }
    payload_hash = canonical_payload_hash(base_payload)
    token = _execute(
        client,
        auth_headers("user-a"),
        "consent_token_issue",
        {
            "action_type": "appointment_book",
            "payload_hash": payload_hash,
            "expires_in_seconds": 300,
        },
    ).json()["result"]["token"]
    execute = _execute(
        client,
        auth_headers("user-a"),
        "appointment_book",
        {**base_payload, "consent_token": token, "payload_hash": payload_hash},
    )
    assert execute.status_code == 200
    assert execute.json()["status"] == "success"

    with backend_module.container.db.connection() as conn:
        booking_row = conn.execute(
            "SELECT value_json FROM conversation_preferences WHERE user_id = ? AND key = ? LIMIT 1",
            ("user-a", "appointment_booking_defaults"),
        ).fetchone()
        purchase_row = conn.execute(
            "SELECT value_json FROM conversation_preferences WHERE user_id = ? AND key = ? LIMIT 1",
            ("user-a", "medical_purchase_defaults"),
        ).fetchone()

    assert booking_row is not None
    booking_defaults = json.loads(booking_row["value_json"])
    assert booking_defaults["provider_name"] == "Care Clinic"
    assert booking_defaults["location"] == "Pittsburgh"
    assert purchase_row is None


def test_medical_purchase_persists_purchase_defaults_without_overwriting_booking_defaults(
    client, auth_headers, backend_module
):
    appointment_payload = {
        "provider_name": "Care Clinic",
        "slot_datetime": "2026-02-10T09:00:00Z",
        "location": "Pittsburgh",
        "mode": "simulated",
        "full_name": "Jane Doe",
        "email": "jane@example.com",
        "phone": "+14125551212",
        "idempotency_key": "idem-appointment-before-purchase",
    }
    appointment_hash = canonical_payload_hash(appointment_payload)
    appointment_token = _execute(
        client,
        auth_headers("user-a"),
        "consent_token_issue",
        {
            "action_type": "appointment_book",
            "payload_hash": appointment_hash,
            "expires_in_seconds": 300,
        },
    ).json()["result"]["token"]
    _execute(
        client,
        auth_headers("user-a"),
        "appointment_book",
        {**appointment_payload, "consent_token": appointment_token, "payload_hash": appointment_hash},
    )

    purchase_payload = {
        "item_name": "at-home blood test kit",
        "quantity": 1,
        "purchase_url": "https://example.com/kit",
        "mode": "simulated",
        "full_name": "Jane Buyer",
        "email": "buyer@example.com",
        "phone": "+14125550000",
        "idempotency_key": "idem-purchase-defaults-key",
    }
    purchase_hash = canonical_payload_hash(purchase_payload)
    purchase_token = _execute(
        client,
        auth_headers("user-a"),
        "consent_token_issue",
        {
            "action_type": "medical_purchase",
            "payload_hash": purchase_hash,
            "expires_in_seconds": 300,
        },
    ).json()["result"]["token"]
    execute = _execute(
        client,
        auth_headers("user-a"),
        "medical_purchase",
        {**purchase_payload, "consent_token": purchase_token, "payload_hash": purchase_hash},
    )
    assert execute.status_code == 200
    assert execute.json()["status"] == "success"

    with backend_module.container.db.connection() as conn:
        booking_row = conn.execute(
            "SELECT value_json FROM conversation_preferences WHERE user_id = ? AND key = ? LIMIT 1",
            ("user-a", "appointment_booking_defaults"),
        ).fetchone()
        purchase_row = conn.execute(
            "SELECT value_json FROM conversation_preferences WHERE user_id = ? AND key = ? LIMIT 1",
            ("user-a", "medical_purchase_defaults"),
        ).fetchone()

    assert booking_row is not None
    assert purchase_row is not None
    booking_defaults = json.loads(booking_row["value_json"])
    purchase_defaults = json.loads(purchase_row["value_json"])
    assert booking_defaults["provider_name"] == "Care Clinic"
    assert booking_defaults["location"] == "Pittsburgh"
    assert purchase_defaults["full_name"] == "Jane Buyer"
    assert purchase_defaults["email"] == "buyer@example.com"
    assert purchase_defaults["phone"] == "+14125550000"


def test_consent_token_issue_handles_non_numeric_expiry(client, auth_headers):
    response = _execute(
        client,
        auth_headers("user-a"),
        "consent_token_issue",
        {
            "action_type": "appointment_book",
            "payload_hash": "abc123",
            "expires_in_seconds": "not-a-number",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["result"]["token"]


def test_refill_remaining_pills_estimate_is_anchored_to_now(client, auth_headers):
    profile = {
        "conditions": [],
        "allergies": [],
        "meds": [
            {
                "id": "med_remaining_now",
                "name": "MedRemainingNow",
                "regimen_type": "daily",
                "quantity_dispensed": 30,
                "frequency_per_day": 1,
                "last_fill_date": "2025-01-01T00:00:00Z",
            }
        ],
        "preferences": {},
        "timezone": "UTC",
    }
    profile_response = client.post("/profile", headers=auth_headers("user-a"), json=profile)
    assert profile_response.status_code == 200

    action_payload = {
        "medication_name": "MedRemainingNow",
        "remaining_pills_reported": 10,
        "idempotency_key": "idem-refill-remaining-now",
    }
    payload_hash = canonical_payload_hash(action_payload)
    issue = _execute(
        client,
        auth_headers("user-a"),
        "consent_token_issue",
        {
            "action_type": "medication_refill_request",
            "payload_hash": payload_hash,
            "expires_in_seconds": 300,
        },
    )
    token = issue.json()["result"]["token"]
    execute = _execute(
        client,
        auth_headers("user-a"),
        "medication_refill_request",
        {**action_payload, "consent_token": token, "payload_hash": payload_hash},
    )
    assert execute.status_code == 200
    body = execute.json()
    assert body["status"] == "success"
    runout = parse_iso(body["result"]["runout_estimate"])
    assert runout is not None
    assert runout > utc_now()


def test_refill_monthly_default_interval_is_around_30_days(client, auth_headers):
    last_fill = utc_now() - timedelta(days=1)
    profile = {
        "conditions": [],
        "allergies": [],
        "meds": [
            {
                "id": "med_monthly_default",
                "name": "MedMonthlyDefault",
                "regimen_type": "monthly",
                "quantity_dispensed": 2,
                "frequency_per_day": 1,
                "last_fill_date": to_iso(last_fill),
            }
        ],
        "preferences": {},
        "timezone": "UTC",
    }
    profile_response = client.post("/profile", headers=auth_headers("user-a"), json=profile)
    assert profile_response.status_code == 200

    action_payload = {
        "medication_name": "MedMonthlyDefault",
        "idempotency_key": "idem-refill-monthly-default",
    }
    payload_hash = canonical_payload_hash(action_payload)
    issue = _execute(
        client,
        auth_headers("user-a"),
        "consent_token_issue",
        {
            "action_type": "medication_refill_request",
            "payload_hash": payload_hash,
            "expires_in_seconds": 300,
        },
    )
    token = issue.json()["result"]["token"]
    execute = _execute(
        client,
        auth_headers("user-a"),
        "medication_refill_request",
        {**action_payload, "consent_token": token, "payload_hash": payload_hash},
    )
    assert execute.status_code == 200
    body = execute.json()
    assert body["status"] == "success"
    runout = parse_iso(body["result"]["runout_estimate"])
    assert runout is not None
    assert (runout - utc_now()).days >= 45


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
