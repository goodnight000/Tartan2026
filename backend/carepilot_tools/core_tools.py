from __future__ import annotations

import hashlib
import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from carepilot_agent_core.models import ExecutionContext
from carepilot_agent_core.registry import ToolDefinition, ToolRegistry
from memory.service import MemoryService, canonical_payload_hash
from memory.time_utils import parse_iso, to_iso, utc_now

from .web_discovery import WebDiscoveryPipeline
from .web_automation import BrowserAutomationRunner


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _default_booking_mode_from_env() -> str:
    disable_external = os.getenv("CAREPILOT_DISABLE_EXTERNAL_WEB", "false").strip().lower() == "true"
    return "simulated" if disable_external else "live"


def _resolve_booking_mode(raw_mode: Any) -> str:
    if isinstance(raw_mode, str):
        normalized = raw_mode.strip().lower()
        if normalized in {"simulated", "mock"}:
            return "simulated"
        if normalized in {"call_to_book", "call"}:
            return "call_to_book"
        if normalized in {"live", "real"}:
            return "live"
    return _default_booking_mode_from_env()


class CarePilotToolset:
    def __init__(self, memory: MemoryService) -> None:
        self.memory = memory
        self.web_discovery = WebDiscoveryPipeline()
        self.browser_automation = BrowserAutomationRunner()

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
        expires_in = int(_safe_float(payload.get("expires_in_seconds"), 300.0))
        expires_in = max(30, min(expires_in, 3600))
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
        mode = _resolve_booking_mode(payload.get("mode"))
        booking_url = str(payload.get("booking_url") or payload.get("source_url") or payload.get("provider_url") or "").strip()
        full_name = str(payload.get("full_name") or "").strip()
        email = str(payload.get("email") or "").strip()
        phone = str(payload.get("phone") or "").strip()
        extra_form_fields = payload.get("extra_form_fields") if isinstance(payload.get("extra_form_fields"), dict) else None

        generic_provider_tokens = {"unknown provider", "primary care provider", "tbd"}
        missing_fields: list[str] = []
        if not provider_name or provider_name.lower() in generic_provider_tokens:
            missing_fields.append("provider_name")
        if not location or location.lower() in {"unknown location", "tbd"}:
            missing_fields.append("location")
        if not slot_dt:
            missing_fields.append("slot_datetime")
        if mode == "live":
            if not booking_url:
                missing_fields.append("booking_url")
            if not full_name:
                missing_fields.append("full_name")
            if not email:
                missing_fields.append("email")
            if not phone:
                missing_fields.append("phone")
        if mode == "call_to_book" and not phone:
            missing_fields.append("phone")
        if missing_fields:
            return {
                "status": "pending",
                "data": {
                    "missing_fields": missing_fields,
                    "message": "Missing required booking fields.",
                },
                "errors": [],
            }

        appointment_id = f"apt_{uuid.uuid4().hex[:12]}"
        status = "succeeded"
        confirmation: str | None = None
        automation: dict[str, Any] = {}
        automation_missing_fields: list[str] = []
        errors: list[dict[str, str]] = []
        if mode == "simulated":
            confirmation = f"SIM-{uuid.uuid4().hex[:10].upper()}"
        elif mode == "call_to_book":
            status = "pending"
        else:
            live_result = self.browser_automation.submit_appointment(
                booking_url=booking_url,
                provider_name=provider_name,
                location=location,
                slot_datetime=slot_dt,
                full_name=full_name,
                email=email,
                phone=phone,
                extra_fields=extra_form_fields,
            )
            status = str(live_result.get("status") or "pending")
            confirmation = str(live_result.get("external_ref") or "").strip() or None
            automation = live_result.get("automation") if isinstance(live_result.get("automation"), dict) else {}
            if isinstance(live_result.get("missing_fields"), list):
                automation_missing_fields = [str(item) for item in live_result["missing_fields"] if str(item).strip()]
            if status == "failed":
                errors.append(
                    {
                        "code": "web_automation_failed",
                        "message": str(live_result.get("message") or "Live web booking failed."),
                    }
                )
            elif status == "pending" and live_result.get("message"):
                errors.append({"code": "web_automation_pending", "message": str(live_result.get("message"))})

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
                "execution_mode": mode,
                "booking_url": booking_url or None,
                "lifecycle_transition": "executing->" + status,
                "confirmation_artifact": {
                    "external_ref": confirmation,
                    "sim_ref": confirmation if mode == "simulated" else None,
                },
                "automation": automation,
                "missing_fields": automation_missing_fields,
            },
            "errors": errors,
        }

    def medical_purchase(self, ctx: ExecutionContext, payload: dict[str, Any]) -> dict[str, Any]:
        mode = _resolve_booking_mode(payload.get("mode"))
        item_name = str(payload.get("item_name") or payload.get("product_name") or "").strip()
        purchase_url = str(payload.get("purchase_url") or payload.get("source_url") or "").strip()
        quantity = int(_safe_float(payload.get("quantity"), 1.0) or 1.0)
        quantity = max(1, quantity)
        full_name = str(payload.get("full_name") or "").strip()
        email = str(payload.get("email") or "").strip()
        phone = str(payload.get("phone") or "").strip()
        shipping_address = str(payload.get("shipping_address") or "").strip() or None
        extra_form_fields = payload.get("extra_form_fields") if isinstance(payload.get("extra_form_fields"), dict) else None

        missing_fields: list[str] = []
        if not item_name:
            missing_fields.append("item_name")
        if mode == "live" and not purchase_url:
            missing_fields.append("purchase_url")
        if mode == "live" and not full_name:
            missing_fields.append("full_name")
        if mode == "live" and not email:
            missing_fields.append("email")
        if mode in {"live", "call_to_book"} and not phone:
            missing_fields.append("phone")
        if missing_fields:
            return {
                "status": "pending",
                "data": {"missing_fields": missing_fields, "message": "Missing required purchase fields."},
                "errors": [],
            }

        purchase_id = f"pur_{uuid.uuid4().hex[:12]}"
        status = "succeeded"
        confirmation: str | None = None
        automation: dict[str, Any] = {}
        automation_missing_fields: list[str] = []
        errors: list[dict[str, str]] = []

        if mode == "simulated":
            confirmation = f"SIMPUR-{uuid.uuid4().hex[:10].upper()}"
        elif mode == "call_to_book":
            status = "pending"
        else:
            live_result = self.browser_automation.submit_purchase(
                purchase_url=purchase_url,
                item_name=item_name,
                quantity=quantity,
                full_name=full_name,
                email=email,
                phone=phone,
                shipping_address=shipping_address,
                extra_fields=extra_form_fields,
            )
            status = str(live_result.get("status") or "pending")
            confirmation = str(live_result.get("external_ref") or "").strip() or None
            automation = live_result.get("automation") if isinstance(live_result.get("automation"), dict) else {}
            if isinstance(live_result.get("missing_fields"), list):
                automation_missing_fields = [str(item) for item in live_result["missing_fields"] if str(item).strip()]
            if status == "failed":
                errors.append(
                    {"code": "web_automation_failed", "message": str(live_result.get("message") or "Live purchase failed.")}
                )
            elif status == "pending" and live_result.get("message"):
                errors.append({"code": "web_automation_pending", "message": str(live_result.get("message"))})

        return {
            "status": status,
            "data": {
                "purchase_id": purchase_id,
                "item_name": item_name,
                "quantity": quantity,
                "purchase_url": purchase_url or None,
                "execution_mode": mode,
                "lifecycle_transition": "executing->" + status,
                "confirmation_artifact": {
                    "external_ref": confirmation,
                    "sim_ref": confirmation if mode == "simulated" else None,
                },
                "automation": automation,
                "missing_fields": automation_missing_fields,
            },
            "errors": errors,
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
                default_interval = 7.0 if regimen_type == "weekly" else 14.0 if regimen_type == "biweekly" else 30.0
                interval = _safe_float(med.get("interval_days"), default_interval)
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

        base_date = now if remaining_reported is not None else (last_fill or now)
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
    registry.register(ToolDefinition("medical_purchase", toolset.medical_purchase, transactional=True))
    registry.register(ToolDefinition("medication_refill_request", toolset.medication_refill_request, transactional=True))
    registry.register(ToolDefinition("consent_token_issue", toolset.consent_token_issue))
