"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle, CircleAlert, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagInput } from "@/components/TagInput";
import { StepProgress } from "@/components/StepProgress";
import { useToast } from "@/components/ui/toast";
import { getProfile, upsertProfile } from "@/lib/firestore";
import { useAuthUser } from "@/lib/useAuth";
import type { MedicalProfile } from "@/lib/types";

const ONBOARDING_STATE_KEY = "carepilot.onboarding_state.v1";

const conditionSchema = z.object({
  name: z.string().optional(),
  diagnosed_year: z.coerce.number().optional(),
  under_treatment: z.boolean().optional(),
});

const procedureSchema = z.object({
  name: z.string().optional(),
  approximate_year: z.coerce.number().optional(),
});

const medSchema = z.object({
  name: z.string().optional(),
  dose: z.string().optional(),
  cadence: z.enum(["once_daily", "multiple_daily", "weekly", "as_needed"]).optional(),
  frequency_per_day: z.coerce.number().optional(),
  start_date: z.string().optional(),
  last_fill_date: z.string().optional(),
  refill_days: z.coerce.number().optional(),
});

const allergySchema = z.object({
  allergen: z.string().optional(),
  reaction: z.string().optional(),
  category: z.enum(["medication", "food", "other"]).optional(),
});

const schema = z.object({
  consent: z.object({
    health_data_use: z.boolean().default(false),
    accepted_at: z.string().optional(),
    privacy_version: z.literal("v1"),
  }),
  profile_mode: z.object({
    managing_for: z.enum(["self", "someone_else"]).optional(),
    dependent_label: z.string().optional(),
    relationship: z.enum(["parent", "child", "spouse", "other"]).optional(),
  }),
  demographics: z.object({
    first_name: z.string().max(40).optional(),
    year_of_birth: z.coerce.number().optional(),
    sex_assigned_at_birth: z.enum(["female", "male", "intersex", "prefer_not_to_say"]).optional(),
    height_cm: z.coerce.number().optional(),
    weight_kg: z.coerce.number().optional(),
  }),
  lifestyle: z.object({
    smoking_status: z.enum(["never", "former", "occasional", "regular"]).optional(),
    alcohol_use: z.enum(["none", "occasional", "weekly", "daily"]).optional(),
    activity_level: z.enum(["rarely", "1_2_per_week", "3_plus_per_week"]).optional(),
  }),
  conditions: z.array(conditionSchema),
  procedures: z.array(procedureSchema),
  meds: z.array(medSchema),
  allergies: z.array(allergySchema),
  family_history: z.object({
    heart_disease: z.boolean().optional(),
    stroke: z.boolean().optional(),
    diabetes: z.boolean().optional(),
    cancer: z.boolean().optional(),
    hypertension: z.boolean().optional(),
    none_or_unsure: z.boolean().optional(),
  }),
  preferences: z.object({
    radius_miles: z.coerce.number().optional(),
    preferred_pharmacy: z.string().optional(),
    preferred_days: z.array(z.string()),
    appointment_windows: z.array(z.string()),
    provider_gender_preference: z.enum(["female", "male", "no_preference"]).optional(),
    care_priority: z.enum([
      "closest_location",
      "weekend_availability",
      "specific_provider_gender",
      "no_preference",
    ]).optional(),
  }),
  reminders: z.object({
    med_runout: z.boolean(),
    checkup_due: z.boolean(),
    followup_nudges: z.boolean(),
    reminder_mode: z.enum(["all", "medications_only"]),
    proactive_state: z.enum(["active", "paused"]),
    quiet_hours: z.object({
      start: z.string(),
      end: z.string(),
    }),
  }),
});

type FormValues = z.infer<typeof schema>;

type StepId =
  | "consent_transparency"
  | "profile_mode"
  | "health_baseline"
  | "medications_allergies"
  | "care_logistics"
  | "reminders_controls"
  | "review_confirm";

type OnboardingState = {
  current_step: StepId;
  completed_steps: StepId[];
  last_saved_at: string;
};

const DEFAULT_REMINDERS = {
  med_runout: true,
  checkup_due: true,
  followup_nudges: true,
  reminder_mode: "all" as const,
  proactive_state: "active" as const,
  quiet_hours: {
    start: "22:00",
    end: "08:00",
  },
};

const DEFAULT_PROFILE_MODE = {
  managing_for: "self" as const,
};

const DEFAULT_PREFERENCES = {
  radius_miles: 5 as 5,
  preferred_pharmacy: "",
  preferred_days: [] as string[],
  appointment_windows: [] as string[],
  provider_gender_preference: undefined as "female" | "male" | "no_preference" | undefined,
  care_priority: "no_preference" as const,
};

const defaultValues: FormValues = {
  consent: {
    health_data_use: false,
    accepted_at: undefined,
    privacy_version: "v1",
  },
  profile_mode: {
    managing_for: undefined,
    dependent_label: "",
    relationship: undefined,
  },
  demographics: {
    first_name: "",
    year_of_birth: undefined,
    sex_assigned_at_birth: undefined,
    height_cm: undefined,
    weight_kg: undefined,
  },
  lifestyle: {
    smoking_status: undefined,
    alcohol_use: undefined,
    activity_level: undefined,
  },
  conditions: [],
  procedures: [],
  meds: [{ name: "", cadence: undefined }],
  allergies: [],
  family_history: {
    heart_disease: false,
    stroke: false,
    diabetes: false,
    cancer: false,
    hypertension: false,
    none_or_unsure: false,
  },
  preferences: {
    radius_miles: undefined,
    preferred_pharmacy: "",
    preferred_days: [],
    appointment_windows: [],
    provider_gender_preference: undefined,
    care_priority: undefined,
  },
  reminders: DEFAULT_REMINDERS,
};

const steps: { id: StepId; title: string; }[] = [
  { id: "consent_transparency", title: "Consent" },
  { id: "profile_mode", title: "Profile" },
  { id: "health_baseline", title: "Baseline" },
  { id: "medications_allergies", title: "Meds" },
  { id: "care_logistics", title: "Logistics" },
  { id: "reminders_controls", title: "Reminders" },
  { id: "review_confirm", title: "Review" },
];

const stepDescriptions: Record<StepId, { heading: string; subtitle: string; why: string; }> = {
  consent_transparency: {
    heading: "Before we begin",
    subtitle: "A quick confirmation so CarePilot can personalize guidance safely.",
    why: "We need consent to store your health information.",
  },
  profile_mode: {
    heading: "Who is this profile for?",
    subtitle: "Tell us who CarePilot is supporting.",
    why: "This helps us phrase reminders correctly and avoid confusion in conversations.",
  },
  health_baseline: {
    heading: "Health baseline",
    subtitle: "Optional details for safer checks and better context.",
    why: "These details improve context for safety checks and long-term tracking.",
  },
  medications_allergies: {
    heading: "Medications & allergies",
    subtitle: "The most important inputs for safety and refills.",
    why: "Medication and allergy data is the most important input for refill support and safety checks.",
  },
  care_logistics: {
    heading: "Care logistics",
    subtitle: "Preferences that help with search and scheduling.",
    why: "These preferences are used for care search and appointment suggestions.",
  },
  reminders_controls: {
    heading: "Reminders & controls",
    subtitle: "Set how often CarePilot checks in.",
    why: "You control how often CarePilot checks in and when notifications are allowed.",
  },
  review_confirm: {
    heading: "Review & confirm",
    subtitle: "Make sure we captured everything correctly.",
    why: "Here is what I understand so far. Please fix anything inaccurate.",
  },
};

const QUICK_CONDITIONS = [
  "hypertension",
  "diabetes_type_1",
  "diabetes_type_2",
  "asthma",
  "heart_disease",
  "high_cholesterol",
  "thyroid_disorder",
  "kidney_disease",
  "gastrointestinal_condition",
  "depression",
  "anxiety",
  "none",
] as const;

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const APPOINTMENT_WINDOWS = [
  "08:00-12:00",
  "12:00-17:00",
  "17:00-20:00",
] as const;

const CARE_PRIORITY_OPTIONS = [
  { value: "closest_location", label: "Closest location" },
  { value: "weekend_availability", label: "Weekend availability" },
  { value: "specific_provider_gender", label: "Specific provider gender" },
  { value: "no_preference", label: "No preference" },
] as const;

const FAMILY_HISTORY_KEYS = [
  "heart_disease",
  "stroke",
  "diabetes",
  "cancer",
  "hypertension",
  "none_or_unsure",
] as const;

const SELECT_CLASS =
  "w-full rounded-2xl border border-[color:var(--cp-line)] bg-white/85 px-4 py-2.5 text-sm text-[color:var(--cp-text)] focus:outline-none focus:ring-2 focus:ring-[color:var(--cp-primary)]/45 focus:border-[color:var(--cp-primary)]";

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value?: string | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function normalizeRadius(value?: number | null): 3 | 5 | 10 | undefined {
  if (value === 3 || value === 5 || value === 10) return value;
  return undefined;
}

function stripUndefined<T>(value: T): T {
  if (value === undefined) return value as T;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return (trimmed.length ? trimmed : undefined) as T;
  }
  if (Array.isArray(value)) {
    const next = value
      .map((item) => stripUndefined(item))
      .filter((item) => item !== undefined) as T;
    return next as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, val]) => {
      const cleaned = stripUndefined(val);
      if (cleaned !== undefined) result[key] = cleaned;
    });
    return result as T;
  }
  return value;
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

function loadOnboardingState(): OnboardingState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ONBOARDING_STATE_KEY);
    return raw ? (JSON.parse(raw) as OnboardingState) : null;
  } catch {
    return null;
  }
}

function persistOnboardingState(state: OnboardingState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ONBOARDING_STATE_KEY, JSON.stringify(state));
}

function buildPayload(
  values: FormValues,
  existing: MedicalProfile | null,
  stepId: StepId,
  complete: boolean
): Omit<MedicalProfile, "user_id" | "updated_at"> {
  const writeAll = complete || stepId === "review_confirm";
  const writeConsent = writeAll || stepId === "consent_transparency";
  const writeProfileMode = writeAll || stepId === "profile_mode";
  const writeBaseline = writeAll || stepId === "health_baseline";
  const writeMeds = writeAll || stepId === "medications_allergies";
  const writeLogistics = writeAll || stepId === "care_logistics";
  const writeReminders = writeAll || stepId === "reminders_controls";

  const cleanedConditions = values.conditions
    .map((condition) => ({
      name: normalizeText(condition.name) ?? "",
      diagnosed_year: condition.diagnosed_year,
      under_treatment: condition.under_treatment,
    }))
    .filter((condition) => condition.name.length > 0);

  const cleanedProcedures = values.procedures
    .map((procedure) => ({
      name: normalizeText(procedure.name) ?? "",
      approximate_year: procedure.approximate_year,
    }))
    .filter((procedure) => procedure.name.length > 0);

  const cleanedMeds = values.meds
    .map((med) => {
      const cadence = med.cadence;
      const baseFrequency = typeof med.frequency_per_day === "number" ? med.frequency_per_day : undefined;
      let derivedFrequency = baseFrequency;
      if (cadence === "once_daily") derivedFrequency = 1;
      if (cadence === "multiple_daily") derivedFrequency = baseFrequency ?? 2;
      if (cadence === "weekly") derivedFrequency = 0.14;
      if (cadence === "as_needed") derivedFrequency = 0;
      return {
        name: normalizeText(med.name) ?? "",
        dose: normalizeText(med.dose),
        cadence,
        frequency_per_day: derivedFrequency,
        start_date: normalizeText(med.start_date),
        last_fill_date: normalizeText(med.last_fill_date),
        refill_days: med.refill_days,
      };
    })
    .filter((med) => med.name.length > 0);

  const cleanedAllergies = values.allergies
    .map((allergy) => ({
      allergen: normalizeText(allergy.allergen) ?? "",
      reaction: normalizeText(allergy.reaction),
      category: allergy.category,
    }))
    .filter((allergy) => allergy.allergen.length > 0);

  const finalConditions = writeBaseline ? cleanedConditions : existing?.conditions ?? [];
  const finalProcedures = writeBaseline ? cleanedProcedures : existing?.procedures ?? [];
  const finalMeds = writeMeds ? cleanedMeds : existing?.meds ?? [];
  const finalAllergies = writeMeds ? cleanedAllergies : existing?.allergies ?? [];

  const healthDataUse = writeConsent
    ? values.consent.health_data_use ?? false
    : existing?.consent?.health_data_use ?? false;
  const acceptedAt = writeConsent
    ? healthDataUse && !existing?.consent?.accepted_at
      ? nowIso()
      : existing?.consent?.accepted_at
    : existing?.consent?.accepted_at;

  const profileMode: MedicalProfile["profile_mode"] =
    (writeProfileMode && values.profile_mode.managing_for
      ? {
          managing_for: values.profile_mode.managing_for,
          dependent_label:
            values.profile_mode.managing_for === "someone_else"
              ? normalizeText(values.profile_mode.dependent_label)
              : undefined,
          relationship:
            values.profile_mode.managing_for === "someone_else"
              ? values.profile_mode.relationship
              : undefined,
        }
      : undefined) ??
    existing?.profile_mode ??
    DEFAULT_PROFILE_MODE;

  const preferences: MedicalProfile["preferences"] = {
    radius_miles:
      normalizeRadius(writeLogistics ? values.preferences.radius_miles : undefined) ??
      normalizeRadius(existing?.preferences?.radius_miles) ??
      DEFAULT_PREFERENCES.radius_miles,
    preferred_pharmacy: writeLogistics
      ? normalizeText(values.preferences.preferred_pharmacy)
      : existing?.preferences?.preferred_pharmacy ?? DEFAULT_PREFERENCES.preferred_pharmacy,
    preferred_days: writeLogistics
      ? values.preferences.preferred_days
      : existing?.preferences?.preferred_days ?? DEFAULT_PREFERENCES.preferred_days,
    appointment_windows: writeLogistics
      ? values.preferences.appointment_windows
      : existing?.preferences?.appointment_windows ?? DEFAULT_PREFERENCES.appointment_windows,
    provider_gender_preference: writeLogistics
      ? values.preferences.provider_gender_preference
      : existing?.preferences?.provider_gender_preference ?? DEFAULT_PREFERENCES.provider_gender_preference,
    care_priority:
      (writeLogistics ? values.preferences.care_priority : undefined) ??
      existing?.preferences?.care_priority ??
      DEFAULT_PREFERENCES.care_priority,
  };

  const reminders: MedicalProfile["reminders"] = {
    med_runout:
      (writeReminders ? values.reminders.med_runout : undefined) ??
      existing?.reminders?.med_runout ??
      DEFAULT_REMINDERS.med_runout,
    checkup_due:
      (writeReminders ? values.reminders.checkup_due : undefined) ??
      existing?.reminders?.checkup_due ??
      DEFAULT_REMINDERS.checkup_due,
    followup_nudges:
      (writeReminders ? values.reminders.followup_nudges : undefined) ??
      existing?.reminders?.followup_nudges ??
      DEFAULT_REMINDERS.followup_nudges,
    reminder_mode:
      (writeReminders ? values.reminders.reminder_mode : undefined) ??
      existing?.reminders?.reminder_mode ??
      DEFAULT_REMINDERS.reminder_mode,
    proactive_state:
      (writeReminders ? values.reminders.proactive_state : undefined) ??
      existing?.reminders?.proactive_state ??
      DEFAULT_REMINDERS.proactive_state,
    quiet_hours: {
      start:
        (writeReminders ? values.reminders.quiet_hours.start : undefined) ??
        existing?.reminders?.quiet_hours?.start ??
        DEFAULT_REMINDERS.quiet_hours.start,
      end:
        (writeReminders ? values.reminders.quiet_hours.end : undefined) ??
        existing?.reminders?.quiet_hours?.end ??
        DEFAULT_REMINDERS.quiet_hours.end,
    },
  };

  const onboardingCompleted = complete || existing?.onboarding?.completed || false;

  return {
    consent: {
      health_data_use: healthDataUse,
      accepted_at: acceptedAt,
      privacy_version: "v1" as const,
    },
    profile_mode: profileMode,
    demographics: {
      first_name: writeProfileMode
        ? normalizeText(values.demographics.first_name)
        : existing?.demographics?.first_name,
      year_of_birth: writeBaseline
        ? values.demographics.year_of_birth
        : existing?.demographics?.year_of_birth,
      sex_assigned_at_birth:
        writeBaseline
          ? values.demographics.sex_assigned_at_birth
          : existing?.demographics?.sex_assigned_at_birth,
      height_cm: writeBaseline ? values.demographics.height_cm : existing?.demographics?.height_cm,
      weight_kg: writeBaseline ? values.demographics.weight_kg : existing?.demographics?.weight_kg,
    },
    lifestyle: {
      smoking_status: writeBaseline
        ? values.lifestyle.smoking_status
        : existing?.lifestyle?.smoking_status,
      alcohol_use: writeBaseline ? values.lifestyle.alcohol_use : existing?.lifestyle?.alcohol_use,
      activity_level: writeBaseline
        ? values.lifestyle.activity_level
        : existing?.lifestyle?.activity_level,
    },
    conditions: finalConditions,
    procedures: finalProcedures,
    meds: finalMeds,
    allergies: finalAllergies,
    family_history: {
      heart_disease: writeBaseline
        ? values.family_history.heart_disease
        : existing?.family_history?.heart_disease,
      stroke: writeBaseline ? values.family_history.stroke : existing?.family_history?.stroke,
      diabetes: writeBaseline ? values.family_history.diabetes : existing?.family_history?.diabetes,
      cancer: writeBaseline ? values.family_history.cancer : existing?.family_history?.cancer,
      hypertension: writeBaseline
        ? values.family_history.hypertension
        : existing?.family_history?.hypertension,
      none_or_unsure: writeBaseline
        ? values.family_history.none_or_unsure
        : existing?.family_history?.none_or_unsure,
    },
    preferences,
    reminders,
    onboarding: {
      completed: onboardingCompleted,
      completed_at: complete ? nowIso() : existing?.onboarding?.completed_at,
      step_last_seen: stepId,
      version: "v1" as const,
    },
    conditions_legacy: finalConditions
      .filter((condition) => condition.name !== "none")
      .map((condition) => condition.name),
    allergies_legacy: finalAllergies.map((allergy) => allergy.allergen),
  } satisfies Omit<MedicalProfile, "user_id" | "updated_at">;
}

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { push } = useToast();
  const { user, loading } = useAuthUser();

  const [ready, setReady] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<StepId[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showSuccess, setShowSuccess] = useState(false);
  const [existingProfile, setExistingProfile] = useState<MedicalProfile | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [hasProcedures, setHasProcedures] = useState(false);
  const [hasAllergies, setHasAllergies] = useState(false);

  const stepStartRef = useRef<number>(Date.now());
  const onboardingStartRef = useRef<number>(Date.now());
  const autosaveTimer = useRef<NodeJS.Timeout | null>(null);
  const skipAutosaveRef = useRef(true);
  const prevValuesRef = useRef<FormValues | null>(null);
  const lastSavedAtRef = useRef<string>(nowIso());
  const skippedCountRef = useRef(0);
  const hasInitializedRef = useRef(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: "onChange",
  });

  const step = steps[stepIndex];

  const conditionFields = useFieldArray({
    control: form.control,
    name: "conditions",
  });

  const procedureFields = useFieldArray({
    control: form.control,
    name: "procedures",
  });

  const medFields = useFieldArray({
    control: form.control,
    name: "meds",
  });

  const allergyFields = useFieldArray({
    control: form.control,
    name: "allergies",
  });

  const progressPercent = Math.round(((stepIndex + 1) / steps.length) * 100);

  const stepHasData = useCallback(
    (id: StepId, values: FormValues) => {
      switch (id) {
        case "consent_transparency":
          return Boolean(values.consent.health_data_use);
        case "profile_mode":
          return Boolean(
            values.profile_mode.managing_for ||
            values.profile_mode.dependent_label ||
            normalizeText(values.demographics.first_name)
          );
        case "health_baseline":
          return (
            Boolean(values.demographics.year_of_birth) ||
            Boolean(values.demographics.sex_assigned_at_birth) ||
            Boolean(values.lifestyle.smoking_status) ||
            values.conditions.length > 0 ||
            values.procedures.length > 0 ||
            Object.values(values.family_history).some((value) => value)
          );
        case "medications_allergies":
          return (
            values.meds.some((med) => normalizeText(med.name)) ||
            values.allergies.some((allergy) => normalizeText(allergy.allergen))
          );
        case "care_logistics":
          return (
            Boolean(values.preferences.care_priority) ||
            Boolean(values.preferences.radius_miles) ||
            values.preferences.preferred_days.length > 0
          );
        case "reminders_controls":
          return Boolean(values.reminders.reminder_mode);
        case "review_confirm":
          return false;
        default:
          return false;
      }
    },
    []
  );

  const trackEvent = useCallback(
    (name: string, props: Record<string, unknown>) => {
      if (typeof window === "undefined") return;
      const payload = { event: name, ...props };
      const dataLayer = (window as Window & { dataLayer?: Array<Record<string, unknown>> }).dataLayer;
      if (Array.isArray(dataLayer)) {
        dataLayer.push(payload);
      } else {
        window.dispatchEvent(new CustomEvent("carepilot:event", { detail: payload }));
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.info("CarePilot analytics", payload);
        }
      }
    },
    []
  );

  const setStepById = useCallback((id: StepId) => {
    const idx = steps.findIndex((s) => s.id === id);
    if (idx >= 0) setStepIndex(idx);
  }, []);

  const syncLocalState = useCallback(
    (override?: Partial<OnboardingState>) => {
      const state: OnboardingState = {
        current_step: step.id,
        completed_steps: completedSteps,
        last_saved_at: lastSavedAtRef.current,
        ...override,
      };
      persistOnboardingState(state);
    },
    [completedSteps, step.id]
  );

  useEffect(() => {
    if (loading) return;
    if (!user) {
      push({ title: "Please log in first", variant: "warning" });
      router.push("/login");
      return;
    }
    setReady(true);
  }, [loading, push, router, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const init = async () => {
      const profile = await getProfile(user.uid);
      if (cancelled) return;
      if (profile) {
        if (profile.onboarding?.completed) {
          push({
            title: "Intake already completed",
            description: "Update details in the Trust Center.",
            variant: "info",
          });
          router.replace("/profile");
          return;
        }
        setExistingProfile(profile);
        skipAutosaveRef.current = true;
        form.reset({
          ...defaultValues,
          consent: {
            health_data_use: profile.consent?.health_data_use ?? false,
            accepted_at: profile.consent?.accepted_at,
            privacy_version: "v1",
          },
          profile_mode: {
            managing_for: profile.profile_mode?.managing_for,
            dependent_label: profile.profile_mode?.dependent_label ?? "",
            relationship: profile.profile_mode?.relationship,
          },
          demographics: {
            first_name: profile.demographics?.first_name ?? "",
            year_of_birth: profile.demographics?.year_of_birth,
            sex_assigned_at_birth: profile.demographics?.sex_assigned_at_birth,
            height_cm: profile.demographics?.height_cm,
            weight_kg: profile.demographics?.weight_kg,
          },
          lifestyle: {
            smoking_status: profile.lifestyle?.smoking_status,
            alcohol_use: profile.lifestyle?.alcohol_use,
            activity_level: profile.lifestyle?.activity_level,
          },
          conditions: profile.conditions ?? [],
          procedures: profile.procedures ?? [],
          meds: profile.meds?.length ? profile.meds : defaultValues.meds,
          allergies: profile.allergies ?? [],
          family_history: {
            heart_disease: profile.family_history?.heart_disease ?? false,
            stroke: profile.family_history?.stroke ?? false,
            diabetes: profile.family_history?.diabetes ?? false,
            cancer: profile.family_history?.cancer ?? false,
            hypertension: profile.family_history?.hypertension ?? false,
            none_or_unsure: profile.family_history?.none_or_unsure ?? false,
          },
          preferences: {
            radius_miles: profile.preferences?.radius_miles,
            preferred_pharmacy: profile.preferences?.preferred_pharmacy ?? "",
            preferred_days: profile.preferences?.preferred_days ?? [],
            appointment_windows: profile.preferences?.appointment_windows ?? [],
            provider_gender_preference: profile.preferences?.provider_gender_preference,
            care_priority: profile.preferences?.care_priority,
          },
          reminders: {
            med_runout: profile.reminders?.med_runout ?? DEFAULT_REMINDERS.med_runout,
            checkup_due: profile.reminders?.checkup_due ?? DEFAULT_REMINDERS.checkup_due,
            followup_nudges: profile.reminders?.followup_nudges ?? DEFAULT_REMINDERS.followup_nudges,
            reminder_mode: profile.reminders?.reminder_mode ?? DEFAULT_REMINDERS.reminder_mode,
            proactive_state: profile.reminders?.proactive_state ?? DEFAULT_REMINDERS.proactive_state,
            quiet_hours: {
              start: profile.reminders?.quiet_hours?.start ?? DEFAULT_REMINDERS.quiet_hours.start,
              end: profile.reminders?.quiet_hours?.end ?? DEFAULT_REMINDERS.quiet_hours.end,
            },
          },
        });
        setHasProcedures((profile.procedures ?? []).length > 0);
        setHasAllergies((profile.allergies ?? []).length > 0);
      }
      skipAutosaveRef.current = false;
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [form, push, router, user]);

  useEffect(() => {
    const state = loadOnboardingState();
    const paramStep = searchParams?.get("step") as StepId | null;

    if (paramStep && steps.some((s) => s.id === paramStep)) {
      setStepById(paramStep);
      return;
    }

    if (hasInitializedRef.current) return;

    if (state?.current_step && steps.some((s) => s.id === state.current_step)) {
      setStepById(state.current_step);
      setCompletedSteps(state.completed_steps ?? []);
      hasInitializedRef.current = true;
      return;
    }

    if (existingProfile?.onboarding?.step_last_seen) {
      setStepById(existingProfile.onboarding.step_last_seen as StepId);
      hasInitializedRef.current = true;
      return;
    }

    if (existingProfile) {
      hasInitializedRef.current = true;
    }
  }, [existingProfile, searchParams, setStepById]);

  useEffect(() => {
    syncLocalState();
    const values = form.getValues();
    trackEvent("onboarding_step_viewed", {
      step_id: step.id,
      step_index: stepIndex + 1,
      has_existing_data: stepHasData(step.id, values),
    });
    stepStartRef.current = Date.now();
  }, [form, step.id, stepIndex, stepHasData, syncLocalState, trackEvent]);

  const performSave = useCallback(
    async (values: FormValues, options: { retry?: boolean; complete?: boolean }) => {
      if (!user) return;
      setSaveStatus("saving");
      const payload = buildPayload(values, existingProfile, step.id, Boolean(options.complete));
      const sanitized = stripUndefined(payload);
      try {
        await upsertProfile(user.uid, sanitized);
        setSaveStatus("saved");
        lastSavedAtRef.current = nowIso();
        syncLocalState({ last_saved_at: lastSavedAtRef.current });
        setExistingProfile((prev) => ({
          ...(prev ?? ({} as MedicalProfile)),
          ...sanitized,
          user_id: user.uid,
          updated_at: lastSavedAtRef.current,
        }));
        return true;
      } catch (error) {
        setSaveStatus("error");
        push({
          title: "Could not save",
          description: "Check connection and retry.",
          variant: "error",
        });
        if (options.retry) {
          setTimeout(() => {
            void performSave(values, { retry: false, complete: options.complete });
          }, 2000);
        }
        return false;
      }
    },
    [existingProfile, push, step.id, syncLocalState, user]
  );

  useEffect(() => {
    const subscription = form.watch((values, meta) => {
      const currentValues = values as FormValues;
      if (skipAutosaveRef.current) {
        prevValuesRef.current = currentValues;
        return;
      }
      if (!ready || !user) return;

      if (meta?.name) {
        const previous = prevValuesRef.current;
        const currentValue = meta.name
          .split(".")
          .reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), values);
        const previousValue = meta.name
          .split(".")
          .reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), previous ?? undefined);
        trackEvent("onboarding_field_updated", {
          step_id: step.id,
          field_key: meta.name,
          field_was_empty: isEmptyValue(previousValue),
        });
      }

      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        void performSave(currentValues, { retry: true });
      }, 500);

      prevValuesRef.current = currentValues;
    });

    return () => subscription.unsubscribe();
  }, [form, performSave, ready, step.id, trackEvent, user]);

  const advanceStep = (skipped: boolean) => {
    const duration = Date.now() - stepStartRef.current;
    trackEvent("onboarding_step_completed", {
      step_id: step.id,
      duration_ms: duration,
      skipped,
    });

    if (skipped) skippedCountRef.current += 1;
    if (!completedSteps.includes(step.id)) {
      setCompletedSteps((prev) => [...prev, step.id]);
    }

    setSaving(true);
    const cleaned = {
      ...values,
      meds: values.meds.filter((med) => med.name?.trim()),
    };
    const timezone =
      Intl.DateTimeFormat().resolvedOptions().timeZone?.trim() || "UTC";

    try {
      await upsertProfile(user.uid, cleaned);

      let idToken: string;
      try {
        idToken = await user.getIdToken();
      } catch {
        throw new Error(
          "Profile saved locally, but backend sync could not verify your session. Please log in again."
        );
      }

      const syncResponse = await fetch("/api/profile/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...cleaned,
          timezone,
          idToken,
        }),
      });
      if (!syncResponse.ok) {
        let detail = "Backend profile sync failed.";
        try {
          const payload = await syncResponse.json();
          if (payload && typeof payload.message === "string" && payload.message.trim()) {
            detail = payload.message.trim();
          }
        } catch {
          // Ignore parse failures and keep generic fallback.
        }
        throw new Error(`Profile saved locally, but backend sync failed: ${detail}`);
      }

      if (typeof window !== "undefined") {
        window.localStorage.removeItem(DRAFT_KEY);
      }
    }
    if (step.id === "review_confirm") {
      if (!reviewConfirmed) {
        push({ title: "Please confirm", description: "Check Looks good to continue.", variant: "warning" });
        return;
      }
      if (!values.consent.health_data_use) {
        push({ title: "Consent required", description: "Consent is required to finish onboarding.", variant: "warning" });
        return;
      }
      const totalDuration = Date.now() - onboardingStartRef.current;
      trackEvent("onboarding_completed", {
        total_duration_ms: totalDuration,
        steps_skipped_count: skippedCountRef.current,
        profile_mode: values.profile_mode.managing_for ?? "self",
      });
      const saved = await performSave(values, { retry: true, complete: true });
      if (!saved) return;
      setShowSuccess(true);
      setTimeout(() => {
        router.push("/app");
      }, 1200);
      return;
    }

    const saved = await performSave(values, { retry: true });
    if (!saved) return;
    advanceStep(false);
  };

  const handleSkip = async () => {
    if (step.id === "reminders_controls") {
      form.setValue("reminders", DEFAULT_REMINDERS);
    }
    const saved = await performSave(form.getValues(), { retry: true });
    if (!saved) return;
    advanceStep(true);
  };

  const toggleCondition = (name: string) => {
    const current = form.getValues("conditions");
    const index = current.findIndex((c) => c.name === name);
    if (name === "none") {
      if (index >= 0) {
        conditionFields.replace(current.filter((c) => c.name !== "none"));
        return;
      }
      conditionFields.replace([{ name: "none" }]);
      return;
    }
    if (index >= 0) {
      conditionFields.remove(index);
      return;
    }
    const withoutNone = current.filter((c) => c.name !== "none");
    conditionFields.replace([...withoutNone, { name }]);
  };

  const togglePreferredDay = (day: string) => {
    const current = form.getValues("preferences.preferred_days");
    if (current.includes(day)) {
      form.setValue("preferences.preferred_days", current.filter((d) => d !== day));
    } else {
      form.setValue("preferences.preferred_days", [...current, day]);
    }
  };

  const toggleWindow = (windowValue: string) => {
    const current = form.getValues("preferences.appointment_windows");
    if (current.includes(windowValue)) {
      form.setValue("preferences.appointment_windows", current.filter((w) => w !== windowValue));
    } else {
      form.setValue("preferences.appointment_windows", [...current, windowValue]);
    }
  };

  const watchedValues = form.watch();

  const summary = useMemo(() => {
    const values = watchedValues;
    const conditions = values.conditions.filter((c) => normalizeText(c.name));
    const meds = values.meds.filter((m) => normalizeText(m.name));
    const allergies = values.allergies.filter((a) => normalizeText(a.allergen));
    const carePriority = values.preferences.care_priority ?? "no_preference";
    const radius = values.preferences.radius_miles ? `${values.preferences.radius_miles} miles` : "not set";

    return {
      conditions:
        conditions.length === 0
          ? "No ongoing conditions noted."
          : conditions.map((c) => c.name).join(", "),
      meds:
        meds.length === 0
          ? "No medications listed."
          : meds
              .map((m) => `${m.name}${m.dose ? ` (${m.dose})` : ""}`)
              .join(", "),
      allergies:
        allergies.length === 0
          ? "No allergies listed."
          : allergies
              .map((a) => `${a.allergen}${a.reaction ? ` (${a.reaction})` : ""}`)
              .join(", "),
      care: `Priority: ${carePriority.replace(/_/g, " ")}. Radius: ${radius}.`,
      reminders: `Mode: ${values.reminders.reminder_mode}. Quiet hours ${values.reminders.quiet_hours.start}–${values.reminders.quiet_hours.end}.`,
    };
  }, [watchedValues]);

  if (!ready) {
    return <div className="text-sm text-[color:var(--cp-muted)]">Checking session...</div>;
  }

  if (showSuccess) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center py-20 text-center"
      >
        <CheckCircle className="h-16 w-16 text-[color:var(--cp-success)]" />
        <h2 className="mt-4 text-3xl">CarePilot onboarding complete</h2>
        <p className="mt-2 text-[color:var(--cp-muted)]">Redirecting to your workspace...</p>
      </motion.div>
    );
  }

  const statusChip =
    saveStatus === "saving"
      ? { label: "Saving...", tone: "status-chip--warn" }
      : saveStatus === "error"
        ? { label: "Save failed - Retry", tone: "status-chip--danger" }
        : saveStatus === "saved"
          ? { label: "Saved", tone: "status-chip--success" }
          : { label: "", tone: "" };

  const continueDisabled =
    step.id === "consent_transparency" && !form.watch("consent.health_data_use");

  return (
    <div className="space-y-5">
      <Card className="reveal space-y-4 p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="editorial-eyebrow">CarePilot Onboarding</p>
            <h1 className="panel-title text-[clamp(2rem,5vw,3.4rem)] leading-[0.95]">Step {stepIndex + 1} of {steps.length}</h1>
            <p className="panel-subtitle">About 3-5 minutes</p>
          </div>
          {statusChip.label && (
            <span className={`status-chip ${statusChip.tone}`}>{statusChip.label}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <StepProgress steps={steps} currentStep={stepIndex} />
          <div className="flex items-center gap-2 text-xs font-semibold text-[color:var(--cp-muted)]">
            <Sparkles className="h-4 w-4 text-[color:var(--cp-accent)]" aria-hidden="true" />
            {progressPercent}% complete
          </div>
        </div>
      </Card>

      <Card className="reveal space-y-6 p-7" style={{ animationDelay: "90ms" }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2 }}
          >
            <div className="space-y-2">
              <h2 className="text-3xl leading-none">{stepDescriptions[step.id].heading}</h2>
              <p className="panel-subtitle">{stepDescriptions[step.id].subtitle}</p>
              <p className="text-sm text-[color:var(--cp-muted)]">{stepDescriptions[step.id].why}</p>
            </div>

            <form className="mt-6 space-y-6" onSubmit={(event) => event.preventDefault()}>
              {step.id === "consent_transparency" && (
                <div className="space-y-5">
                  <div className="space-y-2 text-sm text-[color:var(--cp-text)]">
                    <p>CarePilot stores your health information to personalize guidance and reminders.</p>
                    <p>CarePilot does not replace a licensed medical professional or emergency services.</p>
                    <p>You can review, edit, export, or delete your data in Profile.</p>
                    <p className="font-semibold text-[color:var(--cp-danger)]">If you think you may have a medical emergency, call emergency services now.</p>
                    <p>You can edit or delete your profile data at any time in Profile.</p>
                  </div>
                  <label className="flex items-start gap-3 rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-4 text-sm">
                    <input
                      type="checkbox"
                      {...form.register("consent.health_data_use")}
                      aria-describedby="consent-error"
                    />
                    <span>I agree to CarePilot storing and using my health information for personalized support.</span>
                  </label>
                  {!form.watch("consent.health_data_use") && (
                    <p className="text-xs text-[color:var(--cp-muted)]">
                      Check the box to enable Continue.
                    </p>
                  )}
                  {form.formState.errors.consent?.health_data_use && (
                    <p id="consent-error" className="flex items-center gap-2 text-sm text-[color:var(--cp-danger)]">
                      <CircleAlert className="h-4 w-4" aria-hidden="true" />
                      {form.formState.errors.consent.health_data_use.message}
                    </p>
                  )}
                </div>
              )}

              {step.id === "profile_mode" && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="first-name">First name</Label>
                    <Input id="first-name" maxLength={40} placeholder="Jane" {...form.register("demographics.first_name")} />
                  </div>
                  <div className="space-y-3">
                    <Label>Profile is for</Label>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Button
                        type="button"
                        variant={form.watch("profile_mode.managing_for") === "self" ? "default" : "outline"}
                        onClick={() => form.setValue("profile_mode.managing_for", "self")}
                      >
                        Myself
                      </Button>
                      <Button
                        type="button"
                        variant={form.watch("profile_mode.managing_for") === "someone_else" ? "default" : "outline"}
                        onClick={() => form.setValue("profile_mode.managing_for", "someone_else")}
                      >
                        Someone else
                      </Button>
                    </div>
                    {form.formState.errors.profile_mode?.managing_for && (
                      <p className="text-sm text-[color:var(--cp-danger)]">{form.formState.errors.profile_mode.managing_for.message}</p>
                    )}
                  </div>

                  {form.watch("profile_mode.managing_for") === "someone_else" && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="dependent-label">Label (optional)</Label>
                        <Input id="dependent-label" maxLength={40} {...form.register("profile_mode.dependent_label")} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="relationship">Relationship (optional)</Label>
                        <select id="relationship" className={SELECT_CLASS} {...form.register("profile_mode.relationship")}>
                          <option value="">Select</option>
                          <option value="parent">Parent</option>
                          <option value="child">Child</option>
                          <option value="spouse">Spouse</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step.id === "health_baseline" && (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-[color:var(--cp-text)]">Demographics</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="year-of-birth">Year of birth</Label>
                        <Input id="year-of-birth" type="number" min={1900} max={new Date().getFullYear()} {...form.register("demographics.year_of_birth")} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="sex-assigned">Sex assigned at birth</Label>
                        <select id="sex-assigned" className={SELECT_CLASS} {...form.register("demographics.sex_assigned_at_birth")}>
                          <option value="">Select</option>
                          <option value="female">Female</option>
                          <option value="male">Male</option>
                          <option value="intersex">Intersex</option>
                          <option value="prefer_not_to_say">Prefer not to say</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="height">Height (cm)</Label>
                        <Input id="height" type="number" min={50} max={250} {...form.register("demographics.height_cm")} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="weight">Weight (kg)</Label>
                        <Input id="weight" type="number" min={20} max={350} {...form.register("demographics.weight_kg")} />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-[color:var(--cp-text)]">Lifestyle</h3>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="smoking">Smoking status</Label>
                        <select id="smoking" className={SELECT_CLASS} {...form.register("lifestyle.smoking_status")}>
                          <option value="">Select</option>
                          <option value="never">Never</option>
                          <option value="former">Former</option>
                          <option value="occasional">Occasional</option>
                          <option value="regular">Regular</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="alcohol">Alcohol use</Label>
                        <select id="alcohol" className={SELECT_CLASS} {...form.register("lifestyle.alcohol_use")}>
                          <option value="">Select</option>
                          <option value="none">None</option>
                          <option value="occasional">Occasional</option>
                          <option value="weekly">Weekly</option>
                          <option value="daily">Daily</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="activity">Activity level</Label>
                        <select id="activity" className={SELECT_CLASS} {...form.register("lifestyle.activity_level")}>
                          <option value="">Select</option>
                          <option value="rarely">Rarely</option>
                          <option value="1_2_per_week">1-2 per week</option>
                          <option value="3_plus_per_week">3+ per week</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-[color:var(--cp-text)]">
                      Do you have any ongoing conditions that require management?
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {QUICK_CONDITIONS.map((condition) => {
                        const active = form.watch("conditions").some((c) => c.name === condition);
                        return (
                          <Button
                            key={condition}
                            type="button"
                            size="sm"
                            variant={active ? "default" : "outline"}
                            onClick={() => toggleCondition(condition)}
                          >
                            {condition.replace(/_/g, " ")}
                          </Button>
                        );
                      })}
                    </div>
                    <div className="max-w-md">
                      <TagInput
                        label="Add another condition"
                        value={form
                          .watch("conditions")
                          .map((c) => c.name)
                          .filter((name): name is string => Boolean(name))}
                        onChange={(next) => {
                          const unique = Array.from(new Set(next));
                          const existing = form.getValues("conditions");
                          conditionFields.replace(
                            unique.map((name) => existing.find((c) => c.name === name) ?? { name })
                          );
                        }}
                        placeholder="Add another condition"
                      />
                    </div>
                    {conditionFields.fields
                      .filter((field) => field.name && field.name !== "none")
                      .map((field, index) => (
                        <div key={field.id} className="grid gap-3 rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-4 md:grid-cols-3">
                          <div className="space-y-2 md:col-span-1">
                            <Label>Condition</Label>
                            <Input {...form.register(`conditions.${index}.name`)} />
                          </div>
                          <div className="space-y-2">
                            <Label>Diagnosed year</Label>
                            <Input type="number" min={1900} max={new Date().getFullYear()} {...form.register(`conditions.${index}.diagnosed_year`)} />
                          </div>
                          <div className="space-y-2">
                            <Label>Under treatment?</Label>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant={form.watch(`conditions.${index}.under_treatment`) === true ? "default" : "outline"}
                                onClick={() => form.setValue(`conditions.${index}.under_treatment`, true)}
                              >
                                Yes
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant={form.watch(`conditions.${index}.under_treatment`) === false ? "default" : "outline"}
                                onClick={() => form.setValue(`conditions.${index}.under_treatment`, false)}
                              >
                                No
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-[color:var(--cp-text)]">Procedures & hospitalizations</h3>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={hasProcedures}
                        onChange={(event) => {
                          const next = event.target.checked;
                          setHasProcedures(next);
                          if (!next) procedureFields.replace([]);
                        }}
                      />
                      Any major surgeries or hospitalizations?
                    </label>
                    {hasProcedures && (
                      <div className="space-y-3">
                        {procedureFields.fields.map((field, index) => (
                          <div key={field.id} className="grid gap-3 rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-4 md:grid-cols-3">
                            <div className="space-y-2 md:col-span-2">
                              <Label>Procedure name</Label>
                              <Input {...form.register(`procedures.${index}.name`)} />
                            </div>
                            <div className="space-y-2">
                              <Label>Approximate year</Label>
                              <Input type="number" min={1900} max={new Date().getFullYear()} {...form.register(`procedures.${index}.approximate_year`)} />
                            </div>
                            <div>
                              <Button type="button" variant="ghost" onClick={() => procedureFields.remove(index)}>
                                Remove
                              </Button>
                            </div>
                          </div>
                        ))}
                        <Button type="button" variant="outline" onClick={() => procedureFields.append({ name: "" })}>
                          Add procedure
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-[color:var(--cp-text)]">Family history</h3>
                    <div className="grid gap-2 md:grid-cols-2">
                      {FAMILY_HISTORY_KEYS.map((item) => (
                        <label key={item} className="flex items-center gap-2 text-sm">
                          <input type="checkbox" {...form.register(`family_history.${item}`)} />
                          {item.replace(/_/g, " ")}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {step.id === "medications_allergies" && (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-[color:var(--cp-text)]">Medications (recommended)</h3>
                    {medFields.fields.map((field, index) => (
                      <div key={field.id} className="grid gap-3 rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-4 md:grid-cols-3">
                        <div className="space-y-2">
                          <Label>Medication name</Label>
                          <Input {...form.register(`meds.${index}.name`)} />
                        </div>
                        <div className="space-y-2">
                          <Label>Dose</Label>
                          <Input {...form.register(`meds.${index}.dose`)} />
                        </div>
                        <div className="space-y-2">
                          <Label>Cadence</Label>
                          <select className={SELECT_CLASS} {...form.register(`meds.${index}.cadence`)}>
                            <option value="">Select</option>
                            <option value="once_daily">Once daily</option>
                            <option value="multiple_daily">Multiple times daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="as_needed">As needed</option>
                          </select>
                        </div>
                        {form.watch(`meds.${index}.cadence`) === "multiple_daily" && (
                          <div className="space-y-2">
                            <Label>Frequency per day</Label>
                            <Input type="number" min={1} max={12} {...form.register(`meds.${index}.frequency_per_day`)} />
                          </div>
                        )}
                        <div className="space-y-2">
                          <Label>Start date</Label>
                          <Input type="date" {...form.register(`meds.${index}.start_date`)} />
                        </div>
                        <div className="space-y-2">
                          <Label>Last fill date</Label>
                          <Input type="date" {...form.register(`meds.${index}.last_fill_date`)} />
                        </div>
                        <div className="space-y-2">
                          <Label>Refill days</Label>
                          <Input type="number" min={1} max={365} {...form.register(`meds.${index}.refill_days`)} />
                        </div>
                        <div>
                          <Button type="button" variant="ghost" onClick={() => medFields.remove(index)}>
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                    <Button type="button" variant="outline" onClick={() => medFields.append({ name: "" })}>
                      Add medication
                    </Button>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-[color:var(--cp-text)]">Any medication or food allergies?</h3>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={hasAllergies ? "outline" : "default"}
                        onClick={() => {
                          setHasAllergies(false);
                          allergyFields.replace([]);
                        }}
                      >
                        No
                      </Button>
                      <Button type="button" size="sm" variant={hasAllergies ? "default" : "outline"} onClick={() => setHasAllergies(true)}>
                        Yes
                      </Button>
                    </div>
                    {hasAllergies && (
                      <div className="space-y-3">
                        {allergyFields.fields.map((field, index) => (
                          <div key={field.id} className="grid gap-3 rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-4 md:grid-cols-3">
                            <div className="space-y-2">
                              <Label>Allergen</Label>
                              <Input {...form.register(`allergies.${index}.allergen`)} />
                            </div>
                            <div className="space-y-2">
                              <Label>Reaction</Label>
                              <Input {...form.register(`allergies.${index}.reaction`)} />
                            </div>
                            <div className="space-y-2">
                              <Label>Category</Label>
                              <select className={SELECT_CLASS} {...form.register(`allergies.${index}.category`)}>
                                <option value="">Select</option>
                                <option value="medication">Medication</option>
                                <option value="food">Food</option>
                                <option value="other">Other</option>
                              </select>
                            </div>
                            <div>
                              <Button type="button" variant="ghost" onClick={() => allergyFields.remove(index)}>
                                Remove
                              </Button>
                            </div>
                          </div>
                        ))}
                        <Button type="button" variant="outline" onClick={() => allergyFields.append({ allergen: "" })}>
                          Add allergy
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {step.id === "care_logistics" && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label>Care priority</Label>
                    <div className="grid gap-2 md:grid-cols-2">
                      {CARE_PRIORITY_OPTIONS.map((option) => (
                        <Button
                          key={option.value}
                          type="button"
                          variant={form.watch("preferences.care_priority") === option.value ? "default" : "outline"}
                          onClick={() => form.setValue("preferences.care_priority", option.value)}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </div>
                    {form.formState.errors.preferences?.care_priority && (
                      <p className="text-sm text-[color:var(--cp-danger)]">
                        {form.formState.errors.preferences.care_priority.message}
                      </p>
                    )}
                  </div>

                  {form.watch("preferences.care_priority") === "specific_provider_gender" && (
                    <div className="space-y-2">
                      <Label>Provider gender preference</Label>
                      <div className="grid gap-2 md:grid-cols-3">
                        {["female", "male", "no_preference"].map((option) => (
                          <Button
                            key={option}
                            type="button"
                            variant={form.watch("preferences.provider_gender_preference") === option ? "default" : "outline"}
                            onClick={() => form.setValue("preferences.provider_gender_preference", option as "female" | "male" | "no_preference")}
                          >
                            {option.replace(/_/g, " ")}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Preferred radius</Label>
                    <div className="flex gap-2">
                      {[3, 5, 10].map((radius) => (
                        <Button
                          key={radius}
                          type="button"
                          variant={form.watch("preferences.radius_miles") === radius ? "default" : "outline"}
                          onClick={() => form.setValue("preferences.radius_miles", radius)}
                        >
                          {radius} miles
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pharmacy">Preferred pharmacy</Label>
                    <Input id="pharmacy" {...form.register("preferences.preferred_pharmacy")} />
                  </div>

                  <div className="space-y-2">
                    <Label>Preferred days</Label>
                    <div className="flex flex-wrap gap-2">
                      {DAYS.map((day) => (
                        <Button
                          key={day}
                          type="button"
                          size="sm"
                          variant={form.watch("preferences.preferred_days").includes(day) ? "default" : "outline"}
                          onClick={() => togglePreferredDay(day)}
                        >
                          {day.slice(0, 3).toUpperCase()}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Appointment windows</Label>
                    <div className="flex flex-wrap gap-2">
                      {APPOINTMENT_WINDOWS.map((windowValue) => (
                        <Button
                          key={windowValue}
                          type="button"
                          size="sm"
                          variant={form.watch("preferences.appointment_windows").includes(windowValue) ? "default" : "outline"}
                          onClick={() => toggleWindow(windowValue)}
                        >
                          {windowValue}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {step.id === "reminders_controls" && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label>Reminder types</Label>
                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" {...form.register("reminders.med_runout")} />
                        Medication runout
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" {...form.register("reminders.checkup_due")} />
                        Checkup due
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" {...form.register("reminders.followup_nudges")} />
                        Follow-up nudges
                      </label>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Reminder mode</Label>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Button
                        type="button"
                        variant={form.watch("reminders.reminder_mode") === "all" ? "default" : "outline"}
                        onClick={() => form.setValue("reminders.reminder_mode", "all")}
                      >
                        All
                      </Button>
                      <Button
                        type="button"
                        variant={form.watch("reminders.reminder_mode") === "medications_only" ? "default" : "outline"}
                        onClick={() => form.setValue("reminders.reminder_mode", "medications_only")}
                      >
                        Medications only
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Proactive state</Label>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Button
                        type="button"
                        variant={form.watch("reminders.proactive_state") === "active" ? "default" : "outline"}
                        onClick={() => form.setValue("reminders.proactive_state", "active")}
                      >
                        Active
                      </Button>
                      <Button
                        type="button"
                        variant={form.watch("reminders.proactive_state") === "paused" ? "default" : "outline"}
                        onClick={() => form.setValue("reminders.proactive_state", "paused")}
                      >
                        Paused
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="quiet-start">Quiet hours start</Label>
                      <Input id="quiet-start" type="time" {...form.register("reminders.quiet_hours.start")} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="quiet-end">Quiet hours end</Label>
                      <Input id="quiet-end" type="time" {...form.register("reminders.quiet_hours.end")} />
                    </div>
                  </div>
                </div>
              )}

              {step.id === "review_confirm" && (
                <div className="space-y-5">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">Conditions</h3>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setStepById("health_baseline")}>Edit previous step</Button>
                      </div>
                      <p className="text-sm text-[color:var(--cp-muted)]">{summary.conditions}</p>
                    </div>
                    <div className="rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">Medications</h3>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setStepById("medications_allergies")}>Edit previous step</Button>
                      </div>
                      <p className="text-sm text-[color:var(--cp-muted)]">{summary.meds}</p>
                    </div>
                    <div className="rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">Allergies</h3>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setStepById("medications_allergies")}>Edit previous step</Button>
                      </div>
                      <p className="text-sm text-[color:var(--cp-muted)]">{summary.allergies}</p>
                    </div>
                    <div className="rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">Care preferences</h3>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setStepById("care_logistics")}>Edit previous step</Button>
                      </div>
                      <p className="text-sm text-[color:var(--cp-muted)]">{summary.care}</p>
                    </div>
                    <div className="rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">Reminder settings</h3>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setStepById("reminders_controls")}>Edit previous step</Button>
                      </div>
                      <p className="text-sm text-[color:var(--cp-muted)]">{summary.reminders}</p>
                    </div>
                  </div>
                  <label className="flex items-start gap-3 rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-4 text-sm">
                    <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} />
                    <span>Looks good</span>
                  </label>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--cp-line)]/45 pt-5">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStepIndex((prev) => Math.max(prev - 1, 0))}
                  disabled={stepIndex === 0}
                >
                  Back
                </Button>
                <div className="flex flex-wrap items-center gap-2">
                  {step.id !== "consent_transparency" && step.id !== "profile_mode" && step.id !== "review_confirm" && (
                    <Button type="button" variant="ghost" onClick={handleSkip}>
                      Skip for now
                    </Button>
                  )}
                  {step.id === "review_confirm" ? (
                    <Button type="button" onClick={handleContinue}>
                      Start using CarePilot
                    </Button>
                  ) : (
                    <Button type="button" onClick={handleContinue} disabled={continueDisabled}>
                      Continue
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </motion.div>
        </AnimatePresence>
      </Card>
    </div>
  );
}
