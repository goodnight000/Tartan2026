# CarePilot Agent + Memory Implementation Plan

Date: 2026-02-07  
Status: Proposed (no code executed yet)

## 1. Goal

Build a CarePilot-owned agent core that:

- Reuses only the OpenClaw agent patterns needed for tool orchestration.
- Keeps current frontend contracts and UX intact.
- Implements memory per `MEMORY_IMPLEMENTATION_HACKATHON.md`.
- Supports safe action-taking (lab/clinic discovery + booking/refill flows).

## 2. Scope Boundary

### In Scope (from OpenClaw)

- Tool registry/composition pattern.
- Tool policy filtering pattern.
- Hook pipeline pattern:
  - `before_tool_call`
  - `after_tool_call`
- Web research/browser tool patterns (`web_search`, `web_fetch`, `browser`) as references.

### Out of Scope (do not port)

- OpenClaw UI.
- Channel providers/messaging platform integrations.
- Mobile apps.
- Full OpenClaw gateway/runtime infra.
- Non-agent subsystems unrelated to CarePilot.

## 3. Target Architecture

1. Keep current frontend behavior:
- SSE events remain: `token`, `message`, `action_plan`, `error`.
- Current action confirmation modal flow remains.

2. Introduce local backend module:
- `carepilot-agent-core` (inside this repo).
- Owns tool registration, policy filtering, hook execution, tool lifecycle.

3. Memory routing:
- Clinical store = source of truth.
- Conversational store = preferences/continuity only.
- Routing precedence:
  1. `clinical_profile_get`
  2. conversational recall
  3. document/context retrieval as needed

## 4. Planned Module Layout

Proposed new backend module structure (names can be adjusted during implementation):

- `backend/carepilot_agent_core/`
  - `registry.py|ts`
  - `policy.py|ts`
  - `hooks.py|ts`
  - `executor.py|ts`
  - `lifecycle.py|ts`
- `backend/carepilot_tools/`
  - `clinical_profile_get`
  - `clinical_profile_upsert`
  - `lab_clinic_discovery`
  - `appointment_book`
  - `medication_refill_request`
  - `consent_token_issue`
- `backend/memory/`
  - `clinical_store`
  - `conversation_store`
  - `temporal_lifecycle`
  - `memory_policy_guard`

## 5. Phase Plan

## Phase 0: Contracts and Data Schemas

Deliverables:
- Finalize tool I/O schemas.
- Finalize action lifecycle states:
  - `planned -> awaiting_confirmation -> executing -> succeeded|failed|partial|blocked|expired`
- Finalize consent token schema and expiry policy.
- Finalize memory table schemas and migration plan.

Acceptance Criteria:
- All contracts are documented and test fixtures exist.
- No ambiguous state transitions remain.

## Phase 1: Build `carepilot-agent-core`

Deliverables:
- Tool registry and composition.
- Policy filter stack (allow/deny, role-based if needed).
- Hook runner (`before_tool_call`, `after_tool_call`).
- Tool execution wrapper with lifecycle events.

Acceptance Criteria:
- Tools can be registered and executed through one pipeline.
- `before_tool_call` can block execution deterministically.
- `after_tool_call` reliably receives outcome payloads.

## Phase 2: Wire Current Frontend to New Core (No UX Changes)

Deliverables:
- Keep `/api/chat/stream` response shape unchanged.
- Adapter from current route to new core.
- Keep action confirmation UX unchanged.

Acceptance Criteria:
- Frontend works without UI rewrites.
- `action_plan` behavior unchanged for users.

## Phase 3: Tool Surface Migration

Deliverables:
- Replace ad-hoc tools with CarePilot tools:
  - `clinical_profile_get`
  - `clinical_profile_upsert`
  - `lab/clinic discovery` (ranked output)
  - `appointment_book` (mock first)
  - `medication_refill_request` (mock first)
- Add structured tool result envelopes.

Acceptance Criteria:
- Read-only and transactional tools run through unified pipeline.
- Booking/refill produce lifecycle states and auditable outcomes.

## Phase 4: Memory Implementation (from `MEMORY_IMPLEMENTATION_HACKATHON.md`)

Deliverables:
- Two-store model:
  - clinical store
  - conversational preference/summaries store
- Temporal lifecycle rules:
  - reconfirmation at ~48h for active time-bound states
  - auto-transition to `resolved_unconfirmed` at 7 days
  - inference TTL <= 24h
- Strict user/session scoping + anti-dump guardrails.

Acceptance Criteria:
- Clinical facts persist and override conversational ambiguity.
- Temporal transitions are deterministic and tested.
- Cross-user leakage is blocked.

## Phase 5: Safety + Consent + Audit

Deliverables:
- `before_tool_call` checks:
  - emergency turn transactional block
  - consent token validation (missing/expired => block)
  - allowlist/policy checks
- `after_tool_call` audit:
  - action outcome
  - consent snapshot
  - timestamps and target refs

Acceptance Criteria:
- No transactional action executes without valid consent.
- Emergency-turn actions are blocked and logged.
- Audit trail is queryable per user/action.

## Phase 6: Rollout

Phase A: Shadow Mode
- New core runs in parallel, side effects disabled.

Phase B: Read-Only Cutover
- Enable discovery/research tools only.

Phase C: Transactional Cutover
- Enable booking/refill with consent tokens.

Phase D: Full Switch
- Decommission old Dedalus tool path.

Acceptance Criteria:
- No regression in chat UX.
- Error rates and policy blocks within expected bounds.

## 6. Coverage vs `PRODUCT_DETAIL.md`

### Covered by this plan

- Triage + safety gating.
- Action-taking with explicit confirmation.
- Lab/clinic discovery and ranked output path.
- Appointment/refill workflows with lifecycle/audit.
- Memory system design + temporal lifecycle.
- Consent and `before_tool_call` enforcement.
- User-visible action history support.

### Partially covered / follow-on track required

- Proactive reminders controls (`pause/resume/snooze/quiet hours`) if not added in tool/cron phase.
- Voice input transcript-confirm-edit flow.
- Medical document/image analysis flow.
- Apple Health integration and dashboard toggles.
- Privacy commands (export/delete).

## 7. Risks and Mitigations

1. Risk: Porting too much OpenClaw runtime.
- Mitigation: enforce extraction boundary and adapter interfaces.

2. Risk: Breaking existing frontend UX.
- Mitigation: preserve SSE/event contract and action modal semantics.

3. Risk: Safety regressions during migration.
- Mitigation: shadow mode + policy-first gating + audit checks before cutover.

4. Risk: Memory inconsistency.
- Mitigation: routing precedence rules and explicit transition tests.

## 8. Feasibility Summary

This plan is feasible and aligns with your goal to take only the agent-related parts from OpenClaw while implementing memory per `MEMORY_IMPLEMENTATION_HACKATHON.md`.  
It delivers the core of `PRODUCT_DETAIL.md` and leaves clearly scoped follow-on tracks for remaining multimodal and integration features.
