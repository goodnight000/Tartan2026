from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .models import ExecutionContext
from .registry import ToolDefinition


BeforeHook = Callable[[ExecutionContext, ToolDefinition, dict[str, Any]], "HookDecision"]
AfterHook = Callable[[ExecutionContext, ToolDefinition, dict[str, Any], dict[str, Any]], None]


@dataclass(frozen=True)
class HookDecision:
    allowed: bool
    code: str = "ok"
    message: str = "allowed"


class HookRunner:
    def __init__(self) -> None:
        self._before_hooks: list[BeforeHook] = []
        self._after_hooks: list[AfterHook] = []

    def add_before(self, hook: BeforeHook) -> None:
        self._before_hooks.append(hook)

    def add_after(self, hook: AfterHook) -> None:
        self._after_hooks.append(hook)

    def run_before(self, ctx: ExecutionContext, tool: ToolDefinition, payload: dict[str, Any]) -> HookDecision:
        for hook in self._before_hooks:
            decision = hook(ctx, tool, payload)
            if not decision.allowed:
                return decision
        return HookDecision(allowed=True)

    def run_after(
        self,
        ctx: ExecutionContext,
        tool: ToolDefinition,
        payload: dict[str, Any],
        outcome: dict[str, Any],
    ) -> None:
        for hook in self._after_hooks:
            hook(ctx, tool, payload, outcome)

