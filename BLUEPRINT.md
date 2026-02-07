# MedClaw - Personal AI Family Doctor

## Table of Contents

1. [Naming](#1-naming)
2. [Vision and Problem Statement](#2-vision-and-problem-statement)
3. [MVP Features vs Future Roadmap](#3-mvp-features-vs-future-roadmap)
4. [Agentic Health Actions](#4-agentic-health-actions)
5. [Memory System Design](#5-memory-system-design)
6. [Proactive Health Features](#6-proactive-health-features)
7. [User Flows](#7-user-flows)
8. [Safety and Liability Considerations](#8-safety-and-liability-considerations)
9. [Architecture Overview](#9-architecture-overview)
10. [Hackathon Demo Strategy](#10-hackathon-demo-strategy)
11. [Design Direction](#11-design-direction)
12. [Development Plan](#12-development-plan)
13. [Open Questions](#13-open-questions)

---

## Project Name: MedClaw

MedClaw is a personal AI family doctor that:

- **Knows you.** It maintains a persistent, structured memory of your medical history -- medications, conditions, allergies, past procedures, family history, lab results, and preferences. Every conversation builds on the last.

- **Watches out for you.** It proactively reaches out when your medication might be running low, when seasonal health risks apply to your conditions, when it has been too long since a recommended checkup, or when your reported symptoms suggest a trend worth addressing.

- **Acts for you.** With your explicit approval, it can search for nearby labs, compare appointment availability, book appointments through web or phone, find pharmacies with your medication in stock, and handle routine healthcare logistics.

## 3. MVP Features vs Future Roadmap

### MVP (Hackathon Build)

These are the features to build and demo. Scoped for 24-48 hours of development time.

#### 3.1 Conversational Health Assistant with Memory

| Feature | Description | Priority |
|---------|-------------|----------|
| Health Q&A with context | Answer health questions informed by the user's stored medical profile | Must have |
| Medical profile intake | Structured onboarding flow to capture conditions, medications, allergies, family history | Must have |
| Persistent memory across sessions | Information shared in conversation 1 is available in conversation 10 | Must have |
| Medication tracker | Store current medications with dosage, frequency, and start dates | Must have |
| Symptom logging | Accept and store user-reported symptoms with timestamps | Should have |

#### 3.2 Proactive Health Features

| Feature | Description | Priority |
|---------|-------------|----------|
| Medication refill reminder | Estimate when a prescription is running low based on fill date and dosage frequency, then remind the user | Must have |
| Appointment follow-up nudge | If the AI recommends seeing a doctor, follow up in X days to ask if they went | Should have |
| Seasonal health alert | Flag relevant seasonal risks (flu season, allergy season) based on user's conditions | Nice to have |

#### 3.3 Agentic Actions

| Feature | Description | Priority |
|---------|-------------|----------|
| Lab/appointment search | Search for nearby labs or clinics using location APIs | Must have |
| Appointment booking (simulated or real) | Walk through booking an appointment -- at minimum, demonstrate the flow with a confirmation step | Must have |
| Pharmacy finder | Find nearby pharmacies with hours, distance, and basic info | Should have |

#### 3.4 Safety Layer

| Feature | Description | Priority |
|---------|-------------|----------|
| Emergency detection and redirect | If the user describes emergency symptoms, immediately direct them to call 911 or go to ER | Must have |
| Medical disclaimer | Clear disclaimers that this is not a replacement for professional medical advice | Must have |
| Explicit consent for actions | Never take an action without the user explicitly approving it | Must have |

### Phase 2 Features (Post-Hackathon)

- Integration with Apple Health / Google Fit for vitals data
- Photo-based symptom assessment (rashes, wounds, etc.)
- Insurance network awareness (filter providers by in-network status)
- Family profiles (manage health data for multiple family members under one account)
- PDF/document upload for medical records, lab results, discharge summaries
- Drug interaction checker with real pharmacological databases
- Telehealth integration (connect directly to a video call with a real doctor when needed)
- Voice-first interaction mode for accessibility

### Phase 3 Features (Long-Term Vision)

- FHIR integration with real EHR systems (Epic MyChart, Cerner, etc.)
- Wearable device integration (continuous glucose monitors, blood pressure cuffs, pulse oximeters)
- Clinical trial matching
- Mental health tracking and mood journaling with pattern detection
- Multi-language support for non-English speakers
- Integration with prescription discount services (GoodRx, etc.)
- Predictive health modeling based on longitudinal personal data

---

## 4. Agentic Health Actions

This is MedClaw's most novel and demo-worthy capability. The AI does not just talk -- it acts.

### 4.1 Action Categories

#### Tier 1: Search and Inform (Low risk, high demo value)

These actions gather information and present it to the user. No external state changes.

| Action | How It Works | APIs/Approach |
|--------|-------------|---------------|
| **Find nearby labs** | User asks about getting a blood test. AI searches for labs within a configurable radius, returns name, address, hours, distance, and estimated cost range. | Google Places API or Yelp API for location search; optionally scrape pricing from lab websites |
| **Find nearby pharmacies** | AI searches pharmacies near the user, filtered by hours and distance. | Google Places API |
| **Find specialists** | AI recommends a specialist type based on symptoms, then searches for nearby providers. | Google Places API + specialty keyword search |
| **Compare appointment availability** | Search multiple providers and present a comparison table of available times. | For hackathon: simulated data or Zocdoc-style scraping |
| **Medication price lookup** | Check approximate pricing for a medication across pharmacies. | GoodRx API or similar |

#### Tier 2: Transactional Actions (Medium risk, requires explicit consent)

These actions change state in the real world. Every one requires a confirmation step.

| Action | How It Works | Consent Flow |
|--------|-------------|-------------|
| **Book an appointment** | AI selects a provider based on user preferences and availability, then initiates booking via web automation or API call. | AI presents the specific appointment details (provider, time, location, cost) and asks "Should I book this?" User must explicitly confirm. |
| **Request medication refill** | AI contacts the pharmacy or uses an online portal to request a refill of a known prescription. | AI confirms medication name, dosage, pharmacy, and asks for explicit approval before submitting. |
| **Send a message to provider** | AI drafts a message to the user's doctor via a patient portal. | AI shows the draft message and asks user to approve or edit before sending. |

#### Tier 3: Complex Orchestration (High value, post-hackathon)

| Action | Description |
|--------|-------------|
| **Insurance pre-authorization** | Initiate prior auth process for procedures |
| **Multi-step care coordination** | Book a lab, get results, schedule follow-up based on results |
| **Prescription transfer** | Transfer a prescription from one pharmacy to another |

### 4.2 Action Execution Architecture

Every action follows this pattern:

```
User Request or AI Suggestion
        |
        v
   AI Plans Action
   (identifies what to do, gathers parameters)
        |
        v
   Present Plan to User
   (show exactly what will happen)
        |
        v
   User Confirms / Modifies / Rejects
        |
        v
   Execute Action (if confirmed)
        |
        v
   Report Outcome
   (success, failure, partial -- never overclaim)
        |
        v
   Store in Memory
   (log what was done for future reference)
```

### 4.3 Hackathon Action Strategy

For the hackathon demo, focus on making ONE action flow work end-to-end and feel magical:

**Recommended flagship action: "Find and book a blood test"**

Demo script:
1. User tells MedClaw they have been feeling tired lately
2. MedClaw recalls from memory that the user has a history of low iron and has not had bloodwork in 8 months
3. MedClaw suggests a CBC and iron panel blood test
4. User agrees
5. MedClaw searches for nearby Quest Diagnostics / Labcorp locations
6. MedClaw presents top 3 options with address, hours, estimated wait, and cost
7. User picks one
8. MedClaw confirms the booking details and books it (or simulates booking)
9. MedClaw adds the appointment to its memory and sets a reminder for the day before

This single flow demonstrates ALL three differentiators: memory, proactivity, and agentic action.

---

## 5. Memory System Design

### 5.1 Architecture: Two-Layer Memory

MedClaw uses a two-layer memory system, leveraging OpenClaw's built-in memory infrastructure for the conversational layer and adding a structured clinical data layer on top.

```
+--------------------------------------------------+
|           Layer 1: Clinical Profile               |
|          (Structured Health Data Store)            |
|                                                    |
|  Conditions | Medications | Allergies | Labs      |
|  Family Hx  | Procedures  | Vitals    | Vaccines  |
|                                                    |
|  Source of truth for clinical decisions.           |
|  Stored as structured JSON/markdown.               |
|  Queried by tools, not by free-text recall.       |
+--------------------------------------------------+
|           Layer 2: Conversational Memory           |
|          (OpenClaw Memory System)                  |
|                                                    |
|  Preferences | Communication style | Reminders    |
|  Past conversations | Context | Relationships     |
|                                                    |
|  Indexed with hybrid search (FTS + vector).        |
|  Used for personalization and context continuity.  |
+--------------------------------------------------+
```

### 5.2 What the Clinical Profile Stores

| Category | Data Fields | Example |
|----------|------------|---------|
| **Demographics** | Age, sex, height, weight, blood type | 34, Male, 5'11", 175 lbs, O+ |
| **Active Conditions** | Condition name, date diagnosed, severity, managing provider | Type 2 Diabetes, diagnosed 2022, managed by Dr. Smith |
| **Medications** | Name, dosage, frequency, prescribing doctor, start date, refill date, pharmacy | Metformin 500mg, twice daily, Dr. Smith, started Jan 2023, CVS #4521 |
| **Allergies** | Allergen, reaction type, severity | Penicillin - hives - moderate; Shellfish - anaphylaxis - severe |
| **Family History** | Relation, condition, age of onset | Father - heart disease - age 55; Mother - breast cancer - age 62 |
| **Past Procedures** | Procedure, date, provider, outcome | Appendectomy, March 2019, General Hospital, uncomplicated |
| **Immunizations** | Vaccine, date, next due | Flu shot, Oct 2025; COVID booster, Sep 2025; Tdap due 2027 |
| **Lab Results** | Test name, date, value, reference range, flag | HbA1c, Jan 2026, 6.8%, ref 4.0-5.6%, HIGH |
| **Vitals History** | BP, heart rate, weight over time | BP trending: 135/88 -> 128/82 -> 125/80 over 6 months |
| **Insurance** | Provider, plan name, member ID, group number | Aetna PPO, Member ID: XYZ123456 |
| **Preferences** | Preferred pharmacy, preferred lab, preferred appointment times, communication preferences | CVS on Main St, morning appointments, prefers text reminders |

### 5.3 What Conversational Memory Stores

Using OpenClaw's existing markdown-based memory system:

- Communication preferences ("prefers short answers", "wants explanations in simple terms")
- Emotional context ("was anxious about upcoming surgery last week", "expressed frustration with insurance process")
- Lifestyle context ("works night shifts", "vegetarian", "trains for marathons", "has two young children")
- Past interaction summaries ("on Jan 15, discussed chest pain -- determined likely muscular, recommended stretching")
- Action history ("booked lab appointment at Quest on 5th Ave for Feb 10", "pharmacy refill requested for Metformin on Jan 28")

### 5.4 Memory Intake Flow

How does the profile get populated?

**Option A: Guided Onboarding (Recommended for hackathon)**
First conversation is a structured intake:
```
MedClaw: "Welcome! I'm MedClaw, your personal AI family doctor. To give you
the best care, I'd like to learn about your health. This will take about
5 minutes. Ready to get started?"

MedClaw: "Let's start with the basics. Do you have any ongoing health
conditions? Things like diabetes, high blood pressure, asthma, or anything
else you manage regularly?"

User: "I have type 2 diabetes and high blood pressure"

MedClaw: "Got it. I've noted Type 2 Diabetes and Hypertension. When were
these diagnosed, roughly?"

[...continues through medications, allergies, family history...]
```

**Option B: Organic Extraction**
As the user chats naturally, MedClaw extracts and stores health data:
```
User: "I've been having headaches and my Lisinopril isn't helping my BP"

MedClaw internally: [Extract: medication=Lisinopril, condition=hypertension,
symptom=headaches. Update clinical profile.]
```

**Recommended approach:** Use Option A for the hackathon demo (it is more controllable and impressive), but design the system to also support Option B for organic updates over time.

### 5.5 Memory Retrieval Strategy

When the user sends a message, MedClaw:

1. Always loads the full clinical profile (it is structured and small)
2. Runs a hybrid search against conversational memory for relevant context
3. Combines both into the system prompt for the current turn

This ensures every response is personalized without requiring the user to repeat themselves.

### 5.6 Implementation with OpenClaw

OpenClaw's memory system uses markdown files indexed into SQLite with hybrid FTS + vector search. For MedClaw:

- **Clinical profile:** Stored in a structured markdown file (e.g., `memory/clinical-profile.md`) with clear sections for each category. The `clinical_profile_get` tool reads this file directly.
- **Conversational memory:** Uses the standard `MEMORY.md` and `memory/**/*.md` paths. OpenClaw's memory indexing pipeline (chunk, embed, store) handles this automatically.
- **Memory updates:** A custom `clinical_profile_update` tool writes structured updates to the clinical profile file. OpenClaw's filesystem watchers detect changes and re-index.

---

## 6. Proactive Health Features

### 6.1 Proactive Feature Prioritization

Ranked by impact and feasibility for a hackathon:

#### Tier 1: Build These for the Hackathon

**Medication Refill Predictor**
- How: When a medication is added with a fill date and quantity, calculate the expected run-out date. Set a cron job to check daily.
- Trigger: 5 days before estimated run-out.
- Message: "Hey -- based on when you filled your Metformin prescription, you might be running low in about 5 days. Want me to request a refill from CVS on Main St?"
- Why it demos well: It shows the AI thinking ahead without being asked. This is the single most impressive proactive feature to show judges.

**Post-Conversation Follow-Up**
- How: When MedClaw recommends an action (see a doctor, get a test, start a new exercise), set a follow-up reminder.
- Trigger: Configurable delay (default: 3 days).
- Message: "A few days ago we talked about getting your cholesterol checked. Have you had a chance to schedule that? I can help find a lab near you."
- Why it demos well: Shows persistent care beyond a single conversation.

#### Tier 2: Nice to Have for Hackathon, Easy Wins

**Seasonal Health Alerts**
- How: Cross-reference user's conditions with seasonal health data. Cron job checks weekly.
- Trigger: Date-based (flu season, allergy season, etc.).
- Message: "Flu season is ramping up and with your diabetes, you are at higher risk for complications. Have you gotten your flu shot this year? Your records show your last one was October 2024."
- Why: Shows the AI is aware of the calendar and the user's risk factors simultaneously.

**Appointment Reminder**
- How: When MedClaw books or logs an appointment, set a reminder.
- Trigger: 24 hours before appointment.
- Message: "Reminder: you have a blood test at Quest Diagnostics on 5th Ave tomorrow at 9:30 AM. Remember to fast for 12 hours before the test."
- Why: Practical utility that everyone understands.

#### Tier 3: Post-Hackathon Proactive Features

| Feature | Description |
|---------|-------------|
| **Vitals trend detection** | "Your blood pressure readings have been trending up over the last month. It might be worth discussing with Dr. Smith." |
| **Drug interaction warning** | "I noticed you mentioned taking St. John's Wort. This can interact with your Metformin. Please check with your doctor." |
| **Preventive care reminders** | "You are due for a dental cleaning -- it has been 7 months since your last one." |
| **Lifestyle nudges** | "You mentioned wanting to lose 10 pounds. Based on your activity this week, here is a small adjustment that could help." |
| **Lab result interpreter** | When new lab results are entered, proactively explain what changed and what it means in context. |
| **Vaccination tracker** | "Your Tdap booster is due this year. Want me to check if your pharmacy offers it?" |

### 6.2 Proactive Feature Implementation with OpenClaw

OpenClaw provides two primitives for proactive behavior:

**Cron Jobs** (for deterministic, time-based triggers)
- Medication refill checks: daily at 9 AM
- Appointment reminders: check upcoming appointments every morning
- Seasonal alerts: weekly on Mondays

**Heartbeat** (for context-aware, intelligent check-ins)
- Follow-up nudges (check if enough time has passed since a recommendation)
- Trend detection (analyze recent data during idle periods)
- General wellness check-ins (configurable frequency)

**Constraints to enforce:**
- Maximum 1 proactive message per day unless something is urgent
- Respect quiet hours (default: 10 PM - 8 AM, user-configurable)
- If user says "stop" or "pause reminders," suppress all proactive outreach until resumed
- Never send proactive messages about sensitive topics without prior consent

---

## 7. User Flows

### 7.1 First-Time User Flow

```
[User opens MedClaw for the first time]
    |
    v
Welcome + brief explanation of what MedClaw does
    |
    v
Privacy notice and consent
("I'll store your health information locally to give you personalized care.
Your data never leaves your device. Do you want to proceed?")
    |
    v
Guided Health Profile Intake (5 minutes)
    |-- Demographics (age, sex, height, weight)
    |-- Active conditions
    |-- Current medications (with pharmacy and refill info)
    |-- Allergies
    |-- Family history (optional, can skip)
    |-- Preferences (preferred pharmacy, appointment times, etc.)
    |
    v
Profile Summary + Confirmation
("Here's what I know about you. Anything to add or correct?")
    |
    v
Proactive Feature Setup
("I can remind you when medications run low and follow up on health
recommendations. Want me to enable proactive care?")
    |
    v
Ready for conversation
("You're all set! Ask me anything about your health, or tell me about
a symptom you're experiencing.")
```

### 7.2 Returning User -- Symptom Consultation

```
User: "I've been having really bad headaches for the past 3 days"
    |
    v
[Triage Check: Is this an emergency?]
-- No: proceed
-- Yes: "This sounds serious. Please call 911 or go to your nearest ER."
    |
    v
[Load Clinical Profile]
-- Active conditions: Hypertension, Type 2 Diabetes
-- Medications: Lisinopril 10mg, Metformin 500mg
-- Recent context: BP was 142/90 at last check (2 weeks ago)
    |
    v
MedClaw: "I'm sorry you've been dealing with headaches. Given your
hypertension history and that your last blood pressure reading was a
bit elevated at 142/90, these headaches could be related to your blood
pressure. A few questions:

1. Where exactly is the pain? (front, back, sides?)
2. Have you been taking your Lisinopril consistently?
3. Have you checked your blood pressure recently?"
    |
    v
[Conversation continues with contextual follow-up]
    |
    v
MedClaw recommendation:
"Based on what you've described, I'd recommend:
1. Check your blood pressure today if you can
2. Make sure you're taking Lisinopril consistently
3. Schedule a follow-up with Dr. Smith if the headaches continue past this week

Want me to find available appointments with Dr. Smith?"
    |
    v
[If user says yes -> Agentic Action Flow (see 7.3)]
[If user says no -> Log recommendation, set follow-up reminder for 5 days]
```

### 7.3 Agentic Action -- Book an Appointment

```
User: "Yes, find me an appointment with Dr. Smith"
    |
    v
[AI plans the search]
MedClaw: "Let me search for availability with Dr. Smith. I know you
prefer morning appointments. Searching..."
    |
    v
[Execute search tool -- Google Places / simulated provider API]
    |
    v
MedClaw: "I found 3 options with Dr. Smith's office at 123 Medical Dr:

  1. Tuesday, Feb 11 at 9:00 AM
  2. Wednesday, Feb 12 at 10:30 AM
  3. Friday, Feb 14 at 8:30 AM

Which works best for you?"
    |
    v
User: "Tuesday morning"
    |
    v
[Explicit confirmation step]
MedClaw: "I'll book:
  Dr. Smith - General Checkup
  Tuesday, Feb 11 at 9:00 AM
  123 Medical Drive, Suite 200

  Should I go ahead and book this?"
    |
    v
User: "Yes"
    |
    v
[Execute booking action]
    |
    v
MedClaw: "Done! Your appointment with Dr. Smith is confirmed for
Tuesday, Feb 11 at 9:00 AM. I'll remind you the day before.

Anything else I can help with?"
    |
    v
[Store appointment in memory]
[Set reminder cron job for Feb 10]
[Set follow-up check for Feb 12 to ask how it went]
```

### 7.4 Proactive Outreach -- Medication Refill

```
[Cron job fires at 9 AM, detects Metformin running low in 5 days]
    |
    v
[Heartbeat checks: Is it within active hours? Has user opted in?
Is the main lane idle?]
    |
    v
MedClaw (proactive message):
"Good morning! Based on when you last filled your Metformin prescription
(January 8), I estimate you might run out in about 5 days.

Want me to request a refill from CVS on Main St?"
    |
    v
User: "Yes please"
    |
    v
[Execute refill request action with confirmation]
    |
    v
MedClaw: "Refill request submitted to CVS on Main St for Metformin 500mg.
They typically process refills within 24 hours. I'll check back tomorrow
to confirm it's ready."
    |
    v
[Set follow-up cron to check refill status in 24 hours]
```

---

## 8. Safety and Liability Considerations

This section is critical. A health AI carries real risks, and judges will respect a team that has thought about them seriously.

### 8.1 What MedClaw Is NOT

Be explicit in the product and the demo:

- **MedClaw is NOT a licensed medical professional.** It does not diagnose diseases, prescribe medications, or replace a doctor.
- **MedClaw is NOT an emergency service.** It cannot call 911, dispatch an ambulance, or provide emergency medical care.
- **MedClaw is NOT a medical device.** It is not FDA-regulated and does not claim clinical accuracy.

### 8.2 What MedClaw IS

- A health information companion that helps you organize and remember your medical data
- A health logistics assistant that helps with scheduling, reminders, and finding providers
- A conversational interface for health education and general wellness guidance
- An action-taking agent for healthcare administration tasks

### 8.3 Safety Features to Implement

#### Emergency Detection (Must Have for MVP)

Build a triage layer that fires on every user message before any other processing:

**Immediate escalation triggers:**
- Chest pain / difficulty breathing / heart attack symptoms
- Stroke symptoms (sudden numbness, confusion, vision problems, severe headache)
- Severe allergic reaction / anaphylaxis
- Suicidal ideation or self-harm mentions
- Severe bleeding or trauma
- Loss of consciousness
- Overdose (intentional or accidental)

**Response pattern:**
```
"This sounds like it could be a medical emergency. Please:
  - Call 911 immediately (or your local emergency number)
  - Go to your nearest emergency room
  - If you're with someone, ask them to help

I'm an AI assistant and cannot provide emergency medical care.
Your safety is the top priority."
```

The AI must NOT attempt to diagnose, reassure, or provide treatment advice for potential emergencies. It must redirect immediately.

#### Consent and Confirmation Framework

| Action Type | Consent Required | Confirmation Display |
|-------------|-----------------|---------------------|
| Providing health information | Implicit (user asked) | N/A |
| Storing health data in profile | Explicit at onboarding + per-update confirmation | Show what is being stored |
| Searching for providers/labs | Implicit (user requested) | Show search parameters |
| Booking appointments | Explicit per-action | Show full appointment details before confirming |
| Requesting refills | Explicit per-action | Show medication, pharmacy, and dosage before confirming |
| Proactive outreach | Opt-in at onboarding + per-feature toggle | User can disable anytime with "stop reminders" |

#### Medical Disclaimers

Display at first use and make accessible at any time:

```
"MedClaw provides general health information and administrative assistance.
It is not a substitute for professional medical advice, diagnosis, or treatment.
Always seek the advice of your physician or other qualified health provider with
any questions regarding a medical condition. Never disregard professional medical
advice or delay in seeking it because of something MedClaw said."
```

### 8.4 Data Privacy and Security

| Concern | Approach |
|---------|----------|
| Data storage | All health data stored locally on user's device (OpenClaw runs locally). No cloud storage of PHI. |
| Data transmission | Health data sent to LLM API for processing. Acknowledge this clearly to users. |
| Data deletion | User can delete their entire profile at any time with a single command. |
| Access control | Single-user system (OpenClaw is a personal assistant). No multi-tenant concerns. |
| Encryption | Data at rest should be encrypted (filesystem-level or application-level). |
| Audit log | All agentic actions are logged with timestamps, parameters, and outcomes. |

### 8.5 Hallucination Mitigation

Health AI hallucinations are especially dangerous. Strategies:

1. **Ground responses in the clinical profile.** When referencing a user's medications or conditions, always pull from the structured clinical store, never from model memory alone.

2. **Never fabricate specific medical data.** If the AI does not have lab results, it must say "I don't have your recent lab results" rather than guessing.

3. **Cite uncertainty explicitly.** "Based on general medical knowledge, [X] is a common cause of [symptom], but your doctor can give you a definitive answer."

4. **Separate facts from suggestions.** Use clear language: "Your profile shows..." (fact from memory) vs "It might be worth considering..." (AI suggestion).

5. **Tool-grounded actions.** When searching for providers or booking, use real API data. Never fabricate provider names, addresses, or availability.

### 8.6 Liability Framing for Hackathon

In the presentation, acknowledge these considerations proactively. This shows maturity:

- "We designed MedClaw as a health logistics and information companion, not a diagnostic tool"
- "Emergency detection is the first check on every message -- safety before helpfulness"
- "Every real-world action requires explicit user consent, and outcomes are verified, not assumed"
- "All data stays local -- this is a personal assistant, not a cloud service"

---

## 9. Architecture Overview

### 9.1 High-Level System Diagram

```
+---------------------------------------------------------------+
|                     User Interface Layer                       |
|  (WhatsApp / Telegram / WebChat / iMessage / any OpenClaw     |
|   supported channel)                                           |
+---------------------------------------------------------------+
         |                    |                     |
         v                    v                     v
+------------------+  +-----------------+  +------------------+
|  OpenClaw Gateway |  | OpenClaw Memory |  | OpenClaw Cron /  |
|  (Orchestration)  |  | (Persistence)   |  | Heartbeat        |
|                    |  |                 |  | (Proactive)      |
|  - Session mgmt   |  | - Clinical      |  |                  |
|  - Queue modes     |  |   profile.md    |  | - Refill checks  |
|  - Model fallback  |  | - MEMORY.md     |  | - Follow-ups     |
|  - Streaming       |  | - SQLite index  |  | - Reminders      |
+------------------+  +-----------------+  +------------------+
         |                                          |
         v                                          v
+---------------------------------------------------------------+
|                  MedClaw Plugin Layer                          |
|                                                                |
|  Tools:                                                        |
|  - triage_assess        - clinical_profile_get                |
|  - clinical_profile_update  - appointment_search              |
|  - appointment_book     - pharmacy_search                     |
|  - medication_refill    - care_reminder_set                   |
|                                                                |
|  Hooks:                                                        |
|  - before_tool_call (safety gate, consent check, audit log)   |
|                                                                |
|  Policies:                                                     |
|  - Tool allowlist (only health-related tools enabled)          |
|  - Emergency lockout (disable transactional tools in crisis)  |
+---------------------------------------------------------------+
         |                    |                     |
         v                    v                     v
+------------------+  +-----------------+  +------------------+
|  LLM Provider     |  | External APIs   |  | Local Data Store |
|  (Anthropic/OpenAI)|  |                 |  |                  |
|                    |  | - Google Places  |  | - clinical-      |
|  - Claude / GPT   |  | - Zocdoc (sim)  |  |   profile.md     |
|  - Health system   |  | - Pharmacy APIs |  | - action-log.md  |
|  - prompt          |  | - Calendar      |  | - MEMORY.md      |
+------------------+  +-----------------+  +------------------+
```

### 9.2 Key Architectural Decisions

#### Why Build on OpenClaw?

| OpenClaw Provides | MedClaw Uses It For |
|-------------------|-------------------|
| Multi-channel messaging | Reach users on WhatsApp, Telegram, iMessage, etc. -- no custom app needed |
| Session management | Maintain conversation continuity across interactions |
| Memory system (markdown + SQLite + hybrid search) | Store and retrieve health data and conversation context |
| Cron + heartbeat scheduling | Power proactive reminders and check-ins |
| System event bus | Trigger follow-ups based on completed actions |
| Tool policy layering | Restrict which tools are available and enforce safety checks |
| before_tool_call hooks | Add consent checks, audit logging, emergency detection |
| Model fallback | Ensure reliability even if one LLM provider has an outage |
| Plugin architecture | Package all MedClaw functionality as a clean OpenClaw plugin |

#### MedClaw as an OpenClaw Plugin

MedClaw should be implemented as an OpenClaw plugin that:

1. **Registers custom tools** (triage_assess, clinical_profile_get, appointment_search, etc.)
2. **Provides a health-specialized system prompt** that instructs the LLM on its role, capabilities, and constraints
3. **Configures tool policies** to restrict the agent to health-related tools only
4. **Registers before_tool_call hooks** for consent enforcement and safety gating
5. **Sets up cron jobs** for proactive health monitoring
6. **Manages the clinical profile** as structured markdown within the memory directory

#### Data Flow for a Typical Interaction

```
1. User sends message via WhatsApp
2. OpenClaw Gateway receives message, resolves session
3. MedClaw triage_assess tool runs FIRST (emergency check)
4. If safe, clinical_profile_get loads structured health data
5. OpenClaw memory_search finds relevant conversation history
6. Combined context + user message sent to LLM
7. LLM generates response, possibly calling MedClaw tools
8. before_tool_call hook checks consent for any transactional tools
9. Tool executes (e.g., appointment_search calls Google Places API)
10. Result returned to LLM, which formats response for user
11. Response delivered back through WhatsApp
12. Action logged, memory updated, follow-up cron scheduled if needed
```

### 9.3 Tech Stack Summary

| Layer | Technology | Why |
|-------|-----------|-----|
| Agent Framework | OpenClaw | Already built, proven orchestration, memory, proactivity |
| LLM | Claude (Anthropic) or GPT-4 | Best available reasoning for health context |
| Health Plugin | TypeScript (OpenClaw plugin SDK) | Native integration with OpenClaw |
| Clinical Data Store | Structured Markdown + SQLite | Leverages OpenClaw memory infrastructure |
| Location/Search APIs | Google Places API | Best coverage for provider/pharmacy search |
| Appointment Booking | Simulated API for hackathon; real integrations post-hackathon | Honest about what is simulated vs real |
| User Interface | Existing OpenClaw channels (WhatsApp, Telegram, WebChat) | Zero frontend work needed |
| Hosting | Local machine (OpenClaw runs locally) | Privacy-first, no cloud infra needed |

---

## 10. Hackathon Demo Strategy

### 10.1 The Story Arc

The demo should tell a story, not just show features. Here is a recommended 5-minute demo structure:

**Act 1: The Problem (30 seconds)**
"Raise your hand if you've ever had to repeat your entire medical history to a new doctor. Or forgotten when your last flu shot was. Or run out of medication because nobody reminded you. Healthcare is reactive, fragmented, and it puts all the administrative burden on you."

**Act 2: Meet MedClaw (30 seconds)**
"MedClaw is your personal AI family doctor. It remembers everything about your health. It watches out for you. And it can take action on your behalf."

**Act 3: Live Demo -- Memory (90 seconds)**
Show the onboarding flow. Walk through adding conditions, medications, and allergies. Then start a new conversation and ask a health question -- show that MedClaw remembers everything from the first conversation.

**Act 4: Live Demo -- Proactive Care (60 seconds)**
Show MedClaw proactively reaching out about a medication refill. "Nobody asked it to do this. It calculated when the medication would run out and reached out on its own."

**Act 5: Live Demo -- Agentic Action (90 seconds)**
This is the showstopper. Show the full flow: user mentions a symptom, MedClaw connects it to their history, suggests a blood test, finds nearby labs, and books an appointment. The audience should see the AI taking real actions with real search results.

**Act 6: Safety and Vision (30 seconds)**
"Every action requires explicit consent. Emergencies are detected and redirected immediately. All data stays on your device. This is not a replacement for your doctor -- it is a personal health companion that makes healthcare work better for you."

### 10.2 Demo Preparation Checklist

| Item | Details |
|------|---------|
| Pre-loaded patient profile | Create a realistic test patient with conditions, meds, allergies, and history. Do not use real patient data. |
| Simulated appointment data | Pre-seed realistic appointment availability so the booking demo does not fail due to API issues |
| Backup demo recording | Record a perfect run of the demo as a backup in case of live demo failure |
| Two devices | One for the "user" side (phone showing WhatsApp/Telegram) and one showing the MedClaw backend/logs |
| Emergency detection test | Prepare to show what happens when someone reports chest pain -- judges love to see safety features |
| Memorable patient story | Give the test patient a name and a narrative (e.g., "Sarah, 45, manages diabetes and hypertension, busy working mom") |

### 10.3 What Judges Will Care About

Based on typical hackathon judging criteria:

| Criterion | How MedClaw Scores |
|-----------|-------------------|
| **Innovation** | Agentic health actions + persistent medical memory is genuinely novel. Most health AI is just a chatbot with no memory and no ability to take action. |
| **Technical Complexity** | Multi-layer memory system, proactive scheduling, real-world API integration, safety triage pipeline. Built on a sophisticated open-source agent framework. |
| **Usefulness** | Solves a real, universal problem. Everyone interacts with healthcare. The medication refill reminder alone is a feature people would pay for. |
| **Completeness** | End-to-end flow from onboarding to proactive outreach to action execution. Not just a chatbot -- a complete health companion. |
| **Presentation** | Story-driven demo with a relatable patient persona. Live demo showing real interactions, not just slides. |

### 10.4 Potential Judge Questions and Answers

**Q: "How is this different from just asking ChatGPT about health?"**
A: "Three ways. First, ChatGPT forgets you after every conversation. MedClaw remembers your entire medical history. Second, ChatGPT waits for you to ask. MedClaw proactively reaches out when your meds are running low or you're due for a checkup. Third, ChatGPT can only talk. MedClaw can take action -- it can find labs, compare options, and book appointments."

**Q: "Is this safe? What if it gives bad medical advice?"**
A: "We built safety-first. Every message goes through emergency triage before anything else. MedClaw never claims to diagnose -- it helps you organize your health information and navigate the healthcare system. And every real-world action requires your explicit approval."

**Q: "How do you handle privacy?"**
A: "Everything runs locally on your device using OpenClaw. Your health data never goes to our servers because we don't have servers. The only external call is to the LLM API for generating responses, which we acknowledge clearly to users."

**Q: "What's the business model?"**
A: "The core health companion could be free and open-source, consistent with OpenClaw. Premium features could include real integrations with EHR systems (Epic, Cerner), insurance network matching, and telehealth connections. Those require partnerships and compliance work that go beyond the hackathon."

---

## 11. Design Direction

### 11.1 Visual Identity

Since MedClaw uses existing OpenClaw channels (WhatsApp, Telegram, etc.) as its interface, the "design" is primarily about the conversational experience rather than a custom UI. However, for the WebChat interface and presentation materials:

**Overall aesthetic:** Clean, trustworthy, and calming. Healthcare UI should never feel chaotic, flashy, or aggressive.

### 11.2 Color Palette

| Color Name | Hex Code | Usage |
|------------|----------|-------|
| MedClaw Blue | #2B6CB0 | Primary brand color -- trust, professionalism |
| Calm Teal | #38A89D | Secondary -- health, wellness, growth |
| Soft White | #F7FAFC | Backgrounds -- clean, clinical |
| Warm Gray | #4A5568 | Body text -- readable, not harsh |
| Alert Red | #E53E3E | Emergency messages, critical warnings |
| Success Green | #38A169 | Confirmed actions, positive outcomes |
| Gentle Amber | #D69E2E | Non-critical reminders, proactive nudges |

### 11.3 Conversational Design Principles

1. **Be warm but not casual.** "I've noted your Metformin prescription" not "Got it! Added your meds!"
2. **Be specific.** "Your HbA1c was 6.8% on January 15" not "Your diabetes numbers were a bit high."
3. **Be transparent about uncertainty.** "I don't have information about..." not making up data.
4. **Structure complex information.** Use numbered lists, tables, and clear sections for multi-part responses.
5. **Always provide next steps.** End responses with actionable suggestions or options.
6. **Acknowledge emotions.** "I understand that can be concerning" before diving into clinical details.

### 11.4 Message Formatting

For channels that support rich formatting (Telegram, Slack, WebChat):

```
--- Proactive Message ---

Good morning, Sarah.

Based on your prescription history, your Metformin (500mg, twice daily)
may run out in approximately 5 days.

Would you like me to:
  1. Request a refill from CVS on Main St
  2. Check another pharmacy
  3. Remind you later

--- Action Confirmation ---

Appointment Confirmed

  Doctor: Dr. Sarah Smith
  Date: Tuesday, February 11
  Time: 9:00 AM
  Location: 123 Medical Drive, Suite 200
  Type: General Checkup

I'll send you a reminder tomorrow morning.
```

---

## 12. Development Plan

### 12.1 Hackathon Sprint Plan

Assuming 24-48 hours of development time with a team of 3-4 people.

#### Hour 0-4: Foundation

| Task | Owner | Description |
|------|-------|-------------|
| Set up OpenClaw dev environment | Dev 1 | Clone OpenClaw, install deps, verify gateway runs, connect at least one channel (WebChat or Telegram) |
| Design clinical profile schema | Dev 2 | Define the structured markdown format for the clinical profile |
| Write MedClaw system prompt | Dev 3 | Craft the LLM system prompt that defines MedClaw's persona, capabilities, and constraints |
| Design the demo patient story | Dev 4 / All | Create "Sarah" -- the test patient persona with a realistic health profile |

#### Hour 4-12: Core Plugin

| Task | Owner | Description |
|------|-------|-------------|
| Create MedClaw plugin skeleton | Dev 1 | OpenClaw plugin structure with tool registration |
| Implement clinical_profile_get/update tools | Dev 2 | Read and write structured health data from markdown |
| Implement triage_assess tool | Dev 3 | Emergency detection logic that fires on every message |
| Implement guided onboarding flow | Dev 1 | Structured first-time conversation that populates the clinical profile |
| Test memory retrieval with health context | Dev 2 | Verify that health data persists and is retrieved correctly across sessions |

#### Hour 12-20: Actions and Proactivity

| Task | Owner | Description |
|------|-------|-------------|
| Implement appointment_search tool | Dev 1 | Google Places API integration for finding labs and clinics |
| Implement appointment_book tool | Dev 2 | Booking flow with confirmation step (simulated or real) |
| Implement pharmacy_search tool | Dev 3 | Find nearby pharmacies |
| Set up medication refill cron job | Dev 1 | Cron that checks medication run-out dates daily |
| Implement proactive message flow | Dev 2 | Heartbeat-triggered refill reminder delivery |
| Implement before_tool_call consent gate | Dev 3 | Safety hook that requires explicit consent for transactional tools |

#### Hour 20-28: Polish and Demo Prep

| Task | Owner | Description |
|------|-------|-------------|
| End-to-end demo rehearsal | All | Run through the full demo story multiple times |
| Fix edge cases and error handling | Dev 1-2 | Handle API failures, unexpected inputs, etc. |
| Record backup demo video | Dev 3 | In case live demo fails |
| Prepare presentation slides | Dev 4 | Problem statement, architecture diagram, key differentiators |
| Pre-load demo data | Dev 2 | Seed the test patient profile and simulated appointment data |
| Final demo rehearsal with timing | All | Practice the 5-minute demo with timing |

### 12.2 Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| OpenClaw setup takes too long | High | Start early. Have one person dedicated to setup. Read docs carefully. |
| Google Places API issues (rate limits, auth) | Medium | Pre-cache results for demo locations. Have simulated fallback data. |
| LLM produces poor health responses | Medium | Invest in the system prompt. Test extensively. Have the clinical profile be very specific. |
| Live demo fails on stage | High | Record a backup demo video. Practice offline. Have a "safe" demo path that avoids risky API calls. |
| Scope creep | High | Stick to the MVP feature list. "Good enough" beats "perfect but unfinished." |
| Team unfamiliar with OpenClaw | Medium | Have someone read the deep-dive doc and blueprint doc thoroughly at the start. Focus on plugin development, not modifying core. |

---

## 13. Open Questions

Items that need resolution but can be decided during development:

| Question | Context | Recommended Default |
|----------|---------|-------------------|
| Which messaging channel for the demo? | WebChat is easiest to set up; WhatsApp is more impressive visually | Use WebChat for development, try to get Telegram or WhatsApp working for the demo |
| Simulated vs real appointment booking? | Real APIs are more impressive but riskier for a live demo | Simulate the booking, but use real search results from Google Places |
| How detailed should the onboarding be? | More detail = better context, but longer onboarding | Focus on conditions, medications, and allergies. Skip detailed family history for MVP. |
| Should we show the clinical profile file? | Showing the structured data makes the memory system tangible | Yes -- briefly show the markdown file during the demo to prove data persistence |
| Which LLM to use? | Claude vs GPT-4 vs others | Use whatever model is available through the team's API keys. Claude recommended for instruction following. |
| How to handle the "this is not medical advice" framing? | Too many disclaimers hurt the demo; too few raise concerns | One clear disclaimer at onboarding, then focus on the logistics/companion framing, not diagnosis |
| Should proactive messages be shown live or pre-recorded? | Live is impressive but requires timing the cron job during the demo | Pre-trigger the cron job right before the demo, or simulate the timing with a manual system event |

---

## Appendix

### A. Glossary

| Term | Definition |
|------|-----------|
| **Agentic Action** | An action the AI takes in the real world on behalf of the user (booking, searching, purchasing) |
| **Clinical Profile** | Structured medical data about the user (conditions, medications, allergies, etc.) |
| **Cron Job** | A scheduled task that runs at specific times or intervals |
| **Heartbeat** | OpenClaw's periodic check-in mechanism that decides whether to proactively message the user |
| **FHIR** | Fast Healthcare Interoperability Resources -- a standard for exchanging healthcare data |
| **PHI** | Protected Health Information -- any health data that can identify an individual |
| **Triage** | The process of determining urgency and routing of a health concern |
| **before_tool_call** | An OpenClaw hook that runs before any tool executes, used for safety and policy enforcement |
| **System Event** | An ephemeral context message injected into the next agent turn, used to communicate background state changes |

### B. Competitive Landscape

| Product | What It Does | How MedClaw Differs |
|---------|-------------|-------------------|
| ChatGPT / Claude | General AI chat, can answer health questions | No memory, no proactivity, no actions, no health specialization |
| Ada Health | Symptom checker with decision tree logic | Rule-based, no persistent memory, no action-taking |
| Babylon Health | AI triage + telehealth connection | Commercial, closed, no persistent personal context |
| Apple Health | Health data aggregation from devices | Data display only, no AI reasoning, no actions |
| MyChart (Epic) | Patient portal for specific health systems | Locked to one provider system, no AI, no proactivity |

MedClaw's unique position: **The only AI health companion that combines persistent medical memory, proactive care, and real-world action-taking in a privacy-first, locally-run architecture.**

### C. Reference Links

- OpenClaw Documentation: https://docs.openclaw.ai
- OpenClaw GitHub: https://github.com/openclaw/openclaw
- Google Places API: https://developers.google.com/maps/documentation/places/web-service
- FHIR Standard (for future reference): https://www.hl7.org/fhir/

---

*Blueprint created for hackathon project development. This document is a living specification -- update it as decisions are made during development.*
