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

import httpx
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
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

_ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _load_local_env_file(path: Path) -> None:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not _ENV_KEY_RE.fullmatch(key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def _bootstrap_local_env() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    candidates = [
        repo_root / ".env",
        repo_root / "backend/.env",
        repo_root / "frontend/.env.local",
    ]
    for candidate in candidates:
        if candidate.exists():
            _load_local_env_file(candidate)


_bootstrap_local_env()


def _carebase_only_enabled() -> bool:
    return os.getenv("CAREBASE_ONLY", "false").lower() in {"1", "true", "yes"}


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
    message_text: str | None = None


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
    transactional_tools = {"appointment_book", "medical_purchase", "medication_refill_request"}

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
                "medical_purchase",
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
            supplied_hash = payload.get("payload_hash")
            payload_hash = _tool_params_hash(payload)
            if not token:
                return HookDecision(
                    allowed=False,
                    code="missing_consent_token",
                    message="Consent token required for transactional action.",
                )
            if supplied_hash is not None and str(supplied_hash) != payload_hash:
                return HookDecision(
                    allowed=False,
                    code="invalid_consent_token",
                    message="Consent payload hash mismatch.",
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
        if tool.name in self.transactional_tools and outcome.get("status") in {"succeeded", "partial"}:
            token = payload.get("consent_token")
            if token:
                self.memory.clinical.mark_consent_token_used(token)


def _ensure_not_carebase_only() -> None:
    if _carebase_only_enabled():
        raise HTTPException(
            status_code=410,
            detail="Legacy memory subsystem is disabled. Use CareBase instead.",
        )


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


_TRUSTED_USER_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@-]{1,63}$")


def _validated_trusted_user_id(x_user_id: str) -> str:
    candidate = x_user_id.strip()
    if not candidate:
        raise HTTPException(status_code=400, detail="Invalid X-User-Id")
    if not _TRUSTED_USER_ID_RE.fullmatch(candidate):
        raise HTTPException(status_code=400, detail="Invalid X-User-Id")
    return candidate


def get_user_id(auth_header: str | None) -> str:
    if not auth_header:
        if os.getenv("ALLOW_ANON", "false").lower() == "true":
            return "demo-user"
        raise HTTPException(status_code=401, detail="Missing Authorization")
    raw = auth_header.replace("Bearer", "", 1).strip()
    if not raw:
        if os.getenv("ALLOW_ANON", "false").lower() == "true":
            return "demo-user"
        raise HTTPException(status_code=401, detail="Missing Authorization")
    # Treat bearer token as opaque unless verified by a trusted upstream.
    # Do not trust unsigned/unchecked JWT claims for identity.

    if len(raw) > 96:
        return f"token_{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:24]}"
    return raw


def resolve_user_id(authorization: str | None, x_user_id: str | None) -> str:
    if x_user_id is not None:
        return _validated_trusted_user_id(x_user_id)
    return get_user_id(authorization)


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


_OPENAI_API_BASE = os.getenv("OPENAI_API_BASE_URL", "https://api.openai.com/v1").rstrip("/")
_OPENROUTER_API_BASE = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
_DEDALUS_API_BASE = os.getenv("DEDALUS_BASE_URL", os.getenv("DEDALUS_API_BASE_URL", "https://api.dedaluslabs.ai/v1")).rstrip("/")
_ANTHROPIC_API_BASE = os.getenv("ANTHROPIC_API_BASE_URL", "https://api.anthropic.com/v1").rstrip("/")
_MAX_AUDIO_BYTES = int(os.getenv("CAREPILOT_MAX_AUDIO_BYTES", str(20 * 1024 * 1024)))
_MAX_DOCUMENT_BYTES = int(os.getenv("CAREPILOT_MAX_DOCUMENT_BYTES", str(25 * 1024 * 1024)))
_ALLOWED_AUDIO_MIME_TYPES = {
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/m4a",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "audio/ogg",
}
_ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".mp4", ".m4a", ".wav", ".webm", ".ogg", ".flac"}
_ALLOWED_DOCUMENT_MIME_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "text/plain",
    "text/csv",
}
_ALLOWED_DOCUMENT_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".txt", ".csv"}
_FILE_CATEGORIES = {"lab_report", "imaging_report", "clinical_note", "voice_attachment", "other"}
_HIGH_RISK_MARKERS = {
    "stroke",
    "hemorrhage",
    "intracranial bleed",
    "aneurysm",
    "pulmonary embol",
    "critical",
    "urgent",
    "malignancy",
    "mass effect",
    "sepsis",
    "anaphylaxis",
    "myocardial infarction",
    "troponin",
}


def _require_openai_api_key() -> str:
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="OpenAI API key is not configured.")
    return api_key


def _normalize_upload_filename(upload: UploadFile | None, fallback_name: str) -> str:
    file_name = (upload.filename or "").strip() if upload else ""
    return file_name or fallback_name


def _extension_from_filename(file_name: str) -> str:
    return Path(file_name).suffix.lower().strip()


async def _read_upload_bytes(upload: UploadFile, *, max_bytes: int, too_large_detail: str) -> bytes:
    raw = await upload.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise HTTPException(status_code=413, detail=too_large_detail)
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    return raw


def _provider_error_message(response: httpx.Response) -> str:
    message = response.text.strip()
    try:
        payload = response.json()
    except Exception:
        payload = None
    if isinstance(payload, dict):
        err = payload.get("error")
        if isinstance(err, dict):
            msg = err.get("message")
            if isinstance(msg, str) and msg.strip():
                return msg.strip()
        msg = payload.get("message")
        if isinstance(msg, str) and msg.strip():
            return msg.strip()
    return message or f"HTTP {response.status_code}"


def _extract_json_object(raw_text: str) -> dict[str, Any] | None:
    text = (raw_text or "").strip()
    if not text:
        return None
    try:
        payload = json.loads(text)
        if isinstance(payload, dict):
            return payload
    except json.JSONDecodeError:
        pass

    for start_idx in [idx for idx, char in enumerate(text) if char == "{"]:
        depth = 0
        for end_idx in range(start_idx, len(text)):
            char = text[end_idx]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
            if depth == 0:
                candidate = text[start_idx : end_idx + 1]
                try:
                    payload = json.loads(candidate)
                    if isinstance(payload, dict):
                        return payload
                except json.JSONDecodeError:
                    break
    return None


def _coerce_completion_text(response_json: dict[str, Any]) -> str:
    choices = response_json.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    message = choices[0].get("message", {})
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text_value = item.get("text")
                if isinstance(text_value, str):
                    parts.append(text_value)
        return "\n".join(parts)
    return ""


def _chat_provider_candidates() -> list[dict[str, Any]]:
    provider_preference = (os.getenv("CAREPILOT_CHAT_PROVIDER") or "auto").strip().lower()
    candidates: list[dict[str, Any]] = []

    anthropic_api_key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    if anthropic_api_key:
        candidates.append(
            {
                "provider": "anthropic",
                "base_url": _ANTHROPIC_API_BASE,
                "api_key": anthropic_api_key,
                "model": (os.getenv("ANTHROPIC_MODEL") or "claude-3-5-sonnet-latest").strip(),
            }
        )

    dedalus_api_key = (os.getenv("DEDALUS_API_KEY") or "").strip()
    if dedalus_api_key:
        candidates.append(
            {
                "provider": "dedalus",
                "base_url": _DEDALUS_API_BASE or _OPENROUTER_API_BASE or _OPENAI_API_BASE,
                "api_key": dedalus_api_key,
                "model": (os.getenv("DEDALUS_MODEL") or "anthropic/claude-opus-4-5").strip(),
            }
        )

    openrouter_api_key = (os.getenv("OPENROUTER_API_KEY") or "").strip()
    if openrouter_api_key:
        candidates.append(
            {
                "provider": "openrouter",
                "base_url": _OPENROUTER_API_BASE,
                "api_key": openrouter_api_key,
                "model": (os.getenv("OPENROUTER_MODEL") or "openai/gpt-4o-mini").strip(),
            }
        )

    openai_api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if openai_api_key:
        candidates.append(
            {
                "provider": "openai",
                "base_url": _OPENAI_API_BASE,
                "api_key": openai_api_key,
                "model": (os.getenv("CAREPILOT_CHAT_MODEL") or "gpt-4o-mini").strip(),
            }
        )

    if provider_preference in {"", "auto"}:
        return candidates

    aliases = {
        "claude": "anthropic",
        "anthropic": "anthropic",
        "dedalus": "dedalus",
        "openrouter": "openrouter",
        "openai": "openai",
    }
    canonical = aliases.get(provider_preference)
    if not canonical:
        return candidates
    preferred = [candidate for candidate in candidates if candidate["provider"] == canonical]
    others = [candidate for candidate in candidates if candidate["provider"] != canonical]
    return preferred + others


def _llm_context_snapshot(context: dict[str, Any]) -> dict[str, Any]:
    clinical = context.get("clinical", {}) if isinstance(context.get("clinical"), dict) else {}
    conditions = [row.get("name") for row in clinical.get("conditions", []) if isinstance(row, dict) and row.get("name")]
    allergies = [
        row.get("substance")
        for row in clinical.get("allergies", [])
        if isinstance(row, dict) and row.get("substance")
    ]
    active_symptoms = [
        row.get("symptom")
        for row in clinical.get("active_symptoms", [])
        if isinstance(row, dict) and row.get("symptom")
    ]
    medications = [row.get("name") for row in clinical.get("medications", []) if isinstance(row, dict) and row.get("name")]
    booking_defaults = _booking_defaults_from_context(context)
    last_discovery = _preference_value_by_key(context, "last_lab_discovery") or {}
    ranked_options = _ranked_options_with_fallback([], context)
    return {
        "conditions": conditions[:8],
        "allergies": allergies[:8],
        "active_symptoms": active_symptoms[:8],
        "medications": medications[:8],
        "booking_defaults": booking_defaults,
        "last_lab_discovery": last_discovery,
        "ranked_options": ranked_options[:5],
    }


def _coerce_anthropic_text(response_json: dict[str, Any]) -> str:
    content = response_json.get("content")
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") != "text":
            continue
        text_value = item.get("text")
        if isinstance(text_value, str) and text_value.strip():
            parts.append(text_value.strip())
    return "\n".join(parts).strip()


def _openai_compatible_chat(
    *,
    provider: dict[str, Any],
    messages: list[dict[str, str]],
    timeout_seconds: float,
) -> str | None:
    payload = {
        "model": provider["model"],
        "temperature": 0.35,
        "messages": messages,
    }
    headers: dict[str, str] = {
        "Authorization": f"Bearer {provider['api_key']}",
        "Content-Type": "application/json",
    }
    site_url = (os.getenv("OPENROUTER_SITE_URL") or "").strip()
    app_name = (os.getenv("OPENROUTER_APP_NAME") or "MedClaw").strip()
    if provider["provider"] in {"dedalus", "openrouter"}:
        if site_url:
            headers["HTTP-Referer"] = site_url
        if app_name:
            headers["X-Title"] = app_name
    with httpx.Client(timeout=httpx.Timeout(timeout_seconds, connect=8.0)) as client:
        response = client.post(f"{provider['base_url']}/chat/completions", headers=headers, json=payload)
    if response.status_code >= 400:
        raise RuntimeError(_provider_error_message(response))
    completion_payload = response.json()
    text = _coerce_completion_text(completion_payload).strip()
    return text or None


def _anthropic_chat(
    *,
    provider: dict[str, Any],
    system_prompt: str,
    context_snapshot: dict[str, Any],
    history: list[dict[str, str]],
    user_message: str,
    timeout_seconds: float,
) -> str | None:
    anthropic_messages: list[dict[str, str]] = []
    for turn in history:
        role = str(turn.get("role") or "").strip().lower()
        if role not in {"user", "assistant"}:
            continue
        content = str(turn.get("content") or "").strip()
        if not content:
            continue
        anthropic_messages.append({"role": role, "content": content[:1200]})
    anthropic_messages.append({"role": "user", "content": user_message.strip()[:2000]})

    system_with_context = (
        f"{system_prompt}\n\n"
        "Session context JSON (use this for continuity and personalization):\n"
        f"{json.dumps(context_snapshot, ensure_ascii=True)}"
    )
    payload = {
        "model": provider["model"],
        "max_tokens": 700,
        "temperature": 0.35,
        "system": system_with_context,
        "messages": anthropic_messages,
    }
    headers = {
        "x-api-key": str(provider["api_key"]),
        "anthropic-version": os.getenv("ANTHROPIC_API_VERSION", "2023-06-01"),
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=httpx.Timeout(timeout_seconds, connect=8.0)) as client:
        response = client.post(f"{provider['base_url']}/messages", headers=headers, json=payload)
    if response.status_code >= 400:
        raise RuntimeError(_provider_error_message(response))
    completion_payload = response.json()
    text = _coerce_anthropic_text(completion_payload)
    return text or None


def _llm_chat_reply(
    *,
    message: str,
    context: dict[str, Any],
    history: list[dict[str, str]],
    fallback_reply: str,
) -> str:
    providers = _chat_provider_candidates()
    if not providers:
        print("chat llm unavailable: no provider key found in runtime env")  # noqa: T201
        return fallback_reply

    # Keep tool execution deterministic, but use an LLM for user-facing phrasing and continuity.
    system_prompt = (
        "You are MedClaw, a pragmatic and warm health support assistant. "
        "Sound human, natural, and concise. Avoid robotic boilerplate. "
        "Maintain continuity with the user's current goal and recent context; do not switch topics abruptly. "
        "For symptoms, provide likely possibilities and practical next steps, clearly marking uncertainty. "
        "Never claim a confirmed diagnosis, and do not replace urgent emergency instructions."
    )

    context_snapshot = _llm_context_snapshot(context)
    recent_history = [turn for turn in history[-10:] if isinstance(turn, dict)]
    openai_messages: list[dict[str, str]] = [
        {"role": "system", "content": system_prompt},
        {
            "role": "system",
            "content": (
                "Session context JSON (use this for continuity and personalization):\n"
                + json.dumps(context_snapshot, ensure_ascii=True)
            ),
        },
        *[
            {
                "role": str(turn.get("role") or "").strip().lower(),
                "content": str(turn.get("content") or "").strip()[:1200],
            }
            for turn in recent_history
            if str(turn.get("role") or "").strip().lower() in {"user", "assistant"}
            and str(turn.get("content") or "").strip()
        ],
        {"role": "user", "content": message.strip()[:2000]},
    ]
    timeout_seconds = float(os.getenv("CAREPILOT_CHAT_TIMEOUT_SECONDS", "25"))
    for provider in providers:
        provider_name = str(provider.get("provider") or "unknown")
        try:
            if provider_name == "anthropic":
                text = _anthropic_chat(
                    provider=provider,
                    system_prompt=system_prompt,
                    context_snapshot=context_snapshot,
                    history=openai_messages[2:-1],
                    user_message=message,
                    timeout_seconds=timeout_seconds,
                )
            else:
                text = _openai_compatible_chat(
                    provider=provider,
                    messages=openai_messages,
                    timeout_seconds=timeout_seconds,
                )
            if text:
                print(f"chat llm provider used ({provider_name})")  # noqa: T201
                return text
            print(f"chat llm provider empty response ({provider_name})")  # noqa: T201
        except Exception as exc:
            print(f"chat llm call failed ({provider_name}): {exc}")  # noqa: T201
            continue
    return fallback_reply


def _estimate_transcription_confidence(segments: list[dict[str, Any]]) -> float:
    if not segments:
        return 0.8
    scores: list[float] = []
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        local_scores: list[float] = []
        avg_logprob = segment.get("avg_logprob")
        if isinstance(avg_logprob, (int, float)):
            local_scores.append(max(0.0, min(1.0, 1.0 + (float(avg_logprob) / 2.5))))
        no_speech_prob = segment.get("no_speech_prob")
        if isinstance(no_speech_prob, (int, float)):
            local_scores.append(max(0.0, min(1.0, 1.0 - float(no_speech_prob))))
        if local_scores:
            scores.append(sum(local_scores) / len(local_scores))
    if not scores:
        return 0.8
    return round(max(0.0, min(1.0, sum(scores) / len(scores))), 3)


def _openai_whisper_transcribe(
    *,
    file_name: str,
    mime_type: str,
    audio_bytes: bytes,
    language_hint: str | None,
    prompt: str | None,
) -> dict[str, Any]:
    api_key = _require_openai_api_key()
    model = (os.getenv("CAREPILOT_WHISPER_MODEL") or "whisper-1").strip()
    payload: dict[str, Any] = {"model": model, "response_format": "verbose_json"}
    if language_hint:
        payload["language"] = language_hint.strip()
    if prompt:
        payload["prompt"] = prompt.strip()

    files = {"file": (file_name, audio_bytes, mime_type or "application/octet-stream")}
    headers = {"Authorization": f"Bearer {api_key}"}

    try:
        with httpx.Client(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            response = client.post(
                f"{_OPENAI_API_BASE}/audio/transcriptions",
                headers=headers,
                data=payload,
                files=files,
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Transcription provider timed out.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Failed to reach transcription provider.") from exc

    if response.status_code >= 400:
        provider_error = _provider_error_message(response)
        if response.status_code == 401:
            raise HTTPException(status_code=503, detail="OpenAI API key was rejected by provider.")
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail="Transcription provider is rate-limited. Retry shortly.")
        raise HTTPException(status_code=502, detail=f"Transcription failed: {provider_error}")

    try:
        payload_json = response.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Transcription provider returned invalid JSON.") from exc

    transcript_text = str(payload_json.get("text") or "").strip()
    if not transcript_text:
        raise HTTPException(status_code=502, detail="Transcription provider returned empty text.")
    raw_segments = payload_json.get("segments")
    segments = raw_segments if isinstance(raw_segments, list) else []
    confidence = _estimate_transcription_confidence([item for item in segments if isinstance(item, dict)])
    return {
        "transcript_text": transcript_text,
        "confidence": confidence,
        "segments": [item for item in segments if isinstance(item, dict)],
        "provider_payload": payload_json,
    }


def _resolve_document_category(file_name: str, mime_type: str, explicit_category: str | None) -> str:
    if explicit_category and explicit_category.strip():
        normalized = explicit_category.strip().lower()
        if normalized not in _FILE_CATEGORIES:
            raise HTTPException(status_code=400, detail="Invalid file_category value.")
        return normalized
    lowered_name = file_name.lower()
    if mime_type.startswith("image/"):
        return "imaging_report"
    if "imaging" in lowered_name or "mri" in lowered_name or "ct" in lowered_name or "xray" in lowered_name:
        return "imaging_report"
    if "lab" in lowered_name or "cbc" in lowered_name or "panel" in lowered_name:
        return "lab_report"
    return "other"


def _extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    decoded = pdf_bytes.decode("latin-1", errors="ignore")
    snippets: list[str] = []
    for match in re.finditer(r"\(([^()]{2,300})\)", decoded):
        chunk = match.group(1)
        chunk = chunk.replace("\\n", " ").replace("\\r", " ").replace("\\t", " ").replace("\\)", ")").replace(
            "\\(", "("
        )
        chunk = re.sub(r"\s+", " ", chunk).strip()
        if len(chunk) >= 3 and any(ch.isalpha() for ch in chunk):
            snippets.append(chunk)
    for match in re.finditer(rb"[A-Za-z][A-Za-z0-9\-\s,.:/%()]{4,160}", pdf_bytes):
        chunk = match.group(0).decode("latin-1", errors="ignore")
        chunk = re.sub(r"\s+", " ", chunk).strip()
        if len(chunk) >= 5 and any(ch.isalpha() for ch in chunk):
            snippets.append(chunk)
    deduped: list[str] = []
    seen: set[str] = set()
    for snippet in snippets:
        lowered = snippet.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(snippet)
        if len(deduped) >= 500:
            break
    return "\n".join(deduped)[:20000]


def _extract_document_text(file_name: str, mime_type: str, document_bytes: bytes) -> tuple[str, float, str]:
    ext = _extension_from_filename(file_name)
    if mime_type.startswith("text/") or ext in {".txt", ".csv", ".json", ".md"}:
        text = document_bytes.decode("utf-8", errors="ignore").strip()
        confidence = 0.95 if text else 0.0
        return text, confidence, "direct_text"
    if mime_type == "application/pdf" or ext == ".pdf":
        text = _extract_text_from_pdf_bytes(document_bytes).strip()
        confidence = 0.8 if len(text) > 200 else 0.45 if len(text) > 40 else 0.2
        return text, confidence, "pdf_text_extract"
    if mime_type.startswith("image/") or ext in {".png", ".jpg", ".jpeg", ".webp"}:
        return "", 0.0, "image_no_local_ocr"
    text = document_bytes.decode("utf-8", errors="ignore").strip()
    confidence = 0.4 if text else 0.0
    return text, confidence, "generic_extract"


def _normalize_follow_up_questions(raw_questions: Any) -> list[str]:
    questions: list[str] = []
    if isinstance(raw_questions, list):
        for item in raw_questions:
            if not isinstance(item, str):
                continue
            cleaned = re.sub(r"\s+", " ", item).strip()
            if cleaned:
                questions.append(cleaned)
    if len(questions) >= 3:
        return questions[:5]
    while len(questions) < 3:
        defaults = [
            "What findings should I discuss first with my clinician?",
            "Do these findings require repeat testing or comparison with prior results?",
            "What warning signs should prompt urgent in-person care?",
        ]
        questions.append(defaults[len(questions)])
    return questions[:5]


def _is_high_risk_content(text: str) -> tuple[bool, list[str]]:
    lowered = text.lower()
    matched = sorted({marker for marker in _HIGH_RISK_MARKERS if marker in lowered})
    return bool(matched), matched


def _fallback_document_interpretation(extracted_text: str, user_question: str | None) -> dict[str, Any]:
    lines = [line.strip() for line in extracted_text.splitlines() if line.strip()]
    key_findings = lines[:3] if lines else ["I could not reliably extract structured findings from the file."]
    question = (user_question or "").strip()
    summary = (
        "I extracted limited text from your document and summarized the most visible items."
        if lines
        else "I could not extract enough text to summarize details confidently."
    )
    if question:
        summary += f" I focused on your question: {question[:180]}."
    return {
        "key_findings": key_findings,
        "plain_language_summary": summary,
        "follow_up_questions": _normalize_follow_up_questions([]),
        "uncertainty_statement": "This extraction is limited and may miss details.",
        "safety_guidance": "",
        "urgency_level": "routine",
        "high_risk_flags": [],
    }


def _enforce_document_safety(
    *,
    interpretation: dict[str, Any],
    extracted_text: str,
    category: str,
) -> dict[str, Any]:
    raw_findings = interpretation.get("key_findings")
    key_findings = []
    if isinstance(raw_findings, list):
        for value in raw_findings:
            if isinstance(value, str):
                cleaned = re.sub(r"\s+", " ", value).strip()
                if cleaned:
                    key_findings.append(cleaned)
    key_findings = key_findings[:6]

    raw_summary = interpretation.get("plain_language_summary")
    summary = re.sub(r"\s+", " ", str(raw_summary or "")).strip()
    if not summary:
        summary = "I could not confidently extract enough detail for a full summary."
    if "not a diagnosis" not in summary.lower():
        summary = f"This is an informational summary, not a diagnosis. {summary}"

    uncertainty = re.sub(r"\s+", " ", str(interpretation.get("uncertainty_statement") or "")).strip()
    if not uncertainty:
        uncertainty = "Some findings may be incomplete or uncertain from this file alone."

    high_risk_interpret = interpretation.get("high_risk_flags")
    high_risk_flags: list[str] = []
    if isinstance(high_risk_interpret, list):
        for value in high_risk_interpret:
            if isinstance(value, str) and value.strip():
                high_risk_flags.append(value.strip().lower())
    high_risk_from_text, matched_markers = _is_high_risk_content(
        "\n".join(key_findings + [summary, extracted_text, " ".join(high_risk_flags)])
    )
    merged_high_risk = sorted(set(high_risk_flags + matched_markers))

    urgency_level = str(interpretation.get("urgency_level") or "routine").strip().lower()
    if urgency_level not in {"routine", "urgent"}:
        urgency_level = "routine"
    if high_risk_from_text:
        urgency_level = "urgent"

    safety_guidance = re.sub(r"\s+", " ", str(interpretation.get("safety_guidance") or "")).strip()
    if urgency_level == "urgent":
        if not safety_guidance:
            safety_guidance = (
                "Some findings may need urgent clinical review today. "
                "If you have severe symptoms (for example chest pain, breathing trouble, confusion, or severe weakness), "
                "seek emergency care now."
            )
    elif not safety_guidance:
        safety_guidance = (
            "Review this with a licensed clinician who can interpret it in the context of your history and exam."
        )

    follow_up_questions = _normalize_follow_up_questions(interpretation.get("follow_up_questions"))
    if category == "imaging_report" and all("image" not in question.lower() for question in follow_up_questions):
        follow_up_questions[0] = "How do these report findings compare to my prior imaging, if available?"

    return {
        "key_findings": key_findings,
        "plain_language_summary": summary,
        "follow_up_questions": follow_up_questions,
        "uncertainty_statement": uncertainty,
        "safety_guidance": safety_guidance,
        "urgency_level": urgency_level,
        "high_risk_flags": merged_high_risk,
    }


def _openai_document_interpret(
    *,
    file_name: str,
    mime_type: str,
    document_bytes: bytes,
    extracted_text: str,
    category: str,
    user_question: str | None,
) -> dict[str, Any]:
    api_key = _require_openai_api_key()
    model = (os.getenv("CAREPILOT_DOCUMENT_MODEL") or "gpt-4o-mini").strip()

    prompt_lines = [
        "You are a clinical documentation assistant.",
        "Return JSON only with keys: key_findings, plain_language_summary, follow_up_questions, uncertainty_statement, safety_guidance, urgency_level, high_risk_flags.",
        "Rules: keep uncertainty explicit, never provide diagnosis, never claim treatment certainty, suggest clinician follow-up.",
        "urgency_level must be routine or urgent.",
        f"file_name: {file_name}",
        f"file_category: {category}",
    ]
    if user_question and user_question.strip():
        prompt_lines.append(f"user_question: {user_question.strip()[:500]}")
    if extracted_text:
        prompt_lines.append("extracted_text:")
        prompt_lines.append(extracted_text[:12000])
    else:
        prompt_lines.append("No local text extraction was available.")

    user_content: list[dict[str, Any]] = [{"type": "text", "text": "\n".join(prompt_lines)}]
    if mime_type.startswith("image/"):
        image_data_url = f"data:{mime_type};base64,{base64.b64encode(document_bytes).decode('ascii')}"
        user_content.append({"type": "image_url", "image_url": {"url": image_data_url}})

    payload = {
        "model": model,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": "Provide a safe, non-diagnostic medical document summary in strict JSON."},
            {"role": "user", "content": user_content},
        ],
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    try:
        with httpx.Client(timeout=httpx.Timeout(90.0, connect=10.0)) as client:
            response = client.post(f"{_OPENAI_API_BASE}/chat/completions", headers=headers, json=payload)
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Document interpretation provider timed out.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Failed to reach document interpretation provider.") from exc

    if response.status_code >= 400:
        provider_error = _provider_error_message(response)
        if response.status_code == 401:
            raise HTTPException(status_code=503, detail="OpenAI API key was rejected by provider.")
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail="Document interpretation provider is rate-limited.")
        raise HTTPException(status_code=502, detail=f"Document interpretation failed: {provider_error}")

    try:
        completion_payload = response.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Document interpretation provider returned invalid JSON.") from exc

    content_text = _coerce_completion_text(completion_payload)
    parsed = _extract_json_object(content_text)
    if parsed is None:
        raise HTTPException(status_code=502, detail="Document interpretation provider returned non-JSON output.")
    return parsed


def _build_document_findings(
    *,
    key_findings: list[str],
    extraction_confidence: float,
    extraction_method: str,
    source_label: str,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for finding in key_findings:
        lowered = finding.lower()
        is_abnormal = any(token in lowered for token in ["abnormal", "elevated", "low", "high", "critical"])
        findings.append(
            {
                "finding_type": "document_finding",
                "label": finding[:180],
                "value_text": finding[:500],
                "is_abnormal": is_abnormal,
                "confidence": extraction_confidence,
                "provenance": {
                    "source": source_label,
                    "extraction_method": extraction_method,
                },
            }
        )
    return findings


def _select_upload(primary: UploadFile | None, fallback: UploadFile | None, *, field_hint: str) -> UploadFile:
    upload = primary or fallback
    if upload is None:
        raise HTTPException(status_code=400, detail=f"Missing multipart file field '{field_hint}'.")
    return upload


def _validate_audio_upload(file_name: str, mime_type: str) -> None:
    ext = _extension_from_filename(file_name)
    if mime_type not in _ALLOWED_AUDIO_MIME_TYPES and ext not in _ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported audio format.")


def _validate_document_upload(file_name: str, mime_type: str) -> None:
    ext = _extension_from_filename(file_name)
    if mime_type not in _ALLOWED_DOCUMENT_MIME_TYPES and ext not in _ALLOWED_DOCUMENT_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Unsupported document/image format.")


def _normalize_ranked_option_location(location: str | None) -> str:
    candidate = re.sub(r"\s+", " ", str(location or "")).strip(" .")
    if not candidate:
        return "local area"
    lowered = candidate.lower()
    if lowered in {"hello", "hi", "hey", "hey there", "ok", "okay", "thanks", "thank you"}:
        return "local area"
    return candidate


def _extract_ranked_options_from_history(history: list[dict[str, str]]) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = []
    list_pattern = re.compile(r"^\s*(\d+)[\).:-]\s*(?:\*\*)?(.+?)(?:\*\*)?\s*(?:[—-]\s*(.+?))?\s*$")

    def _append_option(name: str, location: str | None, source_url: str | None = None) -> None:
        cleaned_name = (name or "").strip()
        if not cleaned_name:
            return
        cleaned_location = _normalize_ranked_option_location(location)
        cleaned_source_url = str(source_url or "").strip() or None
        key = f"{cleaned_name.lower()}::{cleaned_location.lower()}::{str(cleaned_source_url).lower()}"
        if any(
            f"{row['name'].lower()}::{row['location'].lower()}::{str(row.get('source_url')).lower()}" == key
            for row in options
        ):
            return
        options.append({"name": cleaned_name, "location": cleaned_location, "source_url": cleaned_source_url})

    def _extract_from_json_blob(content: str) -> list[dict[str, Any]]:
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

        extracted: list[dict[str, Any]] = []
        if isinstance(payload, dict) and isinstance(payload.get("items"), list):
            for item in payload["items"]:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "").strip()
                location = _normalize_ranked_option_location(str(item.get("address") or item.get("location") or ""))
                source_url = str(item.get("source_url") or item.get("url") or "").strip() or None
                if name:
                    extracted.append({"name": name, "location": location, "source_url": source_url})
        elif isinstance(payload, dict) and isinstance(payload.get("options"), list):
            for item in payload["options"]:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or "").strip()
                criteria = item.get("criteria") if isinstance(item.get("criteria"), dict) else {}
                location = _normalize_ranked_option_location(str(criteria.get("origin") or item.get("location") or ""))
                source_url = str(item.get("source_url") or item.get("url") or "").strip() or None
                if name:
                    extracted.append({"name": name, "location": location, "source_url": source_url})
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
                _append_option(row["name"], row["location"], row.get("source_url"))
            break
    return options


def _extract_ranked_options_from_conversation_memory(context: dict[str, Any]) -> list[dict[str, Any]]:
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
        options: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            location = _normalize_ranked_option_location(str(item.get("location") or item.get("address") or ""))
            source_url = str(item.get("source_url") or item.get("url") or "").strip() or None
            if name:
                options.append({"name": name, "location": location, "source_url": source_url})
        if options:
            return options
    return []


def _ranked_options_with_fallback(history: list[dict[str, str]], context: dict[str, Any]) -> list[dict[str, Any]]:
    options = _extract_ranked_options_from_history(history)
    if options:
        return options
    return _extract_ranked_options_from_conversation_memory(context)


def _booking_mode_from_env() -> str:
    disable_external = os.getenv("CAREPILOT_DISABLE_EXTERNAL_WEB", "false").strip().lower() == "true"
    return "simulated" if disable_external else "live"


def _selected_option_index(message: str) -> int | None:
    lowered = message.lower()
    numeric_match = re.search(r"\b(?:option|open|pick|choose|select)\s*([1-5])\b", lowered)
    if numeric_match:
        return int(numeric_match.group(1))
    leading_numeric = re.match(r"^\s*([1-5])(?:\s|$)", lowered)
    if leading_numeric:
        return int(leading_numeric.group(1))
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

_TEMPORAL_LOCATION_TOKEN_RE = re.compile(
    r"\b(?:"
    r"today|tomorrow|tonight|"
    r"this\s+(?:morning|afternoon|evening|week)|"
    r"next\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|"
    r"monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
    r"\d{1,2}(?::\d{2})?\s*(?:am|pm)|"
    r"morning|afternoon|evening|night"
    r")\b",
    flags=re.IGNORECASE,
)

_TRAILING_LOCATION_CONNECTOR_RE = re.compile(r"\b(?:at|on|for|by|around|near|in)\s*$", flags=re.IGNORECASE)


def _sanitize_location_candidate(candidate: str) -> str | None:
    text = re.sub(r"\s+", " ", candidate or "").strip(" .,-")
    if not text:
        return None

    temporal_match = _TEMPORAL_LOCATION_TOKEN_RE.search(text)
    if temporal_match:
        text = text[: temporal_match.start()].strip(" .,-")
    text = _TRAILING_LOCATION_CONNECTOR_RE.sub("", text).strip(" .,-")
    if not text:
        return None
    lowered = text.lower()
    if lowered in {"the", "a", "an"}:
        return None
    return text


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


def _booking_defaults_from_context(context: dict[str, Any]) -> dict[str, Any]:
    booking_defaults = _preference_value_by_key(context, "appointment_booking_defaults") or {}
    purchase_defaults = _preference_value_by_key(context, "medical_purchase_defaults") or {}
    merged = dict(booking_defaults)
    for key in ("full_name", "email", "phone"):
        if not merged.get(key) and purchase_defaults.get(key):
            merged[key] = purchase_defaults[key]
    return merged


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
    text = message.strip()
    if not text:
        return None

    zip_only = re.fullmatch(r"\d{5}(?:-\d{4})?", text)
    if zip_only:
        return zip_only.group(0)

    zip_labeled = re.search(r"\bzip(?:\s*code)?[:\s-]*(\d{5}(?:-\d{4})?)\b", text, flags=re.IGNORECASE)
    if zip_labeled:
        return zip_labeled.group(1)

    match = re.search(
        r"\b(?:in|near|around)\s+([A-Za-z0-9][A-Za-z0-9 .,\'-]{1,80})(?=$|[?.!])",
        text,
        flags=re.IGNORECASE,
    )
    if match:
        candidate = _sanitize_location_candidate(match.group(1))
        if not candidate:
            return None
        lowered = candidate.lower()
        if candidate and lowered not in {"the morning", "the afternoon", "the evening", "next week"}:
            return candidate

    # Support short bare location replies like "Pittsburgh" when this turn is likely filling a location slot.
    if re.fullmatch(r"[A-Za-z][A-Za-z .,\'-]{1,80}", text):
        candidate = _sanitize_location_candidate(text)
        if not candidate:
            return None
        lowered = candidate.lower()
        if re.search(r"\b(book|appointment|schedule)\b", lowered):
            return None
        if any(token in lowered for token in ["option", "first", "second", "third", "fourth", "fifth"]):
            return None
        if lowered.startswith(("open ", "pick ", "choose ", "select ")):
            return None
        if re.search(r"\b(how|what|who|can|could|would|should|do|are|is|am)\b", lowered):
            return None
        stopwords = {
            "yes",
            "no",
            "hi",
            "hello",
            "hey",
            "hey there",
            "thanks",
            "thank you",
            "okay",
            "ok",
            "tomorrow",
            "today",
            "next week",
            "next month",
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
            "tonight",
            "morning",
            "afternoon",
            "evening",
            "night",
        }
        if lowered not in stopwords and len(lowered.split()) <= 4:
            return candidate
    return None


_URGENT_TRIAGE_HINT_RE = re.compile(
    r"\b(?:"
    r"high fever|persistent fever|"
    r"severe pain|worsening pain|"
    r"fainting|syncope|"
    r"shortness of breath|difficulty breathing|"
    r"vomiting|dehydration|"
    r"blood pressure|hypertension spike|"
    r"infection|urgent care"
    r")\b",
    flags=re.IGNORECASE,
)


def _triage_tier_from_text(message: str) -> str:
    text = (message or "").strip()
    if not text:
        return "ROUTINE"
    if container.policy.is_emergency_text(text):
        return "EMERGENT"
    if _URGENT_TRIAGE_HINT_RE.search(text):
        return "URGENT_24H"
    return "ROUTINE"


def _needs_location_reprompt(message: str, history: list[dict[str, str]]) -> bool:
    if not _history_requested_location(history):
        return False
    if _extract_location_from_text(message):
        return False
    lowered = message.lower().strip()
    if not lowered:
        return True
    if _selected_option_index(lowered):
        return False
    if any(token in lowered for token in ["book", "appointment", "schedule", "lab", "clinic", "blood test"]):
        return False
    return True


def _history_has_booking_or_lab_intent(history: list[dict[str, str]]) -> bool:
    intent_tokens = ["book", "appointment", "schedule", "lab", "clinic", "blood test", "diagnostic"]
    for item in reversed(history):
        if item.get("role") != "user":
            continue
        content = item.get("content", "").lower()
        if any(token in content for token in intent_tokens):
            return True
    return False


def _history_requested_location(history: list[dict[str, str]]) -> bool:
    location_prompts = [
        "need your location first",
        "share your city or zip code",
        "what location or city should i use",
    ]
    for item in reversed(history):
        if item.get("role") != "assistant":
            continue
        content = item.get("content", "").lower()
        if any(prompt in content for prompt in location_prompts):
            return True
    return False


def _history_requested_booking_details(history: list[dict[str, str]]) -> bool:
    booking_prompts = [
        "which lab/clinic should i book with",
        "choose one option number or name",
        "what day and time should i request",
        "what location or city should i use",
        "what is the booking page url",
        "what is your full name",
        "what email should i use",
        "what phone number should i use",
    ]
    for item in reversed(history):
        if item.get("role") != "assistant":
            continue
        content = item.get("content", "").lower()
        if any(prompt in content for prompt in booking_prompts):
            return True
    return False


def _looks_off_topic_for_booking(message: str) -> bool:
    lowered = message.lower().strip()
    if not lowered:
        return False
    off_topic_markers = [
        "i don't feel",
        "i dont feel",
        "i feel",
        "i'm sick",
        "im sick",
        "headache",
        "stomach pain",
        "nausea",
        "dizzy",
        "how are you",
        "what is your name",
        "who are you",
        "can you say",
        "hello",
        "hi",
        "hey",
    ]
    return any(marker in lowered for marker in off_topic_markers)


def _is_location_followup_turn(message: str, history: list[dict[str, str]]) -> bool:
    lowered = message.lower().strip()
    location = _extract_location_from_text(message)
    if not location:
        return False

    # Only treat this as follow-up when the user sent primarily a location answer.
    if any(token in lowered for token in ["book", "appointment", "schedule", "lab", "clinic", "blood test"]):
        return False

    return _history_requested_location(history) or _history_has_booking_or_lab_intent(history)


def _extract_phone_from_text(message: str) -> str | None:
    digits = re.sub(r"\D", "", message)
    if len(digits) < 10:
        return None
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return f"+{digits}"


def _extract_email_from_text(message: str) -> str | None:
    match = re.search(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", message)
    return match.group(0).strip() if match else None


def _extract_url_from_text(message: str) -> str | None:
    match = re.search(r"https?://[^\s)>\"]+", message)
    if not match:
        return None
    return match.group(0).strip().rstrip(".,;")


def _extract_full_name_from_text(message: str) -> str | None:
    patterns = [
        r"\bmy name is ([A-Za-z][A-Za-z' -]{1,80})\b",
        r"\bi am ([A-Za-z][A-Za-z' -]{1,80})\b",
        r"\bi'm ([A-Za-z][A-Za-z' -]{1,80})\b",
    ]
    disallowed_terms = {
        "sick",
        "pain",
        "fever",
        "nausea",
        "dizziness",
        "headache",
        "appointment",
        "booking",
        "test",
        "lab",
    }
    for pattern in patterns:
        match = re.search(pattern, message, flags=re.IGNORECASE)
        if not match:
            continue
        candidate = re.sub(r"\s+", " ", match.group(1)).strip(" .")
        tokens = [token.strip(" .").lower() for token in candidate.split()]
        if any(token in disallowed_terms for token in tokens):
            continue
        if len(candidate.split()) >= 2:
            return candidate
    return None


def _extract_purchase_quantity(message: str) -> int | None:
    match = re.search(r"\b(\d{1,3})\s*(?:x|units?|items?|kits?|tests?)\b", message, flags=re.IGNORECASE)
    if match:
        return max(1, int(match.group(1)))
    return None


def _extract_purchase_item(message: str) -> str | None:
    patterns = [
        r"\b(?:buy|purchase|order)\s+(?:a|an|the)?\s*([A-Za-z0-9][A-Za-z0-9'()\-/ ]{2,80})",
        r"\b(?:need|want)\s+(?:to\s+)?(?:buy|purchase|order)\s+(?:a|an|the)?\s*([A-Za-z0-9][A-Za-z0-9'()\-/ ]{2,80})",
    ]
    stop_words = (" from ", " at ", " on ", " using ")
    for pattern in patterns:
        match = re.search(pattern, message, flags=re.IGNORECASE)
        if not match:
            continue
        item = re.sub(r"\s+", " ", match.group(1)).strip(" .")
        lowered = item.lower()
        for token in stop_words:
            idx = lowered.find(token)
            if idx > 0:
                item = item[:idx].strip()
                break
        if len(item) >= 3:
            return item
    return None


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
        "email": draft.get("email"),
        "full_name": draft.get("full_name"),
        "booking_url": draft.get("booking_url"),
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


def _format_booking_missing_prompt(missing: list[str], ranked_options: list[dict[str, Any]]) -> str:
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
    if "booking_url" in missing:
        prompts.append("What is the booking page URL for this provider?")
    if "full_name" in missing:
        prompts.append("What is your full name as it appears on your records?")
    if "email" in missing:
        prompts.append("What email should I use for booking confirmation?")
    if "phone" in missing:
        prompts.append("What phone number should I use for booking updates?")
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
    defaults = _booking_defaults_from_context(context)
    sanitized_location_hint = _extract_location_from_text(location_hint or "") if location_hint else None
    provider_guess = _extract_provider_from_text(message)
    location_guess = _extract_location_from_text(message)
    phone_guess = _extract_phone_from_text(message)
    email_guess = _extract_email_from_text(message)
    full_name_guess = _extract_full_name_from_text(message)
    booking_url_guess = _extract_url_from_text(message)
    slot_guess = _extract_slot_datetime_from_text(message)
    booking_intent = any(word in lowered for word in ["book", "schedule"]) or any(
        phrase in lowered for phrase in ["set up an appointment", "make an appointment"]
    )

    if draft and not any([selected_idx, provider_guess, location_guess, phone_guess, slot_guess, booking_intent]):
        if _looks_off_topic_for_booking(message) or not _history_requested_booking_details(history):
            _clear_booking_draft(ctx.user_id, ctx.session_key)
            return None, None, False

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
    working["mode"] = _booking_mode_from_env()
    if not working.get("provider_name") and defaults.get("provider_name"):
        working["provider_name"] = defaults["provider_name"]
    if not working.get("location") and defaults.get("location"):
        working["location"] = defaults["location"]
    if not working.get("phone") and defaults.get("phone"):
        working["phone"] = defaults["phone"]
    if not working.get("email") and defaults.get("email"):
        working["email"] = defaults["email"]
    if not working.get("full_name") and defaults.get("full_name"):
        working["full_name"] = defaults["full_name"]
    if not working.get("booking_url") and defaults.get("booking_url"):
        working["booking_url"] = defaults["booking_url"]
    if not working.get("location") and sanitized_location_hint:
        working["location"] = sanitized_location_hint

    if selected_idx and 1 <= selected_idx <= len(ranked_options):
        selected = ranked_options[selected_idx - 1]
        working["provider_name"] = selected["name"]
        working["location"] = selected["location"]
        if selected.get("source_url"):
            working["booking_url"] = str(selected["source_url"])
    elif ranked_options:
        for option in ranked_options:
            if option["name"].lower() in lowered:
                working["provider_name"] = option["name"]
                working["location"] = option["location"]
                if option.get("source_url"):
                    working["booking_url"] = str(option["source_url"])
                break

    if provider_guess:
        working["provider_name"] = provider_guess
    if location_guess:
        working["location"] = location_guess
    if slot_guess:
        working["slot_datetime"] = slot_guess
    if phone_guess:
        working["phone"] = phone_guess
    if email_guess:
        working["email"] = email_guess
    if full_name_guess:
        working["full_name"] = full_name_guess
    if booking_url_guess:
        working["booking_url"] = booking_url_guess
    if not working.get("slot_datetime"):
        history_slot = _extract_slot_datetime_from_history(history)
        if history_slot:
            working["slot_datetime"] = history_slot
    if selected_idx and not working.get("slot_datetime"):
        default_slot = (utc_now() + timedelta(days=7)).replace(hour=9, minute=0, second=0, microsecond=0)
        working["slot_datetime"] = to_iso(default_slot)

    required_missing = [field for field in ["provider_name", "slot_datetime", "location"] if not working.get(field)]
    if str(working.get("mode") or _booking_mode_from_env()) in {"live", "call_to_book"}:
        for field in ["booking_url", "full_name", "email", "phone"]:
            if not working.get(field):
                required_missing.append(field)
    if required_missing:
        _persist_booking_draft(ctx.user_id, ctx.session_key, working)
        prompt = _format_booking_missing_prompt(required_missing, ranked_options)
        return prompt, None, True

    action_payload = {
        "provider_name": str(working["provider_name"]).strip(),
        "slot_datetime": str(working["slot_datetime"]).strip(),
        "location": str(working["location"]).strip(),
        "mode": str(working.get("mode") or _booking_mode_from_env()),
        "idempotency_key": uuid.uuid4().hex,
    }
    if working.get("phone"):
        action_payload["phone"] = str(working["phone"]).strip()
    if working.get("email"):
        action_payload["email"] = str(working["email"]).strip()
    if working.get("full_name"):
        action_payload["full_name"] = str(working["full_name"]).strip()
    if working.get("booking_url"):
        action_payload["booking_url"] = str(working["booking_url"]).strip()

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
    booking_defaults = _booking_defaults_from_context(context)
    known_location = _extract_location_from_text(message) or booking_defaults.get("location")

    lowered = message.lower().strip()
    if _is_location_followup_turn(message, history):
        location = _extract_location_from_text(message) or "that location"
        return (
            f"Thanks. I can use {location} to find and rank nearby labs/clinics. "
            "I will prepare that now for your confirmation."
        )

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

    purchase_intent = any(word in lowered for word in ["buy", "purchase", "order", "checkout"]) and any(
        word in lowered for word in ["medical", "lab", "test", "kit", "health"]
    )
    if purchase_intent:
        purchase_url = _extract_url_from_text(message)
        item_name = _extract_purchase_item(message)
        missing: list[str] = []
        if not item_name:
            missing.append("item_name")
        if not purchase_url:
            missing.append("purchase_url")
        if missing:
            prompts = []
            if "item_name" in missing:
                prompts.append("What medical item/test should I order?")
            if "purchase_url" in missing:
                prompts.append("Please share the exact checkout/product URL.")
            return " ".join(prompts)
        return (
            "I can prepare this medical purchase action with a confirmation checkpoint before final submission."
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

    symptom_cause_hints: list[tuple[str, str]] = []
    if "headache" in lowered:
        symptom_cause_hints.append(("headache", "dehydration, tension, migraine, sinus irritation, or poor sleep"))
    if "dizzy" in lowered or "dizziness" in lowered:
        symptom_cause_hints.append(
            ("dizziness", "dehydration, low blood pressure, inner-ear issues, medication effects, or low blood sugar")
        )
    if "nausea" in lowered:
        symptom_cause_hints.append(("nausea", "viral illness, reflux, medication side effects, anxiety, or food-related triggers"))
    if "fever" in lowered:
        symptom_cause_hints.append(("fever", "viral or bacterial infection, inflammatory illness, or medication reaction"))
    if "cough" in lowered:
        symptom_cause_hints.append(("cough", "viral respiratory infection, allergies, asthma irritation, or post-nasal drip"))
    if "rash" in lowered:
        symptom_cause_hints.append(("rash", "allergic reaction, contact irritation, eczema, infection, or medication reaction"))

    if symptom_cause_hints or any(word in lowered for word in ["pain", "sick"]):
        possible_causes = " ".join(
            f"For {symptom}, possible causes can include {causes}."
            for symptom, causes in symptom_cause_hints[:3]
        )
        return (
            "I'm sorry you're dealing with this. I can share possibilities, but I can't diagnose online. "
            f"{possible_causes} "
            "These are possibilities, not a diagnosis. "
            "If symptoms are severe, worsening, or include chest pain, breathing trouble, confusion, or high fever, "
            "seek urgent care now. Otherwise, I can log your symptoms and help you choose safe next steps."
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
        "I can help with symptom triage, lab/clinic discovery, appointment booking, medical purchases, and medication refill coordination. "
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
    booking_defaults = _booking_defaults_from_context(context or {})
    location_hint = _extract_location_from_text(location or "") if location else None
    inferred_location = location_hint or _extract_location_from_text(message) or booking_defaults.get("location")
    selected_idx = _selected_option_index(lower)

    if ranked_options and selected_idx and 1 <= selected_idx <= len(ranked_options):
        selected = ranked_options[selected_idx - 1]
        action_payload = {
            "provider_name": selected["name"],
            "slot_datetime": to_iso(utc_now() + timedelta(days=7)),
            "location": selected["location"],
            "mode": _booking_mode_from_env(),
            "idempotency_key": uuid.uuid4().hex,
        }
        if selected.get("source_url"):
            action_payload["booking_url"] = str(selected["source_url"])
        for field in ["full_name", "email", "phone", "booking_url"]:
            if booking_defaults.get(field) and not action_payload.get(field):
                action_payload[field] = booking_defaults[field]
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

    location_followup = bool(inferred_location) and _is_location_followup_turn(message, history)

    if any(keyword in lower for keyword in ["lab", "clinic", "diagnostic", "test center", "blood test"]) or location_followup:
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
            "mode": _booking_mode_from_env(),
            "idempotency_key": uuid.uuid4().hex,
        }
        for field in ["full_name", "email", "phone", "booking_url"]:
            if booking_defaults.get(field):
                action_payload[field] = booking_defaults[field]
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

    purchase_intent = any(keyword in lower for keyword in ["buy", "purchase", "order", "checkout"]) and any(
        keyword in lower for keyword in ["medical", "lab", "test", "kit", "health"]
    )
    if purchase_intent:
        purchase_url = _extract_url_from_text(message)
        item_name = _extract_purchase_item(message)
        quantity = _extract_purchase_quantity(message) or 1
        if not item_name or not purchase_url:
            return None
        action_payload = {
            "item_name": item_name,
            "quantity": quantity,
            "purchase_url": purchase_url,
            "mode": _booking_mode_from_env(),
            "idempotency_key": uuid.uuid4().hex,
        }
        for field in ["full_name", "email", "phone"]:
            if booking_defaults.get(field):
                action_payload[field] = booking_defaults[field]
        payload_hash = canonical_payload_hash(action_payload)
        consent = container.executor.execute(
            ctx,
            "consent_token_issue",
            {"action_type": "medical_purchase", "payload_hash": payload_hash, "expires_in_seconds": 300},
        )
        if consent.status != "succeeded":
            return None
        action_payload["consent_token"] = consent.data["token"]
        action_payload["payload_hash"] = payload_hash
        return ActionPlan(
            tier=2,
            tool="medical_purchase",
            params=action_payload,
            consent_prompt="I can execute this medical purchase workflow after your confirmation. Proceed?",
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
        normalized.setdefault("summary", "Booking confirmed" if confirmation_id else "Booking request submitted")
    if tool_name == "medical_purchase":
        artifact = normalized.get("confirmation_artifact") or {}
        confirmation_id = artifact.get("external_ref") or artifact.get("sim_ref")
        if confirmation_id:
            normalized["confirmation_id"] = confirmation_id
        normalized.setdefault("summary", "Purchase confirmed" if confirmation_id else "Purchase request submitted")
    if tool_name == "medication_refill_request":
        normalized.setdefault("summary", "Refill request prepared")
    return normalized


@app.get("/profile")
def get_profile(authorization: str | None = Header(default=None), x_user_id: str | None = Header(default=None)):
    _ensure_not_carebase_only()
    user_id = resolve_user_id(authorization, x_user_id)
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
def upsert_profile(
    payload: ProfilePayload,
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
):
    _ensure_not_carebase_only()
    user_id = resolve_user_id(authorization, x_user_id)
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
def get_reminders(authorization: str | None = Header(default=None), x_user_id: str | None = Header(default=None)):
    _ensure_not_carebase_only()
    user_id = resolve_user_id(authorization, x_user_id)
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
def post_symptoms(
    payload: SymptomPayload,
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
):
    _ensure_not_carebase_only()
    user_id = resolve_user_id(authorization, x_user_id)
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
def logs_symptoms(
    limit: int = 20,
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
):
    _ensure_not_carebase_only()
    user_id = resolve_user_id(authorization, x_user_id)
    return {"items": container.memory.clinical.get_symptom_logs(user_id, limit)}


@app.get("/logs/actions")
def logs_actions(
    limit: int = 20,
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
):
    _ensure_not_carebase_only()
    user_id = resolve_user_id(authorization, x_user_id)
    return {"items": container.memory.clinical.get_action_logs(user_id, limit)}


@app.post("/actions/execute")
def actions_execute(
    payload: ActionExecuteRequest,
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
):
    _ensure_not_carebase_only()
    user_id = resolve_user_id(authorization, x_user_id)
    if not payload.user_confirmed:
        raise HTTPException(status_code=400, detail="User not confirmed")

    params = dict(payload.plan.params)
    session_key = payload.session_key or params.get("session_key")
    message_text = (payload.message_text or "").strip()
    if not message_text:
        message_text = " ".join(str(v) for v in params.values() if isinstance(v, str))
    ctx = _build_ctx(user_id=user_id, session_key=session_key, message_text=message_text, user_confirmed=True)
    try:
        container.memory.guard.ensure_session_scope(ctx.session_key)
    except MemoryPolicyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

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
            location = _normalize_ranked_option_location(str(item.get("address") or item.get("location") or ""))
            source_url = str(item.get("source_url") or item.get("url") or "").strip() or None
            if name:
                memory_items.append({"name": name, "location": location, "source_url": source_url})
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
            "email": params.get("email"),
            "full_name": params.get("full_name"),
            "booking_url": params.get("booking_url") or params.get("source_url"),
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
    if resolved_tool.name == "medical_purchase" and success:
        defaults = {
            "full_name": params.get("full_name"),
            "email": params.get("email"),
            "phone": params.get("phone"),
            "session_key": ctx.session_key,
            "updated_at": to_iso(utc_now()),
        }
        cleaned_defaults = {k: v for k, v in defaults.items() if v}
        if cleaned_defaults:
            container.memory.conversation.upsert_preference(
                user_id=user_id,
                key="medical_purchase_defaults",
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


@app.post("/voice/transcribe")
async def voice_transcribe(
    audio: UploadFile | None = File(default=None),
    file: UploadFile | None = File(default=None),
    session_key: str | None = Form(default=None),
    language_hint: str | None = Form(default=None),
    prompt: str | None = Form(default=None),
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
):
    user_id = resolve_user_id(authorization, x_user_id)
    ctx = _build_ctx(user_id=user_id, session_key=session_key)
    try:
        container.memory.guard.ensure_user_scope(user_id, user_id)
        container.memory.guard.ensure_session_scope(ctx.session_key)
    except MemoryPolicyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    upload = _select_upload(audio, file, field_hint="audio")
    file_name = _normalize_upload_filename(upload, "audio-upload")
    mime_type = (upload.content_type or "").lower().strip()
    _validate_audio_upload(file_name, mime_type)

    audio_bytes = await _read_upload_bytes(
        upload,
        max_bytes=_MAX_AUDIO_BYTES,
        too_large_detail=f"Audio file exceeds {_MAX_AUDIO_BYTES // (1024 * 1024)}MB limit.",
    )
    transcription = _openai_whisper_transcribe(
        file_name=file_name,
        mime_type=mime_type,
        audio_bytes=audio_bytes,
        language_hint=language_hint,
        prompt=prompt,
    )

    document_id = f"doc_{uuid.uuid4().hex}"
    container.memory.clinical.create_document_record(
        document_id=document_id,
        user_id=user_id,
        session_key=ctx.session_key,
        file_name=file_name,
        mime_type=mime_type or "application/octet-stream",
        file_category="voice_attachment",
        storage_ref=f"memory://voice/{document_id}",
        processing_status="processed",
    )
    confidence = max(0.0, min(1.0, float(transcription.get("confidence", 0.8))))
    transcript_text = str(transcription["transcript_text"])
    triage_tier = _triage_tier_from_text(transcript_text)
    emergency_detected = triage_tier == "EMERGENT"
    findings = [
        {
            "finding_type": "voice_transcript",
            "label": "transcript",
            "value_text": transcript_text[:4000],
            "is_abnormal": False,
            "confidence": confidence,
            "provenance": {
                "source": "openai_whisper",
                "language_hint": language_hint,
                "segment_count": len(transcription.get("segments", [])),
            },
        }
    ]
    container.memory.clinical.store_document_analysis(
        document_id=document_id,
        user_id=user_id,
        session_key=ctx.session_key,
        processing_status="processed",
        extraction_confidence=confidence,
        summary={
            "analysis_type": "voice_transcription",
            "transcript_text": transcript_text,
            "confidence": confidence,
            "segment_count": len(transcription.get("segments", [])),
            "provider": "openai_whisper",
            "language_hint": language_hint,
            "triage_tier": triage_tier,
            "emergency_detected": emergency_detected,
            "requires_confirmation": True,
        },
        findings=findings,
    )
    return {
        "document_id": document_id,
        "transcript_text": transcript_text,
        "confidence": confidence,
        "segments": transcription.get("segments", []),
        "triage": {
            "tier": triage_tier,
            "emergency": emergency_detected,
        },
        "requires_confirmation": True,
        "editable_transcript": True,
        "next_step": "review_or_edit_transcript_before_chat_send",
    }


@app.post("/documents/analyze")
async def documents_analyze(
    document: UploadFile | None = File(default=None),
    file: UploadFile | None = File(default=None),
    session_key: str | None = Form(default=None),
    file_category: str | None = Form(default=None),
    question: str | None = Form(default=None),
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
):
    user_id = resolve_user_id(authorization, x_user_id)
    ctx = _build_ctx(user_id=user_id, session_key=session_key)
    try:
        container.memory.guard.ensure_user_scope(user_id, user_id)
        container.memory.guard.ensure_session_scope(ctx.session_key)
    except MemoryPolicyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    upload = _select_upload(document, file, field_hint="document")
    file_name = _normalize_upload_filename(upload, "document-upload")
    mime_type = (upload.content_type or "").lower().strip()
    _validate_document_upload(file_name, mime_type)

    document_bytes = await _read_upload_bytes(
        upload,
        max_bytes=_MAX_DOCUMENT_BYTES,
        too_large_detail=f"Document file exceeds {_MAX_DOCUMENT_BYTES // (1024 * 1024)}MB limit.",
    )
    category = _resolve_document_category(file_name, mime_type, file_category)

    document_id = f"doc_{uuid.uuid4().hex}"
    container.memory.clinical.create_document_record(
        document_id=document_id,
        user_id=user_id,
        session_key=ctx.session_key,
        file_name=file_name,
        mime_type=mime_type or "application/octet-stream",
        file_category=category,
        storage_ref=f"memory://document/{document_id}",
        processing_status="queued",
    )

    extracted_text, extraction_confidence, extraction_method = _extract_document_text(file_name, mime_type, document_bytes)
    if not extracted_text and not mime_type.startswith("image/"):
        container.memory.clinical.store_document_analysis(
            document_id=document_id,
            user_id=user_id,
            session_key=ctx.session_key,
            processing_status="failed",
            extraction_confidence=0.0,
            summary={
                "analysis_type": "document_summary",
                "error": "unable_to_extract_text",
                "extraction_method": extraction_method,
            },
            findings=[],
        )
        raise HTTPException(status_code=422, detail="Unable to extract readable content from the uploaded file.")

    llm_used = True
    llm_error: str | None = None
    try:
        interpretation = _openai_document_interpret(
            file_name=file_name,
            mime_type=mime_type,
            document_bytes=document_bytes,
            extracted_text=extracted_text,
            category=category,
            user_question=question,
        )
    except HTTPException as exc:
        if exc.status_code == 503:
            container.memory.clinical.store_document_analysis(
                document_id=document_id,
                user_id=user_id,
                session_key=ctx.session_key,
                processing_status="failed",
                extraction_confidence=extraction_confidence,
                summary={
                    "analysis_type": "document_summary",
                    "error": str(exc.detail),
                    "extraction_method": extraction_method,
                },
                findings=[],
            )
            raise
        llm_used = False
        llm_error = str(exc.detail)
        interpretation = _fallback_document_interpretation(extracted_text, question)

    safe_result = _enforce_document_safety(
        interpretation=interpretation,
        extracted_text=extracted_text,
        category=category,
    )
    if llm_error:
        safe_result["uncertainty_statement"] = (
            f"{safe_result['uncertainty_statement']} "
            "Automated fallback was used because model interpretation was unavailable."
        )

    effective_confidence = extraction_confidence
    if effective_confidence <= 0.0 and mime_type.startswith("image/"):
        effective_confidence = 0.65 if llm_used else 0.35
    findings = _build_document_findings(
        key_findings=safe_result["key_findings"],
        extraction_confidence=effective_confidence,
        extraction_method=extraction_method,
        source_label="openai_document_interpret" if llm_used else "fallback_summary",
    )
    for marker in safe_result["high_risk_flags"]:
        findings.append(
            {
                "finding_type": "risk_marker",
                "label": marker,
                "value_text": marker,
                "is_abnormal": True,
                "confidence": max(0.5, effective_confidence),
                "provenance": {
                    "source": "safety_risk_marker",
                    "extraction_method": extraction_method,
                },
            }
        )
    summary_payload = {
        "analysis_type": "document_summary",
        "file_category": category,
        "llm_used": llm_used,
        "llm_error": llm_error,
        "extraction_method": extraction_method,
        "extraction_confidence": round(effective_confidence, 3),
        "question": (question or "").strip()[:500] if question else None,
        "result": safe_result,
    }
    container.memory.clinical.store_document_analysis(
        document_id=document_id,
        user_id=user_id,
        session_key=ctx.session_key,
        processing_status="processed",
        extraction_confidence=effective_confidence,
        summary=summary_payload,
        findings=findings,
    )
    return {
        "document_id": document_id,
        "file_category": category,
        "key_findings": safe_result["key_findings"],
        "plain_language_summary": safe_result["plain_language_summary"],
        "follow_up_questions": safe_result["follow_up_questions"],
        "safety_framing": {
            "uncertainty": safe_result["uncertainty_statement"],
            "guidance": safe_result["safety_guidance"],
            "urgency_level": safe_result["urgency_level"],
            "high_risk_flags": safe_result["high_risk_flags"],
        },
        "extraction": {
            "method": extraction_method,
            "confidence": round(effective_confidence, 3),
            "llm_used": llm_used,
        },
    }


@app.post("/chat/stream")
def chat_stream(
    payload: ChatRequest,
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
):
    if _carebase_only_enabled():
        def event_stream_disabled():
            message = (
                "Chat streaming via backend is disabled. "
                "Use the CareBase-enabled frontend chat pipeline instead."
            )
            yield _emit_sse("error", {"message": message})

        return StreamingResponse(event_stream_disabled(), media_type="text/event-stream")

    user_id = resolve_user_id(authorization, x_user_id)
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
            fallback_reply = _assistant_reply(payload.message, context, payload.history)
            if booking_reply:
                reply = booking_reply
            elif _needs_location_reprompt(payload.message, payload.history):
                reply = (
                    "I still need your city or ZIP code to continue nearby lab/clinic discovery. "
                    "Share it and I will rank options."
                )
            else:
                reply = _llm_chat_reply(
                    message=payload.message,
                    context=context,
                    history=payload.history,
                    fallback_reply=fallback_reply,
                )
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
            print(f"chat_stream error: {exc}")  # noqa: T201
            yield _emit_sse("error", {"message": "Chat pipeline error."})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
