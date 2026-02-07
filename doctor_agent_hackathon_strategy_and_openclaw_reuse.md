# AI Family Doctor Hackathon Plan (Built on OpenClaw)

## 1) Product Definition (Sharpened)

## 1.1 One-line product
A proactive, action-taking health copilot that combines personalized memory with safe, user-approved execution (booking, refills, reminders, follow-ups).

## 1.2 Core differentiation
- Most chatbots: answer-only.
- Your app: answer + remember + proactively monitor + execute actions with consent.
- Most "memory" systems: generic chat history.
- Your app: structured health context + explicit safety controls for every high-stakes action.

## 1.3 Positioning statement
"A personal AI family doctor assistant for routine care coordination and health adherence, not emergency care and not a licensed physician replacement."

## 2) Hackathon Scope (What to build now)

## 2.1 Must-have user journeys
1. Symptom triage (low/med/high risk) with clear next-step guidance.
2. Medication adherence + refill reminders with user confirmation before action.
3. Lab/clinic recommendation ranked by distance + price + availability.
4. Action execution after approval:
- Book online when possible.
- Place outbound call workflow when needed.
5. Proactive follow-up messages after missed meds / pending tasks / abnormal trends.
6. Connected health-data insights (Apple Health) with user-controlled permissions and visible tracking status.
7. Multimodal intake:
- Voice symptom input (speech-to-text).
- Document analysis (lab report summary + key-value extraction).

## 2.2 Non-goals for hackathon
- Autonomous emergency handling.
- Direct diagnosis claims.
- Full EHR write-back + insurance adjudication.
- Broad multi-provider production integrations.

## 3) Safety Model (Critical)

## 3.1 Mandatory guardrails
- Emergency language detection route: immediate emergency script and stop transactional actions.
- No medication changes without explicit user confirmation.
- No irreversible action without user-visible confirmation token.
- Every action gets an audit record with status: `success | pending | failed | blocked`.
- Agent must never claim completion unless tool returns confirmed success.

## 3.2 User trust UX rules
- Always show: why recommendation, what data used, confidence, and alternatives.
- Add persistent banner: "For education and care coordination only. If severe symptoms, call emergency services."
- For proactive outreach, support `pause`, `snooze`, and quiet hours.

## 4) Memory Strategy (Personalized + Safe)

## 4.1 Split memory into two systems
1. Conversational preference memory (OpenClaw memory):
- communication style
- reminder preferences
- routines and habits

2. Clinical memory (external structured store):
- meds, allergies, conditions, labs, vitals
- care plans, prior actions, refill status

## 4.2 Source-of-truth rule
Clinical recommendations and actions must read from structured clinical store first. OpenClaw memory can enrich communication, not replace clinical records.

## 5) OpenClaw Reuse Map (Validated from this repo)

## 5.1 Reuse as-is
- Agent turn orchestration and queueing:
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/src/auto-reply/reply/get-reply-run.ts`
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/src/auto-reply/reply/queue/settings.ts`
- Tool assembly and policy layering:
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/src/agents/pi-tools.ts`
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/src/agents/pi-tools.policy.ts`
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/src/agents/tool-policy.ts`
- Hook interception for tool safety gates:
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/src/agents/pi-tools.before-tool-call.ts`
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/src/plugins/hooks.ts`
- Proactive runtime (heartbeat + cron + system events):
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/src/infra/heartbeat-runner.ts`
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/src/auto-reply/heartbeat.ts`
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/src/infra/system-events.ts`
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/src/cron/types.ts`
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/src/agents/tools/cron-tool.ts`
- Memory search/get primitives for non-clinical context:
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/src/agents/tools/memory-tool.ts`
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/src/memory/manager.ts`
- Plugin/tool extension system:
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/docs/plugins/agent-tools.md`
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/docs/plugin.md`

## 5.2 Reuse with modification
- Memory behavior:
  - Avoid raw PHI auto-capture patterns from LanceDB plugin defaults.
  - Reference: `/Users/charleszheng/Desktop/Tartan2026/openclaw/extensions/memory-lancedb/index.ts`
- Cron usage:
  - Prefer `sessionTarget=main` + `systemEvent` for patient-safe reminders.
  - Use `isolated` agent turns for backend maintenance workflows.
- Messaging/action containment:
  - Enforce explicit targets for subflows and restrictive send policies.
  - Reference: `/Users/charleszheng/Desktop/Tartan2026/openclaw/src/sessions/send-policy.ts`

## 5.3 Build new (health-specific)
- New healthcare plugin with tools:
  - `triage_assess`
  - `clinical_profile_get`
  - `care_plan_get`
  - `medication_refill_request`
  - `lab_recommend`
  - `appointment_book`
  - `human_escalation_create`
  - `healthkit_sync_ingest`
  - `health_metrics_get`
  - `voice_transcribe`
  - `report_extract`
  - `report_interpret`
  - `imaging_interpret_assist`
- Domain safety hook (`before_tool_call`) to block unsafe action paths.
- Consent/idempotency layer (confirmation tokens + dedupe keys).
- Clinical datastore and adapters (FHIR/EHR/pharmacy/lab vendors).

## 6) "Call to book" and "find nearby + price" fit

## 6.1 Nearby discovery
- Reuse place-search pattern from:
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/skills/local-places/SKILL.md`
- Adapt query/ranking for medical facilities:
  - radius
  - in-network preference
  - price estimates
  - open hours

## 6.2 Phone execution
- Reuse voice execution surface from Voice Call plugin:
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/extensions/voice-call/index.ts`
  - `/Users/charleszheng/Desktop/Tartan2026/openclaw/docs/plugins/voice-call.md`
- Keep human approval before dialing.

## 7) Suggested 3-Phase Hackathon Build

## Phase A (day 1): safe skeleton
- Chat + triage + recommendation only.
- Health plugin with read-only tools.
- Emergency lockout path + disclaimer UX.

## Phase B (day 2): action engine
- Add booking/refill action tools with explicit user confirmation.
- Add audit logging + deterministic action status.
- Add nearby lab ranking endpoint.

## Phase C (day 3): proactive layer
- Add cron reminders + heartbeat follow-up.
- Add quiet hours and frequency caps.
- Add simple dashboard: upcoming tasks, pending actions, last action status.

## 8) Demo Script (7 minutes)
1. User reports recurring fatigue.
2. Agent triages as non-emergency, references prior history.
3. Agent suggests CBC + thyroid panel and explains why.
4. User approves "find nearby labs under $X".
5. Agent presents ranked options and books one.
6. Agent sets refill reminder and follow-up check-in.
7. Show audit trail + consent log.

## 9) Immediate Next Decisions for your team
1. Pick first action integration: booking API first or call-first.
2. Define emergency/high-risk trigger list for lockout.
3. Decide minimum clinical data model for demo (meds/allergies/conditions/labs).
4. Decide default proactive cadence and quiet hours.

## 10) Proposed Feature Mechanics (Concrete Defaults)

## 10.1 Triage state machine (recommended)
- `EMERGENT`: chest pain, stroke signs, severe breathing issues, anaphylaxis, active self-harm risk, overdose, severe bleeding.
- `URGENT_24H`: persistent high fever, moderate breathing symptoms, medication side effects with worsening trend, severe pain without red flags.
- `ROUTINE`: mild-to-moderate symptoms without immediate danger signs.
- Rule: triage runs before any tool call; `EMERGENT` hard-blocks transactional tools and returns emergency guidance only.

## 10.2 Action lifecycle and consent contract
- State machine: `planned -> awaiting_confirmation -> executing -> succeeded|failed|partial|blocked|expired`.
- Every transactional action shows:
  - exact target (provider/pharmacy/lab)
  - exact parameters (time, address, med, dosage, cost estimate)
  - explicit confirmation prompt (`Yes, proceed`).
- Use idempotency key: `user_id + action_type + normalized_payload + day_bucket`.
- If tool output is uncertain, status must be `pending` or `failed`, never "done."

## 10.3 Lab/clinic ranking model (hackathon-simple)
- Score formula (initial): `0.35*distance + 0.25*estimated_price + 0.25*next_slot + 0.10*rating + 0.05*in_network_match`.
- User controls:
  - `max distance`
  - `budget cap`
  - `earliest acceptable date/time`
  - `in-network only` toggle
- Output always includes at least 3 options when available + "why ranked this way."

## 10.4 Medication refill predictor behavior
- Inputs: last fill date, quantity dispensed, sig (frequency), reported missed doses.
- Run-out estimate: `fill_date + (remaining_doses / prescribed_daily_dose)`.
- Confidence labels:
  - `high` (all fields known),
  - `medium` (1 inferred field),
  - `low` (multiple inferred fields).
- If confidence is low, ask user: "About how many pills are left?" before proposing a refill action.

## 10.5 Proactive messaging policy
- Default cap: max 1 non-urgent proactive message/day.
- Quiet hours default: 10:00 PM to 8:00 AM local time.
- User controls supported in natural language:
  - `pause proactive care`
  - `resume proactive care`
  - `snooze for X days`
  - `only medication reminders`
- Escalation rule: if 2+ ignored reminders and issue is safety-relevant (e.g., missed refill), send one final "high-importance" check-in.

## 10.6 Human escalation design
- Add tool: `human_escalation_create`.
- Trigger when:
  - user explicitly asks for a person,
  - uncertainty is high in high-risk context,
  - repeated failed actions (booking/refill attempts).
- Escalation packet:
  - user summary
  - reason for escalation
  - latest triage category
  - action attempts and failures

## 11) Minimal Clinical Data Contract for Demo

## 11.1 Required entities
- `PatientProfile`: demographics, timezone, communication preferences, consent flags.
- `Condition`: name, severity, diagnosed_date, managing_provider.
- `Medication`: name, dosage, frequency, pharmacy, fill_date, quantity.
- `Allergy`: substance, reaction, severity.
- `LabOrder` and `Appointment`: type, location, datetime, status.
- `ActionLog`: action type, request payload, consent snapshot, execution status, timestamps.
- `HealthSignal`: metric_type, source, value/summary, observed_at, sync_time, confidence.
- `DocumentRecord`: file_id, file_type, upload_time, source, retention_until, processing_status.
- `ExtractedFinding`: file_id, finding_type, value, unit, ref_range, confidence, provenance.

## 11.2 Source-of-truth precedence
1. Structured clinical store.
2. Last confirmed action outcome.
3. Conversational memory.
4. Model inference (lowest trust; never used as fact without confirmation).

## 12) Hackathon Scoring Metrics (Operational)
- `Time to value`: time from first message to first useful action proposal.
- `Action completion rate`: confirmed actions / requested actions.
- `Safety block precision`: blocked unsafe actions / total blocked actions.
- `Proactive relevance`: accepted proactive prompts / total proactive prompts.
- `Memory correctness`: correct recalls in demo script checkpoints.

## 13) Clarifications Needed (To Lock Scope)
1. Should the first live action be **real booking**, **call-to-book**, or **simulated booking with real search**?
2. For triage, do you want a strict conservative policy (more false positives) or balanced policy (fewer escalations)?
3. Which user segment do we optimize demo narrative for: chronic condition management, caregiver flow, or general wellness?
4. Is "in-network" filtering in-scope for hackathon or postponed?
5. Do we show medication refill as an actual external request or simulated request with confirmation log?
6. Should the product voice be more clinical-professional or warm-family-doctor?
7. What is the default proactive cadence you want to present: daily max 1 vs every 48h?
8. Do you want one unified profile or multiple family profiles in MVP?
9. Should we expose confidence scores to users directly, or keep them internal and only expose uncertainty language?
10. Which channel is your likely demo surface: WebChat, Telegram, or WhatsApp?
11. Do you want to explicitly show a "consent receipt" screen in the demo?
12. Should we include a lightweight "export/delete my data" command in MVP for privacy credibility?

## 14) Security Architecture (PHI-Safe by Default)

## 14.1 Threat model (top risks)
- Prompt/data exfiltration: model is induced to reveal stored PHI.
- Unsafe tool execution: model triggers transactional tools without valid consent.
- Cross-user/session leakage: memory from one profile appears in another context.
- Over-retention: stale or sensitive data kept longer than needed.
- Log leakage: PHI written into plaintext logs/traces.
- Connector leakage: external API payloads include unnecessary PHI.

## 14.2 Security controls (required)
- Data minimization on every boundary:
  - LLM prompt gets only fields needed for this turn.
  - External APIs receive only operational params (location/time), not full profile.
- Two-store isolation:
  - Store A: clinical structured store (PHI, encrypted at rest).
  - Store B: conversational preference memory (non-clinical context).
- Tool capability gates:
  - Read-only tools available by default.
  - Transactional tools require `consent_token` + short TTL.
  - `before_tool_call` enforces policy and blocks on missing/expired consent.
- Output safety checks:
  - Block raw "dump all memory/profile" requests.
  - Redact high-risk identifiers in agent-visible logs (member IDs, phone, exact DOB when not needed).
- Audit and non-repudiation:
  - Append-only action log with user intent, consent snapshot, tool input hash, result status.
  - No "silent success"; unresolved calls remain `pending`/`failed`.
- Operational hardening:
  - Encryption keys from env/OS keychain, never committed.
  - Secrets rotation support (API keys, service tokens).
  - Fail-closed behavior when policy service/hook unavailable.
- Health-data permission hardening:
  - Apple Health access is category-scoped (cycle, meds, workouts, etc.).
  - Per-category revoke supported; revoked categories must stop syncing immediately.
  - Persist only required fields from health signals (no broad raw payload dump).
- File-analysis hardening:
  - Encrypt uploaded files and extracted findings at rest.
  - Restrict file access to owning user/session.
  - Configurable retention with delete-on-request support.
  - Block model instructions embedded in uploaded documents from altering safety policy.

## 14.3 Security policy decisions for hackathon
- Prohibit internet/web-fetch tools in medical-action flows unless explicitly allowlisted.
- Disable broad memory search for sensitive categories unless query is medically relevant.
- Store only test/demo synthetic data during judging.
- Include explicit "Delete my data" and "Export my data" commands in MVP.

## 14.4 Minimal incident response flow
- Detect: policy violation, unusual tool spike, failed auth/consent checks.
- Contain: disable transactional tools globally (`safe mode` switch).
- Eradicate: rotate credentials and clear queued actions.
- Recover: replay from audit log and re-enable tools gradually.

## 15) Clinical Memory Lifecycle (Read/Write/Forget)

## 15.1 Memory classes with different retention
- `LONG_LIVED_FACT`:
  - allergies, chronic conditions, surgeries, stable preferences.
  - retained until user edits/deletes.
- `TIME_BOUND_STATE`:
  - acute symptoms ("I am sick"), short-term meds, temporary restrictions.
  - must include `status`, `onset_at`, `expected_resolution_at`, `last_confirmed_at`.
  - auto-expire or require reconfirmation.
- `EVENT`:
  - appointments, refill requests, outreach events, action outcomes.
  - immutable history with timestamps.
- `INFERENCE`:
  - model-generated assumptions.
  - low trust, short TTL, never treated as fact without confirmation.

## 15.2 Write policy (prevent bad memory writes)
- Every candidate memory write includes:
  - `source` (`user_direct`, `tool_result`, `model_inference`)
  - `confidence`
  - `retention_class`
  - `expires_at` (required for non-long-lived facts)
- `user_direct` + explicit statement can write facts directly.
- `model_inference` writes as `INFERENCE` only, TTL default 24h.
- Clinical updates that affect care decisions require confirmation:
  - Example: "Are you saying this symptom is still active today?"
- Document-derived findings write as `tool_result` with provenance and confidence.
- Imaging interpretations are stored as assistive observations, never definitive diagnoses.

## 15.3 Read policy (prevent stale/unsafe recalls)
- Retrieval ranking must include recency and status:
  - active + recent > unresolved old > expired.
- For `TIME_BOUND_STATE`, if `last_confirmed_at` is stale:
  - do not assert as fact.
  - ask confirmation before using in recommendations/actions.
- Response template split:
  - "Your profile shows" for confirmed facts.
  - "Previously you mentioned" for stale/unconfirmed states.

## 15.4 Forgetting and decay engine
- Daily maintenance job:
  - expire `INFERENCE` entries past TTL.
  - transition stale `TIME_BOUND_STATE` to `unknown`.
  - archive old `EVENT`s to cold storage if outside active window.
- Symptom decay defaults:
  - mild acute symptoms: reconfirm after 72h.
  - moderate symptoms: reconfirm after 24h.
  - if not reconfirmed in 7 days, mark `resolved_unconfirmed`.
- Hard delete path:
  - `forget <item>` deletes from active store and records tombstone in audit.

## 15.5 Example: "I am sick" should not persist forever
- Day 0:
  - store `TIME_BOUND_STATE` symptom with `status=active`, TTL 7 days.
- Day 2:
  - proactive check: "Are you still feeling sick?"
- If user says no:
  - set `status=resolved`, `resolved_at=now`, stop symptom-based nudges.
- If no response by day 7:
  - auto-set `status=resolved_unconfirmed` and demote in retrieval ranking.
- Month later:
  - agent may mention "You had an illness last month" as history only, not current condition.

## 16) Proposed Data Model Additions (for implementation)
- `memory_items`:
  - `id, user_id, type, payload_json, source, confidence, status, created_at, last_confirmed_at, expires_at`
- `consent_tokens`:
  - `token, user_id, action_type, payload_hash, issued_at, expires_at, used_at`
- `action_audit`:
  - `id, user_id, action_type, input_hash, consent_token, status, error_code, started_at, finished_at`
- `policy_events`:
  - blocked actions, redaction events, safe-mode toggles

## 17) Build Plan for Security + Memory (parallelizable)
1. Implement schema and migration for temporal memory fields (`status`, `expires_at`, `last_confirmed_at`).
2. Build `memory_write_guard` that enforces source/confidence/TTL policy.
3. Build `memory_read_guard` that filters expired/stale states and labels uncertainty.
4. Add daily `memory_decay_job` and explicit `forget_item` tool.
5. Add `consent_token` issuance + `before_tool_call` enforcement for transactional tools.
6. Add append-only `action_audit` writer and "no overclaim" response policy.
7. Add safe-mode kill switch and runbook.
8. Add redaction layer for logs and tracing.
9. Add document-retention enforcement and secure-delete workflow.
10. Add file provenance tracking for every extracted finding.

## 18) Apple Health Integration Plan

## 18.1 Product behavior
- User can connect Apple Health from settings.
- User selects metric categories to share:
  - menstrual cycle,
  - medication tracking,
  - workouts/activity.
- CarePilot shows a Health Tracking page with:
  - enabled metrics,
  - last sync timestamp,
  - latest summary cards,
  - permission toggles.

## 18.2 Advice grounding rule
- When advice uses health signals, response must cite source and recency:
  - "Based on your workouts from Apple Health over the last 7 days..."
- If signal is stale (for example, last sync > 72h), ask user to confirm before using it in strong recommendations.

## 18.3 Data mapping (MVP)
- `cycle_tracking` -> phase/trend summary + last period markers.
- `medication_tracking` -> adherence summary and missed-dose pattern.
- `workouts` -> frequency, duration, intensity trend.
- Store as normalized summaries in `HealthSignal` records; avoid storing unnecessary raw blobs.

## 18.4 Sync model
- Initial backfill window: last 30 days.
- Incremental sync cadence: every 6-12 hours or app foreground refresh.
- On sync failure:
  - keep last known values marked `stale`,
  - show status in dashboard,
  - avoid strong claims based on stale signals.

## 18.5 Security/privacy requirements
- Explicit consent screen per metric category.
- One-tap disconnect deletes active sync tokens.
- "Delete imported health data" command removes stored HealthSignal records.
- Audit log captures connect/disconnect/sync and permission changes.

## 19) Voice and Document Analysis Plan

## 19.1 Voice input design
- User can submit speech messages.
- Pipeline:
  - audio upload -> `voice_transcribe` -> transcript confirmation -> triage -> normal agent flow.
- Transcript is canonical for downstream safety checks and memory writes.

## 19.2 Document analysis design
- Ingestion:
  - upload file -> `DocumentRecord` created -> `report_extract` parses structured findings.
- Interpretation:
  - `report_interpret` provides plain-language summary + abnormal markers + recommended follow-up questions.
- Memory:
  - store extracted findings with confidence/provenance.
  - high-uncertainty findings require user or clinician confirmation before becoming durable facts.

## 19.3 Imaging support constraints
- Preferred MVP: imaging reports (radiologist text/PDF) first.
- Optional stretch: direct image interpretation assist (`imaging_interpret_assist`) with strict disclaimer:
  - "assistive, non-diagnostic, confirm with licensed clinician."
- High-risk cues trigger urgent follow-up recommendation.

## 19.4 Safety rules for interpretation
- Never claim diagnosis certainty from uploaded files.
- Distinguish:
  - extracted fact from document,
  - model interpretation,
  - recommended next step.
- If extraction confidence is low, ask user to verify the value before using it in recommendations.
