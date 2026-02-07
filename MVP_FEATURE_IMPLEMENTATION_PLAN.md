# CarePilot MVP Feature Implementation Plan

Date: 2026-02-07
Owner: Next implementation agent
Status: Ready to execute

## 1. Confirmed Product Decisions (from user)

1. Human escalation destination: **in-app only**.
2. Privacy export/delete commands: **out of MVP scope**.
3. Voice input: use **OpenAI Whisper** for MVP STT.
4. Document analysis scope: choose best per `PRODUCT_DETAIL.md` -> **LLM-assisted plain-language interpretation with strict uncertainty framing**.
5. Custom URGENT_24H trigger taxonomy details: **use pragmatic defaults for MVP**.
6. Advanced proactive precedence policy matrix: **out of MVP scope**.
7. Snooze durations: choose best-case defaults -> **1, 3, 7 days**.
8. Quiet-hours enforcement details: **out of MVP scope for now**.
9. Export/delete data scope details: **out of MVP scope**.
10. Escalation SLA/closure matrix details: **out of MVP scope**.

## 2. In-Scope MVP Deliverables

## A) URGENT_24H triage tier (backend)
- Add explicit triage classes: `EMERGENT`, `URGENT_24H`, `ROUTINE`.
- Keep current emergency hard-block behavior for transactional actions.
- Add `URGENT_24H` response policy:
  - near-term follow-up guidance language,
  - no forced transactional block by default,
  - explicit urgency framing in assistant message.
- Add tests for all three tiers and regression on existing emergency behavior.

## B) Server-side proactive controls
- Add backend preference/command handling for:
  - `pause proactive`,
  - `resume proactive`,
  - `snooze` (`1|3|7` days).
- Enforce controls server-side in proactive reminder generation endpoints/jobs.
- Persist state in conversational preferences with user/session scoping.
- Add tests for:
  - pause suppresses proactive outputs,
  - snooze suppresses until expiry,
  - resume re-enables.

## C) Human escalation internal workflow (in-app)
- Implement tool/workflow: `human_escalation_create`.
- Add storage for escalation tickets:
  - `id`, `user_id`, `session_key`, `reason`, `summary`, `status`, timestamps.
- Add simple status lifecycle for MVP: `open -> in_progress -> resolved`.
- Expose read APIs for user-visible status and history.
- Integrate escalation display into existing UI status/log surfaces.
- Add audit records for escalation creation/status changes.

## D) Replace seeded dashboard cards with real data
- Remove static signal seed usage in `frontend/src/app/app/page.tsx`.
- Back cards with backend-derived values where available:
  - active symptom count,
  - medication adherence/reminder indicators from existing meds/reminders,
  - latest sync/update timestamps from profile/action/symptom logs.
- If source missing, show explicit `"Not connected"` or `"No data yet"` states (no fake values).

## E) Voice input via OpenAI Whisper
- Implement backend endpoint for STT (e.g. multipart upload) using OpenAI Whisper API.
- In chat UI Voice mode:
  - capture/upload audio,
  - return transcript,
  - show transcript in input for user edit before send,
  - run existing triage/memory flow on edited transcript.
- Add error/fallback UX for missing API key or failed transcription.
- Add tests for request validation and failure handling.

## F) Document and imaging interpretation (MVP-safe)
- Implement upload + processing path for PDF/image reports.
- Extract accessible text (OCR/text extraction) and run LLM-assisted summary.
- Enforce safety framing:
  - no definitive diagnosis claims,
  - uncertainty and escalation guidance for high-risk findings.
- Persist provenance metadata (`file_id`, extraction confidence, source).
- Return:
  - key findings,
  - plain-language summary,
  - suggested clinician follow-up questions.

## 3. Explicitly Out of Scope for This MVP Pass

- Privacy commands: `export_my_data`, `delete_my_data`.
- Apple Health native integration and per-signal toggle ingestion.
- Full proactive policy matrix (quiet hours precedence and overlap edge policy).
- External escalation channels (email/SMS/call center).

## 4. Edge Cases to Cover Before Merge

- Triage misrouting:
  - urgent text should not drop to routine,
  - emergency text must still block transactional actions.
- Session isolation:
  - proactive state and escalation tickets must not leak across sessions/users.
- Snooze boundary:
  - expiry behavior at exact boundary timestamps.
- Voice:
  - empty audio, unsupported format, oversized file, Whisper timeout.
- Document:
  - unreadable file, mixed-content PDF, non-medical uploads, oversized upload.
- UI continuity:
  - SSE contract remains exactly `token|message|action_plan|error`.

## 5. Test/Validation Gate

- Backend unit/integration tests for all new workflows.
- Frontend build + typecheck must pass.
- End-to-end smoke:
  - urgent conversation flow,
  - proactive pause/snooze/resume,
  - create escalation + view status,
  - voice transcript -> edited send,
  - document upload -> safe summary.
- No regression on existing 31 passing backend tests.

## 6. Recommended Execution Order

1. Triage tier (`URGENT_24H`) and tests.
2. Proactive controls persistence/enforcement and tests.
3. Human escalation model, APIs, UI status, audits.
4. Dashboard data source replacement.
5. Voice Whisper pipeline.
6. Document interpretation pipeline.
7. Full regression run and manual QA.

## 7. Definition of Done for This Plan

- All in-scope sections A-F implemented and tested.
- Existing core cutover behavior remains stable.
- No seeded fake dashboard data where real data is expected.
- User-facing flows are coherent and session-scoped.
- Remaining out-of-scope items are documented, not silently skipped.

