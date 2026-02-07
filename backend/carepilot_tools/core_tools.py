from __future__ import annotations

import hashlib
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from carepilot_agent_core.models import ExecutionContext
from carepilot_agent_core.registry import ToolDefinition, ToolRegistry
from memory.service import MemoryService, canonical_payload_hash
from memory.time_utils import parse_iso, to_iso, utc_now

from .web_discovery import WebDiscoveryPipeline


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


class CarePilotToolset:
    def __init__(self, memory: MemoryService) -> None:
        self.memory = memory
        self.web_discovery = WebDiscoveryPipeline()

    def clinical_profile_get(self, ctx: ExecutionContext, payload: dict[str, Any]) -> dict[str, Any]:
        profile = self.memory.clinical_profile_get(
            user_id=ctx.user_id,
            sections=payload.get("sections"),
            session_key=ctx.session_key,
        )
        return {"status": "succeeded", "data": profile, "errors": []}

    def clinical_profile_upsert(self, ctx: ExecutionContext, payload: dict[str, Any]) -> dict[str, Any]:
        operation = payload.get("operation", "create")
        entity_type = payload.get("entity_type", "")
        source = payload.get("source", "user_direct")
        confidence = _safe_float(payload.get("confidence", 1.0), 1.0)
        record = self.memory.clinical_profile_upsert(
            user_id=ctx.user_id,
            session_key=ctx.session_key,
            entity_type=entity_type,
            operation=operation,
            payload=payload.get("payload", {}),
            source=source,
            confidence=confidence,
        )
        return {"status": "succeeded", "data": record, "errors": []}

    def consent_token_issue(self, ctx: ExecutionContext, payload: dict[str, Any]) -> dict[str, Any]:
        action_type = payload.get("action_type")
        if not action_type:
            return {"status": "failed", "data": {}, "errors": [{"code": "bad_request", "message": "Missing action_type"}]}
        payload_hash = payload.get("payload_hash")
        if not payload_hash:
            payload_hash = canonical_payload_hash(payload.get("payload", {}))
        expires_in = int(payload.get("expires_in_seconds", 300))
        token_record = self.memory.issue_consent_token(
            user_id=ctx.user_id,
            action_type=action_type,
            payload_hash=payload_hash,
            expires_in_seconds=expires_in,
        )
        return {"status": "succeeded", "data": token_record | {"action_type": action_type, "payload_hash": payload_hash}, "errors": []}

    def lab_clinic_discovery(self, ctx: ExecutionContext, payload: dict[str, Any]) -> dict[str, Any]:
        max_distance = max(1.0, _safe_float(payload.get("max_distance_miles"), 10.0))
        budget_cap = _safe_float(payload.get("budget_cap"), 120.0)
        preference = payload.get("in_network_preference", "no_preference")
        preferred_time_window = payload.get("preferred_time_window", "any")
        origin = payload.get("zip_or_geo") or payload.get("location") or "local area"
        result = self.web_discovery.discover_labs(
            origin=origin,
            max_distance_miles=max_distance,
            budget_cap=budget_cap,
            preferred_time_window=preferred_time_window,
            in_network_preference=preference,
        )
        return {"status": "succeeded", "data": result, "errors": []}

    def appointment_book(self, ctx: ExecutionContext, payload: dict[str, Any]) -> dict[str, Any]:
        provider_name = str(payload.get("provider_name") or payload.get("provider_id") or "").strip()
        location = str(payload.get("location") or "").strip()
        slot_dt = payload.get("slot_datetime")
        if not slot_dt and payload.get("date") and payload.get("time"):
            slot_dt = f"{payload['date']}T{payload['time']}"
        slot_dt = str(slot_dt).strip() if slot_dt else ""

        generic_provider_tokens = {"unknown provider", "primary care provider", "tbd"}
        missing_fields: list[str] = []
        if not provider_name or provider_name.lower() in generic_provider_tokens:
            missing_fields.append("provider_name")
        if not location or location.lower() in {"unknown location", "tbd"}:
            missing_fields.append("location")
        if not slot_dt:
            missing_fields.append("slot_datetime")
        if missing_fields:
            return {
                "status": "pending",
                "data": {
                    "missing_fields": missing_fields,
                    "message": "Missing required booking fields.",
                },
                "errors": [],
            }

        mode = payload.get("mode", "simulated")

        appointment_id = f"apt_{uuid.uuid4().hex[:12]}"
        status = "pending" if mode == "call_to_book" else "succeeded"
        confirmation = f"SIM-{uuid.uuid4().hex[:10].upper()}" if status == "succeeded" else None
        self.memory.clinical.create_appointment(
            appointment_id=appointment_id,
            user_id=ctx.user_id,
            provider_name=provider_name,
            location=location,
            starts_at=slot_dt,
            status=status,
            external_ref=confirmation,
        )

        return {
            "status": status,
            "data": {
                "appointment_id": appointment_id,
                "provider_name": provider_name,
                "location": location,
                "slot_datetime": slot_dt,
                "lifecycle_transition": "executing->" + status,
                "confirmation_artifact": {"external_ref": confirmation, "sim_ref": confirmation},
            },
            "errors": [],
        }

    def medication_refill_request(self, ctx: ExecutionContext, payload: dict[str, Any]) -> dict[str, Any]:
        medication_id = payload.get("medication_id")
        medication_name = payload.get("medication_name", "").strip().lower()
        remaining_reported = payload.get("remaining_pills_reported")
        medications = self.memory.clinical.get_medications(ctx.user_id)
        med = None
        if medication_id:
            med = next((m for m in medications if m["id"] == medication_id), None)
        if not med and medication_name:
            med = next((m for m in medications if m["name"].lower() == medication_name), None)

        if not med:
            return {
                "status": "failed",
                "data": {},
                "errors": [{"code": "medication_not_found", "message": "Medication not found in active profile."}],
            }

        regimen_type = med.get("regimen_type", "daily")
        quantity = _safe_float(med.get("quantity_dispensed"), 0.0)
        freq = _safe_float(med.get("frequency_per_day"), 0.0)
        last_fill = parse_iso(med.get("last_fill_date"))
        now = utc_now()

        if regimen_type == "prn" and remaining_reported is None:
            return {
                "status": "pending",
                "data": {
                    "runout_estimate": None,
                    "confidence": "low",
                    "message": "PRN medication requires current remaining pills before refill execution.",
                },
                "errors": [],
            }

        if remaining_reported is not None:
            estimated_days = max(0.0, _safe_float(remaining_reported) / max(freq, 0.1))
            confidence = "medium"
        elif quantity > 0 and last_fill and freq > 0:
            if regimen_type in {"weekly", "biweekly", "monthly"}:
                interval = _safe_float(med.get("interval_days"), 7.0 if regimen_type == "weekly" else 14.0)
                estimated_days = quantity * max(interval, 1.0)
            else:
                estimated_days = quantity / max(freq, 0.1)
            confidence = "high"
        else:
            return {
                "status": "pending",
                "data": {
                    "runout_estimate": None,
                    "confidence": "low",
                    "message": "Insufficient fill history. Please provide remaining pills.",
                },
                "errors": [],
            }

        base_date = last_fill or now
        runout_date = base_date + timedelta(days=estimated_days)
        follow_up = runout_date - timedelta(days=2)
        request_ref = "RF-" + hashlib.sha1(f"{ctx.user_id}:{med['id']}:{random.random()}".encode("utf-8")).hexdigest()[:10].upper()

        return {
            "status": "succeeded",
            "data": {
                "medication_id": med["id"],
                "medication_name": med["name"],
                "runout_estimate": to_iso(runout_date),
                "request_execution_status": "submitted_simulated",
                "recommended_follow_up_date": to_iso(follow_up),
                "confidence": confidence,
                "request_ref": request_ref,
                "pharmacy_target": payload.get("pharmacy_target") or med.get("pharmacy_name"),
            },
            "errors": [],
        }


def register_tools(registry: ToolRegistry, toolset: CarePilotToolset) -> None:
    registry.register(ToolDefinition("clinical_profile_get", toolset.clinical_profile_get))
    registry.register(ToolDefinition("clinical_profile_upsert", toolset.clinical_profile_upsert))
    registry.register(ToolDefinition("lab_clinic_discovery", toolset.lab_clinic_discovery))
    registry.register(ToolDefinition("appointment_book", toolset.appointment_book, transactional=True))
    registry.register(ToolDefinition("medication_refill_request", toolset.medication_refill_request, transactional=True))
    registry.register(ToolDefinition("consent_token_issue", toolset.consent_token_issue))
