# CarePilot Cutover Status vs `PRODUCT_DETAIL.md`

Date: 2026-02-07

## Implemented
- Hard cutover to new backend agent core pipeline:
  - tool registry/composition,
  - tool policy allowlist filtering,
  - `before_tool_call` and `after_tool_call` hooks,
  - unified tool execution lifecycle with auditable state transitions.
- CarePilot tool surface migrated and active:
  - `clinical_profile_get`
  - `clinical_profile_upsert`
  - `lab_clinic_discovery` (ranked options + transparent rank factors)
  - `appointment_book`
  - `medication_refill_request`
  - `consent_token_issue`
- Memory system implemented with two-store model:
  - clinical store (SQLite source of truth),
  - conversational preference/summary store (SQLite).
- Memory routing precedence enforced:
  - clinical first, conversational second, documents placeholder third.
- Temporal memory lifecycle implemented:
  - reconfirm due around 48h for active symptom states,
  - auto-transition to `resolved_unconfirmed` at 7d,
  - inference expiry capped to <= 24h.
- Safety and security controls implemented:
  - emergency-turn transactional blocking,
  - consent token required for transactional tools and validated before call,
  - strict user/session scoping checks where memory is accessed,
  - anti-dump guard for broad memory/profile dump prompts.
- Frontend chat/action UX contract preserved:
  - SSE events remain `token`, `message`, `action_plan`, `error`,
  - action confirmation modal flow preserved.

## Partial
- Proactive care controls in product spec (`pause`, `resume`, `snooze`, `medication_only`, quiet-hours suppression) are not fully wired end-to-end in the new core path.
- Refill predictor is implemented in core but does not yet fully cover all advanced confidence/reporting behavior from the complete product spec.
- Policy/audit telemetry exists but not all product-level analytics and observability counters are fully implemented.

## Missing
- Apple Health ingestion/dashboard cards and per-metric permission UI/flows.
- Voice transcript pipeline (`voice_transcribe`) and transcript preview/edit flow.
- Document upload/extraction/interpretation tools (`report_extract`, `report_interpret`) and file retention enforcement flows.
- Privacy export/delete command flows and full data export package pipeline.
- Human escalation workflow (`human_escalation_create`).

## Notes
- This migration intentionally removed the legacy Dedalus/ad-hoc agent execution path and dead frontend agent helper modules.
- The repository remains in development/hackathon shape; missing product-scope features above are follow-on tracks, not blockers for the core cutover delivered here.
