import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parseCarePilotPluginConfig } from "../config.js";
import type { CarePilotClinicalStore } from "../services/clinical-store.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { closeCarePilotDb, openCarePilotDb } from "../services/db.js";
import { runCarePilotMigrations } from "../services/migrations.js";
import { validateConsentToken } from "../services/policy-engine.js";

type AppointmentLifecycleStatus =
  | "planned"
  | "awaiting_confirmation"
  | "executing"
  | "succeeded"
  | "failed"
  | "partial"
  | "blocked"
  | "expired"
  | "pending";

const ALLOWED_TRANSITIONS: Record<AppointmentLifecycleStatus, AppointmentLifecycleStatus[]> = {
  planned: ["awaiting_confirmation"],
  awaiting_confirmation: ["executing"],
  executing: ["succeeded", "failed", "partial", "blocked", "expired", "pending"],
  succeeded: [],
  failed: [],
  partial: [],
  blocked: [],
  expired: [],
  pending: [],
};

type TransitionRecord = {
  from: AppointmentLifecycleStatus;
  to: AppointmentLifecycleStatus;
  at: string;
};

type ExternalMode = "simulated" | "real_api" | "call_to_book";
const RECENT_CONSENT_USE_WINDOW_MS = 15_000;

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

export function assertLifecycleTransition(
  from: AppointmentLifecycleStatus,
  to: AppointmentLifecycleStatus,
  params: { consentToken: string | null },
): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid lifecycle transition: ${from} -> ${to}`);
  }
  if (from === "awaiting_confirmation" && to === "executing" && !params.consentToken) {
    throw new Error("Cannot move to executing without consent token.");
  }
}

function toOutputStatus(status: AppointmentLifecycleStatus): "executing" | "succeeded" | "failed" | "pending" {
  if (status === "awaiting_confirmation") {
    return "pending";
  }
  if (status === "blocked" || status === "partial" || status === "expired") {
    return "failed";
  }
  if (status === "executing" || status === "succeeded" || status === "failed" || status === "pending") {
    return status;
  }
  return "pending";
}

function resolveToolUserId(value: string | undefined): string {
  const userId = typeof value === "string" ? value.trim() : "";
  return userId || "default_user";
}

function appointmentId(params: {
  userId: string;
  providerId: string;
  slotDatetime: string;
  location: string;
  mode: ExternalMode;
  idempotencyKey: string;
}): string {
  return createHash("sha256")
    .update(
      `${params.userId}|appointment_book|${params.providerId}|${params.slotDatetime}|${params.location}|${params.mode}|${params.idempotencyKey}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 24);
}

function isoNow(): string {
  return new Date().toISOString();
}

function buildAppointmentPayloadHash(params: {
  providerId: string;
  slotDatetime: string;
  location: string;
  mode: ExternalMode;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider_id: params.providerId,
        slot_datetime: params.slotDatetime,
        location: params.location,
        mode: params.mode,
      }),
      "utf8",
    )
    .digest("hex");
}

function validateAppointmentConsent(params: {
  store: CarePilotClinicalStore;
  userId: string;
  consentToken: string;
  payloadHash: string;
  now: Date;
}):
  | { blocked: false }
  | {
      blocked: true;
      code: string;
      message: string;
    } {
  const validation = validateConsentToken({
    store: params.store,
    userId: params.userId,
    token: params.consentToken,
    actionType: "appointment_book",
    payloadHash: params.payloadHash,
    consume: false,
    now: params.now,
  });

  if (!validation.blocked) {
    return { blocked: false };
  }
  if (validation.code === "consent_token_already_used") {
    const tokenRow = params.store.consentTokens.get(params.consentToken);
    const usedAtRaw = typeof tokenRow?.used_at === "string" ? tokenRow.used_at : "";
    const usedAtMillis = Date.parse(usedAtRaw);
    if (
      Number.isFinite(usedAtMillis) &&
      params.now.getTime() - usedAtMillis >= 0 &&
      params.now.getTime() - usedAtMillis <= RECENT_CONSENT_USE_WINDOW_MS
    ) {
      return { blocked: false };
    }
  }

  return {
    blocked: true,
    code: validation.code,
    message: validation.userMessage,
  };
}

export function createAppointmentBookTool(
  api: OpenClawPluginApi,
  options?: { userId?: string },
) {
  const userId = resolveToolUserId(options?.userId);
  return {
    name: "appointment_book",
    description: "Execute guarded appointment lifecycle transitions with deterministic status outputs.",
    parameters: Type.Object({
      provider_id: Type.String(),
      slot_datetime: Type.String(),
      location: Type.String(),
      mode: Type.Union([Type.Literal("simulated"), Type.Literal("real_api"), Type.Literal("call_to_book")]),
      consent_token: Type.String(),
      idempotency_key: Type.String(),
    }),
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const providerId = typeof rawParams.provider_id === "string" ? rawParams.provider_id.trim() : "";
      const slotDatetime = typeof rawParams.slot_datetime === "string" ? rawParams.slot_datetime.trim() : "";
      const location = typeof rawParams.location === "string" ? rawParams.location.trim() : "";
      const mode = rawParams.mode as ExternalMode;
      const consentToken =
        typeof rawParams.consent_token === "string" && rawParams.consent_token.trim()
          ? rawParams.consent_token.trim()
          : null;
      const idempotencyKey =
        typeof rawParams.idempotency_key === "string" ? rawParams.idempotency_key.trim() : "";

      if (!providerId || !slotDatetime || !location || !idempotencyKey) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [{ code: "invalid_input", message: "provider_id, slot_datetime, location, idempotency_key are required." }],
        });
      }

      if (mode !== "simulated" && mode !== "real_api" && mode !== "call_to_book") {
        return jsonResult({
          status: "error",
          data: null,
          errors: [{ code: "invalid_mode", message: "mode must be simulated|real_api|call_to_book." }],
        });
      }

      if (!consentToken) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code: "consent_token_missing",
              message: "Consent token is required before appointment booking can proceed.",
            },
          ],
        });
      }

      const payloadHash = buildAppointmentPayloadHash({
        providerId,
        slotDatetime,
        location,
        mode,
      });
      const parsedSlot = Date.parse(slotDatetime);
      const uncertain = !Number.isFinite(parsedSlot);
      const id = appointmentId({
        userId,
        providerId,
        slotDatetime,
        location,
        mode,
        idempotencyKey,
      });
      const transitions: TransitionRecord[] = [];

      try {
        const result = withStore(api, (store) => {
          const consentGate = validateAppointmentConsent({
            store,
            userId,
            consentToken,
            payloadHash,
            now: new Date(),
          });
          if (consentGate.blocked) {
            return {
              blocked: true,
              errorCode: consentGate.code,
              errorMessage: consentGate.message,
            };
          }

          const existing = store.appointments.get(id);
          if (existing && String(existing.user_id ?? "") === userId) {
            const existingStatus = String(existing.status) as AppointmentLifecycleStatus;
            return {
              blocked: false,
              appointment: existing,
              replay: true,
              finalStatus: existingStatus,
              artifact:
                existingStatus === "succeeded"
                  ? { sim_ref: String(existing.external_ref ?? `sim-${id}`) }
                  : existingStatus === "pending"
                    ? { external_ref: String(existing.external_ref ?? `pending-${id}`) }
                    : null,
            };
          }

          let currentStatus: AppointmentLifecycleStatus = "planned";
          const step = (to: AppointmentLifecycleStatus) => {
            assertLifecycleTransition(currentStatus, to, { consentToken });
            transitions.push({ from: currentStatus, to, at: isoNow() });
            currentStatus = to;
          };

          step("awaiting_confirmation");

          let artifact: { sim_ref?: string; external_ref?: string } | null = null;
          step("executing");
          if (uncertain) {
            step("failed");
          } else if (mode === "simulated") {
            step("succeeded");
            artifact = { sim_ref: `sim-${id}` };
          } else {
            step("pending");
            artifact = { external_ref: `pending-${id}` };
          }

          const stored = store.appointments.create({
            id,
            user_id: userId,
            provider_name: providerId,
            location,
            starts_at: slotDatetime,
            status: currentStatus,
            external_ref: artifact?.external_ref ?? artifact?.sim_ref ?? null,
          });

          return {
            blocked: false,
            appointment: stored,
            replay: false,
            finalStatus: currentStatus,
            artifact,
          };
        });

        if (result.blocked) {
          return jsonResult({
            status: "error",
            data: null,
            errors: [
              {
                code: result.errorCode,
                message: result.errorMessage,
              },
            ],
          });
        }

        return jsonResult({
          status: "ok",
          data: {
            lifecycle_transition_event: transitions.length > 0 ? transitions[transitions.length - 1] : null,
            lifecycle_transitions: transitions,
            status: toOutputStatus(result.finalStatus),
            confirmation_artifact: result.artifact,
            appointment_id: id,
            replayed_from_idempotency: result.replay,
          },
          errors: [],
        });
      } catch (error) {
        return jsonResult({
          status: "error",
          data: {
            lifecycle_transition_event: transitions.length > 0 ? transitions[transitions.length - 1] : null,
            lifecycle_transitions: transitions,
            status: "failed",
            confirmation_artifact: null,
            appointment_id: id,
          },
          errors: [
            {
              code: "appointment_failed",
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        });
      }
    },
  };
}
