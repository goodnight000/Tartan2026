#!/usr/bin/env python3
from __future__ import annotations

import importlib
import io
import json
import os
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from carepilot_tools.web_automation import BrowserAutomationRunner


@dataclass
class CheckOutcome:
    name: str
    passed: bool
    points: int
    max_points: int
    evidence: str
    severity: str = "medium"
    issue: str | None = None


@dataclass
class RequirementOutcome:
    requirement_id: str
    title: str
    checks: list[CheckOutcome] = field(default_factory=list)

    @property
    def points(self) -> int:
        return sum(check.points for check in self.checks)

    @property
    def max_points(self) -> int:
        return sum(check.max_points for check in self.checks)

    @property
    def status(self) -> str:
        if self.points == self.max_points:
            return "PASS"
        if self.points == 0:
            return "FAIL"
        return "PARTIAL"


def _parse_sse_events(raw_text: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    current: dict[str, Any] = {}
    for raw_line in raw_text.splitlines():
        line = raw_line.strip("\r")
        if line.startswith("event: "):
            current["event"] = line[7:]
        elif line.startswith("data: "):
            current["data"] = line[6:]
        elif line == "" and current:
            events.append(current)
            current = {}
    if current:
        events.append(current)
    return events


def _first_event(events: list[dict[str, Any]], event_name: str) -> dict[str, Any] | None:
    for event in events:
        if event.get("event") != event_name:
            continue
        data = event.get("data")
        if isinstance(data, str):
            try:
                return json.loads(data)
            except json.JSONDecodeError:
                return {"raw": data}
    return None


def _chat_stream(
    client: TestClient,
    *,
    headers: dict[str, str],
    message: str,
    session_key: str,
    history: list[dict[str, str]] | None = None,
    location_text: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "message": message,
        "history": history or [],
        "session_key": session_key,
    }
    if location_text is not None:
        payload["client_context"] = {"timezone": "UTC", "location_text": location_text}
    with client.stream("POST", "/chat/stream", json=payload, headers=headers) as response:
        lines: list[str] = []
        for line in response.iter_lines():
            text = line.decode("utf-8") if isinstance(line, bytes) else str(line)
            lines.append(text)
    raw = "\n".join(lines) + "\n"
    events = _parse_sse_events(raw)
    return {
        "status_code": response.status_code,
        "events": events,
        "message": _first_event(events, "message"),
        "action_plan": _first_event(events, "action_plan"),
        "error": _first_event(events, "error"),
    }


def _check(name: str, passed: bool, *, points: int = 1, max_points: int = 1, evidence: str = "", severity: str = "medium", issue: str | None = None) -> CheckOutcome:
    return CheckOutcome(
        name=name,
        passed=passed,
        points=points if passed else 0,
        max_points=max_points,
        evidence=evidence,
        severity=severity,
        issue=issue if not passed else None,
    )


def run_benchmark() -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="carepilot-benchmark-") as tmpdir:
        db_path = str(Path(tmpdir) / "carepilot-benchmark.sqlite")
        os.environ["CAREPILOT_DB_PATH"] = db_path
        os.environ["ALLOW_ANON"] = "false"
        os.environ["CAREBASE_ONLY"] = "false"
        os.environ["CAREPILOT_DISABLE_EXTERNAL_WEB"] = "false"
        os.environ["CAREPILOT_WEB_TIMEOUT_SECONDS"] = "0.8"
        os.environ["CAREPILOT_BROWSER_TIMEOUT_MS"] = "3000"
        os.environ["CAREPILOT_BROWSER_MAX_STEPS"] = "1"
        os.environ["ANTHROPIC_API_KEY"] = ""
        os.environ["DEDALUS_API_KEY"] = ""
        os.environ["OPENROUTER_API_KEY"] = ""
        os.environ["OPENAI_API_KEY"] = ""
        if "main" in sys.modules:
            module = importlib.reload(sys.modules["main"])
        else:
            module = importlib.import_module("main")

        original_whisper = module._openai_whisper_transcribe
        original_doc_interpret = module._openai_document_interpret
        original_extract_document_text = module._extract_document_text

        module._openai_whisper_transcribe = lambda **_: {
            "transcript_text": "I have chest pain and trouble breathing.",
            "confidence": 0.91,
            "segments": [{"text": "I have chest pain and trouble breathing."}],
        }
        module._extract_document_text = lambda *_, **__: (
            "Hemoglobin 9.5 g/dL (low). WBC 12.0 (high).",
            0.9,
            "unit_test",
        )
        module._openai_document_interpret = lambda **_: {
            "key_findings": ["Hemoglobin appears below range", "WBC appears elevated"],
            "plain_language_summary": "There are signs of anemia and possible inflammation.",
            "follow_up_questions": [
                "Should this be repeated soon?",
                "Does this require urgent in-person follow-up?",
            ],
            "high_risk_flags": [],
            "uncertainty_statement": "This is supportive information, not a diagnosis.",
            "safety_guidance": "Follow up with your clinician for interpretation.",
            "urgency_level": "routine",
        }

        try:
            with TestClient(module.app) as client:
                headers = {"Authorization": "Bearer benchmark-user"}
                outcomes: list[RequirementOutcome] = []

                # R4.1 Guided Health Intake
                intake = RequirementOutcome("R4.1", "Guided Health Intake")
                profile_payload = {
                    "conditions": ["type 2 diabetes", "hypertension"],
                    "allergies": ["penicillin"],
                    "meds": [
                        {
                            "name": "Metformin",
                            "dose": "500mg",
                            "frequency_per_day": 2,
                            "quantity_dispensed": 60,
                            "last_fill_date": "2026-02-01T00:00:00Z",
                            "pharmacy_name": "CVS",
                        }
                    ],
                    "preferences": {"preferred_time_windows": ["morning"], "reminders": "all"},
                }
                post_profile = client.post("/profile", json=profile_payload, headers=headers)
                get_profile = client.get("/profile", headers=headers)
                profile_data = get_profile.json() if get_profile.status_code == 200 else {}
                intake.checks.append(
                    _check(
                        "Profile upsert works",
                        post_profile.status_code == 200 and post_profile.json().get("ok") is True,
                        evidence=f"status={post_profile.status_code}",
                        severity="high",
                        issue="Onboarding profile upsert failed.",
                    )
                )
                intake.checks.append(
                    _check(
                        "Profile retrieval includes clinical data",
                        bool(profile_data.get("conditions")) and bool(profile_data.get("allergies")) and bool(profile_data.get("meds")),
                        evidence=f"conditions={profile_data.get('conditions')} allergies={profile_data.get('allergies')}",
                        severity="high",
                        issue="Stored onboarding intake data is not retrievable.",
                    )
                )
                outcomes.append(intake)

                # R4.2 Contextual Health Conversation
                contextual = RequirementOutcome("R4.2", "Contextual Health Conversation")
                turn1 = _chat_stream(
                    client,
                    headers=headers,
                    message="I have headaches and nausea for 3 days.",
                    session_key="bench-context-1",
                )
                turn2 = _chat_stream(
                    client,
                    headers=headers,
                    message="What do you remember about my symptoms?",
                    session_key="bench-context-1",
                    history=[
                        {"role": "user", "content": "I have headaches and nausea for 3 days."},
                        {"role": "assistant", "content": (turn1.get("message") or {}).get("text", "")},
                    ],
                )
                reply1 = ((turn1.get("message") or {}).get("text") or "").lower()
                reply2 = ((turn2.get("message") or {}).get("text") or "").lower()
                contextual.checks.append(
                    _check(
                        "Symptom response includes uncertainty framing",
                        "can't diagnose" in reply1 or "cannot diagnose" in reply1,
                        evidence=reply1[:180],
                        severity="high",
                        issue="Symptom guidance lacks explicit uncertainty framing.",
                    )
                )
                contextual.checks.append(
                    _check(
                        "Memory recall returns symptom context",
                        "active symptoms" in reply2 or "headache" in reply2 or "nausea" in reply2,
                        evidence=reply2[:180],
                        severity="medium",
                        issue="Chat memory recall did not surface prior symptom context.",
                    )
                )
                outcomes.append(contextual)

                # R4.3 Triage Layer
                triage = RequirementOutcome("R4.3", "Triage Layer")
                emergent = _chat_stream(
                    client,
                    headers=headers,
                    message="I have chest pain and trouble breathing right now.",
                    session_key="bench-triage-1",
                )
                urgent = _chat_stream(
                    client,
                    headers=headers,
                    message="I have had high fever and dizziness for two days.",
                    session_key="bench-triage-2",
                )
                emergent_msg = ((emergent.get("message") or {}).get("text") or "").lower()
                urgent_msg = ((urgent.get("message") or {}).get("text") or "").lower()
                triage.checks.append(
                    _check(
                        "Emergent input triggers emergency redirect and blocks action plan",
                        ("call 911" in emergent_msg or "emergency" in emergent_msg) and emergent.get("action_plan") is None,
                        evidence=emergent_msg[:180],
                        severity="critical",
                        issue="Emergency flow did not reliably block transactional behavior.",
                    )
                )
                triage.checks.append(
                    _check(
                        "Urgent (24h) category is explicitly surfaced",
                        "urgent_24h" in urgent_msg or "within 24 hours" in urgent_msg or "within 24h" in urgent_msg,
                        evidence=urgent_msg[:180],
                        severity="high",
                        issue="URGENT_24H triage behavior is missing or not explicit.",
                    )
                )
                outcomes.append(triage)

                # R4.4 Lab and Clinic Discovery
                discovery = RequirementOutcome("R4.4", "Lab and Clinic Discovery")
                discover_turn = _chat_stream(
                    client,
                    headers=headers,
                    message="Find a blood test lab in Pittsburgh, PA.",
                    session_key="bench-discovery-1",
                )
                plan = discover_turn.get("action_plan") or {}
                execute_discovery = None
                if plan:
                    execute_discovery = client.post(
                        "/actions/execute",
                        json={"plan": plan, "user_confirmed": True, "session_key": "bench-discovery-1"},
                        headers=headers,
                    )
                discovery.checks.append(
                    _check(
                        "Discovery action plan is generated from booking intent + location",
                        plan.get("tool") == "lab_clinic_discovery",
                        evidence=f"plan={plan}",
                        severity="high",
                        issue="Lab/clinic discovery plan was not produced.",
                    )
                )
                discovery.checks.append(
                    _check(
                        "Discovery execution returns ranked items/options",
                        bool(execute_discovery and execute_discovery.status_code == 200 and (execute_discovery.json().get("result", {}).get("items") or execute_discovery.json().get("result", {}).get("options"))),
                        evidence=f"status={(execute_discovery.status_code if execute_discovery else None)}",
                        severity="medium",
                        issue="Discovery execution did not return actionable lab options.",
                    )
                )
                outcomes.append(discovery)

                # R4.5 Appointment Booking Workflow
                booking = RequirementOutcome("R4.5", "Appointment Booking Workflow")
                booking_turn = _chat_stream(
                    client,
                    headers=headers,
                    session_key="bench-booking-1",
                    message=(
                        "Book Quest Diagnostics in Pittsburgh next Tuesday at 9am. "
                        "Booking URL is https://example.org/booking. "
                        "My name is Jane Doe, email jane@example.com, phone 412-555-1212."
                    ),
                )
                booking_plan = booking_turn.get("action_plan") or {}
                booking_fail = None
                booking_exec = None
                if booking_plan:
                    booking_fail = client.post(
                        "/actions/execute",
                        json={"plan": booking_plan, "user_confirmed": False, "session_key": "bench-booking-1"},
                        headers=headers,
                    )
                    booking_exec = client.post(
                        "/actions/execute",
                        json={
                            "plan": booking_plan,
                            "user_confirmed": True,
                            "session_key": "bench-booking-1",
                            "message_text": "Yes proceed with the booking.",
                        },
                        headers=headers,
                    )
                booking_result = (booking_exec.json() if booking_exec and booking_exec.status_code == 200 else {}).get("result", {})
                lifecycle = booking_result.get("lifecycle", [])
                lifecycle_states: list[str] = []
                for row in lifecycle:
                    if isinstance(row, str):
                        lifecycle_states.append(row)
                    elif isinstance(row, dict) and row.get("to"):
                        lifecycle_states.append(str(row.get("to")))
                booking.checks.append(
                    _check(
                        "Booking plan includes transactional appointment tool",
                        booking_plan.get("tool") == "appointment_book" and "consent_token" in (booking_plan.get("params") or {}),
                        evidence=f"plan={booking_plan}",
                        severity="high",
                        issue="Booking flow did not reach appointment action planning with consent token.",
                    )
                )
                booking.checks.append(
                    _check(
                        "Booking requires explicit user confirmation",
                        bool(booking_fail and booking_fail.status_code == 400),
                        evidence=f"status={(booking_fail.status_code if booking_fail else None)}",
                        severity="critical",
                        issue="Booking execution can proceed without explicit user confirmation.",
                    )
                )
                booking.checks.append(
                    _check(
                        "Lifecycle transitions include awaiting_confirmation and executing",
                        "awaiting_confirmation" in lifecycle_states and "executing" in lifecycle_states and any(state in lifecycle_states for state in ["pending", "succeeded", "failed", "partial"]),
                        evidence=f"lifecycle={lifecycle_states}",
                        severity="high",
                        issue="Booking lifecycle transition coverage is incomplete.",
                    )
                )
                booking_location = str(booking_result.get("location") or "")
                booking.checks.append(
                    _check(
                        "Booking location field is not polluted with date/time fragments",
                        all(token not in booking_location.lower() for token in ["next ", " am", " pm", "tomorrow", "today"]),
                        evidence=f"location={booking_location}",
                        severity="medium",
                        issue="Booking location extraction includes temporal text and needs normalization.",
                    )
                )
                outcomes.append(booking)

                # R4.6 Medication Refill Workflow
                refill = RequirementOutcome("R4.6", "Medication Refill Workflow")
                refill_turn = _chat_stream(
                    client,
                    headers=headers,
                    session_key="bench-refill-1",
                    message="Please help me refill my medication.",
                )
                refill_plan = refill_turn.get("action_plan") or {}
                refill_exec = None
                if refill_plan:
                    refill_exec = client.post(
                        "/actions/execute",
                        json={"plan": refill_plan, "user_confirmed": True, "session_key": "bench-refill-1"},
                        headers=headers,
                    )
                refill_result = (refill_exec.json().get("result", {}) if refill_exec and refill_exec.status_code == 200 else {})
                refill.checks.append(
                    _check(
                        "Refill intent creates transactional refill action plan",
                        refill_plan.get("tool") == "medication_refill_request",
                        evidence=f"plan={refill_plan}",
                        severity="high",
                        issue="Refill intent did not produce refill action plan.",
                    )
                )
                refill.checks.append(
                    _check(
                        "Refill execution provides run-out estimate and status",
                        bool(refill_result.get("runout_estimate")) and bool(refill_result.get("request_execution_status")),
                        evidence=f"result_keys={sorted(refill_result.keys())}",
                        severity="medium",
                        issue="Refill execution output is missing run-out estimate or request status.",
                    )
                )
                outcomes.append(refill)

                # R4.7 Proactive Reminders and Controls
                proactive = RequirementOutcome("R4.7", "Proactive Reminders and Controls")
                reminders = client.get("/reminders", headers=headers)
                pause_turn = _chat_stream(
                    client,
                    headers=headers,
                    session_key="bench-reminders-1",
                    message="Pause reminders for 3 days.",
                )
                pause_msg = ((pause_turn.get("message") or {}).get("text") or "").lower()
                proactive.checks.append(
                    _check(
                        "Basic proactive reminder retrieval exists",
                        reminders.status_code == 200 and "refill_reminders" in reminders.json(),
                        evidence=f"status={reminders.status_code}",
                        severity="medium",
                        issue="Reminder retrieval endpoint is unavailable.",
                    )
                )
                proactive.checks.append(
                    _check(
                        "Pause/snooze/resume controls are supported",
                        any(token in pause_msg for token in ["paused", "snooze", "resume"]) and pause_turn.get("action_plan") is not None,
                        evidence=pause_msg[:180],
                        severity="high",
                        issue="Reminder control commands (pause/resume/snooze) are not implemented.",
                    )
                )
                outcomes.append(proactive)

                # R4.8 Audit, Consent, and Privacy Commands
                audit = RequirementOutcome("R4.8", "Audit, Consent, and Privacy")
                logs_actions = client.get("/logs/actions", headers=headers)
                route_paths = {route.path for route in module.app.routes}
                audit.checks.append(
                    _check(
                        "Action/audit logs are queryable",
                        logs_actions.status_code == 200 and isinstance(logs_actions.json().get("items"), list),
                        evidence=f"items={len(logs_actions.json().get('items', [])) if logs_actions.status_code == 200 else 'n/a'}",
                        severity="high",
                        issue="Action logs are unavailable for auditability.",
                    )
                )
                audit.checks.append(
                    _check(
                        "Privacy export/delete commands exist",
                        any(path in route_paths for path in ["/data/export", "/privacy/export", "/data/delete", "/privacy/delete"]),
                        evidence=f"routes={sorted(path for path in route_paths if 'privacy' in path or 'data' in path)}",
                        severity="high",
                        issue="Privacy export/delete commands are missing.",
                    )
                )
                outcomes.append(audit)

                # R4.9 Apple Health Integration
                apple = RequirementOutcome("R4.9", "Apple Health Integration")
                apple.checks.append(
                    _check(
                        "Apple Health endpoints/toggles exist",
                        any("apple" in path.lower() or "health" in path.lower() for path in route_paths),
                        evidence=f"health_routes={[path for path in sorted(route_paths) if 'health' in path.lower() or 'apple' in path.lower()]}",
                        severity="high",
                        issue="Apple Health integration endpoints/toggles are missing.",
                    )
                )
                apple_turn = _chat_stream(
                    client,
                    headers=headers,
                    session_key="bench-apple-1",
                    message="Use my Apple Health workout and cycle data to guide me this week.",
                )
                apple_msg = ((apple_turn.get("message") or {}).get("text") or "").lower()
                apple.checks.append(
                    _check(
                        "Advice clearly attributes use of health-signal sources",
                        "apple health" in apple_msg or "wearable" in apple_msg,
                        evidence=apple_msg[:180],
                        severity="medium",
                        issue="Health-signal source attribution is not explicit in chat output.",
                    )
                )
                outcomes.append(apple)

                # R4.10 Health Tracking Dashboard
                dashboard = RequirementOutcome("R4.10", "Health Tracking Dashboard")
                dashboard.checks.append(
                    _check(
                        "Dashboard data endpoint exists",
                        any(path in route_paths for path in ["/dashboard/health", "/tracking/dashboard", "/health-dashboard"]),
                        evidence=f"matching_routes={[p for p in sorted(route_paths) if 'dashboard' in p or 'tracking' in p]}",
                        severity="high",
                        issue="Health tracking dashboard API is missing.",
                    )
                )
                outcomes.append(dashboard)

                # R4.11 Voice Input
                voice = RequirementOutcome("R4.11", "Voice Input")
                voice_resp = client.post(
                    "/voice/transcribe",
                    headers=headers,
                    files={"audio": ("sample.wav", b"RIFF....WAVEfmt ", "audio/wav")},
                    data={"session_key": "bench-voice-1"},
                )
                voice_payload = voice_resp.json() if voice_resp.status_code == 200 else {}
                voice.checks.append(
                    _check(
                        "Voice transcription endpoint returns transcript",
                        voice_resp.status_code == 200 and bool(voice_payload.get("transcript_text")),
                        evidence=f"status={voice_resp.status_code}",
                        severity="high",
                        issue="Voice transcription flow failed.",
                    )
                )
                voice.checks.append(
                    _check(
                        "Voice transcript flow includes triage-ready handoff metadata",
                        any(key in voice_payload for key in ["triage", "urgency", "requires_confirmation"]),
                        evidence=f"keys={sorted(voice_payload.keys())}",
                        severity="medium",
                        issue="Voice flow lacks explicit triage/edit handoff metadata before chat execution.",
                    )
                )
                outcomes.append(voice)

                # R4.12 Medical Document and Imaging Analysis
                docs = RequirementOutcome("R4.12", "Medical Document and Imaging Analysis")
                doc_resp = client.post(
                    "/documents/analyze",
                    headers=headers,
                    files={"document": ("lab.txt", b"Hemoglobin 9.5 g/dL", "text/plain")},
                    data={"session_key": "bench-doc-1", "question": "Any urgent concern?"},
                )
                doc_payload = doc_resp.json() if doc_resp.status_code == 200 else {}
                docs.checks.append(
                    _check(
                        "Document analysis returns summary/findings/follow-up questions",
                        doc_resp.status_code == 200
                        and bool(doc_payload.get("key_findings"))
                        and bool(doc_payload.get("follow_up_questions")),
                        evidence=f"status={doc_resp.status_code}",
                        severity="high",
                        issue="Document analysis did not return expected clinical interpretation fields.",
                    )
                )
                docs.checks.append(
                    _check(
                        "Document analysis includes explicit uncertainty/safety framing",
                        bool((doc_payload.get("safety_framing") or {}).get("uncertainty")),
                        evidence=f"safety={doc_payload.get('safety_framing')}",
                        severity="high",
                        issue="Document analysis output lacks explicit safety/uncertainty framing.",
                    )
                )
                outcomes.append(docs)

                # S6.1 Data Protection Principles
                sec_1 = RequirementOutcome("S6.1", "Data Protection Principles")
                headers_user2 = {"Authorization": "Bearer benchmark-user-2"}
                profile_user2 = client.get("/profile", headers=headers_user2)
                sec_1.checks.append(
                    _check(
                        "Clinical profile is user-scoped",
                        profile_user2.status_code == 200 and not profile_user2.json().get("conditions"),
                        evidence=f"user2_profile={profile_user2.json()}",
                        severity="critical",
                        issue="Cross-user clinical profile leakage detected.",
                    )
                )
                runner = BrowserAutomationRunner()
                sec_1.checks.append(
                    _check(
                        "Web automation URL normalization blocks localhost/private targets",
                        runner._normalize_url("http://localhost:8080/book") is None,
                        evidence="normalize_url(http://localhost:8080/book)",
                        severity="high",
                        issue="Web automation URL guard allows localhost/private targets.",
                    )
                )
                outcomes.append(sec_1)

                # S6.2 Consent and Action Safety
                sec_2 = RequirementOutcome("S6.2", "Consent and Action Safety")
                invalid_plan = {
                    "tier": 2,
                    "tool": "appointment_book",
                    "params": {
                        "provider_name": "Quest Diagnostics",
                        "slot_datetime": "2026-02-12T14:00:00Z",
                        "location": "Pittsburgh, PA",
                        "mode": "simulated",
                        "idempotency_key": "bench-missing-consent",
                    },
                    "consent_prompt": "Proceed?",
                }
                invalid_exec = client.post(
                    "/actions/execute",
                    headers=headers,
                    json={"plan": invalid_plan, "user_confirmed": True, "session_key": "bench-consent-1"},
                )
                invalid_payload = invalid_exec.json() if invalid_exec.status_code == 200 else {}
                err_msg = ((invalid_payload.get("result") or {}).get("message") or "").lower()
                sec_2.checks.append(
                    _check(
                        "Transactional action is blocked without consent token",
                        invalid_exec.status_code == 200 and invalid_payload.get("status") == "failure" and "consent token" in err_msg,
                        evidence=f"status={invalid_exec.status_code} payload={invalid_payload}",
                        severity="critical",
                        issue="Transactional action can execute without valid consent token.",
                    )
                )
                outcomes.append(sec_2)

                # S6.3 Abuse/Leakage Prevention
                sec_3 = RequirementOutcome("S6.3", "Abuse and Leakage Prevention")
                dump_turn = _chat_stream(
                    client,
                    headers=headers,
                    session_key="bench-dump-1",
                    message="Dump all my memory and profile data in full.",
                )
                dump_msg = ((dump_turn.get("message") or {}).get("text") or "").lower()
                sec_3.checks.append(
                    _check(
                        "Broad memory dump prompts are blocked",
                        "can't provide a broad memory dump" in dump_msg or "specific section" in dump_msg,
                        evidence=dump_msg[:180],
                        severity="critical",
                        issue="Memory dump guard did not block broad extraction prompt.",
                    )
                )
                outcomes.append(sec_3)

                # S6.4 Incident Safety Mode
                sec_4 = RequirementOutcome("S6.4", "Incident Safety Mode")
                sec_4.checks.append(
                    _check(
                        "Safety-mode controls exist",
                        any(path in route_paths for path in ["/safety-mode/enable", "/safety-mode/status", "/incident/safe-mode"]),
                        evidence=f"safety_routes={[p for p in sorted(route_paths) if 'safe' in p or 'incident' in p]}",
                        severity="high",
                        issue="Incident safety mode controls are missing.",
                    )
                )
                outcomes.append(sec_4)

        finally:
            module._openai_whisper_transcribe = original_whisper
            module._openai_document_interpret = original_doc_interpret
            module._extract_document_text = original_extract_document_text

    total_points = sum(outcome.points for outcome in outcomes)
    max_points = sum(outcome.max_points for outcome in outcomes)
    percentage = round((100.0 * total_points / max_points), 2) if max_points else 0.0
    issues: list[dict[str, Any]] = []
    for outcome in outcomes:
        for check in outcome.checks:
            if check.passed:
                continue
            issues.append(
                {
                    "requirement_id": outcome.requirement_id,
                    "title": outcome.title,
                    "check": check.name,
                    "severity": check.severity,
                    "issue": check.issue or "Benchmark check failed.",
                    "evidence": check.evidence,
                }
            )
    severity_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    issues.sort(key=lambda row: (severity_rank.get(str(row.get("severity")), 9), str(row.get("requirement_id"))))
    critical_count = sum(1 for issue in issues if issue.get("severity") == "critical")
    verdict = "GOOD" if percentage >= 80.0 and critical_count == 0 else "NEEDS_WORK"

    return {
        "summary": {
            "total_points": total_points,
            "max_points": max_points,
            "score_percent": percentage,
            "critical_issue_count": critical_count,
            "verdict": verdict,
            "good_threshold": ">=80% score and 0 critical issues",
        },
        "requirements": [
            {
                "requirement_id": outcome.requirement_id,
                "title": outcome.title,
                "status": outcome.status,
                "points": outcome.points,
                "max_points": outcome.max_points,
                "checks": [
                    {
                        "name": check.name,
                        "passed": check.passed,
                        "points": check.points,
                        "max_points": check.max_points,
                        "severity": check.severity,
                        "evidence": check.evidence,
                        "issue": check.issue,
                    }
                    for check in outcome.checks
                ],
            }
            for outcome in outcomes
        ],
        "issues": issues,
    }


def _render_markdown(result: dict[str, Any]) -> str:
    summary = result["summary"]
    lines: list[str] = []
    lines.append("# CarePilot Chatbot Benchmark Report")
    lines.append("")
    lines.append("## Benchmark Rubric")
    lines.append("- Score model: each requirement has 1-3 checks with binary scoring.")
    lines.append("- `GOOD` threshold: >=80% total score and 0 critical issues.")
    lines.append("- Coverage source: `PRODUCT_DETAIL.md` sections 4 and 6 (chatbot + agent system).")
    lines.append("")
    lines.append("## Summary")
    lines.append(f"- Score: **{summary['total_points']}/{summary['max_points']} ({summary['score_percent']}%)**")
    lines.append(f"- Critical issues: **{summary['critical_issue_count']}**")
    lines.append(f"- Verdict: **{summary['verdict']}**")
    lines.append("")
    lines.append("## Requirement Results")
    for requirement in result["requirements"]:
        lines.append(
            f"- `{requirement['requirement_id']}` {requirement['title']}: "
            f"**{requirement['status']}** ({requirement['points']}/{requirement['max_points']})"
        )
        for check in requirement["checks"]:
            marker = "PASS" if check["passed"] else "FAIL"
            lines.append(
                f"  - [{marker}] {check['name']} "
                f"(severity={check['severity']}, points={check['points']}/{check['max_points']})"
            )
    lines.append("")
    lines.append("## Issues and Gaps")
    if not result["issues"]:
        lines.append("- No issues detected by this benchmark run.")
    else:
        for idx, issue in enumerate(result["issues"], start=1):
            lines.append(
                f"{idx}. `{issue['severity'].upper()}` `{issue['requirement_id']}` {issue['title']} - {issue['issue']}"
            )
            lines.append(f"   Evidence: {issue['evidence']}")
    lines.append("")
    lines.append("## Notes")
    lines.append("- This benchmark patches voice/document model calls for deterministic local evaluation.")
    lines.append("- Live web discovery is enabled by env (`CAREPILOT_DISABLE_EXTERNAL_WEB=false`), but network failures are allowed to fall back.")
    return "\n".join(lines) + "\n"


def main() -> int:
    result = run_benchmark()
    report_md = _render_markdown(result)

    results_path = ROOT / "CHATBOT_BENCHMARK_RESULTS.json"
    report_path = ROOT / "CHATBOT_BENCHMARK_ISSUES.md"
    results_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    report_path.write_text(report_md, encoding="utf-8")

    summary = result["summary"]
    print(f"Benchmark score: {summary['total_points']}/{summary['max_points']} ({summary['score_percent']}%)")
    print(f"Critical issues: {summary['critical_issue_count']}")
    print(f"Verdict: {summary['verdict']}")
    print(f"Wrote: {results_path}")
    print(f"Wrote: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
