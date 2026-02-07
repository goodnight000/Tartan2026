from __future__ import annotations

import json

from sse_utils import parse_sse_events


def _chat_payload(
    message: str,
    history: list[dict[str, str]] | None = None,
    *,
    location_text: str | None = "Pittsburgh",
) -> dict:
    payload = {
        "message": message,
        "session_key": "session-user-a",
        "history": history or [],
        "client_context": {"timezone": "America/New_York"},
    }
    if location_text is not None:
        payload["client_context"]["location_text"] = location_text
    return payload


def _execute_action(
    client,
    headers: dict[str, str],
    *,
    tool: str,
    params: dict,
    session_key: str = "session-user-a",
):
    return client.post(
        "/actions/execute",
        headers=headers,
        json={
            "plan": {
                "tier": 1,
                "tool": tool,
                "params": params,
                "consent_prompt": "Proceed?",
            },
            "user_confirmed": True,
            "session_key": session_key,
        },
    )


def _token_text(events: list[dict]) -> str:
    chunks: list[str] = []
    for event in events:
        if event.get("event") != "token":
            continue
        payload = json.loads(event["data"])
        chunks.append(payload.get("delta", ""))
    return "".join(chunks)


def _first_action_plan(events: list[dict]) -> dict | None:
    for event in events:
        if event.get("event") == "action_plan":
            return json.loads(event["data"])
    return None


def _has_action_plan(events: list[dict]) -> bool:
    return any(event.get("event") == "action_plan" for event in events)


def test_booking_intent_with_active_symptom_keeps_booking_continuity(client, auth_headers):
    client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("I have a headache."),
    )
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("can you help me book a blood test next week?"),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    text = _token_text(events).lower()
    assert "book" in text or "rank nearby labs" in text
    assert "active symptoms" not in text

    plan = _first_action_plan(events)
    assert plan is not None
    assert plan["tool"] == "lab_clinic_discovery"


def test_lab_discovery_requires_location_for_live_lookup(client, auth_headers):
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("can you help me book a blood test next week?", location_text=None),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    text = _token_text(events).lower()
    assert "need your location first" in text
    assert not _has_action_plan(events)


def test_lab_discovery_uses_location_in_user_message_when_context_missing(client, auth_headers):
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("find a blood test lab in Pittsburgh", location_text=None),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    plan = _first_action_plan(events)
    assert plan is not None
    assert plan["tool"] == "lab_clinic_discovery"
    assert "pittsburgh" in str(plan["params"]["zip_or_geo"]).lower()


def test_lab_discovery_accepts_city_state_location_format(client, auth_headers):
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("find a blood test lab in Pittsburgh, PA", location_text=None),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    plan = _first_action_plan(events)
    assert plan is not None
    assert plan["tool"] == "lab_clinic_discovery"
    assert "pittsburgh, pa" in str(plan["params"]["zip_or_geo"]).lower()


def test_zip_only_followup_after_location_prompt_creates_lab_discovery_action_plan(client, auth_headers):
    history = [
        {"role": "user", "content": "can you help me book a blood test next week?"},
        {
            "role": "assistant",
            "content": (
                "I can help book that using live nearby discovery, but I need your location first. "
                "Share your city or ZIP code, and I will find and rank real labs/clinics."
            ),
        },
    ]
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("15289", history=history, location_text=None),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    text = _token_text(events).lower()
    assert "find and rank nearby labs/clinics" in text
    plan = _first_action_plan(events)
    assert plan is not None
    assert plan["tool"] == "lab_clinic_discovery"
    assert str(plan["params"]["zip_or_geo"]) == "15289"


def test_followup_first_option_creates_booking_action_plan(client, auth_headers):
    history = [
        {"role": "user", "content": "can you help me book a blood test next week?"},
        {
            "role": "assistant",
            "content": (
                "Found 5 result(s):\n"
                "1. Quest Diagnostics — local area\n"
                "2. Riverside Clinic Lab — local area\n"
                "3. Labcorp Midtown — local area\n"
            ),
        },
    ]
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("first option looks good", history=history),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    text = _token_text(events).lower()
    assert "prepare a booking request" in text or "confirm" in text

    plan = _first_action_plan(events)
    assert plan is not None
    assert plan["tool"] == "appointment_book"
    assert "quest diagnostics" in plan["params"]["provider_name"].lower()


def test_followup_open_numeric_option_creates_booking_action_plan(client, auth_headers):
    history = [
        {"role": "user", "content": "can you help me book a blood test next week?"},
        {
            "role": "assistant",
            "content": (
                "Found 5 result(s):\n"
                "1. Quest Diagnostics — local area\n"
                "2. Riverside Clinic Lab — local area\n"
                "3. Labcorp Midtown — local area\n"
            ),
        },
    ]
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("open 1 is good", history=history),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    plan = _first_action_plan(events)
    assert plan is not None
    assert plan["tool"] == "appointment_book"
    assert "quest diagnostics" in plan["params"]["provider_name"].lower()


def test_booking_action_plan_mode_follows_external_web_flag(client, auth_headers, monkeypatch):
    history = [
        {"role": "user", "content": "can you help me book a blood test next week?"},
        {
            "role": "assistant",
            "content": json.dumps(
                {
                    "result": {
                        "items": [
                            {
                                "name": "Quest Diagnostics",
                                "address": "Pittsburgh",
                                "source_url": "https://example.com/booking",
                            },
                            {
                                "name": "Riverside Clinic Lab",
                                "address": "Pittsburgh",
                                "source_url": "https://example.com/riverside",
                            },
                        ]
                    }
                }
            ),
        },
    ]
    monkeypatch.setenv("CAREPILOT_DISABLE_EXTERNAL_WEB", "false")
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload(
            "first option looks good. my name is Jane Doe. email jane@example.com phone 4125551212",
            history=history,
        ),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    plan = _first_action_plan(events)
    assert plan is not None
    assert plan["tool"] == "appointment_book"
    assert str(plan["params"]["mode"]) == "live"


def test_medical_purchase_intent_builds_action_plan(client, auth_headers):
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("buy a medical test kit from https://example.com/kit"),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    plan = _first_action_plan(events)
    assert plan is not None
    assert plan["tool"] == "medical_purchase"
    assert "kit" in plan["params"]["item_name"].lower()
    assert str(plan["params"]["purchase_url"]).startswith("https://")


def test_followup_option_sanitizes_invalid_location_label(client, auth_headers):
    history = [
        {"role": "user", "content": "can you help me book a blood test next week?"},
        {
            "role": "assistant",
            "content": (
                "Found 5 result(s):\n"
                "1. Quest Diagnostics — hello\n"
                "2. Riverside Clinic Lab — hello\n"
            ),
        },
    ]
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("first option", history=history),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    plan = _first_action_plan(events)
    assert plan is not None
    assert plan["tool"] == "appointment_book"
    assert "hello" not in plan["params"]["location"].lower()
    assert "local area" in plan["params"]["location"].lower()


def test_greeting_after_location_prompt_does_not_trigger_lab_discovery(client, auth_headers):
    history = [
        {"role": "user", "content": "can you help me book a blood test next week?"},
        {
            "role": "assistant",
            "content": (
                "I can help book that using live nearby discovery, but I need your location first. "
                "Share your city or ZIP code, and I will find and rank real labs/clinics."
            ),
        },
    ]
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("hello", history=history, location_text=None),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    text = _token_text(events).lower()
    assert "city or zip" in text
    assert not _has_action_plan(events)


def test_off_topic_message_clears_active_booking_draft(client, auth_headers):
    client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("Can you book an appointment for me?"),
    )
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("I don't feel too good"),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    text = _token_text(events).lower()
    assert "which provider to book with" not in text


def test_hello_clears_active_booking_draft(client, auth_headers):
    client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("Can you book an appointment for me?"),
    )
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("hello"),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    text = _token_text(events).lower()
    assert "which provider to book with" not in text


def test_chat_stream_uses_llm_reply_path_when_available(client, auth_headers, backend_module, monkeypatch):
    def fake_llm_reply(**_: dict) -> str:
        return "This came from the live LLM path."

    monkeypatch.setattr(backend_module, "_llm_chat_reply", fake_llm_reply)
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("hello"),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    text = _token_text(events)
    assert "live LLM path" in text


def test_chat_stream_can_use_anthropic_provider_path(client, auth_headers, backend_module, monkeypatch):
    monkeypatch.setattr(
        backend_module,
        "_chat_provider_candidates",
        lambda: [{"provider": "anthropic", "base_url": "https://api.anthropic.com/v1", "api_key": "k", "model": "m"}],
    )
    monkeypatch.setattr(
        backend_module,
        "_anthropic_chat",
        lambda **_: "This came from Anthropic Claude.",
    )
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("how are you"),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    text = _token_text(events)
    assert "Anthropic Claude" in text


def test_followup_first_option_uses_session_memory_when_history_missing(client, auth_headers):
    discovery = _execute_action(
        client,
        auth_headers("user-a"),
        tool="lab_clinic_discovery",
        params={
            "zip_or_geo": "Pittsburgh",
            "max_distance_miles": 10,
            "budget_cap": 120,
            "preferred_time_window": "next_available",
            "in_network_preference": "prefer_in_network",
            "idempotency_key": "idem-lab-for-followup",
        },
        session_key="session-user-a",
    )
    assert discovery.status_code == 200
    first_result = discovery.json()
    assert first_result["status"] == "success"
    first_name = first_result["result"]["items"][0]["name"].lower()

    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("first option looks good", history=[]),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    plan = _first_action_plan(events)
    assert plan is not None
    assert plan["tool"] == "appointment_book"
    assert first_name in plan["params"]["provider_name"].lower()


def test_booking_slot_fill_prompts_for_missing_fields(client, auth_headers):
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("Can you book an appointment for me?"),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    text = _token_text(events).lower()
    assert "which lab/clinic" in text
    assert "what day and time" in text
    assert not _has_action_plan(events)


def test_booking_slot_fill_completes_after_user_provides_missing_fields(client, auth_headers):
    client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("Can you book an appointment for me?"),
    )

    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("Book with City Health Lab on Friday morning in Pittsburgh."),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    plan = _first_action_plan(events)
    assert plan is not None
    assert plan["tool"] == "appointment_book"
    assert "city health lab" in plan["params"]["provider_name"].lower()
    assert "pittsburgh" in plan["params"]["location"].lower()
    assert plan["params"]["slot_datetime"]


def test_booking_location_omits_temporal_suffix_from_user_message(client, auth_headers):
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload(
            (
                "Book Quest Diagnostics in Pittsburgh next Tuesday at 9am. "
                "Booking URL is https://example.com/booking. "
                "My name is Jane Doe. Email jane@example.com. Phone 4125551212."
            )
        ),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    plan = _first_action_plan(events)
    assert plan is not None
    assert plan["tool"] == "appointment_book"
    location = str(plan["params"]["location"]).lower()
    assert "pittsburgh" in location
    assert "next" not in location
    assert "am" not in location


def test_booking_slot_fill_can_be_cancelled(client, auth_headers):
    client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("Can you book an appointment for me?"),
    )
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("Never mind, cancel that booking."),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    text = _token_text(events).lower()
    assert "cancelled" in text
    assert not _has_action_plan(events)


def test_booking_defaults_reused_for_future_booking_turns(client, auth_headers):
    client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("Can you book an appointment for me?"),
    )
    client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("Book with City Health Lab on Friday morning in Pittsburgh."),
    )
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("Book another appointment next week on Tuesday morning."),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    plan = _first_action_plan(events)
    assert plan is not None
    assert plan["tool"] == "appointment_book"
    assert "city health lab" in plan["params"]["provider_name"].lower()
    assert "pittsburgh" in plan["params"]["location"].lower()


def test_booking_draft_is_session_scoped(client, auth_headers):
    client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json={
            "message": "Can you book an appointment for me?",
            "session_key": "session-a",
            "history": [],
            "client_context": {"timezone": "America/New_York", "location_text": "Pittsburgh"},
        },
    )
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json={
            "message": "Book it tomorrow morning.",
            "session_key": "session-b",
            "history": [],
            "client_context": {"timezone": "America/New_York", "location_text": "Pittsburgh"},
        },
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    text = _token_text(events).lower()
    assert "which lab/clinic should i book with" in text
    assert not _has_action_plan(events)


def test_booking_defaults_do_not_leak_across_sessions(client, auth_headers):
    client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json={
            "message": "Can you book an appointment for me?",
            "session_key": "session-a",
            "history": [],
            "client_context": {"timezone": "America/New_York", "location_text": "Pittsburgh"},
        },
    )
    client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json={
            "message": "Book with City Health Lab on Friday morning in Pittsburgh.",
            "session_key": "session-a",
            "history": [],
            "client_context": {"timezone": "America/New_York", "location_text": "Pittsburgh"},
        },
    )

    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json={
            "message": "Book another appointment next week on Tuesday morning.",
            "session_key": "session-b",
            "history": [],
            "client_context": {"timezone": "America/New_York", "location_text": "Pittsburgh"},
        },
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    text = _token_text(events).lower()
    assert "which lab/clinic" in text
    assert not _has_action_plan(events)
