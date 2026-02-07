from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from carepilot_agent_core import (
    ActionLifecycleService,
    AgentExecutor,
    ExecutionContext,
    HookDecision,
    HookRunner,
    PolicyEngine,
    ToolRegistry,
)
from carepilot_tools import CarePilotToolset, register_tools
from memory import MemoryPolicyError, MemoryService, SQLiteMemoryDB, canonical_payload_hash
from memory.time_utils import parse_iso, to_iso, utc_now


def _stable_id(prefix: str, value: str) -> str:
    return f"{prefix}_{hashlib.sha1(value.strip().lower().encode('utf-8')).hexdigest()[:20]}"


def _sanitize_payload_for_hash(payload: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in payload.items() if k not in {"consent_token", "payload_hash"}}


def _tool_params_hash(payload: dict[str, Any]) -> str:
    return canonical_payload_hash(_sanitize_payload_for_hash(payload))


class ClientContext(BaseModel):
    timezone: str = "UTC"
    location_text: str | None = None


class ChatRequest(BaseModel):
    message: str
    client_context: ClientContext | None = None
    session_key: str | None = None
    history: list[dict[str, str]] = Field(default_factory=list)


class ActionPlan(BaseModel):
    tier: int
    tool: str
    params: dict[str, Any] = Field(default_factory=dict)
    consent_prompt: str | None = None


class ActionExecuteRequest(BaseModel):
    plan: ActionPlan
    user_confirmed: bool
    session_key: str | None = None


class ProfilePayload(BaseModel):
    user_id: str | None = None
    conditions: list[str] = Field(default_factory=list)
    allergies: list[str] = Field(default_factory=list)
    meds: list[dict[str, Any]] = Field(default_factory=list)
    family_history: str | None = None
    preferences: dict[str, Any] = Field(default_factory=dict)
    timezone: str = "UTC"


class SymptomPayload(BaseModel):
    symptom_text: str
    severity: int
    onset_time: str | None = None
    notes: str | None = None


class CarePilotApp:
    transactional_tools = {"appointment_book", "medication_refill_request"}

    def __init__(self) -> None:
        db_path = os.getenv(
            "CAREPILOT_DB_PATH",
            str((Path(__file__).resolve().parent / "carepilot.sqlite")),
        )
        self.db = SQLiteMemoryDB(db_path)
        self.memory = MemoryService(self.db)
        self.registry = ToolRegistry()
        self.toolset = CarePilotToolset(self.memory)
        register_tools(self.registry, self.toolset)

        self.policy = PolicyEngine(
            allowlist={
                "clinical_profile_get",
                "clinical_profile_upsert",
                "lab_clinic_discovery",
                "appointment_book",
                "medication_refill_request",
                "consent_token_issue",
            },
            transactional_tools=self.transactional_tools,
        )

        self.hooks = HookRunner()
        self.hooks.add_before(self._before_tool_call)
        self.hooks.add_after(self._after_tool_call)

        self.executor = AgentExecutor(
            registry=self.registry,
            policy=self.policy,
            hooks=self.hooks,
            lifecycle=ActionLifecycleService(self.db),
        )

    def _before_tool_call(
        self,
        ctx: ExecutionContext,
        tool,
        payload: dict[str, Any],
    ) -> HookDecision:
        if tool.name in self.transactional_tools:
            if ctx.emergency:
                return HookDecision(
                    allowed=False,
                    code="emergency_transaction_block",
                    message="Emergency context blocks transactional actions.",
                )
            token = payload.get("consent_token")
            payload_hash = payload.get("payload_hash") or _tool_params_hash(payload)
            if not token:
                return HookDecision(
                    allowed=False,
                    code="missing_consent_token",
                    message="Consent token required for transactional action.",
                )
            valid, reason = self.memory.validate_consent_token(
                user_id=ctx.user_id,
                action_type=tool.name,
                payload_hash=payload_hash,
                token=token,
                consume=False,
            )
            if not valid:
                return HookDecision(allowed=False, code="invalid_consent_token", message=reason)
        return HookDecision(allowed=True)

    def _after_tool_call(
        self,
        ctx: ExecutionContext,
        tool,
        payload: dict[str, Any],
        outcome: dict[str, Any],
    ) -> None:
        details = {
            "status": outcome.get("status"),
            "errors": outcome.get("errors", []),
            "action_id": outcome.get("action_id"),
        }
        self.memory.clinical.append_policy_event(
            user_id=ctx.user_id,
            session_key=ctx.session_key,
            event_type="tool_outcome",
            tool_name=tool.name,
            details=details,
        )
        if tool.name in self.transactional_tools and outcome.get("status") in {"succeeded", "partial", "pending"}:
            token = payload.get("consent_token")
            if token:
                self.memory.clinical.mark_consent_token_used(token)


container = CarePilotApp()
app = FastAPI(title="CarePilot Backend")

allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in allowed_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_user_id(auth_header: str | None) -> str:
    if not auth_header:
        if os.getenv("ALLOW_ANON", "false").lower() == "true":
            return "demo-user"
        raise HTTPException(status_code=401, detail="Missing Authorization")
    raw = auth_header.replace("Bearer", "", 1).strip()
    if not raw:
        return "demo-user"

    # If the bearer token is a JWT, prefer subject/uid claims to avoid using a long raw token as user_id.
    parts = raw.split(".")
    if len(parts) >= 2:
        try:
            payload = parts[1] + ("=" * (-len(parts[1]) % 4))
            claims = json.loads(base64.urlsafe_b64decode(payload.encode("utf-8")).decode("utf-8"))
            for key in ("sub", "uid", "user_id"):
                value = claims.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
        except Exception:
            pass

    if len(raw) > 96:
        return f"token_{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:24]}"
    return raw


def _build_ctx(
    *,
    user_id: str,
    session_key: str | None,
    message_text: str = "",
    user_confirmed: bool = False,
) -> ExecutionContext:
    # Keep default session key bounded even if user_id source is unusual.
    default_session = f"session-{hashlib.sha1(user_id.encode('utf-8')).hexdigest()[:24]}"
    session = session_key or default_session
    emergency = container.policy.is_emergency_text(message_text)
    return ExecutionContext(
        user_id=user_id,
        session_key=session,
        request_id=uuid.uuid4().hex,
        message_text=message_text,
        emergency=emergency,
        user_confirmed=user_confirmed,
    )


def _emit_sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _extract_ranked_options_from_history(history: list[dict[str, str]]) -> list[dict[str, str]]:
    options: list[dict[str, str]] = []
    list_pattern = re.compile(r"^\s*(\d+)[\).:-]\s*(?:\*\*)?(.+?)(?:\*\*)?\s*(?:[—-]\s*(.+?))?\s*$")

    def _append_option(name: str, location: str | None) -> None:
        cleaned_name = (name or "").strip()
        if not cleaned_name:
            return
        cleaned_location = (location or "local area").strip() or "local area"
        key = f"{cleaned_name.lower()}::{cleaned_location.lower()}"
        if any(f"{row['name'].lower()}::{row['location'].lower()}" == key for row in options):
            return
        options.append({"name": cleaned_name, "location": cleaned_location})

    def _extract_from_json_blob(content: str) -> list[dict[str, str]]:
        start = content.find("{")
        end = content.rfind("}")
        if start < 0 or end <= start:
            return []
        try:
            payload = json.loads(content[start : end + 1])
        except json.JSONDecodeError:
            return []
        if isinstance(payload, dict) and isinstance(payload.get("result"), dict):
            payload = payload["result"]

        extracted: list[dict[str, str]] = []
        if isinstance(payload, dict) and isinstance(payload.get("items"), list):
            for item in payload["items"]:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "").strip()
                location = str(item.get("address") or item.get("location") or "local area").strip()
                if name:
                    extracted.append({"name": name, "location": location or "local area"})
        elif isinstance(payload, dict) and isinstance(payload.get("options"), list):
            for item in payload["options"]:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "").strip()
                criteria = item.get("criteria") if isinstance(item.get("criteria"), dict) else {}
                location = str(criteria.get("origin") or item.get("location") or "local area").strip()
                if name:
                    extracted.append({"name": name, "location": location or "local area"})
        return extracted

    for item in reversed(history):
        if item.get("role") != "assistant":
            continue
        content = item.get("content", "")
        lines = content.splitlines()
        parsed: list[tuple[int, str, str]] = []
        for line in lines:
            match = list_pattern.match(line)
            if not match:
                continue
            parsed.append((int(match.group(1)), match.group(2).strip(), (match.group(3) or "local area").strip()))
        if parsed:
            parsed.sort(key=lambda row: row[0])
            for _, name, location in parsed:
                _append_option(name, location)
            break
        json_items = _extract_from_json_blob(content)
        if json_items:
            for row in json_items:
                _append_option(row["name"], row["location"])
            break
    return options


def _extract_ranked_options_from_conversation_memory(context: dict[str, Any]) -> list[dict[str, str]]:
    conversational = context.get("conversational", {})
    prefs = conversational.get("preferences", []) if isinstance(conversational, dict) else []
    target_session = str(context.get("_session_key") or context.get("session_key") or "")
    for pref in prefs:
        if not isinstance(pref, dict) or pref.get("key") != "last_lab_discovery":
            continue
        value = pref.get("value") if isinstance(pref.get("value"), dict) else {}
        if target_session and isinstance(value, dict):
            stored_session = str(value.get("session_key") or "")
            if stored_session and stored_session != target_session:
                continue
        items = value.get("items", []) if isinstance(value, dict) else []
        options: list[dict[str, str]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            location = str(item.get("location") or item.get("address") or "local area").strip()
            if name:
                options.append({"name": name, "location": location or "local area"})
        if options:
            return options
    return []


def _ranked_options_with_fallback(history: list[dict[str, str]], context: dict[str, Any]) -> list[dict[str, str]]:
    options = _extract_ranked_options_from_history(history)
    if options:
        return options
    return _extract_ranked_options_from_conversation_memory(context)


def _selected_option_index(message: str) -> int | None:
    lowered = message.lower()
    if any(token in lowered for token in ["first option", "option 1", "1st option", "the first one"]):
        return 1
    if any(token in lowered for token in ["second option", "option 2", "2nd option", "the second one"]):
        return 2
    if any(token in lowered for token in ["third option", "option 3", "3rd option", "the third one"]):
        return 3
    if any(token in lowered for token in ["fourth option", "option 4", "4th option"]):
        return 4
    if any(token in lowered for token in ["fifth option", "option 5", "5th option"]):
        return 5
    if any(token in lowered for token in ["looks good", "that works", "sounds good", "let's do it", "lets do it"]):
        return 1
    return None


_WEEKDAY_INDEX = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


def _preference_value_by_key(context: dict[str, Any], key: str) -> dict[str, Any] | None:
    conversational = context.get("conversational", {})
    prefs = conversational.get("preferences", []) if isinstance(conversational, dict) else []
    target_session = str(context.get("_session_key") or context.get("session_key") or "")
    for pref in prefs:
        if not isinstance(pref, dict) or pref.get("key") != key:
            continue
        value = pref.get("value")
        if isinstance(value, dict):
            if target_session:
                stored_session = str(value.get("session_key") or "")
                if stored_session != target_session:
                    continue
            return dict(value)
    return None


def _active_booking_draft(context: dict[str, Any], session_key: str) -> dict[str, Any] | None:
    value = _preference_value_by_key(context, "appointment_booking_draft")
    if not value:
        return None
    if value.get("session_key") != session_key:
        return None
    if value.get("status") != "collecting":
        return None
    return value


def _extract_provider_from_text(message: str) -> str | None:
    patterns = [
        r"\b(?:with|at)\s+([A-Za-z][A-Za-z0-9&' .-]{2,80}?)(?=\s+\b(?:on|for|in|next|tomorrow|today)\b|[?.!,]|$)",
        r"\bbook\s+([A-Za-z][A-Za-z0-9&' .-]{2,80}?)(?=\s+\b(?:on|for|in|next|tomorrow|today)\b|[?.!,]|$)",
    ]
    for pattern in patterns:
        match = re.search(pattern, message, flags=re.IGNORECASE)
        if not match:
            continue
        candidate = re.sub(r"\s+", " ", match.group(1)).strip()
        if not candidate:
            continue
        lowered = candidate.lower()
        if lowered in {"an appointment", "appointment", "a blood test", "blood test"}:
            continue
        if any(token in lowered for token in ["book", "schedule", "appointment"]):
            continue
        words = lowered.split()
        if words and words[0] in {"it", "one", "another", "an", "a", "the"}:
            continue
        if any(token in lowered for token in ["tomorrow", "today", "morning", "afternoon", "evening", "next week"]):
            continue
        provider_markers = ["clinic", "lab", "diagnostic", "hospital", "doctor", "dr ", "medical", "care"]
        if len(words) == 1 and not any(marker in lowered for marker in provider_markers):
            continue
        return candidate
    return None


def _extract_location_from_text(message: str) -> str | None:
    match = re.search(r"\bin\s+([A-Za-z][A-Za-z .'-]{1,80})(?=$|[?.!,])", message, flags=re.IGNORECASE)
    if not match:
        return None
    candidate = re.sub(r"\s+", " ", match.group(1)).strip(" .")
    if not candidate:
        return None
    lowered = candidate.lower()
    if lowered in {"the morning", "the afternoon", "the evening", "next week"}:
        return None
    return candidate


def _extract_phone_from_text(message: str) -> str | None:
    digits = re.sub(r"\D", "", message)
    if len(digits) < 10:
        return None
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return f"+{digits}"


def _extract_explicit_time(message: str) -> tuple[int, int] | None:
    match = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", message, flags=re.IGNORECASE)
    if match:
        hour = int(match.group(1)) % 12
        if match.group(3).lower() == "pm":
            hour += 12
        minute = int(match.group(2) or "0")
        return hour, minute

    lowered = message.lower()
    if "morning" in lowered:
        return 9, 0
    if "afternoon" in lowered:
        return 14, 0
    if "evening" in lowered or "night" in lowered:
        return 18, 0
    return None


def _extract_slot_datetime_from_text(message: str, reference: datetime | None = None) -> str | None:
    now = reference or utc_now()
    explicit_iso = re.search(r"\b(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2})(?::(\d{2}))?)?\b", message)
    if explicit_iso:
        year, month, day = int(explicit_iso.group(1)), int(explicit_iso.group(2)), int(explicit_iso.group(3))
        hour = int(explicit_iso.group(4) or 9)
        minute = int(explicit_iso.group(5) or 0)
        try:
            dt = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
            return to_iso(dt)
        except ValueError:
            return None

    lowered = message.lower()
    target_day_offset: int | None = None
    if "tomorrow" in lowered:
        target_day_offset = 1
    elif "today" in lowered:
        target_day_offset = 0
    else:
        for name, weekday in _WEEKDAY_INDEX.items():
            if name not in lowered:
                continue
            offset = (weekday - now.weekday()) % 7
            if offset == 0:
                offset = 7
            if "next week" in lowered and offset < 7:
                offset += 7
            target_day_offset = offset
            break
        if target_day_offset is None and "next week" in lowered:
            target_day_offset = 7

    if target_day_offset is None:
        return None

    hour, minute = _extract_explicit_time(message) or (9, 0)
    slot = (now + timedelta(days=target_day_offset)).replace(hour=hour, minute=minute, second=0, microsecond=0)
    return to_iso(slot)


def _extract_slot_datetime_from_history(history: list[dict[str, str]]) -> str | None:
    for item in reversed(history):
        if item.get("role") != "user":
            continue
        content = item.get("content", "")
        slot = _extract_slot_datetime_from_text(content)
        if slot:
            return slot
    return None


def _persist_booking_draft(user_id: str, session_key: str, draft: dict[str, Any]) -> None:
    payload = dict(draft)
    payload["status"] = "collecting"
    payload["session_key"] = session_key
    payload["updated_at"] = to_iso(utc_now())
    container.memory.conversation.upsert_preference(
        user_id=user_id,
        key="appointment_booking_draft",
        value=payload,
        source="user_direct",
        confidence=1.0,
    )


def _clear_booking_draft(user_id: str, session_key: str) -> None:
    container.memory.conversation.upsert_preference(
        user_id=user_id,
        key="appointment_booking_draft",
        value={"status": "cleared", "session_key": session_key, "updated_at": to_iso(utc_now())},
        source="tool_result",
        confidence=1.0,
    )


def _persist_booking_defaults(user_id: str, draft: dict[str, Any], session_key: str) -> None:
    defaults = {
        "provider_name": draft.get("provider_name"),
        "location": draft.get("location"),
        "phone": draft.get("phone"),
        "last_slot_datetime": draft.get("slot_datetime"),
        "session_key": session_key,
        "updated_at": to_iso(utc_now()),
    }
    cleaned = {k: v for k, v in defaults.items() if v}
    if not cleaned:
        return
    container.memory.conversation.upsert_preference(
        user_id=user_id,
        key="appointment_booking_defaults",
        value=cleaned,
        source="user_direct",
        confidence=1.0,
    )


def _format_booking_missing_prompt(missing: list[str], ranked_options: list[dict[str, str]]) -> str:
    prompts: list[str] = []
    if "provider_name" in missing:
        if ranked_options:
            top = ranked_options[:3]
            options_text = "\n".join(f"{idx + 1}. {row['name']} ({row['location']})" for idx, row in enumerate(top))
            prompts.append(
                "I still need which provider to book with. Choose one option number or name:\n"
                + options_text
            )
        else:
            prompts.append("Which lab/clinic should I book with?")
    if "slot_datetime" in missing:
        prompts.append("What day and time should I request? Example: Tuesday 9:00 AM next week.")
    if "location" in missing:
        prompts.append("What location or city should I use?")
    return " ".join(prompts)


def _booking_flow_response(
    ctx: ExecutionContext,
    message: str,
    history: list[dict[str, str]],
    location_hint: str | None,
    context: dict[str, Any],
) -> tuple[str | None, ActionPlan | None, bool]:
    lowered = message.lower()
    ranked_options = _ranked_options_with_fallback(history, context)
    selected_idx = _selected_option_index(lowered)
    draft = _active_booking_draft(context, ctx.session_key)
    defaults = _preference_value_by_key(context, "appointment_booking_defaults") or {}
    provider_guess = _extract_provider_from_text(message)
    location_guess = _extract_location_from_text(message)
    phone_guess = _extract_phone_from_text(message)
    slot_guess = _extract_slot_datetime_from_text(message)
    booking_intent = any(word in lowered for word in ["book", "schedule"]) or any(
        phrase in lowered for phrase in ["set up an appointment", "make an appointment"]
    )

    if draft and any(word in lowered for word in ["cancel", "never mind", "nevermind", "stop"]):
        _clear_booking_draft(ctx.user_id, ctx.session_key)
        return "Understood. I cancelled the in-progress booking request.", None, True

    has_signal = bool(draft or selected_idx or provider_guess or slot_guess or booking_intent)
    if not has_signal:
        return None, None, False

    if (
        draft is None
        and selected_idx is None
        and provider_guess is None
        and any(word in lowered for word in ["blood test", "lab", "clinic", "diagnostic"])
    ):
        return None, None, False

    working = dict(draft or {})
    working.setdefault("mode", "simulated")
    if not working.get("provider_name") and defaults.get("provider_name"):
        working["provider_name"] = defaults["provider_name"]
    if not working.get("location") and defaults.get("location"):
        working["location"] = defaults["location"]
    if not working.get("phone") and defaults.get("phone"):
        working["phone"] = defaults["phone"]
    if not working.get("location") and location_hint:
        working["location"] = location_hint

    if selected_idx and 1 <= selected_idx <= len(ranked_options):
        selected = ranked_options[selected_idx - 1]
        working["provider_name"] = selected["name"]
        working["location"] = selected["location"]
    elif ranked_options:
        for option in ranked_options:
            if option["name"].lower() in lowered:
                working["provider_name"] = option["name"]
                working["location"] = option["location"]
                break

    if provider_guess:
        working["provider_name"] = provider_guess
    if location_guess:
        working["location"] = location_guess
    if slot_guess:
        working["slot_datetime"] = slot_guess
    if phone_guess:
        working["phone"] = phone_guess
    if not working.get("slot_datetime"):
        history_slot = _extract_slot_datetime_from_history(history)
        if history_slot:
            working["slot_datetime"] = history_slot
    if selected_idx and not working.get("slot_datetime"):
        default_slot = (utc_now() + timedelta(days=7)).replace(hour=9, minute=0, second=0, microsecond=0)
        working["slot_datetime"] = to_iso(default_slot)

    required_missing = [field for field in ["provider_name", "slot_datetime", "location"] if not working.get(field)]
    if required_missing:
        _persist_booking_draft(ctx.user_id, ctx.session_key, working)
        prompt = _format_booking_missing_prompt(required_missing, ranked_options)
        return prompt, None, True

    action_payload = {
        "provider_name": str(working["provider_name"]).strip(),
        "slot_datetime": str(working["slot_datetime"]).strip(),
        "location": str(working["location"]).strip(),
        "mode": "simulated",
        "idempotency_key": uuid.uuid4().hex,
    }
    if working.get("phone"):
        action_payload["phone"] = str(working["phone"]).strip()

    payload_hash = canonical_payload_hash(action_payload)
    consent = container.executor.execute(
        ctx,
        "consent_token_issue",
        {"action_type": "appointment_book", "payload_hash": payload_hash, "expires_in_seconds": 300},
    )
    if consent.status != "succeeded":
        return "I could not prepare consent for booking right now. Please try again.", None, True

    action_payload["consent_token"] = consent.data["token"]
    action_payload["payload_hash"] = payload_hash
    _persist_booking_defaults(ctx.user_id, working, ctx.session_key)
    _clear_booking_draft(ctx.user_id, ctx.session_key)

    slot_display = action_payload["slot_datetime"]
    parsed = parse_iso(slot_display)
    if parsed:
        slot_display = parsed.strftime("%a %b %d %I:%M %p")
    message_text = (
        f"I have what I need. I can book with {action_payload['provider_name']} "
        f"at {action_payload['location']} for {slot_display}. Confirm to execute."
    )
    return (
        message_text,
        ActionPlan(
            tier=2,
            tool="appointment_book",
            params=action_payload,
            consent_prompt=message_text,
        ),
        True,
    )


def _assistant_reply(message: str, context: dict[str, Any], history: list[dict[str, str]]) -> str:
    clinical = context.get("clinical", {})
    conditions = [row.get("name") for row in clinical.get("conditions", []) if row.get("name")]
    allergies = [row.get("substance") for row in clinical.get("allergies", []) if row.get("substance")]
    active_symptoms = [row.get("symptom") for row in clinical.get("active_symptoms", []) if row.get("symptom")]
    meds = [row.get("name") for row in clinical.get("medications", []) if row.get("name")]
    ranked_options = _ranked_options_with_fallback(history, context)
    booking_defaults = _preference_value_by_key(context, "appointment_booking_defaults") or {}
    known_location = _extract_location_from_text(message) or booking_defaults.get("location")

    lowered = message.lower().strip()
    asks_memory = any(
        phrase in lowered
        for phrase in [
            "what do you remember",
            "what did i tell you",
            "what symptoms",
            "what condition",
            "what do i have",
            "do you remember",
        ]
    )

    if asks_memory:
        parts: list[str] = []
        if conditions:
            parts.append(f"conditions: {', '.join(conditions[:3])}")
        if allergies:
            parts.append(f"allergies: {', '.join(allergies[:3])}")
        if meds:
            parts.append(f"medications: {', '.join(meds[:3])}")
        if active_symptoms:
            parts.append(f"active symptoms: {', '.join(active_symptoms[:4])}")
        if not parts:
            return (
                "I do not have confirmed clinical details yet. "
                "Share your conditions, medications, allergies, or current symptoms and I will track them."
            )
        return (
            "Here is the clinical context I currently have: "
            + "; ".join(parts)
            + ". Tell me what changed and I will update it."
        )

    if ranked_options:
        selected_idx = _selected_option_index(lowered)
        if selected_idx and 1 <= selected_idx <= len(ranked_options):
            selected = ranked_options[selected_idx - 1]
            return (
                f"Great, I can prepare a booking request with {selected['name']} at {selected['location']}. "
                "I will put this into a confirmation step before execution."
            )

    if any(word in lowered for word in ["book", "appointment", "schedule", "blood test", "lab"]):
        if not ranked_options and not known_location:
            return (
                "I can help book that using live nearby discovery, but I need your location first. "
                "Share your city or ZIP code, and I will find and rank real labs/clinics."
            )
        if ranked_options:
            top = ranked_options[0]
            return (
                f"I can prepare booking with one of the ranked options. "
                f"For example, {top['name']} at {top['location']}. "
                "Tell me which option you want, and I will prepare the confirmation."
            )
        return (
            "I can help coordinate this. I can first find and rank nearby labs/clinics, "
            "then prepare a booking action for your confirmation."
        )

    if any(word in lowered for word in ["headache", "pain", "sick", "nausea", "fever", "rash", "dizzy"]):
        return (
            "I can’t diagnose what is causing this, but I can help triage. "
            "If symptoms are severe, worsening, or include chest pain, breathing trouble, confusion, or high fever, "
            "seek urgent care now. Otherwise, I can log your symptoms and help plan next steps."
        )

    if active_symptoms:
        symptom_preview = ", ".join(active_symptoms[:3])
        return (
            f"I noted these active symptoms: {symptom_preview}. "
            "I cannot diagnose, but I can help assess urgency and recommend safe next steps."
        )

    if meds:
        med_name = meds[0]
        return (
            f"I see {med_name} in your medication list. "
            "I can help with refill timing, lab discovery, or appointment planning."
        )

    return (
        "I can help with symptom triage, lab/clinic discovery, appointment booking, and medication refill coordination. "
        "Tell me your symptoms or the action you want to take."
    )


_SYMPTOM_MAP: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"\bheadache(s)?\b", re.IGNORECASE), "headache", "moderate"),
    (re.compile(r"\bskin\b.*\b(hurt|pain|burn|itch)", re.IGNORECASE), "skin pain", "moderate"),
    (re.compile(r"\bfever\b", re.IGNORECASE), "fever", "moderate"),
    (re.compile(r"\bnausea\b", re.IGNORECASE), "nausea", "mild"),
    (re.compile(r"\bdizz(y|iness)\b", re.IGNORECASE), "dizziness", "moderate"),
    (re.compile(r"\bcough(ing)?\b", re.IGNORECASE), "cough", "mild"),
]


def _extract_symptoms(message: str) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for pattern, label, severity in _SYMPTOM_MAP:
        if pattern.search(message):
            found.append((label, severity))
    deduped: dict[str, str] = {}
    for label, severity in found:
        deduped[label] = severity
    return [(label, deduped[label]) for label in deduped]


def _maybe_build_action_plan(
    ctx: ExecutionContext,
    message: str,
    location: str | None,
    history: list[dict[str, str]],
    context: dict[str, Any] | None = None,
) -> ActionPlan | None:
    lower = message.lower()
    ranked_options = _ranked_options_with_fallback(history, context or {})
    booking_defaults = _preference_value_by_key(context or {}, "appointment_booking_defaults") or {}
    inferred_location = location or _extract_location_from_text(message) or booking_defaults.get("location")
    selected_idx = _selected_option_index(lower)

    if ranked_options and selected_idx and 1 <= selected_idx <= len(ranked_options):
        selected = ranked_options[selected_idx - 1]
        action_payload = {
            "provider_name": selected["name"],
            "slot_datetime": to_iso(utc_now() + timedelta(days=7)),
            "location": selected["location"],
            "mode": "simulated",
            "idempotency_key": uuid.uuid4().hex,
        }
        payload_hash = canonical_payload_hash(action_payload)
        consent = container.executor.execute(
            ctx,
            "consent_token_issue",
            {"action_type": "appointment_book", "payload_hash": payload_hash, "expires_in_seconds": 300},
        )
        if consent.status != "succeeded":
            return None
        action_payload["consent_token"] = consent.data["token"]
        action_payload["payload_hash"] = payload_hash
        return ActionPlan(
            tier=2,
            tool="appointment_book",
            params=action_payload,
            consent_prompt=(
                f"I can book with {selected['name']} at {selected['location']} next week. "
                "Confirm to execute."
            ),
        )

    if any(keyword in lower for keyword in ["lab", "clinic", "diagnostic", "test center", "blood test"]):
        if not inferred_location:
            return None
        return ActionPlan(
            tier=1,
            tool="lab_clinic_discovery",
            params={
                "zip_or_geo": inferred_location,
                "max_distance_miles": 10,
                "budget_cap": 120,
                "preferred_time_window": "next_available",
                "in_network_preference": "prefer_in_network",
            },
            consent_prompt="I can find and rank nearby labs and clinics. Proceed?",
        )

    if any(keyword in lower for keyword in ["book", "appointment", "schedule"]):
        action_payload = {
            "provider_name": "Primary Care Provider",
            "slot_datetime": to_iso(utc_now() + timedelta(days=1)),
            "location": inferred_location or "TBD",
            "mode": "simulated",
            "idempotency_key": uuid.uuid4().hex,
        }
        payload_hash = canonical_payload_hash(action_payload)
        consent = container.executor.execute(
            ctx,
            "consent_token_issue",
            {"action_type": "appointment_book", "payload_hash": payload_hash, "expires_in_seconds": 300},
        )
        if consent.status != "succeeded":
            return None
        action_payload["consent_token"] = consent.data["token"]
        action_payload["payload_hash"] = payload_hash
        return ActionPlan(
            tier=2,
            tool="appointment_book",
            params=action_payload,
            consent_prompt="I can book this appointment after your confirmation. Proceed?",
        )

    if any(keyword in lower for keyword in ["refill", "prescription", "medication"]):
        meds = container.memory.clinical.get_medications(ctx.user_id)
        if not meds:
            return None
        first_med = meds[0]
        action_payload = {
            "medication_id": first_med["id"],
            "pharmacy_target": first_med.get("pharmacy_name") or "Preferred pharmacy",
            "idempotency_key": uuid.uuid4().hex,
        }
        payload_hash = canonical_payload_hash(action_payload)
        consent = container.executor.execute(
            ctx,
            "consent_token_issue",
            {"action_type": "medication_refill_request", "payload_hash": payload_hash, "expires_in_seconds": 300},
        )
        if consent.status != "succeeded":
            return None
        action_payload["consent_token"] = consent.data["token"]
        action_payload["payload_hash"] = payload_hash
        return ActionPlan(
            tier=2,
            tool="medication_refill_request",
            params=action_payload,
            consent_prompt="I can prepare a refill request after your confirmation. Proceed?",
        )

    return None


def _write_symptoms_from_chat(ctx: ExecutionContext, message: str) -> list[str]:
    extracted = _extract_symptoms(message)
    if not extracted:
        return []
    written: list[str] = []
    for symptom, severity in extracted:
        symptom_id = _stable_id(f"symptom_{ctx.user_id}", symptom)
        container.memory.clinical_profile_upsert(
            user_id=ctx.user_id,
            session_key=ctx.session_key,
            entity_type="symptom_state",
            operation="update",
            payload={
                "id": symptom_id,
                "symptom": symptom,
                "status": "active",
                "severity": severity,
                "last_confirmed_at": to_iso(utc_now()),
            },
            source="user_direct",
            confidence=1.0,
        )
        written.append(symptom)
    return written


def _normalize_action_result(tool_name: str, result_data: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(result_data)
    if tool_name == "lab_clinic_discovery" and "options" in normalized:
        options = normalized.get("options") or []
        normalized["items"] = [
            {
                "name": item.get("name"),
                "address": item.get("address") or item.get("criteria", {}).get("origin"),
                "distance_m": item.get("distance_miles"),
                "hours": item.get("next_slot"),
                "rank_score": item.get("rank_score"),
                "rank_reason": item.get("rank_reason"),
                "network_match_hint": item.get("network_match_hint"),
                "source_url": item.get("source_url"),
                "contact_phone": item.get("contact_phone"),
                "data_source": item.get("data_source"),
            }
            for item in options
        ]
    if tool_name == "appointment_book":
        artifact = normalized.get("confirmation_artifact") or {}
        confirmation_id = artifact.get("external_ref") or artifact.get("sim_ref")
        if confirmation_id:
            normalized["confirmation_id"] = confirmation_id
        normalized.setdefault("summary", "Booking confirmed")
    if tool_name == "medication_refill_request":
        normalized.setdefault("summary", "Refill request prepared")
    return normalized


@app.get("/profile")
def get_profile(authorization: str | None = Header(default=None)):
    user_id = get_user_id(authorization)
    ctx = _build_ctx(user_id=user_id, session_key=None)
    profile = container.memory.clinical_profile_get(
        user_id=user_id,
        sections=["conditions", "allergies", "medications", "preferences"],
        session_key=ctx.session_key,
    )
    if not profile.get("conditions") and not profile.get("allergies") and not profile.get("medications"):
        return {}
    return {
        "user_id": user_id,
        "conditions": [row.get("name") for row in profile.get("conditions", []) if row.get("name")],
        "allergies": [row.get("substance") for row in profile.get("allergies", []) if row.get("substance")],
        "meds": profile.get("medications", []),
        "family_history": profile.get("family_history"),
        "preferences": profile.get("preferences", {}),
        "updated_at": to_iso(utc_now()),
    }


@app.post("/profile")
def upsert_profile(payload: ProfilePayload, authorization: str | None = Header(default=None)):
    user_id = get_user_id(authorization)
    ctx = _build_ctx(user_id=user_id, session_key=None)

    container.memory.clinical.upsert_profile(
        user_id=user_id,
        profile_payload={
            "timezone": payload.timezone,
            "family_history": payload.family_history,
            "preferences": payload.preferences,
        },
    )
    for condition in payload.conditions:
        container.memory.clinical_profile_upsert(
            user_id=user_id,
            session_key=ctx.session_key,
            entity_type="condition",
            operation="update",
            payload={"id": _stable_id("cond", condition), "name": condition, "status": "active"},
            source="user_direct",
            confidence=1.0,
        )
    for allergy in payload.allergies:
        container.memory.clinical_profile_upsert(
            user_id=user_id,
            session_key=ctx.session_key,
            entity_type="allergy",
            operation="update",
            payload={"id": _stable_id("allergy", allergy), "substance": allergy, "status": "active"},
            source="user_direct",
            confidence=1.0,
        )
    for med in payload.meds:
        med_name = med.get("name", "medication")
        container.memory.clinical_profile_upsert(
            user_id=user_id,
            session_key=ctx.session_key,
            entity_type="medication",
            operation="update",
            payload={"id": _stable_id("med", med_name), **med, "status": "active"},
            source="user_direct",
            confidence=1.0,
        )
    return {"ok": True}


@app.get("/reminders")
def get_reminders(authorization: str | None = Header(default=None)):
    user_id = get_user_id(authorization)
    reminders: list[dict[str, Any]] = []
    today = utc_now()
    for med in container.memory.clinical.get_medications(user_id):
        last_fill = med.get("last_fill_date")
        if not last_fill or not med.get("quantity_dispensed") or not med.get("frequency_per_day"):
            continue
        fill_dt = parse_iso(last_fill)
        if not fill_dt:
            continue
        total_days = float(med["quantity_dispensed"]) / max(float(med["frequency_per_day"]), 0.1)
        due_dt = fill_dt + timedelta(days=total_days)
        days_left = (due_dt.date() - today.date()).days
        if days_left <= 7:
            reminders.append(
                {
                    "med_name": med.get("name", "med"),
                    "days_left": days_left,
                    "recommended_action": "Refill soon",
                }
            )
    return {"refill_reminders": reminders}


@app.post("/symptoms")
def post_symptoms(payload: SymptomPayload, authorization: str | None = Header(default=None)):
    user_id = get_user_id(authorization)
    ctx = _build_ctx(user_id=user_id, session_key=None)
    container.memory.clinical_profile_upsert(
        user_id=user_id,
        session_key=ctx.session_key,
        entity_type="symptom_state",
        operation="create",
        payload={
            "symptom": payload.symptom_text,
            "severity": str(payload.severity),
            "onset_time": payload.onset_time,
            "status": "active",
            "notes": payload.notes,
        },
        source="user_direct",
        confidence=1.0,
    )
    return {"ok": True}


@app.get("/logs/symptoms")
def logs_symptoms(limit: int = 20, authorization: str | None = Header(default=None)):
    user_id = get_user_id(authorization)
    return {"items": container.memory.clinical.get_symptom_logs(user_id, limit)}


@app.get("/logs/actions")
def logs_actions(limit: int = 20, authorization: str | None = Header(default=None)):
    user_id = get_user_id(authorization)
    return {"items": container.memory.clinical.get_action_logs(user_id, limit)}


@app.post("/actions/execute")
def actions_execute(payload: ActionExecuteRequest, authorization: str | None = Header(default=None)):
    user_id = get_user_id(authorization)
    if not payload.user_confirmed:
        raise HTTPException(status_code=400, detail="User not confirmed")

    params = dict(payload.plan.params)
    session_key = payload.session_key or params.get("session_key")
    message_text = " ".join(str(v) for v in params.values() if isinstance(v, str))
    ctx = _build_ctx(user_id=user_id, session_key=session_key, message_text=message_text, user_confirmed=True)

    try:
        resolved_tool = container.registry.resolve(payload.plan.tool)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    outcome = container.executor.execute(ctx, payload.plan.tool, params)
    success = outcome.status in {"succeeded", "partial", "pending"}
    normalized_data = _normalize_action_result(resolved_tool.name, outcome.data)
    if (
        resolved_tool.name == "lab_clinic_discovery"
        and isinstance(normalized_data.get("items"), list)
        and normalized_data["items"]
    ):
        memory_items = []
        for item in normalized_data["items"]:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            location = str(item.get("address") or item.get("location") or "local area").strip()
            if name:
                memory_items.append({"name": name, "location": location or "local area"})
        if memory_items:
            container.memory.conversation.upsert_preference(
                user_id=user_id,
                key="last_lab_discovery",
                value={
                    "session_key": ctx.session_key,
                    "items": memory_items,
                    "updated_at": to_iso(utc_now()),
                },
                source="tool_result",
                confidence=1.0,
            )
    if resolved_tool.name == "appointment_book" and success:
        defaults = {
            "provider_name": params.get("provider_name") or normalized_data.get("provider_name"),
            "location": params.get("location") or normalized_data.get("location"),
            "phone": params.get("phone"),
            "last_slot_datetime": params.get("slot_datetime") or normalized_data.get("slot_datetime"),
            "session_key": ctx.session_key,
            "updated_at": to_iso(utc_now()),
        }
        cleaned_defaults = {k: v for k, v in defaults.items() if v}
        if cleaned_defaults:
            container.memory.conversation.upsert_preference(
                user_id=user_id,
                key="appointment_booking_defaults",
                value=cleaned_defaults,
                source="tool_result",
                confidence=1.0,
            )
    error_message = (outcome.errors[0] or {}).get("message") if outcome.errors else None
    result_payload = {
        **normalized_data,
        "errors": outcome.errors,
        "lifecycle": outcome.lifecycle,
        "action_id": outcome.action_id,
        "message": error_message,
    }
    return {"status": "success" if success else "failure", "result": result_payload}


@app.post("/chat/stream")
def chat_stream(payload: ChatRequest, authorization: str | None = Header(default=None)):
    user_id = get_user_id(authorization)
    client_context = payload.client_context or ClientContext()
    ctx = _build_ctx(
        user_id=user_id,
        session_key=payload.session_key,
        message_text=payload.message,
        user_confirmed=False,
    )

    def event_stream():
        try:
            dump_check = container.memory.check_dump_guard(payload.message)
            if dump_check["blocked"]:
                message = "I can’t provide a broad memory dump. Ask for a specific section instead."
                for chunk in message:
                    yield _emit_sse("token", {"delta": chunk})
                yield _emit_sse("message", {"text": message})
                return

            if ctx.emergency:
                message = (
                    "This may be an emergency. Call 911 or local emergency services now. "
                    "I will not run booking or refill actions in this context."
                )
                for chunk in message:
                    yield _emit_sse("token", {"delta": chunk})
                yield _emit_sse("message", {"text": message})
                container.memory.clinical.append_policy_event(
                    user_id=user_id,
                    session_key=ctx.session_key,
                    event_type="emergency_turn_block",
                    tool_name=None,
                    details={"message": payload.message[:256]},
                )
                return

            written_symptoms = _write_symptoms_from_chat(ctx, payload.message)
            context = container.memory.memory_context(
                user_id=user_id,
                session_key=ctx.session_key,
                query=payload.message,
            )
            context["_session_key"] = ctx.session_key
            booking_reply, booking_plan, booking_handled = _booking_flow_response(
                ctx,
                payload.message,
                payload.history,
                client_context.location_text,
                context,
            )
            reply = booking_reply or _assistant_reply(payload.message, context, payload.history)
            if written_symptoms:
                reply = (
                    f"I logged these symptoms to your active record: {', '.join(written_symptoms)}. "
                    + reply
                )
            container.memory.conversation.add_summary(
                user_id=user_id,
                session_key=ctx.session_key,
                summary_text=payload.message[:400],
                tags=["chat_turn"],
            )
            for chunk in reply:
                yield _emit_sse("token", {"delta": chunk})
            yield _emit_sse("message", {"text": reply})

            if booking_handled:
                plan = booking_plan
            else:
                plan = _maybe_build_action_plan(
                    ctx,
                    payload.message,
                    client_context.location_text,
                    payload.history,
                    context=context,
                )
            if plan:
                yield _emit_sse("action_plan", plan.model_dump())
        except MemoryPolicyError as exc:
            yield _emit_sse("error", {"message": str(exc)})
        except Exception as exc:
            yield _emit_sse("error", {"message": f"Chat pipeline error: {str(exc)}"})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
