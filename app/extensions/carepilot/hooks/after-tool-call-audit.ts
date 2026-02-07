import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createHash, randomUUID } from "node:crypto";
import type { CarePilotClinicalStore, CarePilotRow } from "../services/clinical-store.js";
import { parseCarePilotPluginConfig } from "../config.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { closeCarePilotDb, openCarePilotDb } from "../services/db.js";
import {
  buildReplayWindowBucket,
  canonicalizePayload,
  computeIdempotencyKeyFromPayload,
  lookupIdempotencyReplay,
} from "../services/idempotency.js";
import { runCarePilotMigrations } from "../services/migrations.js";
import { emitPolicyEvent } from "../services/policy-engine.js";
import { isTransactionalTool } from "./message-received-triage.js";

type ToolParams = Record<string, unknown>;
type OutcomeSummary = {
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
};

const SUCCESS_STATES = new Set(["succeeded", "success", "ok", "completed"]);
const PENDING_STATES = new Set(["pending", "in_progress", "executing", "awaiting_confirmation"]);
const FAILURE_STATES = new Set(["failed", "error", "blocked", "expired", "partial", "cancelled"]);

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toScopedUserId(input: { sessionKey?: string; agentId?: string }): string {
  const sessionKey = toTrimmedString(input.sessionKey);
  if (sessionKey) {
    return sessionKey;
  }
  const agentId = toTrimmedString(input.agentId);
  if (agentId) {
    return agentId;
  }
  return "default_user";
}

function asObject(value: unknown): ToolParams {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as ToolParams) };
  }
  return {};
}

function withStore<T>(api: OpenClawPluginApi, run: (store: CarePilotClinicalStore) => T): T {
  const config = parseCarePilotPluginConfig(api.pluginConfig);
  const db = openCarePilotDb(config.dbPath);
  try {
    runCarePilotMigrations({ db, logger: api.logger });
    const store = createCarePilotClinicalStore(db);
    return run(store);
  } finally {
    closeCarePilotDb(db);
  }
}

function buildConsentPayload(params: ToolParams): ToolParams {
  const payload = { ...params };
  delete payload.consent_token;
  delete payload.idempotency_key;
  return payload;
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalizePayload(payload), "utf8").digest("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex").slice(0, 16);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function deriveToolResultPayload(result: unknown): Record<string, unknown> | null {
  const direct = asRecord(result);
  if (!direct) {
    return null;
  }
  const details = asRecord(direct.details);
  if (details) {
    return details;
  }
  return direct;
}

function deriveToolError(payload: Record<string, unknown> | null): {
  code: string | null;
  message: string | null;
} {
  if (!payload || !Array.isArray(payload.errors)) {
    return { code: null, message: null };
  }
  const firstError = payload.errors[0];
  const first = asRecord(firstError);
  if (!first) {
    return { code: null, message: null };
  }
  return {
    code: toTrimmedString(first.code) || null,
    message: toTrimmedString(first.message) || null,
  };
}

function normalizeStatus(rawStatus: string, defaultStatus: "succeeded" | "failed"): string {
  if (!rawStatus) {
    return defaultStatus;
  }
  if (SUCCESS_STATES.has(rawStatus)) {
    return "succeeded";
  }
  if (PENDING_STATES.has(rawStatus)) {
    return "pending";
  }
  if (FAILURE_STATES.has(rawStatus)) {
    return "failed";
  }
  return defaultStatus;
}

function summarizeOutcome(params: {
  payload: Record<string, unknown> | null;
  eventError?: string;
}): OutcomeSummary {
  const payload = params.payload;
  const topStatus = toTrimmedString(payload?.status).toLowerCase();
  const data = asRecord(payload?.data);
  const dataStatus = toTrimmedString(data?.request_execution_status ?? data?.status).toLowerCase();
  const statusSource = dataStatus || topStatus;

  if (params.eventError) {
    const derivedError = deriveToolError(payload);
    return {
      status: normalizeStatus(statusSource, "failed"),
      errorCode: derivedError.code ?? "tool_execution_error",
      errorMessage: derivedError.message ?? params.eventError,
    };
  }

  const derivedError = deriveToolError(payload);
  const status = normalizeStatus(statusSource, derivedError.message ? "failed" : "succeeded");
  return {
    status,
    errorCode: derivedError.code ?? null,
    errorMessage: status === "failed" ? (derivedError.message ?? "Unknown tool failure.") : null,
  };
}

function resolveTargetRef(toolName: string, payload: ToolParams): string {
  if (toolName === "appointment_book") {
    const providerId = toTrimmedString(payload.provider_id) || "unknown_provider";
    const slotDatetime = toTrimmedString(payload.slot_datetime) || "unknown_slot";
    return `${providerId}|${slotDatetime}`;
  }

  if (toolName === "medication_refill_request") {
    const medicationId = toTrimmedString(payload.medication_id) || "unknown_medication";
    const pharmacyTarget = toTrimmedString(payload.pharmacy_target) || "unknown_pharmacy";
    return `${medicationId}|${pharmacyTarget}`;
  }

  if (toolName === "human_escalation_create") {
    const reason = toTrimmedString(payload.reason) || "unspecified_reason";
    return reason;
  }

  return toolName;
}

function computeActionAuditId(params: {
  userId: string;
  toolName: string;
  idempotencyKey: string;
  replayWindowBucket: string;
}): string {
  return createHash("sha256")
    .update(
      `${params.userId}|${params.toolName}|${params.idempotencyKey}|${params.replayWindowBucket}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 24);
}

function toIso(value: Date): string {
  return value.toISOString();
}

function resolveStartedAt(now: Date, durationMs: number | undefined): string {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
    return toIso(now);
  }
  return toIso(new Date(now.getTime() - Math.floor(durationMs)));
}

function buildConsentSnapshot(params: {
  store: CarePilotClinicalStore;
  consentToken: string | null;
  idempotencyKey: string;
  replayWindowBucket: string;
  replayState: string;
  replayRow: CarePilotRow | null;
}): string {
  const tokenRow = params.consentToken ? params.store.consentTokens.get(params.consentToken) : null;
  const snapshot = {
    consent: {
      token_present: Boolean(params.consentToken),
      token_hash: params.consentToken ? hashToken(params.consentToken) : null,
      token_record: tokenRow
        ? {
            issued_at: toTrimmedString(tokenRow.issued_at) || null,
            expires_at: toTrimmedString(tokenRow.expires_at) || null,
            used_at: toTrimmedString(tokenRow.used_at) || null,
            action_type: toTrimmedString(tokenRow.action_type) || null,
            payload_hash: toTrimmedString(tokenRow.payload_hash) || null,
          }
        : null,
    },
    idempotency: {
      key: params.idempotencyKey,
      replay_window_bucket: params.replayWindowBucket,
      replay_state_before_write: params.replayState,
      replay_row_id: params.replayRow ? toTrimmedString(params.replayRow.id) || null : null,
    },
  };
  return JSON.stringify(snapshot);
}

export function registerAfterToolCallAuditHook(api: OpenClawPluginApi): void {
  api.on("after_tool_call", async (event, ctx) => {
    const toolName = toTrimmedString(event.toolName).toLowerCase();
    if (!isTransactionalTool(toolName)) {
      return;
    }

    const now = new Date();
    const userId = toScopedUserId({
      sessionKey: ctx.sessionKey,
      agentId: ctx.agentId,
    });
    const inputParams = asObject(event.params);
    const consentPayload = buildConsentPayload(inputParams);
    const payloadHash = hashPayload(consentPayload);
    const consentToken = toTrimmedString(inputParams.consent_token) || null;
    const replayWindowBucket = buildReplayWindowBucket(now);

    try {
      withStore(api, (store) => {
        const targetRef = resolveTargetRef(toolName, consentPayload);
        const normalizedIdempotencyKey =
          toTrimmedString(inputParams.idempotency_key) ||
          computeIdempotencyKeyFromPayload({
            userId,
            actionType: toolName,
            payload: consentPayload,
            targetRef,
          });

        const replayLookup = lookupIdempotencyReplay({
          store,
          userId,
          idempotencyKey: normalizedIdempotencyKey,
          replayWindowBucket,
        });

        const payload = deriveToolResultPayload(event.result);
        const summary = summarizeOutcome({
          payload,
          eventError: toTrimmedString(event.error) || undefined,
        });

        const auditIdFromReplay = replayLookup.row ? toTrimmedString(replayLookup.row.id) : "";
        const auditId =
          auditIdFromReplay ||
          computeActionAuditId({
            userId,
            toolName,
            idempotencyKey: normalizedIdempotencyKey,
            replayWindowBucket,
          }) ||
          randomUUID();

        const consentSnapshotJson = buildConsentSnapshot({
          store,
          consentToken,
          idempotencyKey: normalizedIdempotencyKey,
          replayWindowBucket,
          replayState: replayLookup.state,
          replayRow: replayLookup.row,
        });

        if (auditIdFromReplay) {
          store.actionAudit.update(auditId, {
            action_type: toolName,
            payload_hash: payloadHash,
            idempotency_key: normalizedIdempotencyKey,
            consent_token: consentToken,
            status: summary.status,
            error_code: summary.errorCode,
            error_message: summary.errorMessage,
            consent_snapshot_json: consentSnapshotJson,
            replay_window_bucket: replayWindowBucket,
            finished_at: toIso(now),
          });
        } else {
          store.actionAudit.create({
            id: auditId,
            user_id: userId,
            action_type: toolName,
            payload_hash: payloadHash,
            idempotency_key: normalizedIdempotencyKey,
            consent_token: consentToken,
            status: summary.status,
            error_code: summary.errorCode,
            error_message: summary.errorMessage,
            consent_snapshot_json: consentSnapshotJson,
            replay_window_bucket: replayWindowBucket,
            started_at: resolveStartedAt(now, event.durationMs),
            finished_at: toIso(now),
          });
        }

        emitPolicyEvent({
          store,
          userId,
          toolName,
          eventType: "action_audit_written",
          details: {
            action_audit_id: auditId,
            status: summary.status,
            error_code: summary.errorCode,
            replay_state: replayLookup.state,
            replay_window_bucket: replayWindowBucket,
            idempotency_key: normalizedIdempotencyKey,
            consent_token_present: Boolean(consentToken),
          },
          now,
        });
      });
    } catch (error) {
      api.logger.warn(
        `[carepilot] after_tool_call audit write failed: tool=${toolName} error=${String(error)}`,
      );
    }
  });
}
