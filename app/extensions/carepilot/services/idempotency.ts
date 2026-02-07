import { createHash } from "node:crypto";
import type { CarePilotClinicalStore, CarePilotRow } from "./clinical-store.js";

const FALLBACK_USER_ID = "default_user";
const DEFAULT_REPLAY_WINDOW_HOURS = 24;

const TERMINAL_SUCCESS_STATUSES = new Set(["succeeded", "success", "ok", "completed"]);
const IN_PROGRESS_STATUSES = new Set([
  "planned",
  "awaiting_confirmation",
  "executing",
  "pending",
  "in_progress",
  "queued",
]);

type CanonicalJsonPrimitive = string | number | boolean | null;
type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | CanonicalJsonValue[]
  | {
      [key: string]: CanonicalJsonValue;
    };

export type IdempotencyKeyParams = {
  userId: string;
  actionType: string;
  canonicalPayload: string;
  targetRef: string;
};

export type IdempotencyKeyFromPayloadParams = {
  userId: string;
  actionType: string;
  payload: unknown;
  targetRef: string;
};

export type IdempotencyLookupParams = {
  store: CarePilotClinicalStore;
  userId: string;
  idempotencyKey: string;
  replayWindowBucket: string;
};

export type IdempotencyReplayState =
  | "miss"
  | "replay_success"
  | "in_progress"
  | "terminal_non_success";

export type IdempotencyLookupResult = {
  state: IdempotencyReplayState;
  replayWindowBucket: string;
  row: CarePilotRow | null;
};

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveScopedUserId(userId: string): string {
  const resolved = toTrimmedString(userId);
  return resolved || FALLBACK_USER_ID;
}

function normalizeCanonicalValue(value: unknown): CanonicalJsonValue | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeCanonicalValue(item) ?? null);
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const normalized: Record<string, CanonicalJsonValue> = {};
    const keys = Object.keys(objectValue).toSorted((left, right) => left.localeCompare(right));

    for (const key of keys) {
      const next = normalizeCanonicalValue(objectValue[key]);
      if (next !== undefined) {
        normalized[key] = next;
      }
    }

    return normalized;
  }

  return undefined;
}

function toStatus(row: CarePilotRow): string {
  return toTrimmedString(row.status).toLowerCase();
}

export function canonicalizePayload(payload: unknown): string {
  const normalized = normalizeCanonicalValue(payload) ?? null;
  return JSON.stringify(normalized);
}

export function computeIdempotencyKey(params: IdempotencyKeyParams): string {
  const userId = resolveScopedUserId(params.userId);
  const actionType = toTrimmedString(params.actionType);
  const canonicalPayload = params.canonicalPayload;
  const targetRef = toTrimmedString(params.targetRef);
  if (!actionType) {
    throw new Error("actionType is required to compute idempotency key.");
  }
  if (!targetRef) {
    throw new Error("targetRef is required to compute idempotency key.");
  }
  return createHash("sha256")
    .update(`${userId}|${actionType}|${canonicalPayload}|${targetRef}`, "utf8")
    .digest("hex");
}

export function computeIdempotencyKeyFromPayload(params: IdempotencyKeyFromPayloadParams): string {
  return computeIdempotencyKey({
    userId: params.userId,
    actionType: params.actionType,
    canonicalPayload: canonicalizePayload(params.payload),
    targetRef: params.targetRef,
  });
}

export function buildReplayWindowBucket(
  now: Date = new Date(),
  replayWindowHours: number = DEFAULT_REPLAY_WINDOW_HOURS,
): string {
  if (!Number.isFinite(replayWindowHours) || replayWindowHours <= 0) {
    throw new Error("replayWindowHours must be > 0.");
  }
  const windowMs = Math.floor(replayWindowHours) * 60 * 60 * 1000;
  const bucketStartMillis = Math.floor(now.getTime() / windowMs) * windowMs;
  return new Date(bucketStartMillis).toISOString();
}

export function lookupIdempotencyReplay(params: IdempotencyLookupParams): IdempotencyLookupResult {
  const userId = resolveScopedUserId(params.userId);
  const idempotencyKey = toTrimmedString(params.idempotencyKey);
  const replayWindowBucket = toTrimmedString(params.replayWindowBucket);

  if (!idempotencyKey) {
    throw new Error("idempotencyKey is required.");
  }
  if (!replayWindowBucket) {
    throw new Error("replayWindowBucket is required.");
  }

  const matches = params.store.actionAudit.list({
    where: {
      user_id: userId,
      idempotency_key: idempotencyKey,
      replay_window_bucket: replayWindowBucket,
    },
    limit: 1,
  });

  const row = matches[0] ?? null;
  if (!row) {
    return {
      state: "miss",
      replayWindowBucket,
      row: null,
    };
  }

  const status = toStatus(row);
  if (TERMINAL_SUCCESS_STATUSES.has(status)) {
    return {
      state: "replay_success",
      replayWindowBucket,
      row,
    };
  }

  if (IN_PROGRESS_STATUSES.has(status)) {
    return {
      state: "in_progress",
      replayWindowBucket,
      row,
    };
  }

  return {
    state: "terminal_non_success",
    replayWindowBucket,
    row,
  };
}
