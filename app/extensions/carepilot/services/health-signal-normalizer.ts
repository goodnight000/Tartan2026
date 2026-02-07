export const CAREPILOT_HEALTH_METRIC_TYPES = [
  "cycle",
  "medication_tracking",
  "workouts",
  "sleep",
  "resting_hr",
  "step_count",
] as const;

export type CarePilotHealthMetricType = (typeof CAREPILOT_HEALTH_METRIC_TYPES)[number];

export const CAREPILOT_HEALTH_SIGNAL_SOURCES = ["apple_health", "user_reported", "tool_result"] as const;

export type CarePilotHealthSignalSource = (typeof CAREPILOT_HEALTH_SIGNAL_SOURCES)[number];

export type CarePilotNormalizedHealthSignal = {
  metricType: CarePilotHealthMetricType;
  source: CarePilotHealthSignalSource;
  summary: Record<string, unknown>;
  observedAt: string;
  syncedAt: string;
  staleAfter: string;
};

type NormalizeHealthSignalInput = {
  metricType?: unknown;
  metric_type?: unknown;
  source?: unknown;
  summary?: unknown;
  summary_json?: unknown;
  observedAt?: unknown;
  observed_at?: unknown;
  syncedAt?: unknown;
  synced_at?: unknown;
  staleAfter?: unknown;
  stale_after?: unknown;
};

const HOUR_MS = 60 * 60 * 1000;

const STALE_AFTER_HOURS_BY_METRIC: Record<CarePilotHealthMetricType, number> = {
  cycle: 72,
  medication_tracking: 36,
  workouts: 48,
  sleep: 36,
  resting_hr: 24,
  step_count: 12,
};

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseIsoTimestamp(value: unknown): string | null {
  const raw = toTrimmedString(value);
  if (!raw) {
    return null;
  }
  const millis = Date.parse(raw);
  if (!Number.isFinite(millis)) {
    return null;
  }
  return new Date(millis).toISOString();
}

function pickFirst(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  const value = toTrimmedString(pickFirst(record, keys));
  return value || null;
}

function readBoolean(record: Record<string, unknown>, keys: readonly string[]): boolean | null {
  const raw = pickFirst(record, keys);
  if (typeof raw === "boolean") {
    return raw;
  }
  const value = toTrimmedString(raw).toLowerCase();
  if (!value) {
    return null;
  }
  if (value === "true" || value === "1" || value === "yes") {
    return true;
  }
  if (value === "false" || value === "0" || value === "no") {
    return false;
  }
  return null;
}

function readNumber(
  record: Record<string, unknown>,
  keys: readonly string[],
  options: { integer?: boolean; min?: number } = {},
): number | null {
  const raw = pickFirst(record, keys);
  if (raw === null || raw === undefined) {
    return null;
  }
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw.trim())
        : Number.NaN;

  if (!Number.isFinite(value)) {
    return null;
  }

  const normalized = options.integer ? Math.trunc(value) : value;
  if (options.min !== undefined && normalized < options.min) {
    return null;
  }
  return normalized;
}

function readStringArray(record: Record<string, unknown>, keys: readonly string[]): string[] {
  const raw = pickFirst(record, keys);
  if (!Array.isArray(raw)) {
    return [];
  }
  const normalized = raw
    .map((item) => toTrimmedString(item))
    .filter((item) => item.length > 0);
  return Array.from(new Set(normalized));
}

function parseSummaryInput(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return {};
  }
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("summary_json must be valid JSON.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("summary_json must decode to an object.");
    }
    return parsed as Record<string, unknown>;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error("summary must be an object.");
}

function normalizeMetricType(value: unknown): CarePilotHealthMetricType {
  const metricType = toTrimmedString(value);
  if ((CAREPILOT_HEALTH_METRIC_TYPES as readonly string[]).includes(metricType)) {
    return metricType as CarePilotHealthMetricType;
  }
  throw new Error(
    `metricType must be one of: ${CAREPILOT_HEALTH_METRIC_TYPES.join(", ")}. Received: ${String(value)}`,
  );
}

function normalizeSource(value: unknown): CarePilotHealthSignalSource {
  const source = toTrimmedString(value);
  if ((CAREPILOT_HEALTH_SIGNAL_SOURCES as readonly string[]).includes(source)) {
    return source as CarePilotHealthSignalSource;
  }
  throw new Error(
    `source must be one of: ${CAREPILOT_HEALTH_SIGNAL_SOURCES.join(", ")}. Received: ${String(value)}`,
  );
}

function normalizeSummary(
  metricType: CarePilotHealthMetricType,
  summary: Record<string, unknown>,
): Record<string, unknown> {
  switch (metricType) {
    case "cycle":
      return {
        phase: readString(summary, ["phase", "cycle_phase"]),
        cycleDay: readNumber(summary, ["cycleDay", "cycle_day", "day"], { integer: true, min: 1 }),
        flow: readString(summary, ["flow", "flow_level"]),
        symptoms: readStringArray(summary, ["symptoms"]),
        periodStartAt: parseIsoTimestamp(pickFirst(summary, ["periodStartAt", "period_start_at"])),
        periodEndAt: parseIsoTimestamp(pickFirst(summary, ["periodEndAt", "period_end_at"])),
      };

    case "medication_tracking":
      return {
        medicationName: readString(summary, ["medicationName", "medication_name"]),
        taken: readBoolean(summary, ["taken", "is_taken"]),
        takenAt: parseIsoTimestamp(pickFirst(summary, ["takenAt", "taken_at"])),
        dose: readString(summary, ["dose"]),
        notes: readString(summary, ["notes"]),
      };

    case "workouts":
      return {
        workoutType: readString(summary, ["workoutType", "workout_type", "type"]),
        durationMinutes: readNumber(summary, ["durationMinutes", "duration_minutes", "duration"], {
          integer: true,
          min: 0,
        }),
        caloriesKcal: readNumber(summary, ["caloriesKcal", "calories_kcal", "calories"], {
          min: 0,
        }),
        distanceKm: readNumber(summary, ["distanceKm", "distance_km"], { min: 0 }),
      };

    case "sleep": {
      const durationMinutes = readNumber(summary, ["durationMinutes", "duration_minutes"], {
        min: 0,
      });
      const durationHoursFromMinutes =
        durationMinutes === null ? null : Math.round((durationMinutes / 60) * 100) / 100;
      return {
        durationHours:
          durationHoursFromMinutes ?? readNumber(summary, ["durationHours", "duration_hours"], { min: 0 }),
        bedtime: parseIsoTimestamp(pickFirst(summary, ["bedtime", "bed_time", "sleep_start"])),
        wakeTime: parseIsoTimestamp(pickFirst(summary, ["wakeTime", "wake_time", "sleep_end"])),
        quality: readString(summary, ["quality"]),
      };
    }

    case "resting_hr":
      return {
        bpm: readNumber(summary, ["bpm", "value", "resting_hr"], { min: 0 }),
        unit: "bpm",
      };

    case "step_count":
      return {
        steps: readNumber(summary, ["steps", "count", "value"], { integer: true, min: 0 }),
        unit: "count",
      };
  }
}

function deriveStaleAfter(metricType: CarePilotHealthMetricType, syncedAtIso: string): string {
  const syncedMillis = Date.parse(syncedAtIso);
  const staleHours = STALE_AFTER_HOURS_BY_METRIC[metricType];
  return new Date(syncedMillis + staleHours * HOUR_MS).toISOString();
}

export function normalizeHealthSignalInput(
  input: NormalizeHealthSignalInput,
  now: Date = new Date(),
): CarePilotNormalizedHealthSignal {
  const record = asRecord(input);

  const metricType = normalizeMetricType(pickFirst(record, ["metricType", "metric_type"]));
  const source = normalizeSource(pickFirst(record, ["source"]));

  const observedAt =
    parseIsoTimestamp(pickFirst(record, ["observedAt", "observed_at"])) ?? now.toISOString();

  const syncedAtCandidate =
    parseIsoTimestamp(pickFirst(record, ["syncedAt", "synced_at"])) ?? now.toISOString();
  const syncedAt =
    Date.parse(syncedAtCandidate) < Date.parse(observedAt) ? observedAt : syncedAtCandidate;

  const staleAfter =
    parseIsoTimestamp(pickFirst(record, ["staleAfter", "stale_after"])) ??
    deriveStaleAfter(metricType, syncedAt);

  const summaryInput = pickFirst(record, ["summary", "summary_json"]);
  const summary = normalizeSummary(metricType, parseSummaryInput(summaryInput));

  return {
    metricType,
    source,
    summary,
    observedAt,
    syncedAt,
    staleAfter,
  };
}

export function isSignalStale(
  signal: { staleAfter?: unknown; stale_after?: unknown },
  now: Date = new Date(),
): boolean {
  const staleAfter = parseIsoTimestamp(signal.staleAfter ?? signal.stale_after);
  if (!staleAfter) {
    return true;
  }
  return now.getTime() >= Date.parse(staleAfter);
}
