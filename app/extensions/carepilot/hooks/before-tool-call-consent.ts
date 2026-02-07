import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createHash } from "node:crypto";
import type { CarePilotClinicalStore } from "../services/clinical-store.js";
import { parseCarePilotPluginConfig } from "../config.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { closeCarePilotDb, openCarePilotDb } from "../services/db.js";
import { canonicalizePayload, computeIdempotencyKeyFromPayload } from "../services/idempotency.js";
import { runCarePilotMigrations } from "../services/migrations.js";
import {
  emitPolicyEvent,
  failClosedWhenPolicyUnavailable,
  validateConsentToken,
} from "../services/policy-engine.js";
import { getEmergentContextForSession, isTransactionalTool } from "./message-received-triage.js";

type ToolParams = Record<string, unknown>;

type ConsentDecision =
  | {
      blocked: true;
      reason: string;
    }
  | {
      blocked: false;
      paramsPatch: ToolParams;
    };

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

function normalizePayloadValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizePayloadValue(entry));
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      normalized[key] = normalizePayloadValue(source[key]);
    }
    return normalized;
  }
  return value;
}

function hashPayload(payload: unknown): string {
  const canonical = canonicalizePayload(normalizePayloadValue(payload));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function hashToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
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

function blockWithReason(reason: string): { block: true; blockReason: string } {
  return {
    block: true,
    blockReason: reason,
  };
}

function evaluateConsentChecks(params: {
  store: CarePilotClinicalStore;
  userId: string;
  toolName: string;
  inputParams: ToolParams;
  now: Date;
}): ConsentDecision {
  const payload = normalizePayloadValue(
    buildConsentPayload(params.inputParams),
  ) as ToolParams;
  const payloadHash = hashPayload(payload);
  const targetRef = resolveTargetRef(params.toolName, payload);
  const normalizedIdempotencyKey = computeIdempotencyKeyFromPayload({
    userId: params.userId,
    actionType: params.toolName,
    payload,
    targetRef,
  });

  const consentToken = toTrimmedString(params.inputParams.consent_token) || null;
  const validation = validateConsentToken({
    store: params.store,
    userId: params.userId,
    token: consentToken,
    actionType: params.toolName,
    payloadHash,
    consume: true,
    now: params.now,
  });

  if (validation.blocked) {
    const tokenHash = consentToken ? hashToken(consentToken) : null;
    const policyEvent = emitPolicyEvent({
      store: params.store,
      userId: params.userId,
      toolName: params.toolName,
      eventType: "consent_validation_failed",
      details: {
        code: validation.code,
        reason: validation.reason,
        user_message: validation.userMessage,
        token_hash: tokenHash,
        payload_hash: payloadHash,
      },
      now: params.now,
    });
    return {
      blocked: true,
      reason: `${validation.userMessage} (policy_event=${String(policyEvent.id ?? "unknown")})`,
    };
  }

  const paramsPatch: ToolParams = {};
  const existingIdempotencyKey = toTrimmedString(params.inputParams.idempotency_key);
  if (existingIdempotencyKey !== normalizedIdempotencyKey) {
    paramsPatch.idempotency_key = normalizedIdempotencyKey;
  }

  emitPolicyEvent({
    store: params.store,
    userId: params.userId,
    toolName: params.toolName,
    eventType: "consent_validated",
    details: {
      consumed: validation.consumed,
      token_hash: hashToken(toTrimmedString(validation.token.token)),
      payload_hash: payloadHash,
      idempotency_key: normalizedIdempotencyKey,
      idempotency_key_normalized: existingIdempotencyKey !== normalizedIdempotencyKey,
    },
    now: params.now,
  });

  return {
    blocked: false,
    paramsPatch,
  };
}

export function registerBeforeToolCallConsentHook(api: OpenClawPluginApi): void {
  api.on("before_tool_call", async (event, ctx) => {
    const toolName = toTrimmedString(event.toolName).toLowerCase();
    if (!isTransactionalTool(toolName)) {
      return;
    }

    const now = new Date();
    const sessionKey = toTrimmedString(ctx.sessionKey) || undefined;
    const userId = toScopedUserId({
      sessionKey,
      agentId: ctx.agentId,
    });
    const inputParams = asObject(event.params);

    const emergentContext = getEmergentContextForSession(sessionKey);
    if (emergentContext) {
      try {
        withStore(api, (store) => {
          emitPolicyEvent({
            store,
            userId,
            toolName,
            eventType: "transaction_blocked_emergent_context",
            details: {
              triage_level: emergentContext.triageLevel,
              recommended_next_step: emergentContext.recommendedNextStep,
              signals: emergentContext.signals,
              emergent_key: emergentContext.key,
            },
            now,
          });
        });
      } catch (error) {
        api.logger.warn(`[carepilot] emergent block policy event write failed: ${String(error)}`);
      }

      return blockWithReason(
        "Emergency context is active. Transactional actions are blocked until emergency guidance is resolved.",
      );
    }

    try {
      const decision = withStore(api, (store) => {
        try {
          const dependencyCheck = failClosedWhenPolicyUnavailable({
            dependencies: [
              {
                name: "carepilot_store",
                available: true,
              },
              {
                name: "policy_engine",
                available: true,
              },
            ],
            store,
            userId,
            toolName,
            now,
          });
          if (dependencyCheck.blocked) {
            return {
              blocked: true,
              reason: dependencyCheck.userMessage,
            } satisfies ConsentDecision;
          }

          return evaluateConsentChecks({
            store,
            userId,
            toolName,
            inputParams,
            now,
          });
        } catch (error) {
          const failClosed = failClosedWhenPolicyUnavailable({
            dependencies: [
              {
                name: "policy_runtime",
                available: false,
                detail: "Exception while evaluating consent policy.",
                error,
              },
            ],
            store,
            userId,
            toolName,
            now,
          });
          return {
            blocked: true,
            reason: failClosed.userMessage,
          } satisfies ConsentDecision;
        }
      });

      if (decision.blocked) {
        return blockWithReason(decision.reason);
      }

      if (Object.keys(decision.paramsPatch).length > 0) {
        return {
          params: {
            ...inputParams,
            ...decision.paramsPatch,
          },
        };
      }

      return;
    } catch (error) {
      const failClosed = failClosedWhenPolicyUnavailable({
        dependencies: [
          {
            name: "carepilot_store",
            available: false,
            detail: "CarePilot DB or migrations unavailable during consent gate.",
            error,
          },
        ],
        userId,
        toolName,
        now,
      });
      return blockWithReason(failClosed.userMessage);
    }
  });
}
