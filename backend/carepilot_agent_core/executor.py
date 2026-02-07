from __future__ import annotations

import hashlib
import json
from typing import Any

from memory.service import canonical_payload_hash

from .hooks import HookRunner
from .lifecycle import ActionLifecycleService, LifecycleError
from .models import ExecutionContext, ToolExecutionResult
from .policy import PolicyEngine
from .registry import ToolRegistry


def _default_idempotency_key(user_id: str, action_type: str, payload: dict[str, Any], session_key: str) -> str:
    base = f"{user_id}:{action_type}:{canonical_payload_hash(payload)}:{session_key}"
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


class AgentExecutor:
    def __init__(
        self,
        *,
        registry: ToolRegistry,
        policy: PolicyEngine,
        hooks: HookRunner,
        lifecycle: ActionLifecycleService,
    ) -> None:
        self.registry = registry
        self.policy = policy
        self.hooks = hooks
        self.lifecycle = lifecycle

    def execute(self, ctx: ExecutionContext, tool_name: str, payload: dict[str, Any]) -> ToolExecutionResult:
        tool = self.registry.resolve(tool_name)
        payload_hash = canonical_payload_hash(payload)
        idempotency_key = payload.get("idempotency_key") or _default_idempotency_key(
            ctx.user_id, tool.name, payload, ctx.session_key
        )
        action = self.lifecycle.start(
            user_id=ctx.user_id,
            session_key=ctx.session_key,
            action_type=tool.name,
            payload_hash=payload_hash,
            payload_json=payload,
            idempotency_key=idempotency_key,
            consent_token=payload.get("consent_token"),
        )
        lifecycle = list(action.lifecycle)

        current_state = action.status
        if action.replayed and action.status in {"succeeded", "failed", "partial", "blocked", "expired"}:
            replay_data = dict(action.result_json or {})
            replay_data["replayed"] = True
            replay_data["idempotency_key"] = idempotency_key
            return ToolExecutionResult(
                status=action.status,
                data=replay_data,
                errors=[],
                lifecycle=lifecycle,
                action_id=action.action_id,
            )

        try:
            if tool.transactional:
                lifecycle = self.lifecycle.transition(action_id=action.action_id, next_state="awaiting_confirmation")
                current_state = "awaiting_confirmation"
                if not ctx.user_confirmed:
                    lifecycle = self.lifecycle.transition(action_id=action.action_id, next_state="blocked")
                    return ToolExecutionResult(
                        status="blocked",
                        data={},
                        errors=[{"code": "not_confirmed", "message": "User confirmation required."}],
                        lifecycle=lifecycle,
                        action_id=action.action_id,
                    )

            policy_decision = self.policy.evaluate(ctx, tool, payload)
            if not policy_decision.allowed:
                next_state = "blocked" if current_state in {"planned", "awaiting_confirmation"} else "failed"
                lifecycle = self.lifecycle.transition(action_id=action.action_id, next_state=next_state)
                return ToolExecutionResult(
                    status=next_state,
                    data={},
                    errors=[{"code": policy_decision.code, "message": policy_decision.message}],
                    lifecycle=lifecycle,
                    action_id=action.action_id,
                )

            hook_decision = self.hooks.run_before(ctx, tool, payload)
            if not hook_decision.allowed:
                next_state = "blocked" if current_state in {"planned", "awaiting_confirmation"} else "failed"
                lifecycle = self.lifecycle.transition(action_id=action.action_id, next_state=next_state)
                outcome = {
                    "status": next_state,
                    "data": {},
                    "errors": [{"code": hook_decision.code, "message": hook_decision.message}],
                    "lifecycle": lifecycle,
                }
                self.hooks.run_after(ctx, tool, payload, outcome)
                return ToolExecutionResult(
                    status=next_state,
                    data={},
                    errors=outcome["errors"],
                    lifecycle=lifecycle,
                    action_id=action.action_id,
                )

            if current_state in {"planned", "awaiting_confirmation"}:
                lifecycle = self.lifecycle.transition(action_id=action.action_id, next_state="executing")

            try:
                tool_output = tool.handler(ctx, payload)
            except Exception as exc:
                lifecycle = self.lifecycle.transition(
                    action_id=action.action_id,
                    next_state="failed",
                    error_code="tool_exception",
                    error_message=str(exc),
                )
                outcome = {
                    "status": "failed",
                    "data": {},
                    "errors": [{"code": "tool_exception", "message": str(exc)}],
                    "lifecycle": lifecycle,
                }
                self.hooks.run_after(ctx, tool, payload, outcome)
                return ToolExecutionResult(
                    status="failed",
                    data={},
                    errors=outcome["errors"],
                    lifecycle=lifecycle,
                    action_id=action.action_id,
                )

            result_state = tool_output.get("status", "succeeded")
            if result_state not in {"succeeded", "failed", "partial", "blocked", "expired", "pending"}:
                result_state = "succeeded"
            lifecycle = self.lifecycle.transition(
                action_id=action.action_id,
                next_state=result_state,
                result=tool_output.get("data"),
                error_code=(tool_output.get("errors") or [{}])[0].get("code") if tool_output.get("errors") else None,
                error_message=(tool_output.get("errors") or [{}])[0].get("message")
                if tool_output.get("errors")
                else None,
            )
            outcome = {
                "status": result_state,
                "data": tool_output.get("data", {}),
                "errors": tool_output.get("errors", []),
                "lifecycle": lifecycle,
            }
            self.hooks.run_after(ctx, tool, payload, outcome)
            return ToolExecutionResult(
                status=result_state,
                data=outcome["data"],
                errors=outcome["errors"],
                lifecycle=lifecycle,
                action_id=action.action_id,
            )
        except LifecycleError as exc:
            return ToolExecutionResult(
                status="failed",
                data={},
                errors=[{"code": "lifecycle_error", "message": str(exc)}],
                lifecycle=lifecycle,
                action_id=action.action_id,
            )

    @staticmethod
    def canonical_payload(payload: dict[str, Any]) -> str:
        return json.dumps(payload, sort_keys=True, separators=(",", ":"))
