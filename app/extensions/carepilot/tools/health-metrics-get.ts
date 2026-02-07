import { Type } from "@sinclair/typebox";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parseCarePilotPluginConfig } from "../config.js";
import type { CarePilotClinicalStore, CarePilotRow } from "../services/clinical-store.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { closeCarePilotDb, openCarePilotDb } from "../services/db.js";
import {
  CAREPILOT_HEALTH_METRIC_TYPES,
  isSignalStale,
  type CarePilotHealthMetricType,
  type CarePilotHealthSignalSource,
} from "../services/health-signal-normalizer.js";
import {
  buildConnectionRecencySummary,
  resolveMetricPermission,
  type CarePilotHealthConnectionStatus,
} from "../services/health-connections.js";
import { runCarePilotMigrations } from "../services/migrations.js";

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

function safeParseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function parseMetricTypes(raw: unknown): CarePilotHealthMetricType[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...CAREPILOT_HEALTH_METRIC_TYPES];
  }
  const selected: CarePilotHealthMetricType[] = [];
  for (const value of raw) {
    if (
      typeof value === "string" &&
      (CAREPILOT_HEALTH_METRIC_TYPES as readonly string[]).includes(value) &&
      !selected.includes(value as CarePilotHealthMetricType)
    ) {
      selected.push(value as CarePilotHealthMetricType);
    }
  }
  return selected.length > 0 ? selected : [...CAREPILOT_HEALTH_METRIC_TYPES];
}

function parseLookbackDays(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return 30;
  }
  return Math.min(365, Math.max(1, Math.floor(raw)));
}

type HealthSignalRow = {
  id: string;
  user_id: string;
  metric_type: CarePilotHealthMetricType;
  source: CarePilotHealthSignalSource;
  summary_json: string;
  observed_at: string;
  synced_at: string;
  stale_after: string;
};

function summarizeActiveSymptoms(rows: CarePilotRow[]) {
  const items = rows
    .map((row) => ({
      symptom: typeof row.symptom === "string" ? row.symptom : "unknown",
      severity: typeof row.severity === "string" ? row.severity : null,
      onset_at: typeof row.onset_at === "string" ? row.onset_at : null,
      last_confirmed_at: typeof row.last_confirmed_at === "string" ? row.last_confirmed_at : null,
    }))
    .sort((left, right) => left.symptom.localeCompare(right.symptom));
  return {
    active_count: items.length,
    items,
  };
}

export function createHealthMetricsGetTool(api: OpenClawPluginApi, options?: { userId?: string }) {
  const userId = resolveToolUserId(options?.userId);

  return {
    name: "health_metrics_get",
    description: "Fetch dashboard-ready health metric cards with source status, recency, and controls.",
    parameters: Type.Object({
      metric_types: Type.Optional(
        Type.Array(
          Type.Union(CAREPILOT_HEALTH_METRIC_TYPES.map((metric) => Type.Literal(metric))),
          { minItems: 1 },
        ),
      ),
      lookback_days: Type.Optional(Type.Number({ minimum: 1, maximum: 365 })),
    }),
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const metricTypes = parseMetricTypes(rawParams.metric_types);
      const lookbackDays = parseLookbackDays(rawParams.lookback_days);
      const lookbackStartMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

      try {
        const data = withStore(api, (store) => {
          const now = new Date();
          const config = parseCarePilotPluginConfig(api.pluginConfig);
          const enabledMetricSet = new Set(config.healthkit.enabledMetrics);

          const connectionRow = store.healthConnections.list({
            where: { user_id: userId, source_type: "apple_health" },
            limit: 1,
          })[0];

          const connectionStatus = (typeof connectionRow?.connection_status === "string"
            ? connectionRow.connection_status
            : "disconnected") as CarePilotHealthConnectionStatus;
          const permissionsJson = safeParseJson(connectionRow?.permissions_json);
          const lastSyncAt = typeof connectionRow?.last_sync_at === "string" ? connectionRow.last_sync_at : null;
          const connectionMeta = safeParseJson(connectionRow?.connection_meta_json);

          const signalsByMetric = new Map<CarePilotHealthMetricType, HealthSignalRow[]>();
          for (const metricType of metricTypes) {
            const rows = store.healthSignals
              .list({
                where: {
                  user_id: userId,
                  metric_type: metricType,
                },
                limit: 5000,
              })
              .filter((row) => {
                const observedAt = typeof row.observed_at === "string" ? Date.parse(row.observed_at) : NaN;
                return observedAt >= lookbackStartMs;
              }) as unknown as HealthSignalRow[];
            rows.sort((left, right) => Date.parse(right.observed_at) - Date.parse(left.observed_at));
            signalsByMetric.set(metricType, rows);
          }

          const metricCards = metricTypes.map((metricType) => {
            const rows = signalsByMetric.get(metricType) ?? [];
            const latest = rows[0] ?? null;
            const latestSummary = latest ? safeParseJson(latest.summary_json) : null;
            const stale = latest
              ? isSignalStale(
                  {
                    staleAfter: latest.stale_after,
                    observedAt: latest.observed_at,
                    syncedAt: latest.synced_at,
                    source: latest.source,
                    metricType: latest.metric_type,
                    summary: latestSummary ?? {},
                  },
                  now,
                )
              : true;
            const enabled = enabledMetricSet.has(metricType);
            const permission = resolveMetricPermission(permissionsJson, metricType);
            const canRead = permission === "granted";
            const recommendationEligible =
              enabled && canRead && connectionStatus === "connected" && !stale;

            return {
              metric_type: metricType,
              connected_source_status: connectionStatus,
              enabled,
              latest_value_summary: latestSummary,
              latest_observed_at: latest?.observed_at ?? null,
              last_sync: latest?.synced_at ?? lastSyncAt,
              stale,
              recommendation_eligible: recommendationEligible,
              permission_toggle: {
                metric_type: metricType,
                enabled,
                can_toggle: true,
                permission_state: permission,
                can_read: canRead,
              },
              data_controls: {
                export_action: "settings.export_data",
                delete_action: "settings.delete_data",
                source_type: "apple_health",
              },
            };
          });

          const activeSymptoms = summarizeActiveSymptoms(
            store.symptomStates.list({
              where: {
                user_id: userId,
                status: "active",
              },
              limit: 500,
            }),
          );

          const recencySummary = buildConnectionRecencySummary({
            connectionStatus,
            lastSyncAt,
          });
          const recencyPayload = {
            connection_status: recencySummary.connectionStatus,
            last_sync_at: recencySummary.lastSyncAt,
            minutes_since_last_sync: recencySummary.minutesSinceLastSync,
            stale_threshold_minutes: recencySummary.staleThresholdMinutes,
            is_stale: recencySummary.isStale,
            recency_state: recencySummary.recencyState,
          };

          const groundingSources = metricTypes.map((metricType) => {
            const latest = (signalsByMetric.get(metricType) ?? [])[0] ?? null;
            return {
              metric_type: metricType,
              source: (latest?.source ?? "apple_health") as CarePilotHealthSignalSource,
              observed_at: latest?.observed_at ?? null,
              synced_at: latest?.synced_at ?? lastSyncAt,
            };
          });

          return {
            source_status: {
              source_type: "apple_health",
              connection_status: connectionStatus,
              last_sync_at: lastSyncAt,
              connection_meta: connectionMeta,
            },
            metric_summaries: metricCards,
            sync_recency: recencyPayload,
            symptom_state_summary: activeSymptoms,
            toggles_data_controls: {
              enabled_metrics: [...enabledMetricSet],
              metric_permissions: permissionsJson,
              export_action: "settings.export_data",
              delete_action: "settings.delete_data",
            },
            grounding: {
              sources: groundingSources,
              recency: recencyPayload,
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
              code: "health_metrics_get_failed",
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        });
      }
    },
  };
}
