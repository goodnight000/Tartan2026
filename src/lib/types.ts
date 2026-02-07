export type MedItem = {
  name: string;
  dose: string;
  frequency_per_day: number;
  start_date?: string;
  last_fill_date?: string;
  refill_days?: number;
};

export type MedicalProfile = {
  user_id: string;
  conditions: string[];
  allergies: string[];
  meds: MedItem[];
  family_history: string;
  preferences: {
    radius_miles: number;
    open_now: boolean;
    preferred_days: string[];
  };
  updated_at: string;
};

export type SymptomLog = {
  created_at: string;
  symptom_text: string;
  severity: number;
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
