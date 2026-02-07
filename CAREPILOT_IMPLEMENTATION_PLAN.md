# CarePilot Implementation Plan (Phased, Junior-Executable)

Version: 1.0
Date: 2026-02-07
Source documents:
- `/Users/charleszheng/Desktop/Tartan2026/CAREPILOT_TECHNICAL_DESIGN.md`
- `/Users/charleszheng/Desktop/Tartan2026/CAREPILOT_PRODUCT_DESCRIPTION.md`

## 1. Purpose

This plan translates the technical design into a concrete build sequence with minimal judgment calls.

Execution goal:
- A junior developer can implement CarePilot by completing phases in order.
- Each phase has explicit file targets, coding tasks, commands, and acceptance criteria.
- Do not skip gates. Do not reorder phases unless explicitly noted.

## 2. Non-Negotiable Implementation Rules

1. Follow phases in order.
2. Do not start a new phase until current phase acceptance checklist is fully green.
3. Keep all new code under `extensions/carepilot` unless the phase explicitly says otherwise.
4. No memory-core redesign in this stream.
- Use baseline planned memory now (`memory-lancedb` + existing memory tools).
- Only integrate to memory contracts.
5. No security-core redesign in this stream.
- Implement security checkpoints/hooks and consume security interfaces only.
6. Use synthetic data only for local/testing/demo.
7. If a required API is unavailable, implement mock adapter behind the same interface.
8. LLM provider for this project is Claude only (Anthropic). Do not use OpenAI/Gemini for primary reasoning/chat flows.

## 3. Repository Targets

Main codebase root:
- `/Users/charleszheng/Desktop/Tartan2026/app`

New extension root:
- `/Users/charleszheng/Desktop/Tartan2026/app/extensions/carepilot`

Plan artifact in repo root:
- `/Users/charleszheng/Desktop/Tartan2026/CAREPILOT_IMPLEMENTATION_PLAN.md`

## 3.1 Required Skills, MCPs, and LLM Provider

### Skills (must be used)

Use these skills during implementation:
1. `debugging-strategies`
- Use for bug/root-cause work and failing tests.
2. `code-review-excellence`
- Use at the end of each phase for self-review before merge.
3. `webapp-testing`
- Use for UI/browser interaction validation and screenshots.
4. `frontend-design`
- Use when implementing the full web UI in Phase 8.

### MCPs (must be used)

Required MCP:
1. `context7`
- Purpose: framework/library docs lookup for implementation details.
- Mandatory usage:
  - query Context7 for API/framework usage before implementing new framework-dependent modules.
  - log queried docs/links in phase notes or PR description.

Context7 connection gate:
- In Codex/MCP tooling, `context7` must be resolvable.
- If `context7` is not available, stop and configure MCP before Phase 1.

### LLM API Standard

Use Claude (Anthropic) as the project LLM provider:
- Configure Anthropic key in environment (`ANTHROPIC_API_KEY`).
- Configure OpenClaw model defaults to Claude alias/provider in project config.
- Keep all CarePilot agent defaults on Claude models unless explicitly overridden by lead approval.

## 4. Phase Map

1. Phase 0: Environment + scaffolding baseline.
2. Phase 1: Plugin skeleton + config contract.
3. Phase 2: Database schema + migration system + store layer.
4. Phase 3: Core clinical tools (triage/profile/lab/refill/booking).
5. Phase 4: Hook layer (consent, safety, fail-closed, audit).
6. Phase 5: Proactive engine (heartbeat + cron + controls).
7. Phase 6: Apple Health + health dashboard backend contracts.
8. Phase 7: Voice + document pipelines + trend comparison.
9. Phase 8: Full web app UI implementation.
10. Phase 9: Observability + tests + demo readiness.
11. Phase 10: Memory migration readiness (without migrating yet).

## 5. Phase 0: Environment + Scaffolding Baseline

### Objective
Create a stable local development baseline and verify OpenClaw runs before adding CarePilot code.

### Steps
1. Install dependencies in OpenClaw repo:
- Run: `pnpm install`
2. Confirm baseline build works:
- Run: `pnpm build`
3. Confirm baseline tests run:
- Run: `pnpm test`
4. Configure and verify MCP:
- Verify `context7` MCP is available in tooling.
- If unavailable, configure MCP server and re-check before continuing.
5. Configure Claude as the default LLM provider:
- Set `ANTHROPIC_API_KEY` in local environment.
- Update OpenClaw config to use Claude as primary model for CarePilot agent defaults.
- Run a smoke prompt through gateway and confirm model provider resolves to Anthropic/Claude.
6. Create extension directories:
- `extensions/carepilot`
- `extensions/carepilot/tools`
- `extensions/carepilot/hooks`
- `extensions/carepilot/services`
- `extensions/carepilot/db/migrations`
- `extensions/carepilot/types`
- `extensions/carepilot/tests`
7. Add placeholder README and TODO checklist in extension root.

### Deliverables
- Directory tree exists.
- Baseline build/test logs captured in phase notes.
- MCP connection verification log (Context7).
- Claude provider smoke-test log.

### Acceptance Checklist
- `pnpm build` passes.
- `pnpm test` passes.
- `context7` MCP is reachable and usable.
- Claude is configured as primary provider for CarePilot runtime.
- Extension directory structure created exactly.

## 6. Phase 1: Plugin Skeleton + Config Contract

### Objective
Register CarePilot as a valid OpenClaw plugin with explicit config schema and tool declarations.

### Files to Create
- `extensions/carepilot/openclaw.plugin.json`
- `extensions/carepilot/index.ts`
- `extensions/carepilot/config.ts`
- `extensions/carepilot/types/plugin-config.ts`

### Steps
1. Define plugin manifest:
- `id = carepilot`
- `kind = extension`
- include config schema fields from technical design:
  - `dbPath`
  - `retentionPolicies`
  - `triageMode`
  - `actionMode`
  - `proactiveMaxPerDay`
  - `voice`
  - `docs`
  - `healthkit`
2. In `config.ts`, define and export validated config parser.
3. In `index.ts`, export plugin object and register placeholder tools/hooks with no business logic yet.
4. Add boot-time log line confirming plugin load and config mode.

### Acceptance Checklist
- Plugin appears in `openclaw plugins list`.
- Gateway starts with plugin enabled and no schema errors.
- Invalid config is rejected with clear error.
- Phase self-review done using `code-review-excellence`.

## 7. Phase 2: Database Schema + Migration System + Store Layer

### Objective
Implement CarePilot SQLite schema and migration execution layer.

### Files to Create
- `extensions/carepilot/db/migrations/001_init.sql`
- `extensions/carepilot/db/migrations/002_temporal_memory.sql`
- `extensions/carepilot/db/migrations/003_documents.sql`
- `extensions/carepilot/db/migrations/004_memory_migration_fields.sql`
- `extensions/carepilot/services/clinical-store.ts`
- `extensions/carepilot/services/migrations.ts`
- `extensions/carepilot/services/db.ts`

### Steps
1. Create schema from technical design tables.
2. Ensure every table includes:
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
3. Add `updated_at` triggers for each table.
4. Add required indexes from the design.
5. Ensure appointments status enum includes `pending`.
6. Add `patient_profile.snooze_until`.
7. Add `action_audit.replay_window_bucket` and compound unique index.
8. Add migration runner that executes pending migrations in order.
9. Add small repository functions for each table (create/get/update/list minimal API).

### Acceptance Checklist
- Fresh DB initializes successfully.
- Running migrations twice is idempotent.
- Schema inspection confirms all required columns and indexes.
- Phase self-review done using `code-review-excellence`.

## 8. Phase 3: Core Clinical Tools

### Objective
Implement core business tools with deterministic contracts.

### Files to Create
- `extensions/carepilot/tools/triage-assess.ts`
- `extensions/carepilot/tools/clinical-profile-get.ts`
- `extensions/carepilot/tools/clinical-profile-upsert.ts`
- `extensions/carepilot/tools/lab-recommend.ts`
- `extensions/carepilot/tools/appointment-book.ts`
- `extensions/carepilot/tools/medication-refill-request.ts`
- `extensions/carepilot/services/lab-ranking.ts`
- `extensions/carepilot/services/refill-estimator.ts`

### Steps
1. Implement `triage_assess`:
- fixed label set: `EMERGENT | URGENT_24H | ROUTINE`
- include numeric confidence output + confidence label.
2. Implement profile read/write tools:
- all clinical writes flow through `clinical_profile_upsert`.
3. Implement `lab_recommend`:
- ranking formula exactly as design.
- soft in-network preference only.
4. Implement `appointment_book` state behavior:
- enforce lifecycle progression.
- never return success if uncertain.
5. Implement `medication_refill_request`:
- include edge cases:
  - PRN meds,
  - non-daily regimens,
  - taper regimens,
  - paused meds,
  - missing fill data.

### Acceptance Checklist
- Tool contracts match JSON schema exactly.
- Refill estimator returns expected outputs for all edge-case fixtures.
- Action status transitions are guard-enforced.
- Phase self-review done using `code-review-excellence`.

## 9. Phase 4: Hook Layer (Consent, Safety, Fail-Closed, Audit)

### Objective
Implement policy checkpoints and action governance.

### Files to Create
- `extensions/carepilot/hooks/message-received-triage.ts`
- `extensions/carepilot/hooks/before-tool-call-consent.ts`
- `extensions/carepilot/hooks/before-agent-start-context.ts`
- `extensions/carepilot/hooks/message-sending-disclaimer.ts`
- `extensions/carepilot/hooks/after-tool-call-audit.ts`
- `extensions/carepilot/services/policy-engine.ts`
- `extensions/carepilot/services/idempotency.ts`
- `extensions/carepilot/tools/consent-token-issue.ts`

### Steps
1. Message-received hook:
- run triage before any action logic.
- emergent path blocks transactional tools.
2. Before-tool-call hook:
- enforce consent token validity.
- enforce payload hash match.
- enforce token single-use.
3. Implement fail-closed:
- if policy dependencies unavailable, block transactional tools and emit `policy_unavailable_fail_closed`.
4. Implement idempotency behavior:
- `idempotency_key = sha256(user_id + action_type + canonical_payload + target_ref)`
- use `replay_window_bucket`.
5. Implement audit writes with consent snapshot.

### Acceptance Checklist
- Missing/expired consent always blocked.
- Policy outage always blocks transactional tools.
- Duplicate requests behave per replay rules.
- Phase self-review done using `code-review-excellence`.

## 10. Phase 5: Proactive Engine

### Objective
Implement reminders, quiet hours, and user control mapping.

### Files to Create
- `extensions/carepilot/services/proactive-scheduler.ts`
- `extensions/carepilot/services/proactive-policy.ts`
- `extensions/carepilot/tools/care-preferences-update.ts`

### Steps
1. Configure heartbeat prompt and schedule.
2. Create cron helpers for:
- appointment reminders,
- refill reminders,
- follow-up nudges.
3. Map user commands to profile state:
- `pause` -> `proactive_mode=paused`
- `resume` -> `proactive_mode=active` and clear `snooze_until`
- `snooze X days` -> set `snooze_until`
- `only medication reminders` -> `proactive_mode=medication_only`
4. Enforce send caps:
- max 1 non-urgent proactive/day.
5. Enforce DST/timezone rules from design.

### Acceptance Checklist
- Reminders suppressed in quiet hours.
- Snooze/pause/resume behavior is persisted and honored.
- Daily cap is enforced.
- Phase self-review done using `code-review-excellence`.

## 11. Phase 6: Apple Health + Dashboard Backend Contracts

### Objective
Implement health signal ingest/retrieval and connected-source model.

### Files to Create
- `extensions/carepilot/tools/healthkit-sync-ingest.ts`
- `extensions/carepilot/tools/health-metrics-get.ts`
- `extensions/carepilot/services/health-signal-normalizer.ts`
- `extensions/carepilot/services/health-connections.ts`

### Steps
1. Implement ingest DTO validation.
2. Store metrics:
- cycle,
- medication tracking,
- workouts,
- sleep,
- resting heart rate,
- step count.
3. Implement `health_connections` support for source status and permissions.
4. Ensure response grounding metadata includes source + recency.
5. Implement dashboard backend payload:
- source status,
- metric summaries,
- sync recency,
- symptom-state summary,
- toggles/data controls metadata.

### Acceptance Checklist
- Simulated sync writes and reads correctly.
- Metric toggles affect output and recommendation eligibility.
- Dashboard payload matches contract exactly.
- Phase self-review done using `code-review-excellence`.

## 12. Phase 7: Voice + Document Pipelines

### Objective
Implement STT flow and medical document analysis with trend comparison.

### Files to Create
- `extensions/carepilot/tools/voice-transcribe.ts`
- `extensions/carepilot/services/stt-service.ts`
- `extensions/carepilot/tools/report-extract.ts`
- `extensions/carepilot/tools/report-interpret.ts`
- `extensions/carepilot/services/document-parser.ts`
- `extensions/carepilot/services/lab-trend-comparison.ts`

### Steps
1. Voice pipeline:
- transcribe audio,
- return transcript + confidence + segments,
- ensure transcript is canonical for triage/memory.
2. Document pipeline:
- parse lab and imaging reports only,
- persist findings with provenance and confidence.
3. Implement prior-result trend comparison:
- key: `user_id + normalized_test_name + unit`
- output: prior value, deltas, trend direction, significance hint.
4. Ensure non-diagnostic safety language.

### Acceptance Checklist
- Voice transcript preview/edit flow works end-to-end.
- Upload -> extract -> interpret -> persist succeeds.
- Trend comparison works when prior data exists and states explicit fallback if not.
- Phase self-review done using `code-review-excellence`.

## 13. Phase 8: Full Web App UI

### Objective
Ship the full CarePilot UI surface on top of backend/plugin contracts.

### UI Sections Required
1. Onboarding intake wizard.
2. Chat screen with mic capture and transcript confirm.
3. Health dashboard with connected source cards and metric status.
4. Action receipt timeline.
5. Settings with:
- permissions,
- proactive controls,
- privacy actions (`Export my data`, `Delete my data`).

### Files to Create (example structure)
- `ui/carepilot/src/pages/Onboarding.tsx`
- `ui/carepilot/src/pages/Chat.tsx`
- `ui/carepilot/src/pages/Dashboard.tsx`
- `ui/carepilot/src/pages/Actions.tsx`
- `ui/carepilot/src/pages/Settings.tsx`
- shared API client/hooks/components under `ui/carepilot/src/*`

### Acceptance Checklist
- All required pages render and are navigable.
- Settings actions call backend successfully.
- UI reflects real backend state, not hardcoded data.
- Browser verification done using `webapp-testing`.
- UI review done using `frontend-design` criteria.

## 14. Phase 9: Observability + Tests + Demo Readiness

### Objective
Reach production-like confidence for hackathon demo.

### Steps
1. Add required metrics:
- `carepilot_memory_dual_write_total{result}`
- `carepilot_memory_parity_mismatch_total{type}`
- `carepilot_memory_cutover_mode{mode}`
- `carepilot_memory_recall_latency_ms{backend}`
2. Add logging redaction checks.
3. Implement unit tests:
- triage,
- consent/idempotency,
- refill edge cases,
- temporal decay,
- schema-version compatibility.
4. Implement integration tests:
- hook chain,
- fail-closed behavior,
- dual-write/tombstone propagation,
- routing precedence.
5. Implement E2E tests:
- core journeys from design.

### Commands
- `pnpm test`
- `pnpm build`
- run E2E command configured for CarePilot UI suite.

### Acceptance Checklist
- All tests green.
- Demo scripts run without manual patching.
- No PHI leakage in logs.
- Phase self-review done using `code-review-excellence`.

## 15. Phase 10: Memory Migration Readiness (Do Not Cut Over Yet)

### Objective
Prepare and validate migration mechanics; do not switch production read path in this phase.

### Steps
1. Implement migration modes:
- `baseline_only`
- `shadow_compare`
- `new_primary`
2. Implement Phase 0-2 migration only:
- backfill,
- dual-write,
- parity measurement.
3. Implement rollback automation hooks.
4. Produce migration readiness report with acceptance metrics.

### Cutover Preconditions (must all pass)
- Recall parity >= 90% top-5 overlap over >=500 queries.
- Temporal stale-state parity >= 99% over >=200 fixtures.
- Safety parity 100% over >=200 high-risk cases.
- p95 latency regression <= 20%.
- Dual-write reliability >= 99.5% for 7 days.

### Acceptance Checklist
- Migration readiness report generated.
- Rollback drill tested.
- Team signoff recorded.
- Phase self-review done using `code-review-excellence`.

## 16. Junior Developer Daily Workflow

1. Pick the next incomplete task in current phase.
2. Query `context7` MCP for any framework/library API used by that task and capture references.
3. Implement only that task.
4. If blocked by bugs/failures, apply `debugging-strategies`.
5. Run phase test commands.
6. Update phase checklist in PR description (including skill + MCP usage notes).
7. Request review only when all acceptance items for that task are green.

## 17. Definition of Done (Global)

Feature is done only if all are true:
1. Implementation merged in correct phase order.
2. Acceptance checklist for each touched phase is fully green.
3. Tests are green locally and in CI.
4. Logs show no sensitive leakage.
5. User-visible behavior matches technical design contracts.
6. Demo walkthrough succeeds without code changes.

## 18. Suggested Task Tickets (Ready to Create)

1. `P1-01` Create CarePilot plugin skeleton and manifest.
2. `P2-01` Implement migration runner + base schema.
3. `P3-01` Implement `triage_assess`.
4. `P3-02` Implement profile get/upsert tools.
5. `P3-03` Implement lab recommendation + ranking.
6. `P3-04` Implement refill request + edge-case estimator.
7. `P4-01` Implement consent token + before-tool-call guard.
8. `P4-02` Implement fail-closed and policy event emission.
9. `P5-01` Implement proactive scheduler and controls mapping.
10. `P6-01` Implement HealthKit ingest + health metrics read.
11. `P7-01` Implement STT pipeline.
12. `P7-02` Implement document extraction/interpretation + trend compare.
13. `P8-01` Build onboarding/chat/dashboard/actions/settings UI.
14. `P9-01` Add observability + tests.
15. `P10-01` Implement migration shadow mode + readiness report.
