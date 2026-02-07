# CarePilot Memory Implementation (Hackathon-Realistic)

Date: 2026-02-07  
Scope: MVP/hackathon execution plan aligned with `PRODUCT_DETAIL.md` and `TECH_DOC.md`

## 1. Objective

Build a memory system that is:
- safe for healthcare-oriented guidance,
- realistic to implement in a hackathon timeline,
- compatible with future migration to a stronger long-term memory backend.

## 2. What We Will Build (Hackathon Scope)

We will implement a two-store memory model:

1. Clinical store (source of truth)
- Structured SQLite tables for conditions, allergies, medications, symptom states, events, health signals, and extracted findings.
- Used for all safety-critical medical facts.

2. Conversational preference store
- Lightweight SQLite table(s) for user preferences and conversation summaries.
- Optional FTS5 index for keyword retrieval.
- Used only for personalization and continuity, never to override clinical facts.

## 3. What We Will Not Build (Hackathon)

- No full memory backend migration (no dual-write cutover in hackathon).
- No graph-memory stack (Mem0/Graphiti) in MVP.
- No heavy neural reranking pipeline.
- No broad infra expansion beyond local SQLite + existing app runtime.

## 4. Memory Rules (Product-Critical)

Memory classes:
- `LONG_LIVED_FACT`: allergies, chronic conditions; no default expiry.
- `TIME_BOUND_STATE`: temporary symptoms/states; must track `last_confirmed_at` and `expires_at`.
- `EVENT`: immutable history (appointments/refills/actions).
- `INFERENCE`: low-trust model inference; hard TTL <= 24h.

Required temporal behavior:
- Reconfirmation due at ~48h after initial active time-bound symptom state.
- Auto-transition to `resolved_unconfirmed` at 7 days without reconfirmation.
- `resolved_unconfirmed` is history-only and not treated as current condition.
- Apple Health trend summaries decay every 7 days unless refreshed.

## 5. Data Model (Minimal MVP Tables)

Clinical source-of-truth tables:
- `patient_profile`
- `conditions`
- `allergies`
- `medications`
- `symptom_states`
- `appointments`
- `action_audit`
- `health_signals`
- `documents`
- `extracted_findings`

Conversational memory tables:
- `conversation_preferences`
  - `id`, `user_id`, `key`, `value_json`, `source`, `confidence`, `updated_at`
- `conversation_summaries`
  - `id`, `user_id`, `session_key`, `summary_text`, `tags_json`, `created_at`
- Optional: FTS5 virtual table for `conversation_summaries.summary_text`

Common fields:
- Every record keeps `created_at` and `updated_at`.
- User-scoped tables always include `user_id`.
- Provenance fields required where relevant (`source`, confidence, timestamps, file/source metadata).

## 6. Read/Write Routing Policy (Must Enforce)

Read precedence:
1. `clinical_profile_get` for medical/safety facts.
2. Conversational recall for preference/context only.
3. Document lookup for citation-style retrieval when needed.

Write precedence:
1. `clinical_profile_upsert` for clinical state.
2. Conversational write endpoint for preference/habit data.

Conflict resolution:
- If clinical and conversational memory disagree, clinical store wins.
- Assistant should ask for reconfirmation instead of silently overwriting.

## 7. Retrieval Strategy (Hackathon Version)

For each user request:
1. Load structured clinical profile snapshot.
2. Load active symptom states (excluding expired or resolved-unconfirmed current-state use).
3. Load recent events and health signals by recency.
4. Retrieve conversational summaries:
- first by recent window (for example last 14-30 days),
- optionally by FTS keyword match.
5. Merge into prompt context with explicit source labels.

No dense-vector reranking is required for hackathon MVP.

## 8. Temporal Engine Implementation

Implement temporal transitions as deterministic service logic (lazy + scheduled):

1. Lazy pass on read/write:
- evaluate each `TIME_BOUND_STATE` and `INFERENCE` for expiry and transitions.

2. Scheduled pass (heartbeat/cron):
- run periodic reconfirmation and decay jobs.
- enqueue reconfirmation prompts for due states.

3. Transition rules:
- `active` + no reconfirmation >= 7 days -> `resolved_unconfirmed`.
- inference older than TTL -> mark expired/unavailable for current decisions.
- stale health trend summaries -> decay marker and deprioritize in recommendations.

## 9. Safety and Privacy Controls

Mandatory controls for hackathon:
- Strict `user_id` scoping on all memory reads/writes.
- Session scoping where applicable (`session_key`).
- Block broad "dump all memory/profile" responses.
- Redact sensitive data in logs.
- Keep consent/audit writes for transactional actions.

## 10. Implementation Plan (3-Day Execution)

Day 1:
- Create/validate SQLite schema and migrations for clinical + conversational memory.
- Implement `clinical_profile_get` and `clinical_profile_upsert`.
- Wire routing precedence in agent/tool orchestration.

Day 2:
- Implement temporal engine rules (48h reconfirm, 7d auto-resolve, inference TTL, health signal decay).
- Implement conversation summary writes and simple recall (recency + optional FTS).
- Add provenance fields for health signals and extracted findings.

Day 3:
- Add safety/privacy gates (scoping, anti-dump guardrails, basic redaction).
- Add observability counters for memory reads/writes/errors/decay transitions.
- Run end-to-end demo flows and patch reliability issues.

## 11. Acceptance Criteria (Hackathon MVP)

Functional:
- Profile facts persist across sessions.
- Time-bound symptoms auto-transition correctly without reconfirmation.
- Conversational preferences personalize responses without overriding clinical truth.
- Apple Health trends and document findings are source-labeled and time-scoped.

Safety:
- Emergency/safety logic never depends on conversational memory over clinical state.
- Cross-user access is blocked.
- Memory dump requests are blocked/sanitized.

Reliability:
- No crashes under expected demo load.
- Deterministic status updates for actions and memory transitions.

## 12. Post-Hackathon Upgrade Path

After demo stability:
1. Introduce memory adapter interface to support dual backend reads/writes.
2. Add shadow-compare mode and parity metrics.
3. Add hybrid dense + keyword retrieval and optional reranker.
4. Evaluate Mem0 or Graphiti sidecar for richer long-term relational memory.
5. Execute phased migration with rollback controls from the technical design.

## 13. Deliverables Checklist

- Migration SQL for clinical and conversational memory tables.
- Service modules:
  - clinical memory service
  - conversational memory service
  - temporal lifecycle service
  - memory policy guard service
- Tool contracts wired to routing policy.
- Basic tests for:
  - temporal transitions
  - routing precedence
  - user/session scoping
  - anti-dump safeguards
