# CarePilot Onboarding Process (Implementation Spec)

Version: `v1.0`
Owner: `Product + Frontend`
Audience: `Junior developer implementing onboarding end-to-end`
Status: `Ready to implement`

## 1) Goal
Create a **comprehensive but low-burden** onboarding flow that:
- captures minimum safety-critical context first,
- progressively collects additional details,
- saves every response immediately,
- allows skipping any non-critical field,
- supports future reminders, refill workflows, booking workflows, and profile-driven chat.

This spec removes judgment calls by defining:
- exact step order,
- exact fields and validation,
- exact UI copy,
- exact persistence behavior,
- exact completion rules.

## 2) Canonical Naming
Use **CarePilot** in all user-facing text.
Use `medical_profiles` collection and existing backend naming internally.

## 3) Non-Negotiable UX Rules
1. Show progress: `Step X of 7` + percent.
2. Show estimated time at top: `About 3-5 minutes`.
3. Every non-critical step has `Skip for now`.
4. Autosave every field change with debounce.
5. If user leaves and returns, resume where they left off.
6. Explain why each section is asked.
7. Never block completion except consent.
8. Use plain language, no medical jargon where avoidable.

## 4) Flow Overview

## 4.1 Step Sequence
1. `consent_transparency`
2. `profile_mode`
3. `health_baseline`
4. `medications_allergies`
5. `care_logistics`
6. `reminders_controls`
7. `review_confirm`

## 4.2 Completion Rule
Onboarding is complete when:
- consent accepted (`consent.health_data_use = true`), and
- user clicks `Start using CarePilot` on review screen.

All other fields can be empty.

## 4.3 Resume Rule
Store onboarding UI state in localStorage:
- key: `carepilot.onboarding_state.v1`
- shape:
```json
{
  "current_step": "care_logistics",
  "completed_steps": ["consent_transparency", "profile_mode", "health_baseline"],
  "last_saved_at": "2026-02-07T06:00:00.000Z"
}
```

## 5) Data Model (Profile)

## 5.1 Final Object Stored in `medical_profiles/{user_id}`
```ts
export type MedicalProfileV1 = {
  user_id: string;

  consent: {
    health_data_use: boolean; // required true to finish
    accepted_at?: string; // ISO
    privacy_version: "v1";
  };

  profile_mode: {
    managing_for: "self" | "someone_else";
    dependent_label?: string; // e.g. "Mom", "Dad", "Child"
    relationship?: "parent" | "child" | "spouse" | "other";
  };

  demographics: {
    year_of_birth?: number;
    sex_assigned_at_birth?: "female" | "male" | "intersex" | "prefer_not_to_say";
    height_cm?: number;
    weight_kg?: number;
  };

  lifestyle: {
    smoking_status?: "never" | "former" | "occasional" | "regular";
    alcohol_use?: "none" | "occasional" | "weekly" | "daily";
    activity_level?: "rarely" | "1_2_per_week" | "3_plus_per_week";
  };

  conditions: Array<{
    name: string;
    diagnosed_year?: number;
    under_treatment?: boolean;
  }>;

  procedures: Array<{
    name: string;
    approximate_year?: number;
  }>;

  meds: Array<{
    name: string;
    dose?: string;
    frequency_per_day?: number;
    cadence?: "once_daily" | "multiple_daily" | "weekly" | "as_needed";
    start_date?: string; // YYYY-MM-DD
    last_fill_date?: string; // YYYY-MM-DD
    refill_days?: number;
  }>;

  allergies: Array<{
    allergen: string;
    reaction?: string;
    category?: "medication" | "food" | "other";
  }>;

  family_history: {
    heart_disease?: boolean;
    stroke?: boolean;
    diabetes?: boolean;
    cancer?: boolean;
    hypertension?: boolean;
    none_or_unsure?: boolean;
  };

  preferences: {
    radius_miles: 3 | 5 | 10;
    preferred_pharmacy?: string;
    preferred_days: string[]; // e.g. ["monday", "tuesday"]
    appointment_windows: string[]; // e.g. ["09:00-12:00", "13:00-17:00"]
    provider_gender_preference?: "female" | "male" | "no_preference";
    care_priority: "closest_location" | "weekend_availability" | "specific_provider_gender" | "no_preference";
  };

  reminders: {
    med_runout: boolean;
    checkup_due: boolean;
    followup_nudges: boolean;
    reminder_mode: "all" | "medications_only";
    proactive_state: "active" | "paused";
    quiet_hours: {
      start: string; // HH:mm
      end: string;   // HH:mm
    };
  };

  onboarding: {
    completed: boolean;
    completed_at?: string;
    step_last_seen: string;
    version: "v1";
  };

  updated_at: string;
};
```

## 5.2 Backward Compatibility With Current App
Current app expects:
- `conditions: string[]`
- `allergies: string[]`
- `meds[]` with `frequency_per_day`
- `preferences` fields already present

During transition, also write compatibility mirrors:
- `conditions_legacy = conditions.map(c => c.name)`
- `allergies_legacy = allergies.map(a => a.allergen)`
- Keep `meds.frequency_per_day` populated when cadence selected:
  - `once_daily => 1`
  - `multiple_daily => 2` (default)
  - `weekly => 0.14`
  - `as_needed => 0`

## 6) Step-by-Step Screen Specs

## 6.1 Step 1 - Consent & Transparency
`screen_id`: `consent_transparency`

Headline: `Before we begin`
Body:
- `CarePilot stores your health information to personalize guidance and reminders.`
- `CarePilot does not replace a licensed medical professional or emergency services.`
- `You can review, edit, export, or delete your data in Profile.`

Field:
- `consent.health_data_use` (checkbox, required)
  - Label: `I agree to CarePilot storing and using my health information for personalized support.`

CTA:
- Primary: `Continue`
- Disabled until checkbox checked.

Validation:
- if unchecked and Continue clicked: `You must accept to continue. You can delete your data anytime in Profile.`

Persistence:
- save immediately on check/uncheck.

## 6.2 Step 2 - Who Is This Profile For?
`screen_id`: `profile_mode`

Why text: `This helps us phrase reminders correctly and avoid confusion in conversations.`

Fields:
- `profile_mode.managing_for` (radio, required)
  - `self`
  - `someone_else`
- if `someone_else`:
  - `profile_mode.dependent_label` (text, optional, max 40)
  - `profile_mode.relationship` (radio, optional)

CTA:
- Primary: `Continue`
- Secondary: none

Validation:
- `managing_for` required.

## 6.3 Step 3 - Health Baseline
`screen_id`: `health_baseline`

Why text: `These details improve context for safety checks and long-term tracking.`

Sections:

1) Demographics (all optional)
- `demographics.year_of_birth` (number)
  - range: `1900..currentYear`
- `demographics.sex_assigned_at_birth` (single select)
- `demographics.height_cm` (number)
  - range: `50..250`
- `demographics.weight_kg` (number)
  - range: `20..350`

2) Lifestyle (all optional)
- `lifestyle.smoking_status`
- `lifestyle.alcohol_use`
- `lifestyle.activity_level`

3) Conditions
Prompt: `Do you have any ongoing conditions that require management?`

Quick-pick chips (multi-select):
- `hypertension`, `diabetes_type_1`, `diabetes_type_2`, `asthma`, `heart_disease`, `high_cholesterol`, `thyroid_disorder`, `kidney_disease`, `gastrointestinal_condition`, `depression`, `anxiety`, `none`

Custom add input: `Add another condition`

For each condition (except `none`), optional detail fields:
- `diagnosed_year` (1900..currentYear)
- `under_treatment` (yes/no)

4) Procedures/Hospitalizations (optional)
- toggle question: `Any major surgeries or hospitalizations?`
- if yes: repeatable rows
  - `name` (required within row)
  - `approximate_year` (1900..currentYear)

CTA:
- Primary: `Continue`
- Secondary: `Skip for now`

Skip behavior:
- leaves all fields as null/empty.

## 6.4 Step 4 - Medications & Allergies
`screen_id`: `medications_allergies`

Why text: `Medication and allergy data is the most important input for refill support and safety checks.`

Section A: Medications (recommended)
- repeatable card
- minimum fields per row:
  - `name` (required to keep row)
- optional fields:
  - `dose` (text)
  - `cadence` (`once_daily`, `multiple_daily`, `weekly`, `as_needed`)
  - `frequency_per_day` (number, optional; show only when cadence is `multiple_daily`)
  - `start_date` (date)
  - `last_fill_date` (date)
  - `refill_days` (number: 1..365)

Rule:
- remove rows with blank name before final save.

Section B: Allergies (recommended)
Question:
- `Any medication or food allergies?`
  - `no`
  - `yes`

if yes: repeatable rows
- `allergen` (required)
- `reaction` (optional)
- `category` (`medication`, `food`, `other`)

CTA:
- Primary: `Continue`
- Secondary: `Skip for now`

## 6.5 Step 5 - Care Logistics
`screen_id`: `care_logistics`

Why text: `These preferences are used for care search and appointment suggestions.`

Fields:
- `preferences.care_priority` (single select, required)
  - `closest_location`
  - `weekend_availability`
  - `specific_provider_gender`
  - `no_preference`
- `preferences.provider_gender_preference` (conditional; show only if specific gender selected)
- `preferences.radius_miles` (segmented control, required): `3`, `5`, `10`
- `preferences.preferred_pharmacy` (text, optional)
- `preferences.preferred_days` (multi-select day chips, optional)
- `preferences.appointment_windows` (multi-select predefined windows, optional)
  - `08:00-12:00`, `12:00-17:00`, `17:00-20:00`

CTA:
- Primary: `Continue`
- Secondary: `Skip for now`

Validation:
- `care_priority` required unless skipped.
- `radius_miles` required unless skipped.

## 6.6 Step 6 - Reminders & Controls
`screen_id`: `reminders_controls`

Why text: `You control how often CarePilot checks in and when notifications are allowed.`

Fields:
- `reminders.med_runout` (checkbox)
- `reminders.checkup_due` (checkbox)
- `reminders.followup_nudges` (checkbox)
- `reminders.reminder_mode` (radio)
  - `all`
  - `medications_only`
- `reminders.proactive_state` (radio)
  - `active`
  - `paused`
- `reminders.quiet_hours.start` (time input)
- `reminders.quiet_hours.end` (time input)

Default values:
- `med_runout=true`
- `checkup_due=true`
- `followup_nudges=true`
- `reminder_mode=all`
- `proactive_state=active`
- `quiet_hours.start=22:00`
- `quiet_hours.end=08:00`

CTA:
- Primary: `Continue`
- Secondary: `Skip for now` (applies defaults)

## 6.7 Step 7 - Review & Confirm
`screen_id`: `review_confirm`

Show generated summary block:
`Here is what I understand so far. Please fix anything inaccurate.`

Summary template:
1. Conditions summary.
2. Medication summary.
3. Allergy summary.
4. Care preference summary.
5. Reminder settings summary.

Actions:
- `Edit previous step` buttons per section.
- checkbox: `Looks good`

CTA:
- Primary: `Start using CarePilot`
- Secondary: `Back`

Validation:
- `Looks good` checkbox required to finish.

On primary click:
- set `onboarding.completed=true`
- set `onboarding.completed_at=now`
- redirect `/app`

## 7) Persistence Rules

## 7.1 Save Frequency
Save profile on:
1. every field change (500ms debounce),
2. every step continue,
3. skip action,
4. final completion.

## 7.2 Save Function
Use existing `upsertProfile(user.uid, payload)` with merge semantics.

## 7.3 Required Save Behavior
- Show top-right status chip:
  - `Saving...`
  - `Saved`
  - `Save failed - Retry`
- On save failure:
  - keep user on current step,
  - show toast: `Could not save. Check connection and retry.`
  - auto-retry once after 2 seconds.

## 7.4 Data Integrity
- Never delete fields when skipping.
- Do not overwrite non-empty existing fields with empty strings.
- Trim whitespace from all text fields.

## 8) Accessibility Requirements
1. Every input has visible label.
2. Every step has `h1` heading.
3. Keyboard-only navigation works for entire flow.
4. Error text linked with `aria-describedby`.
5. Color is not the only error indicator.
6. Touch targets >= 44x44 px.

## 9) Exact Copy for Critical Safety Messaging
Use these exact strings:

- `CarePilot does not replace a licensed medical professional or emergency services.`
- `If you think you may have a medical emergency, call emergency services now.`
- `You can edit or delete your profile data at any time in Profile.`

## 10) Event Tracking (Analytics)

Emit events with these names and properties:

1. `onboarding_step_viewed`
- `step_id`
- `step_index`
- `has_existing_data` (boolean)

2. `onboarding_step_completed`
- `step_id`
- `duration_ms`
- `skipped` (boolean)

3. `onboarding_field_updated`
- `step_id`
- `field_key`
- `field_was_empty` (boolean)

4. `onboarding_completed`
- `total_duration_ms`
- `steps_skipped_count`
- `profile_mode`

## 11) Implementation Checklist

## 11.1 Frontend
- [ ] Extend form schema to include new sections in this spec.
- [ ] Add step IDs exactly as listed.
- [ ] Implement conditional fields exactly as listed.
- [ ] Implement autosave + save status chip.
- [ ] Implement review screen summary template.
- [ ] Implement resume behavior from localStorage.
- [ ] Keep `Skip for now` on steps 3-6.

## 11.2 Data Layer
- [ ] Update `frontend/src/lib/types.ts` with `MedicalProfileV1` fields.
- [ ] Ensure `upsertProfile` merge writes nested fields correctly.
- [ ] Preserve backward-compatible fields used by existing pages.

## 11.3 Profile Page
- [ ] Show newly captured sections.
- [ ] Allow edit by routing back to onboarding with deep-link step query: `/onboarding?step=<id>`.
- [ ] Show `last updated` timestamp.

## 12) QA Acceptance Criteria

1. User can complete onboarding with only consent checked.
2. User can skip any non-consent step without error.
3. Reloading browser restores step and data.
4. Each field edit persists to backend within 1 second under normal network.
5. Final review summary reflects saved values exactly.
6. `Start using CarePilot` marks onboarding complete and routes to `/app`.
7. Profile page shows saved onboarding data after completion.
8. Quiet hours default to `22:00-08:00` when skipped.
9. No step traps keyboard users.
10. Save error state appears and retries once automatically.

## 13) Out of Scope for This Spec (Do Not Build Now)
- Apple Health connection screens.
- Document upload onboarding.
- Insurance capture.
- OCR medication import.

These should be added as **just-in-time prompts** later when user first uses related features.

## 14) Developer Notes (Practical)
1. Build this in one onboarding route with local step state.
2. Keep existing `StepProgress` component.
3. Do not block on backend schema migration; Firestore allows flexible nested fields.
4. If legacy UI depends on old arrays (`conditions`, `allergies`), maintain mirrored values during save until all screens are migrated.
