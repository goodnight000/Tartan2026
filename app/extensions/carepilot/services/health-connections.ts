import type { CarePilotHealthMetricType } from "./health-signal-normalizer.js";
import { CAREPILOT_HEALTH_METRIC_TYPES } from "./health-signal-normalizer.js";

export const CAREPILOT_HEALTH_CONNECTION_SOURCE_TYPES = ["apple_health"] as const;
export type CarePilotHealthConnectionSourceType = (typeof CAREPILOT_HEALTH_CONNECTION_SOURCE_TYPES)[number];

export const CAREPILOT_HEALTH_CONNECTION_STATUSES = ["connected", "disconnected", "error"] as const;
export type CarePilotHealthConnectionStatus = (typeof CAREPILOT_HEALTH_CONNECTION_STATUSES)[number];

export type CarePilotMetricPermission = "granted" | "denied" | "not_determined";

export type CarePilotConnectionPermissions = {
  all: CarePilotMetricPermission;
  metrics: Partial<Record<CarePilotHealthMetricType, CarePilotMetricPermission>>;
};

export type CarePilotNormalizedHealthConnection = {
  sourceType: CarePilotHealthConnectionSourceType;
  connectionStatus: CarePilotHealthConnectionStatus;
  lastSyncAt: string | null;
  permissionsJson: string;
  connectionMetaJson: string | null;
};

export type CarePilotConnectionRecencySummary = {
  connectionStatus: CarePilotHealthConnectionStatus;
  lastSyncAt: string | null;
  minutesSinceLastSync: number | null;
  staleThresholdMinutes: number;
  isStale: boolean;
  recencyState: "fresh" | "stale" | "never_synced" | "disconnected" | "error";
};

type NormalizeHealthConnectionInput = {
  sourceType?: unknown;
  source_type?: unknown;
  connectionStatus?: unknown;
  connection_status?: unknown;
  lastSyncAt?: unknown;
  last_sync_at?: unknown;
  permissionsJson?: unknown;
  permissions_json?: unknown;
  permissions?: unknown;
  connectionMetaJson?: unknown;
  connection_meta_json?: unknown;
  connectionMeta?: unknown;
};

const MINUTE_MS = 60_000;
const DEFAULT_STALE_THRESHOLD_MINUTES = 120;

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

function normalizeConnectionSourceType(value: unknown): CarePilotHealthConnectionSourceType {
  const normalized = toTrimmedString(value || "apple_health");
  if ((CAREPILOT_HEALTH_CONNECTION_SOURCE_TYPES as readonly string[]).includes(normalized)) {
    return normalized as CarePilotHealthConnectionSourceType;
  }
  throw new Error(
    `sourceType must be one of: ${CAREPILOT_HEALTH_CONNECTION_SOURCE_TYPES.join(", ")}. Received: ${String(value)}`,
  );
}

function normalizeConnectionStatus(value: unknown): CarePilotHealthConnectionStatus {
  const normalized = toTrimmedString(value || "disconnected");
  if ((CAREPILOT_HEALTH_CONNECTION_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as CarePilotHealthConnectionStatus;
  }
  throw new Error(
    `connectionStatus must be one of: ${CAREPILOT_HEALTH_CONNECTION_STATUSES.join(", ")}. Received: ${String(value)}`,
  );
}

function normalizePermissionValue(value: unknown): CarePilotMetricPermission {
  if (typeof value === "boolean") {
    return value ? "granted" : "denied";
  }

  const normalized = toTrimmedString(value).toLowerCase();
  if (
    normalized === "granted" ||
    normalized === "allow" ||
    normalized === "allowed" ||
    normalized === "enabled" ||
    normalized === "on" ||
    normalized === "true"
  ) {
    return "granted";
  }

  if (
    normalized === "denied" ||
    normalized === "deny" ||
    normalized === "disabled" ||
    normalized === "off" ||
    normalized === "false"
  ) {
    return "denied";
  }

  return "not_determined";
}

function parseJsonRecord(value: unknown, fieldName: string): Record<string, unknown> {
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
      throw new Error(`${fieldName} must contain valid JSON.`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${fieldName} must decode to an object.`);
    }
    return parsed as Record<string, unknown>;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error(`${fieldName} must be an object or JSON object string.`);
}

function normalizePermissionsEnvelope(value: unknown): CarePilotConnectionPermissions {
  const raw = parseJsonRecord(value, "permissionsJson");
  const metricsContainer = asRecord(raw.metrics);

  const metrics: Partial<Record<CarePilotHealthMetricType, CarePilotMetricPermission>> = {};
  for (const metricType of CAREPILOT_HEALTH_METRIC_TYPES) {
    const metricValue =
      Object.prototype.hasOwnProperty.call(metricsContainer, metricType)
        ? metricsContainer[metricType]
        : raw[metricType];

    if (metricValue === undefined) {
      continue;
    }
    metrics[metricType] = normalizePermissionValue(metricValue);
  }

  const all = normalizePermissionValue(raw.all ?? raw.default);

  return {
    all,
    metrics,
  };
}

function stableStringifyJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringifyJson(nested)}`)
    .join(",")}}`;
}

function normalizeConnectionMeta(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = parseJsonRecord(value, "connectionMetaJson");
  return stableStringifyJson(parsed);
}

function normalizeThresholdMinutes(value: unknown): number {
  const candidate =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isFinite(candidate) || candidate <= 0) {
    return DEFAULT_STALE_THRESHOLD_MINUTES;
  }

  return Math.trunc(candidate);
}

export function normalizeHealthConnectionInput(
  input: NormalizeHealthConnectionInput,
  _now: Date = new Date(),
): CarePilotNormalizedHealthConnection {
  const record = asRecord(input);

  const sourceType = normalizeConnectionSourceType(pickFirst(record, ["sourceType", "source_type"]));
  const connectionStatus = normalizeConnectionStatus(
    pickFirst(record, ["connectionStatus", "connection_status"]),
  );
  const lastSyncAt = parseIsoTimestamp(pickFirst(record, ["lastSyncAt", "last_sync_at"]));

  const permissionsInput = pickFirst(record, ["permissionsJson", "permissions_json", "permissions"]);
  const permissionsEnvelope = normalizePermissionsEnvelope(permissionsInput);
  const permissionsJson = stableStringifyJson(permissionsEnvelope);

  const metaInput = pickFirst(record, ["connectionMetaJson", "connection_meta_json", "connectionMeta"]);
  const connectionMetaJson = normalizeConnectionMeta(metaInput);

  return {
    sourceType,
    connectionStatus,
    lastSyncAt,
    permissionsJson,
    connectionMetaJson,
  };
}

export function resolveMetricPermission(
  permissionsJson: unknown,
  metricType: CarePilotHealthMetricType,
): CarePilotMetricPermission {
  const envelope = normalizePermissionsEnvelope(permissionsJson);
  return envelope.metrics[metricType] ?? envelope.all;
}

export function buildConnectionRecencySummary(
  input: {
    connectionStatus?: unknown;
    connection_status?: unknown;
    lastSyncAt?: unknown;
    last_sync_at?: unknown;
    staleThresholdMinutes?: unknown;
    stale_threshold_minutes?: unknown;
  },
  now: Date = new Date(),
): CarePilotConnectionRecencySummary {
  const record = asRecord(input);
  const connectionStatus = normalizeConnectionStatus(
    pickFirst(record, ["connectionStatus", "connection_status"]),
  );
  const lastSyncAt = parseIsoTimestamp(pickFirst(record, ["lastSyncAt", "last_sync_at"]));
  const staleThresholdMinutes = normalizeThresholdMinutes(
    pickFirst(record, ["staleThresholdMinutes", "stale_threshold_minutes"]),
  );

  if (connectionStatus === "disconnected") {
    return {
      connectionStatus,
      lastSyncAt,
      minutesSinceLastSync: null,
      staleThresholdMinutes,
      isStale: true,
      recencyState: "disconnected",
    };
  }

  if (connectionStatus === "error") {
    return {
      connectionStatus,
      lastSyncAt,
      minutesSinceLastSync: null,
      staleThresholdMinutes,
      isStale: true,
      recencyState: "error",
    };
  }

  if (!lastSyncAt) {
    return {
      connectionStatus,
      lastSyncAt,
      minutesSinceLastSync: null,
      staleThresholdMinutes,
      isStale: true,
      recencyState: "never_synced",
    };
  }

  const deltaMinutes = Math.max(0, Math.floor((now.getTime() - Date.parse(lastSyncAt)) / MINUTE_MS));
  const isStale = deltaMinutes > staleThresholdMinutes;

  return {
    connectionStatus,
    lastSyncAt,
    minutesSinceLastSync: deltaMinutes,
    staleThresholdMinutes,
    isStale,
    recencyState: isStale ? "stale" : "fresh",
  };
}
