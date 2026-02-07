export type ProactiveMode = "active" | "paused" | "medication_only";
export type ProactiveMessageKind = "medication" | "non_urgent";

export type ProactivePolicyProfile = {
  proactive_mode?: string | null;
  snooze_until?: string | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  timezone?: string | null;
};

export type ProactiveSuppressionReason =
  | "paused_mode"
  | "snoozed"
  | "medication_only_mode"
  | "quiet_hours"
  | "non_urgent_daily_cap";

export type ProactivePolicyDecision = {
  allowed: boolean;
  suppressed: boolean;
  reason: "allowed" | ProactiveSuppressionReason;
  proactiveMode: ProactiveMode;
  quietHoursActive: boolean;
  snoozeUntil: string | null;
  nonUrgentSentToday: number;
  nonUrgentDailyCap: number;
};

export type EvaluateProactivePolicyInput = {
  profile?: ProactivePolicyProfile | null;
  messageKind: ProactiveMessageKind;
  now?: Date;
  nonUrgentSentToday?: number | null;
  nonUrgentDailyCap?: number | null;
  actionAuditRows?: ReadonlyArray<ProactivePolicyActionAuditRow> | null;
};

const DEFAULT_NON_URGENT_DAILY_CAP = 1;
const DEFAULT_TIMEZONE = "UTC";
const NON_URGENT_AUDIT_SUCCESS_STATUSES = new Set(["succeeded", "success", "ok", "completed"]);

export type ProactivePolicyActionAuditRow = {
  action_type?: unknown;
  status?: unknown;
  started_at?: unknown;
  finished_at?: unknown;
  created_at?: unknown;
};

type TimeOfDay = {
  totalMinutes: number;
};

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseIsoMillis(value: unknown): number | null {
  const raw = toTrimmedString(value);
  if (!raw) {
    return null;
  }
  const millis = Date.parse(raw);
  if (!Number.isFinite(millis)) {
    return null;
  }
  return millis;
}

function formatDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeMode(value: unknown): ProactiveMode {
  const raw = toTrimmedString(value);
  if (raw === "paused" || raw === "medication_only") {
    return raw;
  }
  return "active";
}

function parseTimeOfDay(value: unknown, fallback: TimeOfDay): TimeOfDay {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(toTrimmedString(value));
  if (!match) {
    return fallback;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return { totalMinutes: hours * 60 + minutes };
}

function resolveTimezone(value: unknown): string {
  const raw = toTrimmedString(value) || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw }).format();
    return raw;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function localMinutesInTimezone(now: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return now.getUTCHours() * 60 + now.getUTCMinutes();
    }
    return hour * 60 + minute;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

function localDateKeyInTimezone(now: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
    const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
    const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return `${now.getUTCFullYear()}-${formatDatePart(now.getUTCMonth() + 1)}-${formatDatePart(now.getUTCDate())}`;
    }
    return `${String(year).padStart(4, "0")}-${formatDatePart(month)}-${formatDatePart(day)}`;
  } catch {
    return `${now.getUTCFullYear()}-${formatDatePart(now.getUTCMonth() + 1)}-${formatDatePart(now.getUTCDate())}`;
  }
}

function isWithinQuietHours(params: {
  now: Date;
  timezone: string;
  quietHoursStart: TimeOfDay;
  quietHoursEnd: TimeOfDay;
}): boolean {
  const start = params.quietHoursStart.totalMinutes;
  const end = params.quietHoursEnd.totalMinutes;
  if (start === end) {
    return false;
  }

  const current = localMinutesInTimezone(params.now, params.timezone);
  if (start < end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
}

function normalizeCount(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function normalizeCap(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return DEFAULT_NON_URGENT_DAILY_CAP;
  }
  return Math.floor(value);
}

function normalizeStatus(value: unknown): string {
  return toTrimmedString(value).toLowerCase();
}

function isNonUrgentActionType(actionType: unknown): boolean {
  const value = toTrimmedString(actionType).toLowerCase();
  if (!value) {
    return false;
  }
  const hasNonUrgentMarker = value.includes("non_urgent") || value.includes("non-urgent");
  const hasProactiveMarker = value.includes("proactive") || value.includes("reminder");
  return hasNonUrgentMarker && hasProactiveMarker;
}

function resolveAuditEventMillis(row: ProactivePolicyActionAuditRow): number | null {
  return parseIsoMillis(row.finished_at) ?? parseIsoMillis(row.started_at) ?? parseIsoMillis(row.created_at);
}

export function countNonUrgentSentTodayFromActionAudit(params: {
  actionAuditRows?: ReadonlyArray<ProactivePolicyActionAuditRow> | null;
  timezone?: string | null;
  now?: Date;
}): number {
  const now = params.now ?? new Date();
  const timezone = resolveTimezone(params.timezone);
  const rows = params.actionAuditRows ?? [];
  if (rows.length === 0) {
    return 0;
  }

  const localDateKey = localDateKeyInTimezone(now, timezone);
  let count = 0;

  for (const row of rows) {
    if (!isNonUrgentActionType(row.action_type)) {
      continue;
    }
    if (!NON_URGENT_AUDIT_SUCCESS_STATUSES.has(normalizeStatus(row.status))) {
      continue;
    }
    const eventMillis = resolveAuditEventMillis(row);
    if (eventMillis === null) {
      continue;
    }
    const rowLocalDate = localDateKeyInTimezone(new Date(eventMillis), timezone);
    if (rowLocalDate === localDateKey) {
      count += 1;
    }
  }

  return count;
}

export function evaluateProactivePolicy(
  input: EvaluateProactivePolicyInput,
): ProactivePolicyDecision {
  const now = input.now ?? new Date();
  const profile = input.profile ?? null;
  const proactiveMode = normalizeMode(profile?.proactive_mode);
  const snoozeUntil = toTrimmedString(profile?.snooze_until) || null;
  const snoozeUntilMillis = parseIsoMillis(snoozeUntil);
  const timezone = resolveTimezone(profile?.timezone);
  const nonUrgentSentToday =
    input.nonUrgentSentToday === null || input.nonUrgentSentToday === undefined
      ? countNonUrgentSentTodayFromActionAudit({
          actionAuditRows: input.actionAuditRows,
          timezone,
          now,
        })
      : normalizeCount(input.nonUrgentSentToday);
  const nonUrgentDailyCap = normalizeCap(input.nonUrgentDailyCap);

  const quietHoursStart = parseTimeOfDay(profile?.quiet_hours_start, { totalMinutes: 22 * 60 });
  const quietHoursEnd = parseTimeOfDay(profile?.quiet_hours_end, { totalMinutes: 8 * 60 });
  const quietHoursActive = isWithinQuietHours({
    now,
    timezone,
    quietHoursStart,
    quietHoursEnd,
  });

  if (proactiveMode === "paused") {
    return {
      allowed: false,
      suppressed: true,
      reason: "paused_mode",
      proactiveMode,
      quietHoursActive,
      snoozeUntil,
      nonUrgentSentToday,
      nonUrgentDailyCap,
    };
  }

  if (snoozeUntilMillis !== null && now.getTime() < snoozeUntilMillis) {
    return {
      allowed: false,
      suppressed: true,
      reason: "snoozed",
      proactiveMode,
      quietHoursActive,
      snoozeUntil,
      nonUrgentSentToday,
      nonUrgentDailyCap,
    };
  }

  if (proactiveMode === "medication_only" && input.messageKind !== "medication") {
    return {
      allowed: false,
      suppressed: true,
      reason: "medication_only_mode",
      proactiveMode,
      quietHoursActive,
      snoozeUntil,
      nonUrgentSentToday,
      nonUrgentDailyCap,
    };
  }

  if (quietHoursActive) {
    return {
      allowed: false,
      suppressed: true,
      reason: "quiet_hours",
      proactiveMode,
      quietHoursActive,
      snoozeUntil,
      nonUrgentSentToday,
      nonUrgentDailyCap,
    };
  }

  if (input.messageKind === "non_urgent" && nonUrgentSentToday >= nonUrgentDailyCap) {
    return {
      allowed: false,
      suppressed: true,
      reason: "non_urgent_daily_cap",
      proactiveMode,
      quietHoursActive,
      snoozeUntil,
      nonUrgentSentToday,
      nonUrgentDailyCap,
    };
  }

  return {
    allowed: true,
    suppressed: false,
    reason: "allowed",
    proactiveMode,
    quietHoursActive,
    snoozeUntil,
    nonUrgentSentToday,
    nonUrgentDailyCap,
  };
}
