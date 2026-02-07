from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


TERMINAL_STATES = {"succeeded", "failed", "partial", "blocked", "expired", "pending"}
ACTION_STATES = {
    "planned",
    "awaiting_confirmation",
    "executing",
    "succeeded",
    "failed",
    "partial",
    "blocked",
    "expired",
    "pending",
}


@dataclass
class ExecutionContext:
    user_id: str
    session_key: str
    request_id: str
    message_text: str = ""
    emergency: bool = False
    user_confirmed: bool = False


@dataclass
class ToolExecutionResult:
    status: str
    data: dict[str, Any] = field(default_factory=dict)
    errors: list[dict[str, Any]] = field(default_factory=list)
    lifecycle: list[str] = field(default_factory=list)
    action_id: str | None = None

    def as_envelope(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "data": self.data,
            "errors": self.errors,
            "lifecycle": self.lifecycle,
            "action_id": self.action_id,
        }

