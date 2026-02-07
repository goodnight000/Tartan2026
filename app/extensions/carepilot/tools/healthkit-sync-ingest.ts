import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parseCarePilotPluginConfig } from "../config.js";
import type { CarePilotClinicalStore } from "../services/clinical-store.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { closeCarePilotDb, openCarePilotDb } from "../services/db.js";
import {
  CAREPILOT_HEALTH_METRIC_TYPES,
  normalizeHealthSignalInput,
  type CarePilotHealthMetricType,
  type CarePilotNormalizedHealthSignal,
} from "../services/health-signal-normalizer.js";
import {
  buildConnectionRecencySummary,
  normalizeHealthConnectionInput,
} from "../services/health-connections.js";
import { runCarePilotMigrations } from "../services/migrations.js";

const SIGNAL_SOURCE_VALUES = ["apple_health", "user_reported", "tool_result"] as const;
const CONNECTION_STATUS_VALUES = ["connected", "disconnected", "error"] as const;

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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isValidIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

type IngestSignalInput = {
  metric_type: CarePilotHealthMetricType;
  summary: Record<string, unknown>;
  observed_at?: string;
  source?: (typeof SIGNAL_SOURCE_VALUES)[number];
  stale_after?: string;
};

function parseSignalInput(raw: unknown): IngestSignalInput | null {
  const value = asRecord(raw);
  if (!value) {
    return null;
  }
  const metricType = typeof value.metric_type === "string" ? value.metric_type : "";
  if (!(CAREPILOT_HEALTH_METRIC_TYPES as readonly string[]).includes(metricType)) {
    return null;
  }
  const summary = asRecord(value.summary);
  if (!summary) {
    return null;
  }
  const source = typeof value.source === "string" ? value.source : undefined;
  if (source && !SIGNAL_SOURCE_VALUES.includes(source as (typeof SIGNAL_SOURCE_VALUES)[number])) {
    return null;
  }

  const observedAtRaw = typeof value.observed_at === "string" ? value.observed_at.trim() : "";
  const staleAfterRaw = typeof value.stale_after === "string" ? value.stale_after.trim() : "";

  const observedAt = observedAtRaw || undefined;
  const staleAfter = staleAfterRaw || undefined;
  if (observedAt && !isValidIsoTimestamp(observedAt)) {
    return null;
  }
  if (staleAfter && !isValidIsoTimestamp(staleAfter)) {
    return null;
  }

  return {
    metric_type: metricType as CarePilotHealthMetricType,
    summary,
    observed_at: observedAt,
    source: source as (typeof SIGNAL_SOURCE_VALUES)[number] | undefined,
    stale_after: staleAfter,
  };
}

function buildMetricCountSeed(): Record<CarePilotHealthMetricType, number> {
  return CAREPILOT_HEALTH_METRIC_TYPES.reduce(
    (acc, metric) => {
      acc[metric] = 0;
      return acc;
    },
    {} as Record<CarePilotHealthMetricType, number>,
  );
}

function safeJsonParse(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

export function createHealthkitSyncIngestTool(api: OpenClawPluginApi, options?: { userId?: string }) {
  const userId = resolveToolUserId(options?.userId);

  return {
    name: "healthkit_sync_ingest",
    description: "Ingest normalized HealthKit signals into health_signals with sync summaries.",
    parameters: Type.Object({
      source_session_id: Type.String(),
      signals: Type.Array(
        Type.Object(
          {
            metric_type: Type.Union(CAREPILOT_HEALTH_METRIC_TYPES.map((metric) => Type.Literal(metric))),
            summary: Type.Object({}, { additionalProperties: true }),
            observed_at: Type.Optional(Type.String()),
            source: Type.Optional(
              Type.Union(SIGNAL_SOURCE_VALUES.map((source) => Type.Literal(source))),
            ),
            stale_after: Type.Optional(Type.String()),
          },
          { additionalProperties: false },
        ),
        { minItems: 1 },
      ),
      connection: Type.Optional(
        Type.Object(
          {
            connection_status: Type.Optional(
              Type.Union(CONNECTION_STATUS_VALUES.map((status) => Type.Literal(status))),
            ),
            permissions: Type.Optional(Type.Object({}, { additionalProperties: true })),
            connection_meta: Type.Optional(Type.Object({}, { additionalProperties: true })),
          },
          { additionalProperties: false },
        ),
      ),
    }),
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const sourceSessionId =
        typeof rawParams.source_session_id === "string" ? rawParams.source_session_id.trim() : "";
      const rawSignals = Array.isArray(rawParams.signals) ? rawParams.signals : [];

      if (!sourceSessionId || rawSignals.length === 0) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code: "invalid_input",
              message: "source_session_id and signals[] are required.",
            },
          ],
        });
      }

      const parsedSignals: IngestSignalInput[] = [];
      for (const entry of rawSignals) {
        const parsed = parseSignalInput(entry);
        if (!parsed) {
          return jsonResult({
            status: "error",
            data: null,
            errors: [
              {
                code: "invalid_signal",
                message:
                  "Each signal must include valid metric_type, summary object, and optional observed_at/source/stale settings.",
              },
            ],
          });
        }
        parsedSignals.push(parsed);
      }

      try {
        const data = withStore(api, (store) => {
          const now = new Date();
          const countsByMetricType = buildMetricCountSeed();
          const persistedSignals: Array<{
            id: string;
            metric_type: CarePilotHealthMetricType;
            stale_after: string;
            is_stale: boolean;
            observed_at: string;
            synced_at: string;
          }> = [];

          const normalizedSignals: CarePilotNormalizedHealthSignal[] = parsedSignals.map((signal) =>
            normalizeHealthSignalInput(
              {
                metricType: signal.metric_type,
                summary: signal.summary,
                observedAt: signal.observed_at,
                source: signal.source ?? "apple_health",
                staleAfter: signal.stale_after,
              },
              now,
            ),
          );

          for (const signal of normalizedSignals) {
            const id = randomUUID();
            store.healthSignals.create({
              id,
              user_id: userId,
              metric_type: signal.metricType,
              source: signal.source,
              summary_json: JSON.stringify(signal.summary),
              observed_at: signal.observedAt,
              synced_at: signal.syncedAt,
              stale_after: signal.staleAfter,
            });
            countsByMetricType[signal.metricType] += 1;
            persistedSignals.push({
              id,
              metric_type: signal.metricType,
              stale_after: signal.staleAfter,
              is_stale: Date.parse(signal.staleAfter) <= now.getTime(),
              observed_at: signal.observedAt,
              synced_at: signal.syncedAt,
            });
          }

          const existingConnection = store.healthConnections.list({
            where: {
              user_id: userId,
              source_type: "apple_health",
            },
            limit: 1,
          })[0];

          const connectionInput = asRecord(rawParams.connection);
          const connectionStatusRaw =
            typeof connectionInput?.connection_status === "string"
              ? connectionInput.connection_status
              : "connected";
          const connectionStatus = CONNECTION_STATUS_VALUES.includes(
            connectionStatusRaw as (typeof CONNECTION_STATUS_VALUES)[number],
          )
            ? (connectionStatusRaw as (typeof CONNECTION_STATUS_VALUES)[number])
            : "connected";

          const permissionsInput =
            connectionInput && Object.prototype.hasOwnProperty.call(connectionInput, "permissions")
              ? connectionInput.permissions
              : existingConnection?.permissions_json ?? { all: "not_determined" };

          const existingMeta = safeJsonParse(existingConnection?.connection_meta_json);
          const connectionMeta = {
            ...existingMeta,
            source_session_id: sourceSessionId,
            ...(asRecord(connectionInput?.connection_meta) ?? {}),
          };

          const normalizedConnection = normalizeHealthConnectionInput(
            {
              source_type: "apple_health",
              connection_status: connectionStatus,
              permissions: permissionsInput,
              connection_meta_json: connectionMeta,
              last_sync_at: now.toISOString(),
            },
            now,
          );

          if (existingConnection) {
            store.healthConnections.update(String(existingConnection.id), {
              connection_status: normalizedConnection.connectionStatus,
              permissions_json: normalizedConnection.permissionsJson,
              connection_meta_json: normalizedConnection.connectionMetaJson,
              last_sync_at: normalizedConnection.lastSyncAt,
            });
          } else {
            store.healthConnections.create({
              id: randomUUID(),
              user_id: userId,
              source_type: "apple_health",
              connection_status: normalizedConnection.connectionStatus,
              permissions_json: normalizedConnection.permissionsJson,
              connection_meta_json: normalizedConnection.connectionMetaJson,
              last_sync_at: normalizedConnection.lastSyncAt,
            });
          }

          const recency = buildConnectionRecencySummary({
            connectionStatus: normalizedConnection.connectionStatus,
            lastSyncAt: normalizedConnection.lastSyncAt,
          });
          const recencyPayload = {
            connection_status: recency.connectionStatus,
            last_sync_at: recency.lastSyncAt,
            minutes_since_last_sync: recency.minutesSinceLastSync,
            stale_threshold_minutes: recency.staleThresholdMinutes,
            is_stale: recency.isStale,
            recency_state: recency.recencyState,
          };

          return {
            counts_by_metric_type: countsByMetricType,
            stale_markers: persistedSignals,
            sync_summary: {
              source_session_id: sourceSessionId,
              source_type: "apple_health",
              connection_status: normalizedConnection.connectionStatus,
              ingested_count: normalizedSignals.length,
              synced_at: normalizedConnection.lastSyncAt,
              sync_recency: recencyPayload,
            },
          };
        });

        return jsonResult({
          status: "ok",
          data,
          errors: [],
        });
      } catch (error) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code: "healthkit_sync_ingest_failed",
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        });
      }
    },
  };
}
