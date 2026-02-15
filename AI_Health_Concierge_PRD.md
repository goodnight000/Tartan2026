# Product Requirements Document: AI Health Concierge

**Document Version:** 2.0
**Date:** February 15, 2026
**Status:** Draft — Updated with market research findings

---

## 1. Executive Summary

This document outlines the product requirements for an AI-powered health concierge application that serves as a persistent, personalized health assistant. The app combines deep health memory, proactive intelligence, and agentic task execution to help users navigate the healthcare system, stay on top of their health, and make informed decisions.

The product is **not** a diagnostic tool. It is positioned as a health concierge — an intelligent layer between users and the healthcare system that remembers everything, surfaces timely insights, and handles administrative friction on the user's behalf.

---

## 2. Product Vision & Positioning

### Vision
To be the first app that truly knows your health story and actively works to keep you healthy — not by replacing doctors, but by making sure nothing falls through the cracks.

### Positioning Statement
For health-conscious adults who are overwhelmed by navigating the healthcare system, [App Name] is a personal health concierge that remembers your full health history, proactively alerts you to what matters, and handles the logistics so you don't have to. Unlike generic health information apps, [App Name] gets smarter over time and actually takes action on your behalf.

### Brand Direction (Research-Validated)
The brand should position the product as a **knowledgeable friend who happens to have medical expertise** — not a medical tool that tries to be friendly. Research into 310+ healthtech brands confirms that the most successful consumer health apps (Calm, Headspace, Hims, Parsley Health) deliberately avoid looking or sounding like healthcare companies. They lead with warmth and humanity, then validate with clinical credibility.

**Naming strategy:** Use abstract, metaphorical, or human names — avoid "AI," "Med-," "Health," or "Clinic-" in the name. Short (1–2 syllables), warm, and universally resonant. Top three candidates from naming research:
- **Sage** — dual meaning (wise advisor + healing herb) bridges competence and warmth
- **Haven** — broadest emotional appeal with universal safety resonance
- **Beacon** — most aligned with navigation-and-proactive-nudge product positioning

Other strong candidates: Ally, Kindred, Nell, Compass, Trellis, Harbor, Luma, Nura, Flourish, Canopy, Steadwell, Beside.

**Visual identity direction:** Move away from cold medical blues toward warmer, organic palettes. Dusty mint and sage green are emerging as dominant wellness colors for 2026. Custom illustrations outperform photography for health apps (following the Headspace model). Typography should favor rounded sans-serifs for warmth with selective serif use for authority in clinical content. The brand symbol should intentionally avoid medical visual triggers, focusing instead on imagery of a bright, balanced life.

**Tone of voice:** Warm, personal, calm, and gently proactive. Like texting a friend who is also a doctor. Never clinical, never condescending, never alarmist.

### Key Differentiators
- **Persistent memory** that builds a longitudinal understanding of the user's health over time.
- **Proactive intelligence** that surfaces the right information at the right time without the user needing to ask.
- **Agentic execution** that goes beyond information to actually help users book appointments, prepare for visits, and coordinate care.
- **Personalized context** that tailors every interaction to the user's unique health profile, history, and circumstances.

### What This Product Is Not
- Not a diagnostic tool or a replacement for medical professionals.
- Not a fitness tracker or wellness gamification platform.
- Not a telemedicine service.
- All recommendations carry clear disclaimers advising users to consult healthcare professionals for serious concerns.

---

## 3. Target Audience

### Primary Launch Audience: PCOS & Thyroid Patients (Research-Validated Wedge)

After evaluating three candidate segments across market size, digital adoption, pain intensity, reachability, willingness to pay, and competitive gaps, **people managing chronic conditions — specifically PCOS and thyroid patients — are the recommended launch segment.**

**Why this wedge wins:**

- **Large and precisely targetable.** PCOS and thyroid conditions affect ~15–17 million Americans, predominantly women (~80%). These patients self-identify by condition in online communities, making them efficiently reachable. The r/PCOS subreddit alone has ~197,000 highly engaged members; r/hypothyroidism has ~100,000+.
- **Highest demonstrated willingness to pay.** Chronic condition patients already spend $30–200+/month out-of-pocket on supplements (50% of women with chronic conditions use herbal supplements), functional medicine consultations ($200–500/visit), CGMs ($75–350/month), and health coaching ($21–29/month). The $15–30/month price point for an AI concierge sits comfortably below existing fragmented spending.
- **Massive competitor gap.** Dominant platforms (Livongo, Virta Health, Omada Health) are B2B only — accessible through employers or health plans. No existing product combines multi-condition management, persistent AI memory, proactive nudges, and agentic features for direct-to-consumer users.
- **Perfect product-market fit.** The #1 frustration for these patients is coordination between specialists — and the app's core features (visit prep, care team memory, medication intelligence) directly solve this. PCOS + Hashimoto's + insulin resistance patients often see 3–5 specialists with no coordination layer.
- **Strong digital health adoption.** 60–70% of chronic condition patients under 65 are digitally engaged; 40%+ of US adults already use health apps.

### Segment Comparison Summary

| Dimension | Chronic Conditions (Selected) | New Parents | Sandwich Generation |
|---|---|---|---|
| US market size | 50–60M (15–17M for PCOS/thyroid wedge) | 12–15M households with children under 5 | 18.3M active caregivers |
| OOP health spending | $30–200+/month | $20/month validated (Summer Health) | $7,200/year average |
| Digital adoption | 60–70% | 72% (highest) | 41% |
| Online community size | 500K+ Reddit (condition-specific) | 10M+ Reddit (general parenting) | ~100–150K Reddit |
| Competitor gap | Large (B2B-gated) | Moderate (Summer Health, Maven) | Large (fragmented) |
| Pain acuity | Chronic, daily, compounding | Acute but episodic | Most intense but diffuse |

### Expansion Path
1. **Phase 1 (Launch):** PCOS and thyroid patients
2. **Phase 2 (Month 6–9):** Broader chronic conditions — Type 2 diabetes (~40M), autoimmune conditions (~24–50M)
3. **Phase 3 (Month 9–12):** New parents — highest digital adoption (72%), validated $20/month WTP, massive organic communities. Natural churn risk (children age out) mitigated by family coordination features.
4. **Phase 4 (Year 2+):** Sandwich generation caregivers — most acute pain (77% report emotional stress, $10,000/year OOP), but smaller communities and more complex multi-user product requirements.

### Broader Addressable Market
- Health-conscious adults aged 25–65 in the United States.
- Estimated total addressable market: 50–100M individuals.
- Estimated serviceable obtainable market at launch: 2–5M (PCOS/thyroid patients actively seeking digital health tools).

### User Personas

**Persona 1: The Multi-Condition Navigator (Primary — Launch Target)**
Age 31, diagnosed with PCOS and Hashimoto's thyroiditis. Sees an endocrinologist, a gynecologist, a primary care doctor, and occasionally a dermatologist. Takes levothyroxine, metformin, and spironolactone plus 4 supplements. Spends $150/month on supplements and functional medicine. Frustrated that no doctor looks at the full picture. Frequently active on r/PCOS and PCOS-focused Instagram accounts. Wants one place that understands how her conditions interact and helps her prepare for specialist visits.

**Persona 2: The Anxious Optimizer**
Age 29, generally healthy but health-anxious. Googles symptoms frequently and gets overwhelmed by generic, often alarming results. Wants personalized, calm, trustworthy answers that account for their specific situation.

**Persona 3: The Sandwich Generation Caregiver (Future Expansion)**
Age 52, managing their own health plus coordinating care for an 80-year-old parent with multiple conditions. Juggling appointments, medications, and provider communications for two people. Desperate for organizational help.

---

## 4. Feature Requirements

Features are organized by the phase in which they deliver value to the user.

---

### 4.1 Immediate Value Features (First Session)

#### 4.1.1 Smart Health Profile Onboarding

**Priority:** P0 (Must-have for launch)

**Description:**
A conversational, AI-driven onboarding experience that builds the user's health profile through natural dialogue rather than static forms. The system collects key health information — conditions, medications, family history, allergies, recent concerns — while feeling like a conversation with a thoughtful healthcare professional.

**Requirements:**
- Onboarding must be completable in under 5 minutes for a user with moderate health complexity.
- The conversational flow should adapt based on answers (e.g., mentioning diabetes triggers follow-up questions about A1C, medication, and monitoring frequency).
- At the end of onboarding, the app must immediately reflect back at least one personalized, actionable insight based on the information provided (e.g., "Based on your family history and age, you may want to discuss screening for X with your doctor").
- Users must be able to skip onboarding and add information incrementally over time.
- All data entry should support both voice and text input.

**Acceptance Criteria:**
- 80%+ of users who begin onboarding complete it.
- Users report the onboarding felt "personal" and "useful" in post-onboarding survey (target: 4.0+ out of 5).

---

#### 4.1.2 Personal Health Timeline

**Priority:** P0 (Must-have for launch)

**Description:**
A visual, chronological timeline that organizes the user's health history in one coherent view. Includes past events (diagnoses, surgeries, major visits), current medications and treatments, and upcoming actions (screenings due, follow-ups, refills).

**Requirements:**
- Auto-populated from onboarding conversation data.
- Users can manually add, edit, or remove events.
- Timeline entries are categorized (e.g., medications, visits, lab results, screenings).
- Upcoming items should display estimated due dates based on standard care guidelines adjusted for the user's profile.
- The timeline must be scannable at a glance and expandable for detail.

**Acceptance Criteria:**
- Timeline renders correctly for users with 0 to 50+ health events.
- Users can add a new event in under 30 seconds.

---

#### 4.1.3 Personalized Health Q&A

**Priority:** P0 (Must-have for launch)

**Description:**
An AI-powered conversational interface that answers health questions contextualized to the user's specific profile. Unlike generic health search, responses factor in the user's age, sex, conditions, medications, family history, and logged symptoms.

**Requirements:**
- Responses must clearly distinguish between general health information and personalized context.
- Every response that touches on medical topics must include a disclaimer noting that the app is not a substitute for professional medical advice.
- The AI must be able to reference the user's profile data in responses (e.g., "Given that you're taking metformin, this interaction is worth noting").
- Responses should be written in plain, accessible language at approximately an 8th-grade reading level.
- The system must gracefully handle questions outside its scope (e.g., emergencies) by directing users to appropriate resources (911, Poison Control, etc.).

**Acceptance Criteria:**
- Personalized responses are rated more helpful than generic health search by 70%+ of test users.
- Emergency and out-of-scope queries are correctly routed 99%+ of the time.

---

### 4.2 Early Value Features (First Week)

#### 4.2.1 Appointment Prep Sheets

**Priority:** P0 (Must-have for launch)

**Description:**
Before any upcoming doctor visit, the app automatically generates a one-page preparation summary including: symptoms logged since the last visit, changes in medications or health status, questions to ask based on the user's current situation, and any pending items from previous appointments.

**Requirements:**
- Prep sheets are generated automatically 48 hours before a known appointment and surfaced via notification.
- Users can manually trigger a prep sheet for any upcoming appointment.
- The prep sheet is exportable as a PDF and shareable (e.g., email, print, AirDrop).
- Questions suggested should be specific to the appointment type and the user's context (not generic lists).
- Users can edit, add to, or remove items from the generated prep sheet.

**Acceptance Criteria:**
- 60%+ of users who receive a prep sheet report finding it useful.
- Prep sheets are generated in under 10 seconds.

---

#### 4.2.2 Medication & Supplement Intelligence

**Priority:** P1 (High priority)

**Description:**
An intelligent medication management layer that goes beyond reminders to provide contextual understanding of the user's medication regimen. Includes interaction checking between medications and supplements, plain-language side effect explanations, and contextual insights linking medications to reported symptoms.

**Requirements:**
- Maintain a complete, user-editable medication and supplement list with dosage, frequency, and prescribing reason.
- Flag known interactions between any items in the user's medication/supplement list (sourced from a reliable drug interaction database).
- When a user logs a new symptom, cross-reference against known side effects of current medications and surface possible connections.
- Provide plain-language explanations of what each medication does and common experiences in the first weeks of starting it.
- Refill reminders based on user-reported refill cadence.

**Acceptance Criteria:**
- Drug interaction flags are accurate against a validated reference database at 95%+ accuracy.
- Users managing 3+ medications report the feature as "very useful" at 70%+ rate.

---

#### 4.2.3 Conversational Symptom Logging

**Priority:** P1 (High priority)

**Description:**
A lightweight, conversational check-in system that allows users to log symptoms, energy levels, mood, and general wellbeing in under 30 seconds. The system uses natural language processing to extract structured data from casual input and surfaces patterns over time.

**Requirements:**
- Check-in can be completed via a quick conversational exchange (e.g., "How are you feeling today?") or via a minimal-tap interface.
- The system extracts structured symptom data from natural language input (e.g., "had a headache again this morning" → headache, AM, recurring).
- Check-in frequency is user-configurable (daily, every few days, weekly).
- After sufficient data is collected (minimum 2 weeks), the system begins surfacing observed patterns (e.g., "You've reported headaches 4 out of the last 5 Mondays").
- Check-ins should never feel burdensome. If a user skips, the app does not guilt or nag.

**Acceptance Criteria:**
- Average check-in completion time is under 30 seconds.
- Pattern detection surfaces at least one meaningful insight for 50%+ of active users within the first month.

---

### 4.3 Ongoing Value Features (Month 1+)

#### 4.3.1 Proactive Health Nudges

**Priority:** P0 (Must-have for launch — core retention driver)

**Description:**
The app's primary retention mechanism. The system proactively surfaces timely, personalized health recommendations and reminders based on the user's health profile, age, sex, family history, logged data, and established preventive care guidelines. Nudges should feel like a thoughtful friend looking out for you, not a nagging notification system.

**Requirements:**
- Nudge categories include: preventive screening reminders, follow-up visit reminders, seasonal health alerts (flu season, allergy season), lifestyle observations based on logged data, and medication-related reminders.
- Each nudge must be personalized and cite the specific reason it's relevant (e.g., "Based on your age and family history of colon cancer, you're due for a colonoscopy").
- Nudges must include a clear, low-friction call to action (e.g., "Want me to help find a provider?" or "Tap to add this to your calendar").
- Users can snooze, dismiss, or permanently disable specific nudge categories.
- Nudge frequency is capped to avoid notification fatigue. Recommended maximum: 2–3 per week, with no more than 1 per day unless time-sensitive.
- Nudge timing should be intelligent (not sent at night, not clustered together, respecting user-set quiet hours).

**Acceptance Criteria:**
- 50%+ of nudges are rated "helpful" or "very helpful" by users.
- Users who receive nudges show 2x+ higher Day 30 retention compared to users who don't.
- Less than 10% of users disable nudge notifications in their first month.

---

#### 4.3.2 Document Explainer ("Explain This")

**Priority:** P1 (High priority)

**Description:**
Users can upload, paste, or photograph any medical document — lab results, radiology reports, after-visit summaries, insurance explanations of benefits — and receive a plain-language explanation personalized to their health context.

**Requirements:**
- Support input via photo/camera, file upload (PDF, image), and pasted text.
- OCR capability for photographed documents.
- Explanations must be in plain language and contextualized to the user's profile (e.g., "Your LDL of 142 is borderline high. Given your family history of heart disease, this is worth discussing with your doctor").
- Flag any results that appear significantly abnormal with a recommendation to consult their provider.
- Extracted data (lab values, diagnoses, provider notes) should be offered for addition to the user's health profile and timeline.

**Acceptance Criteria:**
- Accurate extraction and explanation of standard lab panels (CBC, CMP, lipid panel, A1C) at 95%+ accuracy.
- Users rate explanations as "clearer than what I got from my doctor's office" at 60%+ rate.

---

#### 4.3.3 Health Spending Tracker

**Priority:** P2 (Medium priority)

**Description:**
A simple tracker that helps users understand and monitor their healthcare spending, including copays, prescription costs, out-of-pocket expenses, and progress toward their annual deductible and out-of-pocket maximum.

**Requirements:**
- Users can manually log healthcare expenses by category (visit copay, prescription, lab work, etc.).
- The system tracks progress toward the user's annual deductible and out-of-pocket maximum (user-entered insurance plan details).
- Alerts when approaching deductible or out-of-pocket max thresholds (e.g., "You've hit 80% of your deductible — it may be worth scheduling any procedures you've been putting off").
- Monthly and annual spending summaries.
- Data exportable for tax purposes or FSA/HSA reimbursement.

**Acceptance Criteria:**
- Users can log an expense in under 15 seconds.
- Spending summary is accurate to within $1 of user-entered data.

---

### 4.4 Deepening Value Features (Month 3+)

#### 4.4.1 Longitudinal Trends & Insights

**Priority:** P1 (High priority)

**Description:**
After sufficient data accumulation, the app surfaces meaningful longitudinal trends across the user's health data — lab values over time, symptom patterns, lifestyle correlations, and progress toward health goals.

**Requirements:**
- Visualize trends for any tracked metric over user-selectable time ranges.
- AI-generated narrative insights that explain trends in context (e.g., "Your blood pressure readings have decreased steadily since you started walking regularly in March").
- Correlate across data types where appropriate (e.g., linking sleep quality logs to symptom frequency).
- Highlight improvements as positive reinforcement.
- Flag concerning trends with a recommendation to discuss with a healthcare provider.

**Acceptance Criteria:**
- Trend visualizations render accurately for data spanning 1 month to 2+ years.
- AI-generated insights are rated as "accurate" and "useful" by 70%+ of users in testing.

---

#### 4.4.2 Family Health Coordination

**Priority:** P2 (Medium priority, high retention impact)

**Description:**
Allow users to create and manage health profiles for family members (children, aging parents, spouse) with the same feature set available for their own profile. Designed for the common scenario where one family member serves as the health coordinator for the household.

**Requirements:**
- Users can create up to 5 dependent profiles linked to their account.
- Each dependent profile has its own health timeline, medication list, appointment tracker, and nudge schedule.
- Appointment prep sheets can be generated for dependents.
- Switching between profiles is seamless (1 tap).
- Privacy controls: dependent profiles for adults (e.g., aging parents) require consent and can be view-only or full-edit.

**Acceptance Criteria:**
- Users managing 2+ profiles show 40%+ higher retention at 6 months compared to single-profile users.
- Profile switching takes less than 2 seconds.

---

#### 4.4.3 Care Team Memory

**Priority:** P2 (Medium priority)

**Description:**
A persistent record of the user's full care team — every provider they see, what was discussed, what was recommended, and what's still pending. Serves as the connective tissue between fragmented healthcare interactions.

**Requirements:**
- Users can add providers with name, specialty, practice, and contact info.
- Each provider entry can have associated visit notes, recommendations, and follow-up items.
- The system cross-references pending items across providers (e.g., "Your dermatologist recommended you mention the mole to your primary care doctor — want me to add that to your next appointment prep?").
- Visit history is viewable per provider and in aggregate on the health timeline.

**Acceptance Criteria:**
- Users with 3+ providers report improved care coordination in qualitative feedback.

---

#### 4.4.4 Smart Provider Matching & Referral

**Priority:** P3 (Future phase)

**Description:**
When a user needs a new provider (specialist referral, moved to a new area, dissatisfied with current provider), the app helps them find one based on insurance acceptance, location, availability, specialty, and user reviews.

**Requirements:**
- Filter by insurance plan, distance, specialty, and availability.
- Display aggregated patient ratings and review summaries where available.
- Integrate with provider directories and, where possible, real-time availability data.
- Allow the user to initiate appointment booking from the search results (initially via phone link, later via direct scheduling integration).

**Acceptance Criteria:**
- Provider search returns relevant results for 90%+ of queries in supported metropolitan areas.

---

## 5. Agentic Capabilities Roadmap

Agentic features — where the app takes action on behalf of the user — represent the highest-value differentiator but also the highest integration complexity. The following phased approach balances user value with technical feasibility.

### Phase 1: Assisted Actions (Launch)
- Generate appointment prep sheets for user review.
- Surface one-tap actions: "Call this office," "Add to calendar," "Set a reminder."
- Pre-fill messages the user can send to provider offices (e.g., refill requests, appointment requests).

### Phase 2: Semi-Automated Actions (6 months post-launch)
- Appointment scheduling through integrated booking platforms (Zocdoc, provider portal APIs where available).
- Automated prescription refill reminders with direct pharmacy links.
- Insurance benefit verification for recommended screenings.

### Phase 3: Fully Agentic Actions (12+ months post-launch)
- Direct appointment booking across a broad provider network.
- Automated care coordination: forwarding relevant records between providers with user permission.
- Proactive insurance optimization (e.g., "You've hit your deductible — now is a good time to schedule that MRI your orthopedist recommended").

---

## 6. Technical Requirements

### 6.1 AI & Data Architecture
- LLM-powered conversational interface with persistent, per-user memory.
- Structured health data store for medications, conditions, lab values, and appointments.
- Unstructured data store for conversation history and free-text notes.
- RAG (Retrieval-Augmented Generation) architecture to ground AI responses in the user's personal health data and validated medical knowledge bases.

### 6.2 Data Sources & Integrations
- Drug interaction database (e.g., DrugBank, Lexicomp, or equivalent licensed source).
- Preventive care guidelines (USPSTF, CDC immunization schedules).
- Provider directory data (NPI registry, insurance network directories).
- OCR service for document scanning.
- Calendar integration (Apple Calendar, Google Calendar).
- Future: EHR integration via FHIR/SMART on FHIR APIs, Apple HealthKit, Google Health Connect.

### 6.3 Platform Requirements
- Native iOS and Android applications.
- Responsive web application for desktop access.
- Push notification support on all platforms.
- Offline support for viewing health profile, timeline, and medication list.

### 6.4 Performance Requirements
- Conversational AI responses delivered in under 3 seconds.
- Document analysis (Explain This) completed in under 15 seconds.
- App launch to interactive state in under 2 seconds.

---

## 7. Privacy, Security & Compliance (Research-Validated)

### 7.1 FDA Regulatory Pathway

The FDA's updated January 2026 guidance creates a favorable pathway for this product. Two primary exemptions apply:

**General Wellness Software Exemption (Primary Path)**
Under Section 520(o)(1)(B) of the FD&C Act, software "intended for maintaining or encouraging a healthy lifestyle" that is "unrelated to the diagnosis, cure, mitigation, prevention, or treatment of a disease or condition" is statutorily excluded from medical device classification. The January 2026 update expanded this to include software that displays health values, ranges, trends, and longitudinal summaries when contextualized around wellness.

This means the app can: remember health history, provide proactive wellness nudges, help prepare for doctor visits, book appointments, track medications, and surface health trends — all without FDA device classification.

**Three Bright Lines That Must Not Be Crossed:**
1. The app must **never identify or name a specific disease from patient data** (e.g., "your glucose levels indicate prediabetes" is a device; "your glucose readings have been trending higher than your usual pattern" is wellness).
2. The app must **never characterize outputs as abnormal, pathological, or diagnostic**.
3. The app must **never include clinical thresholds or specific treatment recommendations** (e.g., "you should start metformin" is a device; "you might want to discuss this trend with your endocrinologist" is wellness).

**Non-Device Clinical Decision Support (Secondary Path)**
If any features are positioned toward healthcare professionals, the four Cures Act CDS criteria apply: (1) does not process medical images or signals, (2) displays or analyzes medical information, (3) supports HCP recommendations, and (4) enables independent HCP review.

**Compliance requirement:** All AI-generated language must be reviewed by the CMO and legal counsel before deployment. A language review checklist should be maintained and audited quarterly to ensure no outputs cross into diagnostic territory.

### 7.2 Clinical Governance Structure

Research into Ada Health, K Health, Buoy Health, and the cautionary collapse of Babylon Health establishes the following as the industry-standard clinical governance framework:

**Required for Launch:**
- **Medical Advisory Board:** 5–10 physicians spanning primary care, endocrinology, gynecology, immunology, and relevant subspecialties. Meets quarterly to review AI outputs and clinical content.
- **Contracted Chief Medical Officer (CMO):** Licensed physician with sign-off authority on all health-related content the AI generates. Can be part-time/contracted at launch.
- **Quarterly Clinical Audits:** Review AI accuracy, safety, user-reported issues, and alignment with current clinical guidelines (USPSTF, ADA, ACOG, etc.).
- **Published Transparency Framework:** Document the AI's methodology, data sources, validation results, and known limitations. Required by California AB 2013 (effective January 2026) and builds user trust.

**Post-Launch (Within 6 Months):**
- **Peer-reviewed validation study** comparing AI recommendation quality against established benchmarks. Ada Health's 2020 BMJ Open study (99% condition coverage, 70.5% top-3 accuracy, 97% safety) demonstrates the credibility impact of published validation.
- **Adverse event reporting process** for cases where users report harm or near-miss related to AI recommendations.

**Key Cautionary Precedent — Babylon Health:**
Despite reaching a $4.2 billion valuation, Babylon Health collapsed partly due to overstating AI capabilities. A Lancet publication concluded their own study "did not offer convincing evidence" of their accuracy claims. In BMJ Open benchmarking, Babylon scored only 32% accuracy vs. Ada's 70.5%. Overclaiming AI accuracy is an existential risk.

### 7.3 Liability Framework

**Avoiding the Doctor-Patient Relationship:**
The strongest legal protection is ensuring no doctor-patient relationship is created. Courts have generally found that software companies have no duty to provide accurate diagnoses when licensing agreements stipulate that final decision-making rests with clinicians. However, the learned intermediary doctrine likely does **not** apply to direct-to-consumer products — the app provides recommendations directly to consumers without physician intermediation, meaning standard product liability and negligence frameworks apply.

**Disclaimer Requirements:**
"Not medical advice" disclaimers reduce but do not eliminate liability. Best practices based on legal analysis:
- Place disclaimers **at every interaction point** (not buried in Terms of Service).
- Use plain language, explicitly state no doctor-patient relationship exists.
- Always include a directive to consult qualified healthcare professionals.
- Ensure actual product conduct does not contradict the disclaimer (a system that presents synthesized health recommendations while stating "not medical advice" still creates representations that users act upon).

**Key Enforcement Precedent — Texas AG v. Pieces Technologies (September 2024):**
The first state enforcement action against a healthcare AI company. Pieces was targeted under the existing Deceptive Trade Practices Act (not AI-specific law) for making unsubstantiated accuracy claims. The settlement mandates: transparent disclosures about accuracy metrics, prohibition of unsubstantiated claims, and documentation for users including known limitations. Lesson: **existing consumer protection law applies fully to AI health companies, and accuracy overclaims are the highest-risk behavior.**

**Regulatory Environment — Ongoing Monitoring Required:**
- FTC's "Operation AI Comply" (launched September 2024) has intensified enforcement against deceptive AI claims, with 6(b) orders issued to seven major AI chatbot companies in September 2025.
- Eight new state comprehensive privacy laws took effect in 2025.
- Colorado's AI Act requires risk assessments for consumer-facing AI.
- Illinois has prohibited AI therapy outright.
- FDA's Digital Health Advisory Committee (inaugurated November 2024) signals increasing federal attention.

### 7.4 Insurance Requirements

| Policy | Recommended Limits | Estimated Annual Cost | Purpose |
|---|---|---|---|
| Technology E&O + Cyber Liability | $1–2M | $2,000–8,000 | Covers incorrect information, system failures, HIPAA breach exposure |
| Professional Liability | $1–3M | $3,000–10,000 | Required if employing/contracting clinicians for content review |
| General Commercial Liability | $1M/$2M | $500–1,500 | Baseline business coverage |
| Directors & Officers (D&O) | $1–5M | $2,000–10,000 | Protects executives from personal liability |

**Total estimated insurance budget:** $8,000–30,000 annually at launch, scaling with revenue and user base. Recommended carriers with digital health specialization: Liberty Mutual/Ironshore, Coalition, Corvus (Travelers).

### 7.5 Data Privacy & Security
- HIPAA compliance is mandatory for all user health data storage, transmission, and processing.
- All health data encrypted at rest (AES-256) and in transit (TLS 1.3).
- Users must have full control over their data: ability to view, export, and permanently delete all stored information.
- No user health data is used for model training without explicit, informed, opt-in consent.
- No user health data is sold to or shared with third parties, including advertisers and data brokers, under any circumstances.
- Transparent privacy policy written in plain language.
- SOC 2 Type II certification targeted within 12 months of launch.
- Compliance with California AB 2013 AI transparency requirements from Day 1.

---

## 8. Monetization Strategy

### Pricing Model: Freemium

**Free Tier:**
- Basic health Q&A (non-personalized or lightly personalized).
- Limited health profile (conditions and medications only).
- Up to 3 appointment prep sheets per month.

**Premium Tier ($19.99/month or $149.99/year):**
- Full persistent health memory and personalized Q&A.
- Unlimited appointment prep sheets.
- Proactive health nudges.
- Document Explainer (Explain This).
- Medication & supplement intelligence.
- Symptom logging with pattern detection.
- Longitudinal trend analysis.
- Health spending tracker.

**Family Tier ($29.99/month or $229.99/year):**
- All Premium features.
- Up to 5 family member profiles.
- Family health coordination features.
- Care team memory across all profiles.

### Pricing Validation
- Prices should be validated through user research and A/B testing before launch.
- Benchmark: comparable health/wellness subscriptions range from $10–30/month.
- The agentic and memory features justify premium pricing above typical wellness apps.

---

## 9. Key Metrics & Success Criteria

### North Star Metric
**Unprompted Week 2 Return Rate:** The percentage of users who open the app in their second week without being driven by a push notification. This measures whether the app has become genuinely valuable enough to be part of the user's life.

### Primary Metrics
| Metric | Target (6 months post-launch) |
|---|---|
| Day 7 retention | 50%+ |
| Day 30 retention | 35%+ |
| Monthly active users (MAU) | 50,000+ |
| Free-to-paid conversion rate | 8–12% |
| Monthly churn (paid subscribers) | < 5% |
| NPS score | 50+ |

### Secondary Metrics
| Metric | Target |
|---|---|
| Onboarding completion rate | 80%+ |
| Average check-ins per week (active users) | 3+ |
| Appointment prep sheet usage rate | 60%+ of users with upcoming appointments |
| Nudge engagement rate (tapped or acted on) | 30%+ |
| Document Explainer usage (monthly, paid users) | 2+ per user |

---

## 10. Launch Plan Overview

### Phase 1: Closed Beta (Month 1–2)
- 200–500 users recruited from PCOS and thyroid online communities (r/PCOS, r/hypothyroidism, condition-specific Facebook groups, Instagram health influencers in the PCOS/thyroid space).
- Core features: onboarding, health timeline, personalized Q&A, appointment prep, proactive nudges.
- Focus: validate Day 1 experience, measure retention, gather qualitative feedback.
- Recruitment strategy: genuine community participation first, organic discovery, direct outreach to active community members.

### Phase 2: Open Beta (Month 3–4)
- Expand to 5,000–10,000 users, still focused on chronic condition patients (broaden to diabetes, autoimmune).
- Add: medication intelligence, symptom logging, document explainer.
- Begin content marketing: short-form video, blog posts, and social threads targeting condition-specific health navigation pain points (e.g., "How to read your thyroid panel," "Questions to ask your endocrinologist about PCOS").
- Focus: validate free-to-paid conversion, optimize nudge effectiveness, stress test infrastructure.

### Phase 3: Public Launch (Month 5–6)
- Full marketing push targeting chronic condition communities.
- All Phase 1 and Phase 2 features live.
- Premium and Family tier billing active.
- Launch referral program with "invite someone you care about" framing (not transactional incentives).
- Focus: growth, retention optimization, community building.

### Phase 4: Expansion (Month 7–12)
- Expand to new parents segment (leverage high digital adoption rate of 72% and massive parenting communities).
- Launch family health coordination features.
- Begin Phase 2 agentic capabilities (semi-automated booking).
- Explore B2B channel (employer wellness programs, health plans).
- Publish peer-reviewed validation study for clinical credibility.

---

## 11. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Regulatory challenge (FDA classification) | High | Low | January 2026 FDA guidance confirms general wellness exemption applies. Maintain clear informational-only positioning. Never cross the three bright lines (no disease identification, no diagnostic characterization, no treatment recommendations). CMO sign-off on all AI language. Quarterly language audits. |
| Accuracy overclaims triggering enforcement | High | Medium | Texas AG v. Pieces Technologies (2024) precedent: existing consumer protection law applies to health AI. Never make unsubstantiated accuracy claims. Publish transparent methodology and known limitations per California AB 2013. FTC's Operation AI Comply is actively monitoring this space. |
| Low retention after initial novelty | High | Medium | Proactive nudges as core loop. Ensure Day 1 value. Longitudinal features that increase value over time. Target wedge (PCOS/thyroid) has chronic, compounding needs that naturally reward continued use. |
| AI hallucination causing health harm | High | Low | Ground responses in validated medical knowledge bases. Conservative disclaimers at every interaction point. Quarterly clinical audits. CMO review process. Published transparency framework. Carry $1–3M professional liability insurance. |
| Integration complexity for agentic features | Medium | High | Phase agentic capabilities. Start with low-integration actions (calendar links, phone links). Build partnerships incrementally. |
| User trust and data privacy concerns | High | Medium | Transparent privacy policy. No data selling. User data control. HIPAA compliance. SOC 2 Type II. Prominent security messaging. Brand positioning emphasizes warmth and trustworthiness. |
| Competitive pressure from big tech | Medium | High | Move fast on PCOS/thyroid wedge. Build deep retention and community before incumbents enter. Focus on personalization depth and multi-condition coordination as moat. B2B competitors (Livongo, Virta) can't easily pivot to D2C. |
| Liability from user harm following AI recommendation | High | Low | No doctor-patient relationship created. Disclaimers at every interaction. Professional liability + Tech E&O insurance ($1–3M). Clinical governance structure pre-launch. Emergency query routing to 911/crisis resources. |

---

## 12. Open Questions & Research Status

### Resolved Through Research

1. **~~Wedge audience selection~~** → **RESOLVED.** PCOS and thyroid patients are the optimal launch segment based on market size (15–17M), willingness to pay ($30–200+/month existing OOP spending), precise online reachability (500K+ Reddit members in condition-specific subs), and a massive D2C competitor gap (dominant players are all B2B-gated). Expansion path: diabetes → broader autoimmune → new parents → sandwich generation. See Section 3 for full analysis.

2. **~~Clinical review process~~** → **RESOLVED.** The FDA's January 2026 general wellness exemption provides a clear non-device pathway. Required clinical governance at launch: Medical Advisory Board (5–10 physicians, quarterly meetings), contracted CMO with sign-off authority, quarterly clinical audits, and a published transparency framework. Post-launch: peer-reviewed validation study within 6 months. Total insurance budget: $8,000–30,000/year. See Section 7 for full regulatory, liability, and governance framework.

4. **~~App name and brand identity~~** → **RESOLVED (Direction Set).** Research confirms: avoid "AI," "Med-," or "Health" in the name. Use abstract/metaphorical/human names. Top three candidates: Sage, Haven, Beacon. Visual identity: sage green/dusty mint palette, custom illustrations, rounded sans-serif typography. Tone: warm, personal, calm — like texting a knowledgeable friend. Final selection requires trademark search and consumer testing. See Section 2 (Brand Direction) for full analysis.

### Still Open

3. **EHR integration timeline:** When and how do we pursue integration with Epic, Cerner, and other EHR systems via FHIR APIs? This requires partnership exploration and technical feasibility assessment.
5. **International expansion:** Timeline and regulatory considerations for expansion beyond the US market. EU MDR, UK MHRA, and other regulatory frameworks differ significantly from the US FDA pathway outlined in Section 7.

---

*This document is a living artifact and should be updated as the product evolves through discovery, testing, and development.*
