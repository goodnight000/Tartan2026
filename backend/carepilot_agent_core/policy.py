from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .models import ExecutionContext
from .registry import ToolDefinition


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    code: str
    message: str


class PolicyEngine:
    _EMERGENCY_PATTERNS = [
        re.compile(r"chest pain.*breath", re.IGNORECASE),
        re.compile(r"stroke", re.IGNORECASE),
        re.compile(r"severe bleeding", re.IGNORECASE),
        re.compile(r"anaphylaxis", re.IGNORECASE),
        re.compile(r"overdose", re.IGNORECASE),
        re.compile(r"self[- ]?harm", re.IGNORECASE),
        re.compile(r"suicid", re.IGNORECASE),
    ]

    def __init__(self, allowlist: set[str], transactional_tools: set[str]) -> None:
        self.allowlist = allowlist
        self.transactional_tools = transactional_tools

    def is_emergency_text(self, text: str) -> bool:
        cleaned = (text or "").strip()
        for pattern in self._EMERGENCY_PATTERNS:
            if pattern.search(cleaned):
                return True
        return False

    def evaluate(self, ctx: ExecutionContext, tool: ToolDefinition, payload: dict[str, Any]) -> PolicyDecision:
        if tool.name not in self.allowlist:
            return PolicyDecision(False, "allowlist_denied", f"Tool '{tool.name}' is not allowlisted.")
        if tool.name in self.transactional_tools and ctx.emergency:
            return PolicyDecision(
                False,
                "emergency_transaction_block",
                "Transactional actions are blocked in an emergency context.",
            )
        if payload.get("target_user_id") and payload.get("target_user_id") != ctx.user_id:
            return PolicyDecision(False, "cross_user_block", "Cross-user target is blocked.")
        return PolicyDecision(True, "ok", "allowed")

