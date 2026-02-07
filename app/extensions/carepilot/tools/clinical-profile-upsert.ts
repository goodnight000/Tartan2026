import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parseCarePilotPluginConfig } from "../config.js";
import type { CarePilotClinicalStore, CarePilotRow } from "../services/clinical-store.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { closeCarePilotDb, openCarePilotDb } from "../services/db.js";
import { runCarePilotMigrations } from "../services/migrations.js";

const ENTITY_TYPES = [
  "patient_profile",
  "conditions",
  "allergies",
  "medications",
  "symptom_states",
] as const;
const OPERATIONS = ["create", "update", "resolve", "delete_soft"] as const;
const WRITE_SOURCES = ["user_direct", "tool_result", "model_inference"] as const;

type EntityType = (typeof ENTITY_TYPES)[number];
type Operation = (typeof OPERATIONS)[number];
type WriteSource = (typeof WRITE_SOURCES)[number];

type WriteGuardResult = {
  allowed: boolean;
  reasons: string[];
};

const USER_SCOPED_ENTITY_TYPES: EntityType[] = [
  "patient_profile",
  "conditions",
  "allergies",
  "medications",
  "symptom_states",
];

const IMPACTFUL_ENTITY_TYPES: EntityType[] = ["conditions", "medications", "symptom_states"];
const STATUS_MUTABLE_ENTITY_TYPES: EntityType[] = [
  "conditions",
  "allergies",
  "medications",
  "symptom_states",
];
const INTERNAL_COLUMNS = new Set(["id", "user_id", "created_at", "updated_at"]);

const ENTITY_COLUMNS: Record<EntityType, readonly string[]> = {
  patient_profile: [
    "id",
    "user_id",
    "timezone",
    "locale",
    "date_of_birth_year",
    "biological_sex",
    "proactive_mode",
    "snooze_until",
    "quiet_hours_start",
    "quiet_hours_end",
    "created_at",
    "updated_at",
  ],
  conditions: [
    "id",
    "user_id",
    "name",
    "status",
    "severity",
    "diagnosed_date",
    "source",
    "confidence",
    "created_at",
    "updated_at",
  ],
  allergies: [
    "id",
    "user_id",
    "substance",
    "reaction",
    "severity",
    "status",
    "created_at",
    "updated_at",
  ],
  medications: [
    "id",
    "user_id",
    "name",
    "dose_value",
    "dose_unit",
    "frequency_per_day",
    "quantity_dispensed",
    "last_fill_date",
    "pharmacy_name",
    "pharmacy_contact",
    "status",
    "created_at",
    "updated_at",
  ],
  symptom_states: [
    "id",
    "user_id",
    "symptom",
    "status",
    "severity",
    "onset_at",
    "last_confirmed_at",
    "expires_at",
    "retention_class",
    "schema_version",
    "memory_source",
    "source_record_id",
    "created_at",
    "updated_at",
  ],
};

const ALLOWED_OPERATIONS_BY_ENTITY: Record<EntityType, readonly Operation[]> = {
  patient_profile: ["create", "update"],
  conditions: OPERATIONS,
  allergies: OPERATIONS,
  medications: OPERATIONS,
  symptom_states: OPERATIONS,
};

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

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function resolveRepository(store: CarePilotClinicalStore, entityType: EntityType) {
  switch (entityType) {
    case "patient_profile":
      return store.patientProfiles;
    case "conditions":
      return store.conditions;
    case "allergies":
      return store.allergies;
    case "medications":
      return store.medications;
    case "symptom_states":
      return store.symptomStates;
    default:
      return null;
  }
}

function resolveToolUserId(value: string | undefined): string {
  const userId = typeof value === "string" ? value.trim() : "";
  return userId || "default_user";
}

function isRowOwnedByUser(row: CarePilotRow | null, userId: string): boolean {
  if (!row) {
    return false;
  }
  return String(row.user_id ?? "") === userId;
}

function normalizeSqlValue(
  value: unknown,
): string | number | bigint | Uint8Array | null | undefined {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  return undefined;
}

function computeWriteGuard(params: {
  entityType: EntityType;
  operation: Operation;
  payload: Record<string, unknown>;
  source: WriteSource;
}): WriteGuardResult {
  const reasons: string[] = [];
  const payload = params.payload;

  if (!WRITE_SOURCES.includes(params.source)) {
    reasons.push("source must be one of user_direct|tool_result|model_inference");
  }

  if (["conditions", "symptom_states"].includes(params.entityType)) {
    if (typeof payload.confidence !== "number") {
      reasons.push("confidence is required for this entity_type");
    }
  }

  if (params.entityType === "symptom_states") {
    const retentionClass = String(payload.retention_class ?? "TIME_BOUND_STATE");
    if (retentionClass !== "LONG_LIVED_FACT") {
      if (typeof payload.expires_at !== "string") {
        reasons.push("expires_at is required for non-long-lived symptom state");
      }
      if (typeof payload.last_confirmed_at !== "string") {
        reasons.push("last_confirmed_at is required for non-long-lived symptom state");
      }
    }
    if (params.source === "model_inference" && typeof payload.expires_at === "string") {
      const ttlMillis = Date.parse(payload.expires_at) - Date.now();
      if (!Number.isFinite(ttlMillis) || ttlMillis > 24 * 60 * 60 * 1000) {
        reasons.push("model_inference writes must set expires_at <= 24h");
      }
    }
  }

  if (IMPACTFUL_ENTITY_TYPES.includes(params.entityType) && params.operation !== "create") {
    if (payload.reconfirm_ack !== true) {
      reasons.push("impactful clinical changes require reconfirm_ack=true");
    }
  }

  return { allowed: reasons.length === 0, reasons };
}

function normalizeCreatePayload(
  entityType: EntityType,
  payload: Record<string, unknown>,
  userId: string,
): CarePilotRow {
  const allowedColumns = new Set(ENTITY_COLUMNS[entityType]);
  const result: CarePilotRow = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!allowedColumns.has(key) || key === "user_id" || key === "created_at" || key === "updated_at") {
      continue;
    }
    const normalized = normalizeSqlValue(value);
    if (normalized !== undefined) {
      result[key] = normalized;
    }
  }

  if (typeof result.id !== "string") {
    result.id = randomUUID();
  }
  if (USER_SCOPED_ENTITY_TYPES.includes(entityType)) {
    result.user_id = userId;
  }
  return result;
}

function normalizeUpdatePayload(
  entityType: EntityType,
  payload: Record<string, unknown>,
): Record<string, string | number | bigint | Uint8Array | null> {
  const allowedColumns = new Set(ENTITY_COLUMNS[entityType]);
  const patch: Record<string, string | number | bigint | Uint8Array | null> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!allowedColumns.has(key) || INTERNAL_COLUMNS.has(key)) {
      continue;
    }
    const normalized = normalizeSqlValue(value);
    if (normalized !== undefined) {
      patch[key] = normalized;
    }
  }
  return patch;
}

function resolveStatusForOperation(entityType: EntityType, operation: Operation): string | null {
  if (!STATUS_MUTABLE_ENTITY_TYPES.includes(entityType)) {
    return null;
  }
  if (operation === "resolve") {
    if (entityType === "symptom_states") {
      return "resolved_unconfirmed";
    }
    return "resolved";
  }
  if (operation === "delete_soft") {
    if (entityType === "symptom_states") {
      return "resolved_unconfirmed";
    }
    return "resolved";
  }
  return null;
}

function extractEntityId(payload: Record<string, unknown>): string | null {
  if (typeof payload.id === "string" && payload.id.trim()) {
    return payload.id;
  }
  return null;
}

export function createClinicalProfileUpsertTool(
  api: OpenClawPluginApi,
  options?: { userId?: string },
) {
  const userId = resolveToolUserId(options?.userId);

  return {
    name: "clinical_profile_upsert",
    description: "Create/update/resolve/delete_soft clinical entities with write guards.",
    parameters: Type.Object({
      entity_type: Type.Union(ENTITY_TYPES.map((value) => Type.Literal(value))),
      operation: Type.Union(OPERATIONS.map((value) => Type.Literal(value))),
      payload: Type.Object({}, { additionalProperties: true }),
      source: Type.Union([
        Type.Literal("user_direct"),
        Type.Literal("tool_result"),
        Type.Literal("model_inference"),
      ]),
    }),
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const entityType = rawParams.entity_type as EntityType;
      const operation = rawParams.operation as Operation;
      const source = rawParams.source as WriteSource;
      const payload = asObject(rawParams.payload);

      if (
        !ENTITY_TYPES.includes(entityType) ||
        !OPERATIONS.includes(operation) ||
        !WRITE_SOURCES.includes(source) ||
        !payload
      ) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [{ code: "invalid_input", message: "entity_type, operation, payload, source are required." }],
        });
      }

      if (!ALLOWED_OPERATIONS_BY_ENTITY[entityType].includes(operation)) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code: "invalid_operation",
              message: `operation "${operation}" is not supported for entity_type "${entityType}".`,
            },
          ],
        });
      }

      const writeGuardResult = computeWriteGuard({
        entityType,
        operation,
        payload,
        source,
      });
      if (!writeGuardResult.allowed) {
        return jsonResult({
          status: "blocked",
          data: {
            updated_entity: null,
            write_guard_result: writeGuardResult,
          },
          errors: writeGuardResult.reasons.map((reason) => ({
            code: "write_guard_failed",
            message: reason,
          })),
        });
      }

      try {
        const updatedEntity = withStore(api, (store) => {
          const repository = resolveRepository(store, entityType);
          if (!repository) {
            throw new Error(`Unsupported entity_type: ${entityType}`);
          }

          if (operation === "create") {
            const createPayload = normalizeCreatePayload(entityType, payload, userId);
            return repository.create(createPayload);
          }

          const id = extractEntityId(payload);
          if (!id) {
            throw new Error("payload.id is required for non-create operations.");
          }

          const existing = repository.get(id);
          if (!existing) {
            throw new Error(`Entity not found: ${entityType}:${id}`);
          }
          if (USER_SCOPED_ENTITY_TYPES.includes(entityType) && !isRowOwnedByUser(existing, userId)) {
            throw new Error(`Entity not found for current user: ${entityType}:${id}`);
          }

          if (operation === "update") {
            const patch = normalizeUpdatePayload(entityType, payload);
            if (Object.keys(patch).length === 0) {
              throw new Error("No writable fields provided for update.");
            }
            return repository.update(id, patch);
          }

          const status = resolveStatusForOperation(entityType, operation);
          if (!status) {
            throw new Error(`Unsupported operation: ${operation}`);
          }
          return repository.update(id, {
            status,
          });
        });

        return jsonResult({
          status: "ok",
          data: {
            updated_entity: updatedEntity,
            write_guard_result: writeGuardResult,
          },
          errors: [],
        });
      } catch (error) {
        return jsonResult({
          status: "error",
          data: {
            updated_entity: null,
            write_guard_result: writeGuardResult,
          },
          errors: [
            {
              code: "upsert_failed",
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        });
      }
    },
  };
}
