from __future__ import annotations

import json

from sse_utils import parse_sse_events


def _chat_payload(message: str, session_key: str = "session-user-a") -> dict:
    return {
        "message": message,
        "session_key": session_key,
        "history": [],
        "client_context": {"timezone": "America/New_York", "location_text": "Pittsburgh"},
    }


def _token_text(events: list[dict]) -> str:
    chunks: list[str] = []
    for event in events:
        if event.get("event") != "token":
            continue
        payload = json.loads(event["data"])
        chunks.append(payload.get("delta", ""))
    return "".join(chunks)


def test_chat_turn_writes_symptoms_to_memory(client, auth_headers):
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("I have a headache today and my skin hurts."),
    )
    assert response.status_code == 200

    events = parse_sse_events(response.text)
    text = _token_text(events).lower()
    assert "logged these symptoms" in text
    assert "headache" in text

    symptom_logs = client.get("/logs/symptoms", headers=auth_headers("user-a")).json()["items"]
    combined = " ".join(item.get("symptom_text", "") for item in symptom_logs).lower()
    assert "headache" in combined
    assert "skin pain" in combined


def test_chat_memory_query_reads_back_written_context(client, auth_headers):
    client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("I have dizziness and nausea."),
    )
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("What symptoms do you remember?"),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    text = _token_text(events).lower()
    assert "active symptoms" in text
    assert "dizziness" in text or "nausea" in text


def test_symptom_reply_includes_possible_causes_and_uncertainty(client, auth_headers):
    response = client.post(
        "/chat/stream",
        headers=auth_headers("user-a"),
        json=_chat_payload("I have headache, dizziness, and nausea."),
    )
    assert response.status_code == 200
    events = parse_sse_events(response.text)
    text = _token_text(events).lower()
    assert "possible causes" in text
    assert "can't diagnose" in text
    assert "not a diagnosis" in text
    assert "headache" in text
