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

