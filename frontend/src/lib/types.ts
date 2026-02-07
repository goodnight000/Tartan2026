export type TriageLevel = "EMERGENT" | "URGENT_24H" | "ROUTINE";

export type ConditionItem = {
  name: string;
  diagnosed_year?: number;
  under_treatment?: boolean;
};

export type ProcedureItem = {
  name: string;
  approximate_year?: number;
};

export type MedItem = {
  name: string;
  dose?: string;
  frequency_per_day?: number;
  cadence?: "once_daily" | "multiple_daily" | "weekly" | "as_needed";
  start_date?: string;
  last_fill_date?: string;
  refill_days?: number;
};

export type AllergyItem = {
  allergen: string;
  reaction?: string;
  category?: "medication" | "food" | "other";
};

export type MedicalProfileV1 = {
  user_id: string;
  consent: {
    health_data_use: boolean;
    accepted_at?: string;
    privacy_version: "v1";
  };
  profile_mode: {
    managing_for: "self" | "someone_else";
    dependent_label?: string;
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
  conditions: ConditionItem[];
  procedures: ProcedureItem[];
  meds: MedItem[];
  allergies: AllergyItem[];
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
    preferred_days: string[];
    appointment_windows: string[];
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
      start: string;
      end: string;
    };
  };
  onboarding: {
    completed: boolean;
    completed_at?: string;
    step_last_seen: string;
    version: "v1";
  };
  conditions_legacy?: string[];
  allergies_legacy?: string[];
  updated_at: string;
};

export type MedicalProfile = MedicalProfileV1;

export type SymptomLog = {
  created_at: string;
  symptom_text: string;
  severity: number;
  onset_time?: string;
  notes?: string;
};

export type ActionLog = {
  created_at: string;
  action_type: string;
  status: string;
};

export type Reminder = {
  med_name: string;
  days_left: number;
  recommended_action: string;
};

export type ActionPlan = {
  tier: 1 | 2;
  tool: string;
  params: Record<string, unknown>;
  consent_prompt?: string;
};

export type ActionResult = {
  status: "success" | "failure";
  result: Record<string, unknown>;
};

export type HealthSignal = {
  id: string;
  title: string;
  value: string;
  trend?: "up" | "down" | "stable";
  lastSync: string;
  source: string;
  data?: number[];
};

export type MedicationCardData = {
  name: string;
  dose: string;
  frequency: string;
  status: "on-track" | "missed" | "due-soon";
  adherenceStreak: boolean[];
  nextDose?: string;
  daysUntilRefill?: number;
};
