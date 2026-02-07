import type { CarePilotRow } from "./clinical-store.js";
import { normalizeFindingLabel, normalizeLabUnit, parseNumericValue } from "./document-parser.js";

export const DEFAULT_TREND_LOOKBACK_MONTHS = 24;

export type LabTrendDirection = "up" | "down" | "stable";

export type LabTrendComparison = {
  has_prior_comparable_result: boolean;
  prior_value: number | null;
  prior_observed_at: string | null;
  delta_absolute: number | null;
  delta_percent: number | null;
  trend_direction: LabTrendDirection;
  clinical_significance_hint: string;
  prior_result_note: string;
  lookback_months: number;
};

export type CompareLabTrendInput = {
  user_id: string;
  label: string;
  unit: string | null;
  current_value: number | null;
  current_observed_at?: string | null;
  current_document_id?: string | null;
  lookback_months?: number;
  existing_findings: CarePilotRow[];
};

type ComparablePrior = {
  id: string;
  value: number;
  observedAt: string;
};

function toIsoOrNull(value: string | null | undefined): string | null {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function parseProvenanceObservedAt(row: CarePilotRow): string | null {
  const raw = typeof row.provenance_json === "string" ? row.provenance_json : null;
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const source = parsed.source;
    if (source && typeof source === "object" && !Array.isArray(source)) {
      const observedAt = (source as Record<string, unknown>).observation_time;
      if (typeof observedAt === "string" && Number.isFinite(Date.parse(observedAt))) {
        return new Date(observedAt).toISOString();
      }
    }
    const observedAtRoot = parsed.observation_time;
    if (typeof observedAtRoot === "string" && Number.isFinite(Date.parse(observedAtRoot))) {
      return new Date(observedAtRoot).toISOString();
    }
    return null;
  } catch {
    return null;
  }
}

function stableThreshold(currentValue: number, priorValue: number): number {
  const scale = Math.max(Math.abs(currentValue), Math.abs(priorValue), 1);
  return Math.max(0.01, scale * 0.03);
}

function computeDirection(
  currentValue: number,
  priorValue: number,
  deltaAbsolute: number,
  deltaPercent: number | null,
): LabTrendDirection {
  if (Math.abs(deltaAbsolute) <= stableThreshold(currentValue, priorValue)) {
    return "stable";
  }
  if (deltaPercent !== null && Math.abs(deltaPercent) < 5) {
    return "stable";
  }
  return deltaAbsolute > 0 ? "up" : "down";
}

function buildHint(direction: LabTrendDirection, deltaPercent: number | null): string {
  if (direction === "stable") {
    return "Change is small versus the prior result; confirm with your clinician whether routine monitoring is sufficient.";
  }
  const notableShift = deltaPercent !== null && Math.abs(deltaPercent) >= 20;
  if (direction === "up") {
    return notableShift
      ? "Notable increase versus prior result. Ask your clinician whether repeat testing or treatment adjustment is needed."
      : "Result is higher than prior. Discuss whether this change is expected in your context.";
  }
  return notableShift
    ? "Notable decrease versus prior result. Ask your clinician whether this reflects improvement or needs follow-up."
    : "Result is lower than prior. Discuss whether this trend is expected in your context.";
}

function fallbackResult(lookbackMonths: number): LabTrendComparison {
  return {
    has_prior_comparable_result: false,
    prior_value: null,
    prior_observed_at: null,
    delta_absolute: null,
    delta_percent: null,
    trend_direction: "stable",
    clinical_significance_hint:
      "No prior comparable result was found in the comparison window. Please review this value directly with your clinician.",
    prior_result_note: "no prior comparable result available",
    lookback_months: lookbackMonths,
  };
}

function selectLatestPrior(values: ComparablePrior[]): ComparablePrior | null {
  if (values.length === 0) {
    return null;
  }
  values.sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt));
  return values[0];
}

export function compareLabTrend(input: CompareLabTrendInput): LabTrendComparison {
  const lookbackMonths =
    typeof input.lookback_months === "number" &&
    Number.isFinite(input.lookback_months) &&
    input.lookback_months > 0
      ? Math.floor(input.lookback_months)
      : DEFAULT_TREND_LOOKBACK_MONTHS;

  const currentValue = toFiniteNumber(input.current_value);
  if (currentValue === null) {
    return fallbackResult(lookbackMonths);
  }

  const currentObservedAt = toIsoOrNull(input.current_observed_at);
  if (!currentObservedAt) {
    return fallbackResult(lookbackMonths);
  }
  const currentObservedMs = Date.parse(currentObservedAt);
  const lookbackStart = new Date(currentObservedAt);
  lookbackStart.setUTCMonth(lookbackStart.getUTCMonth() - lookbackMonths);
  const lookbackStartMs = lookbackStart.getTime();

  const normalizedLabel = normalizeFindingLabel(input.label);
  const normalizedUnit = normalizeLabUnit(input.unit);
  if (!normalizedLabel) {
    return fallbackResult(lookbackMonths);
  }

  const priors: ComparablePrior[] = [];
  for (const row of input.existing_findings) {
    if (String(row.user_id ?? "") !== input.user_id) {
      continue;
    }
    if (String(row.finding_type ?? "") !== "lab_result") {
      continue;
    }
    if (input.current_document_id && String(row.document_id ?? "") === String(input.current_document_id)) {
      continue;
    }

    const rowLabel = normalizeFindingLabel(String(row.label ?? ""));
    if (rowLabel !== normalizedLabel) {
      continue;
    }
    const rowUnit = normalizeLabUnit(typeof row.unit === "string" ? row.unit : null);
    if ((rowUnit ?? "") !== (normalizedUnit ?? "")) {
      continue;
    }

    const observedAt =
      parseProvenanceObservedAt(row) ??
      (typeof row.created_at === "string" && Number.isFinite(Date.parse(row.created_at))
        ? new Date(row.created_at).toISOString()
        : null);
    if (!observedAt) {
      continue;
    }
    const observedMs = Date.parse(observedAt);
    if (!Number.isFinite(observedMs) || observedMs >= currentObservedMs || observedMs < lookbackStartMs) {
      continue;
    }

    const priorValue = parseNumericValue(typeof row.value_text === "string" ? row.value_text : null);
    if (priorValue === null) {
      continue;
    }

    priors.push({
      id: String(row.id ?? ""),
      value: priorValue,
      observedAt,
    });
  }

  const prior = selectLatestPrior(priors);
  if (!prior) {
    return fallbackResult(lookbackMonths);
  }

  const deltaAbsolute = Number((currentValue - prior.value).toFixed(4));
  const deltaPercent =
    prior.value === 0 ? null : Number((((currentValue - prior.value) / Math.abs(prior.value)) * 100).toFixed(2));
  const trendDirection = computeDirection(currentValue, prior.value, deltaAbsolute, deltaPercent);

  return {
    has_prior_comparable_result: true,
    prior_value: prior.value,
    prior_observed_at: prior.observedAt,
    delta_absolute: deltaAbsolute,
    delta_percent: deltaPercent,
    trend_direction: trendDirection,
    clinical_significance_hint: buildHint(trendDirection, deltaPercent),
    prior_result_note: `Compared with prior result from ${prior.observedAt.slice(0, 10)}.`,
    lookback_months: lookbackMonths,
  };
}
