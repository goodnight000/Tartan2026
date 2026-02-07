from __future__ import annotations

import hashlib
import json
import uuid
from datetime import timedelta
from typing import Any

from .clinical_store import ClinicalStore
from .conversation_store import ConversationStore
from .database import SQLiteMemoryDB
from .memory_policy_guard import MemoryPolicyError, MemoryPolicyGuard
from .temporal_lifecycle import TemporalLifecycleService
from .time_utils import parse_iso, to_iso, utc_now


def canonical_payload_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class MemoryService:
    def __init__(self, db: SQLiteMemoryDB) -> None:
        self.db = db
        self.guard = MemoryPolicyGuard()
        self.temporal = TemporalLifecycleService()
        self.clinical = ClinicalStore(db)
        self.conversation = ConversationStore(db)

    def apply_temporal(self, user_id: str) -> dict[str, Any]:
        with self.db.connection() as conn:
            result = self.temporal.apply(conn, user_id)
            return {
                "reconfirm_due_ids": result.reconfirm_due_ids,
                "resolved_unconfirmed_count": result.resolved_unconfirmed_count,
                "inference_expired_count": result.inference_expired_count,
                "stale_health_signal_count": result.stale_health_signal_count,
            }

    def clinical_profile_get(
        self,
        *,
        user_id: str,
        sections: list[str] | None,
        session_key: str,
    ) -> dict[str, Any]:
        self.guard.ensure_session_scope(session_key)
        self.guard.ensure_user_scope(user_id, user_id)
        normalized = self.guard.normalize_sections(sections)
        temporal = self.apply_temporal(user_id)
        profile = self.clinical.get_profile(user_id, normalized)
        profile["temporal"] = temporal
        return profile

    def clinical_profile_upsert(
        self,
        *,
        user_id: str,
        session_key: str,
        entity_type: str,
        operation: str,
        payload: dict[str, Any],
        source: str,
        confidence: float,
    ) -> dict[str, Any]:
        self.guard.ensure_session_scope(session_key)
        self.guard.ensure_user_scope(user_id, user_id)
        if source not in {"user_direct", "tool_result", "model_inference"}:
            raise MemoryPolicyError("Invalid source.")
        if not (0.0 <= confidence <= 1.0):
            raise MemoryPolicyError("Confidence must be between 0 and 1.")
        self.apply_temporal(user_id)
        record = self.clinical.upsert_entity(
            user_id=user_id,
            entity_type=entity_type,
            operation=operation,
            payload=payload,
            source=source,
            confidence=confidence,
        )
        return {
            "updated_entity": record,
            "write_guard_result": {"accepted": True, "source": source, "confidence": confidence},
        }

    def memory_context(self, *, user_id: str, session_key: str, query: str) -> dict[str, Any]:
        self.guard.ensure_session_scope(session_key)
        clinical = self.clinical_profile_get(
            user_id=user_id,
            sections=["conditions", "allergies", "medications", "preferences", "active_symptoms"],
            session_key=session_key,
        )
        conversational = self.conversation.recall(user_id=user_id, session_key=session_key, query=query)
        return {
            "routing_precedence": [
                "clinical_profile_get",
                "conversational_recall",
                "document_context_retrieval",
            ],
            "clinical": clinical,
            "conversational": conversational,
            "documents": [],
        }

    def check_dump_guard(self, text: str) -> dict[str, Any]:
        result = self.guard.check_dump_request(text)
        return {"blocked": result.blocked, "reason": result.reason}

    def issue_consent_token(
        self,
        *,
        user_id: str,
        action_type: str,
        payload_hash: str,
        expires_in_seconds: int = 300,
    ) -> dict[str, Any]:
        ttl = max(30, min(3600, int(expires_in_seconds)))
        expires_at = to_iso(utc_now() + timedelta(seconds=ttl))
        token = f"ctk_{uuid.uuid4().hex}"
        return self.clinical.issue_consent_token(
            user_id=user_id,
            action_type=action_type,
            payload_hash=payload_hash,
            expires_at=expires_at,
            token=token,
        )

    def validate_consent_token(
        self,
        *,
        user_id: str,
        action_type: str,
        payload_hash: str,
        token: str,
        consume: bool = False,
    ) -> tuple[bool, str]:
        token_row = self.clinical.get_consent_token(token)
        if not token_row:
            return False, "Consent token not found."
        if token_row["user_id"] != user_id:
            return False, "Consent token does not match user."
        if token_row["action_type"] != action_type:
            return False, "Consent token does not match action."
        if token_row["payload_hash"] != payload_hash:
            return False, "Consent token payload mismatch."
        if token_row.get("used_at"):
            return False, "Consent token already used."
        expires_at = parse_iso(token_row["expires_at"])
        if not expires_at or expires_at <= utc_now():
            return False, "Consent token expired."
        if consume:
            self.clinical.mark_consent_token_used(token)
        return True, "ok"
