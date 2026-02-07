import { createHmac, randomUUID } from "node:crypto";
import type { CarePilotClinicalStore, CarePilotRow } from "./clinical-store.js";

const DEFAULT_CONSENT_TTL_SECONDS = 300;
const FALLBACK_USER_ID = "default_user";
const FALLBACK_CONSENT_SIGNING_SECRET = "carepilot-dev-consent-secret-v1";

export type ConsentValidationCode =
  | "consent_token_missing"
  | "consent_token_not_found"
  | "consent_token_expired"
  | "consent_action_type_mismatch"
  | "consent_payload_hash_mismatch"
  | "consent_token_already_used";

export type PolicyBlockedState = {
  blocked: true;
  code: string;
  reason: string;
  userMessage: string;
  eventId: string | null;
};

export type PolicyAllowedState = {
  blocked: false;
};

export type ConsentValidationResult =
  | (PolicyAllowedState & {
      token: CarePilotRow;
      consumed: boolean;
    })
  | (PolicyBlockedState & {
      code: ConsentValidationCode;
    });

export type PolicyDependencyStatus = {
  name: string;
  available: boolean;
  detail?: string;
  error?: unknown;
};

export type FailClosedPolicyResult =
  | PolicyAllowedState
  | (PolicyBlockedState & {
      code: "policy_dependency_unavailable";
      unavailableDependencies: string[];
    });

export type EmitPolicyEventParams = {
  store: CarePilotClinicalStore;
  eventType: string;
  userId?: string | null;
  toolName?: string | null;
  details?: Record<string, unknown>;
  now?: Date;
};

export type IssueConsentTokenParams = {
  store: CarePilotClinicalStore;
  userId: string;
  actionType: string;
  payloadHash: string;
  expiresInSeconds?: number;
  now?: Date;
  signingSecret?: string;
};

export type ValidateConsentTokenParams = {
  store: CarePilotClinicalStore;
  userId: string;
  token: string | null | undefined;
  actionType: string;
  payloadHash: string;
  consume?: boolean;
  now?: Date;
};

export type FailClosedPolicyParams = {
  dependencies: PolicyDependencyStatus[];
  store?: CarePilotClinicalStore;
  userId?: string | null;
  toolName?: string | null;
  now?: Date;
};

function toIso(value: Date): string {
  return value.toISOString();
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveScopedUserId(userId: string | null | undefined): string {
  const resolved = toTrimmedString(userId);
  return resolved || FALLBACK_USER_ID;
}

function toTimestamp(value: unknown): number | null {
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

function normalizeConsentTtlSeconds(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_CONSENT_TTL_SECONDS;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("expires_in_seconds must be a positive number.");
  }
  return Math.floor(value);
}

function resolveSigningSecret(secret: string | undefined): string {
  const provided = toTrimmedString(secret);
  if (provided) {
    return provided;
  }
  const fromEnv = toTrimmedString(process.env.CAREPILOT_CONSENT_TOKEN_SECRET);
  if (fromEnv) {
    return fromEnv;
  }
  return FALLBACK_CONSENT_SIGNING_SECRET;
}

function serializeError(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  return String(value);
}

function stringifyDetails(details: Record<string, unknown> | undefined): string {
  try {
    return JSON.stringify(details ?? {});
  } catch (error) {
    return JSON.stringify({
      serialization_error: serializeError(error),
    });
  }
}

export function emitPolicyEvent(params: EmitPolicyEventParams): CarePilotRow {
  const now = params.now ?? new Date();
  const created = params.store.policyEvents.create({
    id: randomUUID(),
    user_id: toTrimmedString(params.userId) || null,
    event_type: params.eventType,
    tool_name: toTrimmedString(params.toolName) || null,
    details_json: stringifyDetails(params.details),
    created_at: toIso(now),
  });
  return created;
}

export function issueConsentToken(params: IssueConsentTokenParams): CarePilotRow {
  const userId = resolveScopedUserId(params.userId);
  const actionType = toTrimmedString(params.actionType);
  const payloadHash = toTrimmedString(params.payloadHash);
  if (!actionType) {
    throw new Error("actionType is required.");
  }
  if (!payloadHash) {
    throw new Error("payloadHash is required.");
  }

  const now = params.now ?? new Date();
  const ttlSeconds = normalizeConsentTtlSeconds(params.expiresInSeconds);
  const issuedAt = toIso(now);
  const expiresAt = toIso(new Date(now.getTime() + ttlSeconds * 1000));

  const nonce = randomUUID();
  const signaturePayload = `${userId}|${actionType}|${payloadHash}|${issuedAt}|${expiresAt}|${nonce}`;
  const signature = createHmac("sha256", resolveSigningSecret(params.signingSecret))
    .update(signaturePayload, "utf8")
    .digest("hex")
    .slice(0, 32);
  const token = `cpct_${nonce.replace(/-/g, "")}_${signature}`;

  return params.store.consentTokens.create({
    token,
    user_id: userId,
    action_type: actionType,
    payload_hash: payloadHash,
    issued_at: issuedAt,
    expires_at: expiresAt,
    used_at: null,
  });
}

export function validateConsentToken(params: ValidateConsentTokenParams): ConsentValidationResult {
  const token = toTrimmedString(params.token);
  const userId = resolveScopedUserId(params.userId);
  const actionType = toTrimmedString(params.actionType);
  const payloadHash = toTrimmedString(params.payloadHash);
  const now = params.now ?? new Date();

  const blocked = (code: ConsentValidationCode, reason: string): ConsentValidationResult => ({
    blocked: true,
    code,
    reason,
    userMessage: "Unable to continue this action because consent verification failed.",
    eventId: null,
  });

  if (!token) {
    return blocked("consent_token_missing", "Consent token was not provided.");
  }

  const existing = params.store.consentTokens.get(token);
  if (!existing || toTrimmedString(existing.user_id) !== userId) {
    return blocked("consent_token_not_found", "Consent token was not found for this user.");
  }

  const expiresAtMillis = toTimestamp(existing.expires_at);
  if (expiresAtMillis === null || now.getTime() >= expiresAtMillis) {
    return blocked("consent_token_expired", "Consent token is expired or invalid.");
  }

  if (toTrimmedString(existing.action_type) !== actionType) {
    return blocked(
      "consent_action_type_mismatch",
      "Consent token action_type does not match request.",
    );
  }

  if (toTrimmedString(existing.payload_hash) !== payloadHash) {
    return blocked(
      "consent_payload_hash_mismatch",
      "Consent token payload_hash does not match request.",
    );
  }

  if (toTrimmedString(existing.used_at)) {
    return blocked("consent_token_already_used", "Consent token has already been consumed.");
  }

  if (!params.consume) {
    return {
      blocked: false,
      token: existing,
      consumed: false,
    };
  }

  const updated = params.store.consentTokens.update(token, { used_at: toIso(now) });
  if (!updated) {
    return blocked("consent_token_not_found", "Consent token was not found during consume.");
  }

  return {
    blocked: false,
    token: updated,
    consumed: true,
  };
}

export function failClosedWhenPolicyUnavailable(
  params: FailClosedPolicyParams,
): FailClosedPolicyResult {
  const unavailable = params.dependencies.filter((dependency) => !dependency.available);
  if (unavailable.length === 0) {
    return { blocked: false };
  }

  let eventId: string | null = null;
  if (params.store) {
    try {
      const event = emitPolicyEvent({
        store: params.store,
        userId: params.userId,
        toolName: params.toolName ?? null,
        eventType: "policy_unavailable_fail_closed",
        details: {
          unavailable_dependencies: unavailable.map((dependency) => ({
            name: dependency.name,
            detail: dependency.detail ?? null,
            error: dependency.error ? serializeError(dependency.error) : null,
          })),
        },
        now: params.now,
      });
      eventId = toTrimmedString(event.id) || null;
    } catch {
      eventId = null;
    }
  }

  const unavailableNames = unavailable.map((dependency) => dependency.name);
  return {
    blocked: true,
    code: "policy_dependency_unavailable",
    reason: `Policy dependencies unavailable: ${unavailableNames.join(", ")}`,
    userMessage:
      "CarePilot is temporarily unable to verify policy checks. Transactional actions are blocked right now.",
    eventId,
    unavailableDependencies: unavailableNames,
  };
}
