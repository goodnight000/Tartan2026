import { Type } from "@sinclair/typebox";
import { createHash } from "node:crypto";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { CarePilotClinicalStore } from "../services/clinical-store.js";
import { parseCarePilotPluginConfig } from "../config.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { closeCarePilotDb, openCarePilotDb } from "../services/db.js";
import { runCarePilotMigrations } from "../services/migrations.js";
import { emitPolicyEvent, issueConsentToken } from "../services/policy-engine.js";

const DEFAULT_EXPIRES_IN_SECONDS = 300;
const MAX_EXPIRES_IN_SECONDS = 3600;

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

function parseExpiresInSeconds(raw: unknown): { value: number | null; error: string | null } {
  if (raw === undefined) {
    return { value: DEFAULT_EXPIRES_IN_SECONDS, error: null };
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { value: null, error: "expires_in_seconds must be a number when provided." };
  }
  const floored = Math.floor(raw);
  if (floored <= 0 || floored > MAX_EXPIRES_IN_SECONDS) {
    return {
      value: null,
      error: `expires_in_seconds must be between 1 and ${MAX_EXPIRES_IN_SECONDS}.`,
    };
  }
  return { value: floored, error: null };
}

export function createConsentTokenIssueTool(api: OpenClawPluginApi, options?: { userId?: string }) {
  const userId = resolveToolUserId(options?.userId);
  return {
    name: "consent_token_issue",
    description: "Issue a signed one-time consent token bound to action_type + payload_hash.",
    parameters: Type.Object({
      action_type: Type.String(),
      payload_hash: Type.String(),
      expires_in_seconds: Type.Optional(
        Type.Number({
          minimum: 1,
          maximum: MAX_EXPIRES_IN_SECONDS,
        }),
      ),
    }),
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const actionType =
        typeof rawParams.action_type === "string" ? rawParams.action_type.trim() : "";
      const payloadHash =
        typeof rawParams.payload_hash === "string" ? rawParams.payload_hash.trim() : "";
      const expires = parseExpiresInSeconds(rawParams.expires_in_seconds);

      if (!actionType || !payloadHash || expires.error || expires.value == null) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code: "invalid_input",
              message:
                expires.error ??
                "action_type and payload_hash are required, and expires_in_seconds must be valid.",
            },
          ],
        });
      }

      try {
        const issued = withStore(api, (store) => {
          const tokenRow = issueConsentToken({
            store,
            userId,
            actionType,
            payloadHash,
            expiresInSeconds: expires.value,
          });

          const consentToken = String(tokenRow.token ?? "");
          const tokenHash = createHash("sha256").update(consentToken, "utf8").digest("hex");

          const policyEvent = emitPolicyEvent({
            store,
            userId,
            toolName: "consent_token_issue",
            eventType: "consent_token_issued",
            details: {
              action_type: actionType,
              payload_hash: payloadHash,
              expires_at: String(tokenRow.expires_at ?? ""),
              token_hash: tokenHash,
            },
          });

          return {
            token: consentToken,
            issuedAt: String(tokenRow.issued_at ?? ""),
            expiresAt: String(tokenRow.expires_at ?? ""),
            policyEventId: typeof policyEvent.id === "string" ? policyEvent.id : null,
          };
        });

        return jsonResult({
          status: "ok",
          data: {
            consent_token: issued.token,
            action_type: actionType,
            payload_hash: payloadHash,
            issued_at: issued.issuedAt,
            expires_at: issued.expiresAt,
            expires_in_seconds: expires.value,
            policy_event_id: issued.policyEventId,
          },
          errors: [],
        });
      } catch (error) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code: "consent_token_issue_failed",
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        });
      }
    },
  };
}
