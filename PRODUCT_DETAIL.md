# CarePilot Product Description

## 1) What CarePilot Is
CarePilot is a personal AI family doctor assistant for routine care coordination. It combines:
- contextual health guidance,
- persistent clinical memory,
- proactive health reminders,
- user-approved real-world actions such as finding labs, booking appointments, and handling refill workflows,
- connected health data from Apple Health (with user permission) to improve advice quality,
- multimodal interaction through voice input and document/image analysis.

CarePilot is designed to support users between doctor visits, not replace licensed clinicians or emergency services.

## 2) Who It Is For
- Adults managing chronic conditions such as diabetes, hypertension, asthma.
- Caregivers coordinating care for family members.
- Busy users who want help with healthcare logistics and adherence.

## 3) Core Product Pillars

### 3.1 Personalized Clinical Memory
CarePilot stores structured health context so users do not need to repeat details every time.

Examples:
- "I take Metformin 500mg twice daily" is stored in medication records.
- "Penicillin allergy causes hives" is stored as a long-lived allergy fact.

### 3.2 Proactive Care
CarePilot can initiate outreach when something needs attention.

Examples:
- "You may run out of Metformin in 5 days. Want me to request a refill?"
- "You planned to schedule bloodwork 3 days ago. Want help doing it now?"

### 3.3 Action-Taking with Consent
CarePilot can perform healthcare admin actions only after explicit user approval.

Examples:
- Search and rank nearby labs by distance, availability, and price.
- Prepare an appointment booking and execute only after user confirms.

### 3.4 Safety and Trust
Safety runs before helpfulness. Emergency signals trigger escalation guidance and block transactional flows.

Examples:
- If user reports chest pain + breathing difficulty, CarePilot responds with emergency instructions and does not book or refill.
- If action result is uncertain, CarePilot reports `pending` or `failed`, never "completed."

### 3.5 Connected Health Signals
CarePilot can use Apple Health data (when permission is granted) to personalize recommendations.

Examples:
- Menstrual cycle trends can add context for symptom timing.
- Workout and activity patterns can help explain fatigue or recovery trends.
- Medication adherence records can improve refill and adherence reminders.

### 3.6 Multimodal Understanding
CarePilot supports voice input and medical document/image interpretation assistance.

Examples:
- User speaks symptoms by voice instead of typing.
- User uploads a lab report PDF and asks for a plain-language summary.
- User uploads an imaging report and asks for key findings and follow-up questions for a clinician.

## 4) Feature Set (MVP)

### 4.1 Guided Health Intake
First-run onboarding captures minimum clinical context:
- conditions,
- medications (dose/frequency/fill date),
- allergies,
- care preferences (pharmacy, appointment time windows, reminder settings).

Example:
- User: "I have hypertension and type 2 diabetes."
- CarePilot: "Noted. What medications and dosages are you currently taking?"

### 4.2 Contextual Health Conversation
CarePilot provides educational guidance grounded in profile data and current symptoms.

Example:
- User: "I've had headaches for 3 days."
- CarePilot: "Given your hypertension history, check BP today and consider follow-up if persistent."

### 4.3 Triage Layer
Every inbound message is triaged:
- `EMERGENT`: emergency redirect only.
- `URGENT_24H`: prompt near-term clinical follow-up.
- `ROUTINE`: standard guidance and optional actions.

### 4.4 Lab and Clinic Discovery
Returns ranked options with transparent criteria and constraints.

Example output:
- 1) Quest Diagnostics (2.1 mi, next slot Tue 9:00 AM, est. $70-95)
- 2) Labcorp Midtown (3.0 mi, next slot Tue 10:30 AM, est. $60-110)
- 3) City Health Lab (1.8 mi, next slot Wed 8:45 AM, est. $85-120)

### 4.5 Appointment Booking Workflow
Action lifecycle:
`planned -> awaiting_confirmation -> executing -> succeeded|failed|partial|blocked|expired`

Example:
- CarePilot: "I can book Tuesday 9:00 AM with Dr. Smith at 123 Medical Dr. Should I proceed?"
- User: "Yes, proceed."
- CarePilot executes and records an auditable outcome.

### 4.6 Medication Refill Workflow
Run-out estimates use fill date, quantity, and dosage frequency.

Example:
- CarePilot: "Based on your last fill, you may have 4 days left. About how many pills remain?"
- After confirmation, refill request is executed or logged as simulated (depending on integration mode).

### 4.7 Proactive Reminders and Controls
Default behavior:
- max 1 non-urgent proactive message/day,
- quiet hours (10:00 PM to 8:00 AM local time),
- user controls: `pause`, `resume`, `snooze X days`, `only medication reminders`.

### 4.8 Audit, Consent, and Privacy Commands
- Every transactional action records consent snapshot + execution status.
- User-visible history for trust and verification.
- Privacy controls: export/delete data commands.

### 4.9 Apple Health Integration (Permission-Based)
CarePilot can ingest selected Apple Health data streams and use them as context for guidance:
- menstrual cycle,
- medication tracking,
- workouts and activity,
- optional additional signals (for example sleep and resting heart rate) if enabled later.

Rules:
- No Apple Health access without granular user opt-in.
- Each signal type has its own toggle and can be revoked at any time.
- Advice must state when it uses wearable/Health data versus user-reported data.

Example:
- "I am using your recent workout trend and cycle phase from Apple Health to suggest lower-intensity sessions this week."

### 4.10 Health Tracking Dashboard
A dedicated page shows what CarePilot is tracking and the latest synced values.

Dashboard sections:
- connected sources (Apple Health connection status),
- active tracked metrics (cycle, meds, workouts, symptom states),
- last sync time per metric,
- permission toggles and data controls.

Example cards:
- "Menstrual Cycle: tracking enabled, last update today 8:10 AM"
- "Medication Adherence: 6 of 7 doses logged this week"
- "Workouts: 4 sessions this week, total 190 minutes"

### 4.11 Voice Input (Speech-to-Text)
Users can talk to CarePilot in addition to typing.

Behavior:
- Voice is transcribed to text before triage and policy checks.
- Transcripts are user-visible and editable before final send when possible.
- Emergency detection runs on the transcript exactly like typed input.

Example:
- User taps mic: "I have had dizziness since yesterday and missed two doses."
- CarePilot transcribes, confirms text, and responds using standard triage/memory logic.

### 4.12 Medical Document and Imaging Analysis
Users can upload medical files for interpretation assistance.

Supported file types (MVP target):
- lab reports (PDF, image),
- imaging reports (PDF/text export),
- optional direct image uploads (for example X-ray images) with strict uncertainty framing.

Capabilities:
- extract key values/findings,
- summarize in plain language,
- flag abnormal markers and trend changes,
- propose follow-up questions for a licensed clinician.

Example:
- User uploads CBC panel.
- CarePilot returns:
  - "Hemoglobin is below reference range."
  - "Compared with your prior result, this moved down by X."
  - "Suggested questions for your doctor..."

Safety rule:
- CarePilot does not provide definitive diagnosis from uploaded imaging.
- For high-risk findings, it recommends urgent professional review.

## 5) Memory System Design

### 5.1 Two Memory Stores
1. Clinical store (structured, safety-critical, PHI-sensitive).
2. Conversational preference store (tone, habits, communication preferences).

Clinical recommendations always prioritize the structured clinical store as source of truth.
Connected health signals are stored with source attribution (`apple_health`, `user_reported`, `tool_result`) and recency metadata.
Document-derived findings are stored with provenance (`file_id`, `section`, `extraction_confidence`) and never promoted to confirmed diagnosis facts.

### 5.2 Temporal Memory Lifecycle (Critical)
CarePilot prevents stale clinical assumptions by classifying memory:
- `LONG_LIVED_FACT`: allergies, chronic conditions.
- `TIME_BOUND_STATE`: acute symptoms ("I am sick"), temporary states.
- `EVENT`: appointments, refills, completed actions.
- `INFERENCE`: low-trust model assumptions with short TTL.

### 5.3 Forgetting and Reconfirmation
Time-bound symptom states are not treated as permanent facts.

Example:
- Day 0: "I am sick" stored as `TIME_BOUND_STATE(active)`.
- Day 2: reconfirmation prompt.
- Day 7 without reconfirmation: auto-transition to `resolved_unconfirmed`.
- One month later: referenced only as past event, not current condition.

Apple Health-derived trend summaries are also time-scoped and decay over time (for example, "low activity this week" should not persist as a long-lived state).

## 6) Security Model

### 6.1 Data Protection Principles
- Data minimization at each boundary.
- Encrypted PHI storage.
- Allowlisted tool usage in medical action flows.
- Redaction of sensitive identifiers in logs and traces.
- Apple Health data access is permission-scoped by metric type.
- Uploaded medical files are access-controlled, encrypted, and retained per explicit policy.

### 6.2 Consent and Action Safety
- Transactional tools require short-lived consent tokens.
- `before_tool_call` policy hook blocks missing/expired consent.
- No irreversible action without explicit user approval.

### 6.3 Abuse/Leakage Prevention
- Block broad "dump all memory/profile" responses by default.
- Enforce strict session/user scoping to prevent cross-user memory leakage.
- Fail closed if safety/policy checks are unavailable.
- Never request or retain Apple Health categories that are not explicitly enabled.
- Restrict document analysis outputs to extracted findings and user-owned files only.

### 6.4 Incident Safety Mode
If policy anomalies are detected, CarePilot can enter safe mode:
- disable transactional tools,
- retain read-only guidance,
- preserve audit trail for recovery.

## 7) Example End-to-End User Journeys

### 7.1 Fatigue to Lab Booking
1. User reports recurring fatigue.
2. CarePilot triages as non-emergency.
3. CarePilot references profile and suggests CBC + thyroid panel.
4. User approves "find labs under $X within Y miles."
5. CarePilot ranks options and asks for booking confirmation.
6. Booking is executed and logged.
7. Reminder and follow-up nudge are scheduled.

### 7.2 Refill Reminder Journey
1. Refill predictor detects potential run-out in 5 days.
2. CarePilot sends proactive reminder inside allowed hours.
3. User confirms refill request.
4. Action status is tracked (`executing -> succeeded/failed/pending`).
5. CarePilot follows up on readiness status.

### 7.3 Emergency Interruption Journey
1. User reports emergent symptoms.
2. CarePilot immediately outputs emergency guidance.
3. Transactional tools are blocked for that turn.
4. Event is logged for safety/audit.

## 8) Current Scope Boundaries

### In Scope (Hackathon)
- Memory-grounded health assistant.
- Triage + safety gating.
- Lab/clinic search and at least one booking/refill action flow.
- Proactive reminders with pause/snooze/quiet-hours controls.
- Action audit and consent records.
- Health tracking dashboard for visible tracked metrics and permissions.
- Voice input for chat interactions.
- At least one medical document analysis flow (lab report summary).

### Out of Scope (Hackathon)
- Autonomous emergency intervention.
- Diagnostic or prescribing claims.
- Full EHR write-back, payer adjudication, and broad production integrations.