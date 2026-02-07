import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parseCarePilotPluginConfig } from "../config.js";
import type { CarePilotClinicalStore } from "../services/clinical-store.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { closeCarePilotDb, openCarePilotDb } from "../services/db.js";
import { buildReplayWindowBucket, lookupIdempotencyReplay } from "../services/idempotency.js";
import { runCarePilotMigrations } from "../services/migrations.js";
import { validateConsentToken } from "../services/policy-engine.js";
import { estimateRefillRunout } from "../services/refill-estimator.js";

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

function resolveToolUserId(value: string | undefined): string {
  const userId = typeof value === "string" ? value.trim() : "";
  return userId || "default_user";
}

function actionId(params: { userId: string; medicationId: string; idempotencyKey: string }): string {
  return createHash("sha256")
    .update(`${params.userId}|medication_refill_request|${params.medicationId}|${params.idempotencyKey}`, "utf8")
    .digest("hex")
    .slice(0, 24);
}

function buildRefillPayloadHash(params: {
  medicationId: string;
  pharmacyTarget: string;
  remainingPillsReported: number | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        medication_id: params.medicationId,
        pharmacy_target: params.pharmacyTarget,
        remaining_pills_reported: params.remainingPillsReported,
      }),
      "utf8",
    )
    .digest("hex");
}

export function createMedicationRefillRequestTool(
  api: OpenClawPluginApi,
  options?: { userId?: string },
) {
  const userId = resolveToolUserId(options?.userId);

  return {
    name: "medication_refill_request",
    description: "Estimate run-out date and create refill request status with conservative confidence handling.",
    parameters: Type.Object({
      medication_id: Type.String(),
      pharmacy_target: Type.String(),
      remaining_pills_reported: Type.Optional(Type.Number({ minimum: 0 })),
      consent_token: Type.String(),
      idempotency_key: Type.String(),
    }),
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const medicationId = typeof rawParams.medication_id === "string" ? rawParams.medication_id.trim() : "";
      const pharmacyTarget =
        typeof rawParams.pharmacy_target === "string" ? rawParams.pharmacy_target.trim() : "";
      const remainingPillsReported =
        typeof rawParams.remaining_pills_reported === "number" ? rawParams.remaining_pills_reported : null;
      const consentToken =
        typeof rawParams.consent_token === "string" && rawParams.consent_token.trim()
          ? rawParams.consent_token.trim()
          : null;
      const idempotencyKey =
        typeof rawParams.idempotency_key === "string" ? rawParams.idempotency_key.trim() : "";

      if (!medicationId || !pharmacyTarget || !idempotencyKey) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [{ code: "invalid_input", message: "medication_id, pharmacy_target, idempotency_key are required." }],
        });
      }

      try {
        const data = withStore(api, (store) => {
          if (!consentToken) {
            return {
              status: "blocked" as const,
              result: null,
              code: "consent_token_missing",
              reason: "Consent token is required before refill execution can proceed.",
            };
          }

          const medication = store.medications.get(medicationId);
          if (!medication || String(medication.user_id ?? "") !== userId) {
            return {
              status: "failed" as const,
              result: null,
              code: "medication_not_found",
              reason: "Medication not found.",
            };
          }

          const estimatorResult = estimateRefillRunout({
            medication_id: medicationId,
            medication_name: String(medication.name ?? medicationId),
            medication_status: typeof medication.status === "string" ? medication.status : null,
            last_fill_date: typeof medication.last_fill_date === "string" ? medication.last_fill_date : null,
            quantity_dispensed:
              typeof medication.quantity_dispensed === "number" ? medication.quantity_dispensed : null,
            frequency_per_day:
              typeof medication.frequency_per_day === "number" ? medication.frequency_per_day : null,
            remaining_pills_reported: remainingPillsReported,
          });

          const requestRef = `sim-refill-${actionId({ userId, medicationId, idempotencyKey })}`;
          const payloadHash = buildRefillPayloadHash({
            medicationId,
            pharmacyTarget,
            remainingPillsReported,
          });
          const replayWindowBucket = buildReplayWindowBucket(new Date());
          const replay = lookupIdempotencyReplay({
            store,
            userId,
            idempotencyKey,
            replayWindowBucket,
          });

          if (replay.state === "replay_success" || replay.state === "in_progress") {
            const replayRowConsentToken =
              typeof replay.row?.consent_token === "string" ? replay.row.consent_token : "";
            if (!replayRowConsentToken || replayRowConsentToken !== consentToken) {
              return {
                status: "blocked" as const,
                result: null,
                code: "consent_token_replay_mismatch",
                reason: "Consent token does not match the original confirmed request.",
              };
            }

            const replayConsentValidation = validateConsentToken({
              store,
              userId,
              token: consentToken,
              actionType: "medication_refill_request",
              payloadHash,
              consume: false,
              now: new Date(),
            });
            if (
              replayConsentValidation.blocked &&
              replayConsentValidation.code !== "consent_token_already_used"
            ) {
              return {
                status: "blocked" as const,
                result: null,
                code: replayConsentValidation.code,
                reason: replayConsentValidation.userMessage,
              };
            }
          }

          if (replay.state === "replay_success") {
            return {
              status: "succeeded" as const,
              result: {
                run_out_estimate: {
                  estimated_runout_date: estimatorResult.runout_estimate_date,
                  confidence: estimatorResult.confidence,
                  confidence_label: estimatorResult.confidence_label,
                  rationale: estimatorResult.rationale,
                },
                request_execution_status: "succeeded",
                recommended_follow_up_date: estimatorResult.follow_up_date,
                request_ref: requestRef,
              },
              code: null,
              reason: null,
            };
          }

          if (replay.state === "in_progress") {
            return {
              status: "pending" as const,
              result: {
                run_out_estimate: {
                  estimated_runout_date: estimatorResult.runout_estimate_date,
                  confidence: estimatorResult.confidence,
                  confidence_label: estimatorResult.confidence_label,
                  rationale: estimatorResult.rationale,
                },
                request_execution_status: "pending",
                recommended_follow_up_date: estimatorResult.follow_up_date,
                request_ref: null,
              },
              code: null,
              reason: null,
            };
          }

          if (replay.state === "terminal_non_success") {
            return {
              status: "blocked" as const,
              result: null,
              code: "duplicate_non_success_replay",
              reason:
                "A previous request with this idempotency key failed in the active replay window. Re-confirm and submit a new idempotency key.",
            };
          }

          const consentValidationNow = new Date();
          const consentValidation = validateConsentToken({
            store,
            userId,
            token: consentToken,
            actionType: "medication_refill_request",
            payloadHash,
            consume: false,
            now: consentValidationNow,
          });
          if (consentValidation.blocked) {
            if (consentValidation.code === "consent_token_already_used") {
              const tokenRow = store.consentTokens.get(consentToken);
              const usedAtRaw = typeof tokenRow?.used_at === "string" ? tokenRow.used_at : "";
              const usedAtMillis = Date.parse(usedAtRaw);
              const usedRecently =
                Number.isFinite(usedAtMillis) &&
                consentValidationNow.getTime() - usedAtMillis >= 0 &&
                consentValidationNow.getTime() - usedAtMillis <= RECENT_CONSENT_USE_WINDOW_MS;
              if (usedRecently) {
                // Hook-level validation may consume just before tool execution.
              } else {
                return {
                  status: "blocked" as const,
                  result: null,
                  code: consentValidation.code,
                  reason: consentValidation.userMessage,
                };
              }
            } else {
              return {
                status: "blocked" as const,
                result: null,
                code: consentValidation.code,
                reason: consentValidation.userMessage,
              };
            }
          }

          const needsConfirmation = estimatorResult.requires_confirmation;
          const executionStatus = needsConfirmation ? "pending" : "succeeded";
          const followUpDate = estimatorResult.follow_up_date;

          const nowIso = new Date().toISOString();
          store.actionAudit.create({
            id: actionId({ userId, medicationId, idempotencyKey }),
            user_id: userId,
            action_type: "medication_refill_request",
            payload_hash: payloadHash,
            idempotency_key: idempotencyKey,
            consent_token: consentToken,
            status: executionStatus,
            error_code: null,
            error_message: null,
            consent_snapshot_json: JSON.stringify({ consent_token: consentToken }),
            replay_window_bucket: replayWindowBucket,
            started_at: nowIso,
            finished_at: executionStatus === "pending" ? null : nowIso,
          });

          return {
            status: executionStatus as "pending" | "succeeded",
            result: {
              run_out_estimate: {
                estimated_runout_date: estimatorResult.runout_estimate_date,
                confidence: estimatorResult.confidence,
                confidence_label: estimatorResult.confidence_label,
                rationale: estimatorResult.rationale,
              },
              request_execution_status: executionStatus,
              recommended_follow_up_date: followUpDate,
              request_ref: needsConfirmation ? null : requestRef,
            },
            code: null,
            reason: null,
          };
        });

        if (data.status === "failed" || data.status === "blocked") {
          return jsonResult({
            status: "error",
            data: {
              run_out_estimate: null,
              request_execution_status: "failed",
              recommended_follow_up_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
            },
            errors: [{ code: data.code ?? "refill_request_blocked", message: data.reason }],
          });
        }

        return jsonResult({
          status: "ok",
          data: data.result,
          errors: [],
        });
      } catch (error) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code: "refill_request_failed",
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        });
      }
    },
  };
}
