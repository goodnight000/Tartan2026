# MedClaw / CarePilot Launch Compliance Checklist

Date: 2026-02-08  
Scope: Codebase-driven assessment (backend, frontend, carebase_server).  
Note: This is a product/compliance engineering checklist, not legal advice.

## Basis Reviewed

- Backend API and policy gating: `backend/main.py`
- Transactional tools and browser automation: `backend/carepilot_tools/core_tools.py`, `backend/carepilot_tools/web_automation.py`
- Data model/storage: `backend/memory/database.py`
- Frontend API routes and prompting: `frontend/src/app/api/chat/stream/route.ts`, `frontend/src/app/api/chat/complete/route.ts`, `frontend/src/app/api/documents/analyze/route.ts`, `frontend/src/app/api/voice/transcribe/route.ts`
- CareBase encryption implementation: `carebase_server/lib/carebase/encryption.ts`
- Contractual text present: `EULA.txt`

## Executive Priority (Before Public App-Store Launch)

## P0 (Blockers)

- Enforce authenticated identity in production for all PHI endpoints.
  - Evidence: `ALLOW_ANON=true` default in `backend/.env.example:8`; anonymous fallback in `backend/main.py:264`.
  - Requirement: Set `ALLOW_ANON=false` in production, enforce verified auth at edge, block direct backend access without trusted auth.

- Prevent user impersonation via `X-User-Id` unless set by trusted gateway only.
  - Evidence: `resolve_user_id` accepts `X-User-Id` when present (`backend/main.py:282`), only regex-validated (`backend/main.py:255`), not cryptographically bound to bearer token.
  - Requirement: Only trust `X-User-Id` from private network/reverse proxy or remove this override path for public ingress.

- Encrypt backend PHI at rest (not only CareBase layer).
  - Evidence: patient/clinical/document payloads in plain SQLite JSON/text fields (`backend/memory/database.py:43`, `backend/memory/database.py:113`, `backend/memory/database.py:185`).
  - Requirement: DB-at-rest encryption + key management + backup encryption + documented access controls.

- Add production privacy policy + health data disclosure UX.
  - Evidence: EULA exists (`EULA.txt`), but no dedicated privacy policy artifact in repo root.
  - Requirement: Public privacy notice covering collection, sharing, retention, deletion, and model provider processing.

## P1 (High Priority)

- Add explicit user rights workflows (delete/export/correct data) and operational tooling.
  - Evidence: No explicit account-level delete/export API routes found in `backend/main.py`.
  - Requirement: Implement and test DSR flows (access/export/deletion), including auditability.

- Align all system prompts and user-facing copy to patient/caregiver audience.
  - Evidence: frontend chat routes still use “You are a clinical assistant.” (`frontend/src/app/api/chat/stream/route.ts:40`, `frontend/src/app/api/chat/complete/route.ts:31`).
  - Requirement: Ensure no outputs assume clinician user role unless explicitly selected.

- Add formal data-retention jobs and policy docs.
  - Evidence: schema has retention fields (`backend/memory/database.py:106`) but no observed scheduled purge/anonymization process.
  - Requirement: define TTL by data class, implement purge/anonymization jobs, and test.

- Complete incident response and breach-notification runbook.
  - Requirement: include legal notification triggers, timelines, and provider-contact pathways.

## P2 (Important)

- Strengthen model safety governance and claim controls.
  - Requirement: release gating for medical-content regressions; forbid diagnosis/treatment certainty; monitor dangerous advice.

- Add minors/dependent data policy and parental consent handling.
  - Evidence: prompts include dependent profile fields (`frontend/src/app/api/chat/stream/route.ts:58`), but policy implementation is not explicit.
  - Requirement: COPPA/youth privacy decision tree and age-gating where applicable.

- Vendor governance package.
  - Requirement: DPAs/BAAs where applicable, subprocessor inventory, transfer mechanisms, and security questionnaires.

## Feature-by-Feature Compliance Mapping

1. Chat + triage guidance
   - Code: `backend/main.py:700`, `backend/main.py:3137`
   - Risk: Medical advice framing/FDA boundary and consumer-protection claims.
   - Controls present: emergency language and non-diagnosis framing.
   - Needed: claims review for marketing text and explicit “informational support only” framing in UX.

2. Document interpretation (labs/imaging)
   - Code: `backend/main.py:2985` (`/documents/analyze`)
   - Risk: Could be interpreted as clinical decision support if marketed as diagnostic.
   - Controls present: uncertainty + non-diagnosis framing.
   - Needed: regulatory review + content safety evals + explainability wording.

3. Voice transcription + triage signals
   - Code: `backend/main.py:2886` (`/voice/transcribe`)
   - Risk: Sensitive biometric/health data handling and urgency classification risk.
   - Controls present: requires transcript confirmation before send; urgency flags.
   - Needed: clear consent capture for voice uploads and retention/deletion controls.

4. Transactional actions (booking/purchase/refill)
   - Code: `backend/main.py:130`, `backend/main.py:173`, `backend/main.py:2781`, `backend/carepilot_tools/core_tools.py:107`
   - Risk: Unauthorized actions and user harm if actions execute without clear consent.
   - Controls present: consent tokens, payload hash validation, emergency blocks.
   - Needed: stronger identity guarantees + user-visible action history + dispute/reversal workflows.

5. Live browser automation
   - Code: `backend/carepilot_tools/web_automation.py:14`
   - Risk: Terms-of-service conflicts on third-party sites, credential/form misuse risks.
   - Controls present: URL normalization and limited automation safeguards.
   - Needed: approved-domain allowlist, legal review of automation use, explicit user authorization language.

6. Memory and PHI persistence
   - Code: `backend/memory/database.py`, `frontend/src/app/api/chat/stream/route.ts`
   - Risk: Over-collection, retention drift, and cross-tenant access if auth weak.
   - Controls present: some scoped session/user checks.
   - Needed: production auth hardening, data minimization defaults, retention jobs, encryption posture uplift.

## Prompt & Product Language Audit (Current State)

- Good: Backend document and chat prompting now explicitly patient-facing and non-diagnostic in `backend/main.py`.
- Gap: Frontend chat API routes still use “clinical assistant” framing:
  - `frontend/src/app/api/chat/stream/route.ts:40`
  - `frontend/src/app/api/chat/complete/route.ts:31`
- Action: standardize prompts and public UI language to avoid clinician-assumption and diagnostic framing.

## Regulatory / Policy Workstreams to Assign

1. Privacy counsel workstream
   - Finalize privacy policy, data map, retention matrix, deletion/export rights process.
2. Medical regulatory workstream
   - Determine FDA software-function posture and claims boundaries before launch copy is finalized.
3. Security engineering workstream
   - Auth hardening, at-rest encryption rollout, key management, logging/monitoring, incident playbooks.
4. App-store policy workstream
   - Apple/Google health-data declarations, permission rationale text, and in-app disclosures.

## Suggested Go/No-Go Launch Gate

- No-go until all P0 items are complete and verified in staging with evidence.
- No-go until legal review signs off on:
  - consumer-facing health claims,
  - privacy policy + data rights operations,
  - vendor/subprocessor terms for AI providers.

## External Reference Set (for legal/compliance review)

- FDA CDS software overview: https://www.fda.gov/medical-devices/software-medical-device-samd/clinical-decision-support-software
- FDA mobile medical apps policy guidance: https://www.fda.gov/regulatory-information/search-fda-guidance-documents/policy-device-software-functions-and-mobile-medical-applications
- FTC health breach rule guidance: https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0
- FTC health app developers page: https://www.ftc.gov/business-guidance/resources/health-app-developers-ftcs-health-breach-notification-rule
- FTC health claims compliance: https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance
- HHS HIPAA covered entities/business associates: https://www.hhs.gov/hipaa/for-professionals/covered-entities/index.html
- HHS HIPAA cloud computing guidance: https://www.hhs.gov/hipaa/for-professionals/special-topics/cloud-computing/index.html
- Washington My Health My Data Act (RCW 19.373): https://app.leg.wa.gov/RCW/default.aspx?cite=19.373&full=true
- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Google Play User Data policy: https://support.google.com/googleplay/android-developer/answer/10144311
- FTC COPPA overview: https://www.ftc.gov/business-guidance/privacy-security/childrens-privacy
