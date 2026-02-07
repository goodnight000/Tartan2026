from __future__ import annotations

import re
from dataclasses import dataclass


class MemoryPolicyError(Exception):
    pass


@dataclass(frozen=True)
class DumpGuardResult:
    blocked: bool
    reason: str | None = None


class MemoryPolicyGuard:
    _DUMP_PATTERNS = [
        re.compile(r"\bdump\b.*\b(memory|profile|history)\b", re.IGNORECASE),
        re.compile(r"\bshow\b.*\ball\b.*\b(memory|records|profile)\b", re.IGNORECASE),
        re.compile(r"\bexport\b.*\ball\b.*\b(memory|profile)\b", re.IGNORECASE),
        re.compile(r"\bentire\b.*\bprofile\b", re.IGNORECASE),
    ]

    _ALLOWED_SECTIONS = {"conditions", "allergies", "medications", "preferences", "active_symptoms"}

    def ensure_user_scope(self, requested_user_id: str, scoped_user_id: str) -> None:
        if requested_user_id != scoped_user_id:
            raise MemoryPolicyError("Cross-user access is blocked.")

    def ensure_session_scope(self, session_key: str) -> None:
        if not session_key or len(session_key) > 128:
            raise MemoryPolicyError("Invalid session scope.")

    def check_dump_request(self, text: str) -> DumpGuardResult:
        cleaned = (text or "").strip()
        for pattern in self._DUMP_PATTERNS:
            if pattern.search(cleaned):
                return DumpGuardResult(blocked=True, reason="Broad memory dump is blocked by policy.")
        return DumpGuardResult(blocked=False)

    def normalize_sections(self, sections: list[str] | None) -> list[str]:
        if not sections:
            return ["conditions", "allergies", "medications", "preferences", "active_symptoms"]
        normalized = [section.strip().lower() for section in sections if section.strip()]
        invalid = [section for section in normalized if section not in self._ALLOWED_SECTIONS]
        if invalid:
            raise MemoryPolicyError(f"Unsupported profile sections requested: {', '.join(sorted(set(invalid)))}")
        return sorted(set(normalized))
