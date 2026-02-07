export type CarePilotCronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string };

export type CarePilotCronPayload =
  | { kind: "systemEvent"; text: string }
  | {
      kind: "agentTurn";
      message: string;
      model?: string;
      thinking?: string;
      timeoutSeconds?: number;
      allowUnsafeExternalContent?: boolean;
      deliver?: boolean;
      channel?: string;
      to?: string;
      bestEffortDeliver?: boolean;
    };

export type CarePilotCronJobCreate = {
  name: string;
  description?: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
  wakeMode: "next-heartbeat" | "now";
  schedule: CarePilotCronSchedule;
  sessionTarget: "main" | "isolated";
  payload: CarePilotCronPayload;
};

export type CarePilotHeartbeatDefaults = {
  every: string;
  activeHours: {
    start: string;
    end: string;
    timezone: "user";
  };
  session: "main";
  target: "last";
  prompt: string;
};

export const CAREPILOT_HEARTBEAT_DEFAULTS: CarePilotHeartbeatDefaults = {
  every: "12h",
  activeHours: {
    start: "08:00",
    end: "22:00",
    timezone: "user",
  },
  session: "main",
  target: "last",
  prompt:
    "Evaluate pending CarePilot reminders and unresolved actions. Send only if actionable and policy allows.",
};

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const MINUTE_MS = 60_000;
const MAX_SCAN_MINUTES = 2 * 24 * 60;

function parseLocalDate(localDate: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) {
    throw new Error(`Invalid local date (expected YYYY-MM-DD): ${localDate}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid local date value: ${localDate}`);
  }
  return { year, month, day };
}

function parseLocalTime(localTime: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!match) {
    throw new Error(`Invalid local time (expected HH:mm): ${localTime}`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid local time value: ${localTime}`);
  }
  return { hour, minute };
}

function formatLocalDateKey(parts: Pick<LocalDateTimeParts, "year" | "month" | "day">): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function formatLocalTime(parts: Pick<LocalDateTimeParts, "hour" | "minute">): string {
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function compareLocalDateTime(left: LocalDateTimeParts, right: LocalDateTimeParts): number {
  if (left.year !== right.year) {
    return left.year - right.year;
  }
  if (left.month !== right.month) {
    return left.month - right.month;
  }
  if (left.day !== right.day) {
    return left.day - right.day;
  }
  if (left.hour !== right.hour) {
    return left.hour - right.hour;
  }
  return left.minute - right.minute;
}

function extractPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const raw = parts.find((part) => part.type === type)?.value;
  if (!raw) {
    throw new Error(`Missing Intl part: ${type}`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid Intl part value for ${type}: ${raw}`);
  }
  return value;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const key = timeZone.trim();
  const existing = formatterCache.get(key);
  if (existing) {
    return existing;
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: key,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(key, formatter);
  return formatter;
}

function utcMsToLocalParts(utcMs: number, timeZone: string): LocalDateTimeParts {
  const parts = getFormatter(timeZone).formatToParts(new Date(utcMs));
  return {
    year: extractPart(parts, "year"),
    month: extractPart(parts, "month"),
    day: extractPart(parts, "day"),
    hour: extractPart(parts, "hour"),
    minute: extractPart(parts, "minute"),
  };
}

function addLocalMinutes(params: {
  localDate: string;
  localTime: string;
  deltaMinutes: number;
}): { localDate: string; localTime: string } {
  const date = parseLocalDate(params.localDate);
  const time = parseLocalTime(params.localTime);
  const pseudoLocalMs =
    Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0, 0) +
    Math.trunc(params.deltaMinutes) * MINUTE_MS;
  const shifted = new Date(pseudoLocalMs);
  return {
    localDate: formatLocalDateKey({
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    }),
    localTime: formatLocalTime({ hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() }),
  };
}

export type ResolvedLocalSchedule = {
  localDate: string;
  localTime: string;
  utcIso: string;
  localDateKey: string;
  resolution: "exact" | "next_valid_local_minute";
  isRepeatedLocalTime: boolean;
};

export function resolveScheduledLocalTimestamp(params: {
  timeZone: string;
  localDate: string;
  localTime: string;
}): ResolvedLocalSchedule {
  const timeZone = params.timeZone.trim();
  if (!timeZone) {
    throw new Error("timeZone is required");
  }

  const date = parseLocalDate(params.localDate);
  const time = parseLocalTime(params.localTime);
  const target: LocalDateTimeParts = {
    year: date.year,
    month: date.month,
    day: date.day,
    hour: time.hour,
    minute: time.minute,
  };

  const naiveUtcMs = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, 0, 0);
  const matches: number[] = [];

  for (let delta = -MAX_SCAN_MINUTES; delta <= MAX_SCAN_MINUTES; delta += 1) {
    const candidateMs = naiveUtcMs + delta * MINUTE_MS;
    const local = utcMsToLocalParts(candidateMs, timeZone);
    if (compareLocalDateTime(local, target) === 0) {
      matches.push(candidateMs);
    }
  }

  if (matches.length > 0) {
    const first = Math.min(...matches);
    return {
      localDate: params.localDate,
      localTime: params.localTime,
      utcIso: new Date(first).toISOString(),
      localDateKey: formatLocalDateKey(target),
      resolution: "exact",
      isRepeatedLocalTime: matches.length > 1,
    };
  }

  for (let delta = 0; delta <= MAX_SCAN_MINUTES; delta += 1) {
    const candidateMs = naiveUtcMs + delta * MINUTE_MS;
    const local = utcMsToLocalParts(candidateMs, timeZone);
    if (compareLocalDateTime(local, target) >= 0) {
      return {
        localDate: formatLocalDateKey(local),
        localTime: formatLocalTime(local),
        utcIso: new Date(candidateMs).toISOString(),
        localDateKey: formatLocalDateKey(local),
        resolution: "next_valid_local_minute",
        isRepeatedLocalTime: false,
      };
    }
  }

  throw new Error(
    `Unable to resolve local schedule timestamp for ${params.localDate} ${params.localTime} in timezone ${timeZone}`,
  );
}

export function buildProactiveDedupeKey(jobId: string, localDateKey: string): string {
  const cleanJobId = jobId.trim();
  const cleanDate = localDateKey.trim();
  if (!cleanJobId || !cleanDate) {
    throw new Error("jobId and localDateKey are required for dedupe key generation");
  }
  return `${cleanJobId}:${cleanDate}`;
}

export type ProactiveCronDraft = {
  jobId: string;
  dedupeKey: string;
  localDateKey: string;
  resolution: ResolvedLocalSchedule["resolution"];
  isRepeatedLocalTime: boolean;
  job: CarePilotCronJobCreate;
};

function buildMainSystemEventJob(params: {
  name: string;
  text: string;
  atIso: string;
  wakeMode?: "next-heartbeat" | "now";
}): CarePilotCronJobCreate {
  return {
    name: params.name,
    schedule: {
      kind: "at",
      at: params.atIso,
    },
    sessionTarget: "main",
    wakeMode: params.wakeMode ?? "next-heartbeat",
    payload: {
      kind: "systemEvent",
      text: params.text,
    },
    enabled: true,
  };
}

export function buildAppointmentReminderJobs(params: {
  appointmentId: string;
  timeZone: string;
  appointmentLocalDate: string;
  appointmentLocalTime: string;
  offsetHours?: number[];
  wakeMode?: "next-heartbeat" | "now";
}): ProactiveCronDraft[] {
  const offsets =
    Array.isArray(params.offsetHours) && params.offsetHours.length > 0
      ? params.offsetHours.map((value) => Math.max(0, Math.trunc(value)))
      : [24, 2];

  return offsets.map((offsetHours) => {
    const reminderLocal = addLocalMinutes({
      localDate: params.appointmentLocalDate,
      localTime: params.appointmentLocalTime,
      deltaMinutes: -offsetHours * 60,
    });
    const resolved = resolveScheduledLocalTimestamp({
      timeZone: params.timeZone,
      localDate: reminderLocal.localDate,
      localTime: reminderLocal.localTime,
    });
    const jobId = `carepilot-appointment-${params.appointmentId}-${offsetHours}h`;
    return {
      jobId,
      localDateKey: resolved.localDateKey,
      dedupeKey: buildProactiveDedupeKey(jobId, resolved.localDateKey),
      resolution: resolved.resolution,
      isRepeatedLocalTime: resolved.isRepeatedLocalTime,
      job: buildMainSystemEventJob({
        name: jobId,
        atIso: resolved.utcIso,
        wakeMode: params.wakeMode,
        text: `carepilot_reminder kind=appointment appointment_id=${params.appointmentId} offset_hours=${offsetHours}`,
      }),
    };
  });
}

export function buildRefillReminderJobs(params: {
  medicationId: string;
  timeZone: string;
  runOutLocalDate: string;
  reminderLocalTime?: string;
  daysBefore?: number[];
  wakeMode?: "next-heartbeat" | "now";
}): ProactiveCronDraft[] {
  const daysBefore =
    Array.isArray(params.daysBefore) && params.daysBefore.length > 0
      ? params.daysBefore.map((value) => Math.max(0, Math.trunc(value)))
      : [5, 2, 1];
  const reminderLocalTime = params.reminderLocalTime ?? "09:00";

  return daysBefore.map((days) => {
    const reminderLocal = addLocalMinutes({
      localDate: params.runOutLocalDate,
      localTime: reminderLocalTime,
      deltaMinutes: -days * 24 * 60,
    });
    const resolved = resolveScheduledLocalTimestamp({
      timeZone: params.timeZone,
      localDate: reminderLocal.localDate,
      localTime: reminderLocal.localTime,
    });
    const jobId = `carepilot-refill-${params.medicationId}-${days}d`;
    return {
      jobId,
      localDateKey: resolved.localDateKey,
      dedupeKey: buildProactiveDedupeKey(jobId, resolved.localDateKey),
      resolution: resolved.resolution,
      isRepeatedLocalTime: resolved.isRepeatedLocalTime,
      job: buildMainSystemEventJob({
        name: jobId,
        atIso: resolved.utcIso,
        wakeMode: params.wakeMode,
        text: `carepilot_reminder kind=refill medication_id=${params.medicationId} days_before=${days}`,
      }),
    };
  });
}

export function buildFollowUpNudgeJob(params: {
  followUpId: string;
  timeZone: string;
  localDate: string;
  localTime: string;
  wakeMode?: "next-heartbeat" | "now";
}): ProactiveCronDraft {
  const resolved = resolveScheduledLocalTimestamp({
    timeZone: params.timeZone,
    localDate: params.localDate,
    localTime: params.localTime,
  });
  const jobId = `carepilot-followup-${params.followUpId}`;

  return {
    jobId,
    localDateKey: resolved.localDateKey,
    dedupeKey: buildProactiveDedupeKey(jobId, resolved.localDateKey),
    resolution: resolved.resolution,
    isRepeatedLocalTime: resolved.isRepeatedLocalTime,
    job: buildMainSystemEventJob({
      name: jobId,
      atIso: resolved.utcIso,
      wakeMode: params.wakeMode,
      text: `carepilot_reminder kind=follow_up follow_up_id=${params.followUpId}`,
    }),
  };
}
