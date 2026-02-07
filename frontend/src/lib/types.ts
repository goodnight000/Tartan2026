export type TriageLevel = "EMERGENT" | "URGENT_24H" | "ROUTINE";

export type MedItem = {
  name?: string;
  dose?: string;
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
  family_history?: string;
  preferences: {
    radius_miles: number;
    open_now: boolean;
    preferred_days: string[];
    preferred_pharmacy?: string;
    appointment_windows?: string[];
    reminder_mode?: "all" | "medications_only";
    proactive_state?: "active" | "paused";
    quiet_hours?: {
      start: string;
      end: string;
    };
  };
  updated_at: string;
};

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
