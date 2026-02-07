export type RefillConfidenceLabel = "high" | "medium" | "low";

export type TaperSegment = {
  start_date: string;
  dose: number;
  duration_days: number;
};

export type RefillEstimatorInput = {
  medication_id: string;
  medication_name: string;
  medication_status?: string | null;
  regimen_type?: "daily" | "prn" | "non_daily" | "taper";
  schedule_interval_days?: number | null;
  taper_segments?: TaperSegment[] | null;
  last_fill_date?: string | null;
  quantity_dispensed?: number | null;
  frequency_per_day?: number | null;
  missed_doses_estimate?: number | null;
  remaining_pills_reported?: number | null;
};

export type RefillEstimatorResult = {
  medication_id: string;
  runout_estimate_date: string | null;
  estimated_days_total: number | null;
  effective_daily_use: number | null;
  confidence: number;
  confidence_label: RefillConfidenceLabel;
  requires_confirmation: boolean;
  follow_up_date: string;
  rationale: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function safeDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) {
    return null;
  }
  return new Date(millis);
}

function toIsoDate(value: Date): string {
  return value.toISOString();
}

function clampMin(value: number, min: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, value);
}

function toConfidenceLabel(confidence: number): RefillConfidenceLabel {
  if (confidence >= 0.85) {
    return "high";
  }
  if (confidence >= 0.6) {
    return "medium";
  }
  return "low";
}

function inferRegimenType(input: RefillEstimatorInput): "daily" | "prn" | "non_daily" | "taper" {
  if (input.regimen_type) {
    return input.regimen_type;
  }

  const status = String(input.medication_status ?? "").toLowerCase();
  if (status.includes("prn")) {
    return "prn";
  }
  if (status.includes("taper")) {
    return "taper";
  }
  if (typeof input.frequency_per_day === "number" && input.frequency_per_day > 0 && input.frequency_per_day < 1) {
    return "non_daily";
  }
  return "daily";
}

function computeTaperDailyUse(segments: TaperSegment[]): number | null {
  if (!segments.length) {
    return null;
  }
  let totalDose = 0;
  let totalDays = 0;
  for (const segment of segments) {
    if (!Number.isFinite(segment.dose) || !Number.isFinite(segment.duration_days) || segment.duration_days <= 0) {
      return null;
    }
    totalDose += segment.dose * segment.duration_days;
    totalDays += segment.duration_days;
  }
  if (totalDays <= 0) {
    return null;
  }
  return totalDose / totalDays;
}

function buildFallbackFollowUp(now: Date, offsetDays: number): string {
  return toIsoDate(new Date(now.getTime() + offsetDays * DAY_MS));
}

export function estimateRefillRunout(
  input: RefillEstimatorInput,
  now: Date = new Date(),
): RefillEstimatorResult {
  const rationale: string[] = [];
  const medicationStatus = String(input.medication_status ?? "active").toLowerCase();

  if (medicationStatus === "paused" || medicationStatus === "held") {
    rationale.push("Medication is paused/held; refill automation suspended.");
    return {
      medication_id: input.medication_id,
      runout_estimate_date: null,
      estimated_days_total: null,
      effective_daily_use: null,
      confidence: 0.25,
      confidence_label: "low",
      requires_confirmation: true,
      follow_up_date: buildFallbackFollowUp(now, 7),
      rationale,
    };
  }

  const regimenType = inferRegimenType(input);
  if (regimenType === "prn") {
    rationale.push("PRN regimen detected; fixed run-out cannot be auto-computed.");
    return {
      medication_id: input.medication_id,
      runout_estimate_date: null,
      estimated_days_total: null,
      effective_daily_use: null,
      confidence: 0.3,
      confidence_label: "low",
      requires_confirmation: true,
      follow_up_date: buildFallbackFollowUp(now, 3),
      rationale,
    };
  }

  if (!input.last_fill_date || input.quantity_dispensed == null) {
    rationale.push("Missing last_fill_date or quantity_dispensed; user confirmation required.");
    return {
      medication_id: input.medication_id,
      runout_estimate_date: null,
      estimated_days_total: null,
      effective_daily_use: null,
      confidence: 0.35,
      confidence_label: "low",
      requires_confirmation: true,
      follow_up_date: buildFallbackFollowUp(now, 3),
      rationale,
    };
  }

  const lastFillDate = safeDate(input.last_fill_date);
  if (!lastFillDate) {
    rationale.push("Invalid last_fill_date format.");
    return {
      medication_id: input.medication_id,
      runout_estimate_date: null,
      estimated_days_total: null,
      effective_daily_use: null,
      confidence: 0.3,
      confidence_label: "low",
      requires_confirmation: true,
      follow_up_date: buildFallbackFollowUp(now, 3),
      rationale,
    };
  }

  let inferredFieldCount = 0;
  let baseDailyUse: number | null = null;

  if (regimenType === "taper") {
    const taperDailyUse = computeTaperDailyUse(input.taper_segments ?? []);
    if (taperDailyUse == null) {
      rationale.push("Taper regimen requires valid schedule segments before estimation.");
      return {
        medication_id: input.medication_id,
        runout_estimate_date: null,
        estimated_days_total: null,
        effective_daily_use: null,
        confidence: 0.25,
        confidence_label: "low",
        requires_confirmation: true,
        follow_up_date: buildFallbackFollowUp(now, 2),
        rationale,
      };
    }
    baseDailyUse = taperDailyUse;
  } else if (regimenType === "non_daily") {
    if (input.schedule_interval_days && input.schedule_interval_days > 0) {
      baseDailyUse = 1 / input.schedule_interval_days;
    } else if (input.frequency_per_day && input.frequency_per_day > 0) {
      baseDailyUse = input.frequency_per_day;
      inferredFieldCount += 1;
      rationale.push("Used frequency_per_day fallback for non-daily regimen.");
    } else {
      rationale.push("Non-daily regimen requires schedule_interval_days or valid frequency_per_day.");
      return {
        medication_id: input.medication_id,
        runout_estimate_date: null,
        estimated_days_total: null,
        effective_daily_use: null,
        confidence: 0.3,
        confidence_label: "low",
        requires_confirmation: true,
        follow_up_date: buildFallbackFollowUp(now, 3),
        rationale,
      };
    }
  } else {
    if (!input.frequency_per_day || input.frequency_per_day <= 0) {
      rationale.push("Daily regimen missing valid frequency_per_day.");
      return {
        medication_id: input.medication_id,
        runout_estimate_date: null,
        estimated_days_total: null,
        effective_daily_use: null,
        confidence: 0.35,
        confidence_label: "low",
        requires_confirmation: true,
        follow_up_date: buildFallbackFollowUp(now, 3),
        rationale,
      };
    }
    baseDailyUse = input.frequency_per_day;
  }

  const missedDoseAdjustment = clampMin((input.missed_doses_estimate ?? 0) / 30, 0);
  const effectiveDailyUse = clampMin((baseDailyUse ?? 0) - missedDoseAdjustment, 0.1);
  const availableQuantity =
    input.remaining_pills_reported != null && input.remaining_pills_reported >= 0
      ? input.remaining_pills_reported
      : input.quantity_dispensed;

  if (input.remaining_pills_reported == null) {
    inferredFieldCount += 1;
    rationale.push("Remaining pills not provided; using dispensed quantity as proxy.");
  }
  if (input.missed_doses_estimate == null) {
    inferredFieldCount += 1;
    rationale.push("Missed dose estimate absent; assumed zero missed doses.");
  }

  const estimatedDaysTotal = availableQuantity / effectiveDailyUse;
  const runoutDate = new Date(lastFillDate.getTime() + estimatedDaysTotal * DAY_MS);
  const followUpOffsetDays = estimatedDaysTotal > 10 ? Math.max(1, Math.floor(estimatedDaysTotal - 7)) : 2;
  const followUpDate = new Date(lastFillDate.getTime() + followUpOffsetDays * DAY_MS);
  const minFollowUpDate = new Date(now.getTime() + DAY_MS);
  const boundedFollowUpDate = followUpDate.getTime() < minFollowUpDate.getTime() ? minFollowUpDate : followUpDate;

  let confidence = 0.9;
  if (inferredFieldCount === 1) {
    confidence = 0.65;
  } else if (inferredFieldCount >= 2) {
    confidence = 0.4;
  }
  const confidenceLabel = toConfidenceLabel(confidence);
  const requiresConfirmation = confidenceLabel === "low";
  if (requiresConfirmation) {
    rationale.push("Low confidence estimate; ask for remaining pills before execution.");
  }

  return {
    medication_id: input.medication_id,
    runout_estimate_date: toIsoDate(runoutDate),
    estimated_days_total: Math.round(estimatedDaysTotal * 100) / 100,
    effective_daily_use: Math.round(effectiveDailyUse * 1000) / 1000,
    confidence,
    confidence_label: confidenceLabel,
    requires_confirmation: requiresConfirmation,
    follow_up_date: toIsoDate(boundedFollowUpDate),
    rationale,
  };
}
