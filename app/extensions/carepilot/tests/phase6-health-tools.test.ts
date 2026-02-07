import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import * as dbModule from "../services/db.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { runCarePilotMigrations } from "../services/migrations.js";
import { createHealthkitSyncIngestTool } from "../tools/healthkit-sync-ingest.js";
import { createHealthMetricsGetTool } from "../tools/health-metrics-get.js";

const FIXED_NOW = new Date("2026-02-07T12:00:00.000Z");
const USER_ID = "phase6-user";
const createdDbs = new Set<string>();

function createDbPath(): string {
  const dbPath = path.join(os.tmpdir(), `carepilot-phase6-tools-${randomUUID()}.sqlite`);
  createdDbs.add(dbPath);
  return dbPath;
}

function createApi(
  dbPath: string,
  enabledMetrics: string[] = ["cycle", "sleep"],
): OpenClawPluginApi {
  return {
    pluginConfig: {
      dbPath,
      healthkit: {
        mode: "simulated",
        enabledMetrics,
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  } as OpenClawPluginApi;
}

function withStore<T>(dbPath: string, run: (store: ReturnType<typeof createCarePilotClinicalStore>) => T): T {
  const db = dbModule.openCarePilotDb(dbPath);
  try {
    runCarePilotMigrations({ db });
    const store = createCarePilotClinicalStore(db);
    return run(store);
  } finally {
    dbModule.closeCarePilotDb(db);
  }
}

function detailsOf(result: unknown): Record<string, unknown> {
  return ((result as { details?: unknown }).details ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  const fs = await import("node:fs/promises");
  for (const dbPath of createdDbs) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        await fs.unlink(`${dbPath}${suffix}`);
      } catch {
        // best-effort cleanup
      }
    }
  }
  createdDbs.clear();
});

describe("carepilot phase6 health tools", () => {
  it("ingests simulated healthkit signals and returns counts + stale markers + sync summary", async () => {
    const dbPath = createDbPath();
    const tool = createHealthkitSyncIngestTool(createApi(dbPath), { userId: USER_ID });

    const result = detailsOf(
      await tool.execute("call-health-ingest", {
        source_session_id: "sim-session-1",
        signals: [
          {
            metric_type: "cycle",
            summary: { phase: "follicular", confidence: 0.9 },
            observed_at: "2026-02-07T10:00:00.000Z",
          },
          {
            metric_type: "step_count",
            summary: { steps: 8342 },
            observed_at: "2026-02-07T11:00:00.000Z",
          },
        ],
        connection: {
          connection_status: "connected",
          permissions: {
            cycle: true,
            step_count: false,
          },
        },
      }),
    );

    expect(result.status).toBe("ok");
    const data = (result.data ?? {}) as Record<string, unknown>;
    const counts = (data.counts_by_metric_type ?? {}) as Record<string, unknown>;
    expect(counts.cycle).toBe(1);
    expect(counts.step_count).toBe(1);

    const staleMarkers = Array.isArray(data.stale_markers) ? data.stale_markers : [];
    expect(staleMarkers).toHaveLength(2);

    const syncSummary = (data.sync_summary ?? {}) as Record<string, unknown>;
    expect(syncSummary.source_session_id).toBe("sim-session-1");
    expect(syncSummary.connection_status).toBe("connected");
    expect(syncSummary.ingested_count).toBe(2);

    withStore(dbPath, (store) => {
      const signals = store.healthSignals.list({ where: { user_id: USER_ID }, limit: 10 });
      expect(signals).toHaveLength(2);
      const connection = store.healthConnections.list({ where: { user_id: USER_ID }, limit: 1 })[0];
      expect(connection).toBeTruthy();
      expect(connection?.source_type).toBe("apple_health");
      expect(connection?.connection_status).toBe("connected");
    });
  });

  it("rejects invalid signal timestamps", async () => {
    const dbPath = createDbPath();
    const tool = createHealthkitSyncIngestTool(createApi(dbPath), { userId: USER_ID });

    const result = detailsOf(
      await tool.execute("call-health-ingest-invalid-time", {
        source_session_id: "sim-session-invalid-time",
        signals: [
          {
            metric_type: "cycle",
            summary: { phase: "follicular" },
            observed_at: "not-a-timestamp",
          },
        ],
      }),
    );

    expect(result.status).toBe("error");
    const errors = Array.isArray(result.errors) ? result.errors : [];
    expect((errors[0] as Record<string, unknown>)?.code).toBe("invalid_signal");
  });

  it("does not auto-grant unspecified metric permissions and marks successful ingest as connected", async () => {
    const dbPath = createDbPath();
    const api = createApi(dbPath, ["cycle", "step_count"]);
    const ingest = createHealthkitSyncIngestTool(api, { userId: USER_ID });
    const metricsGet = createHealthMetricsGetTool(api, { userId: USER_ID });

    withStore(dbPath, (store) => {
      store.healthConnections.create({
        id: randomUUID(),
        user_id: USER_ID,
        source_type: "apple_health",
        connection_status: "disconnected",
        permissions_json: JSON.stringify({ all: "not_determined" }),
        connection_meta_json: JSON.stringify({ bootstrap: true }),
        last_sync_at: "2026-02-07T05:00:00.000Z",
      });
    });

    const ingestResult = detailsOf(
      await ingest.execute("call-health-ingest-permissions", {
        source_session_id: "sim-session-permissions",
        signals: [
          {
            metric_type: "cycle",
            summary: { phase: "luteal" },
            observed_at: "2026-02-07T11:10:00.000Z",
          },
          {
            metric_type: "step_count",
            summary: { steps: 12000 },
            observed_at: "2026-02-07T11:30:00.000Z",
          },
        ],
        connection: {
          permissions: {
            metrics: {
              cycle: "granted",
            },
          },
        },
      }),
    );
    expect(ingestResult.status).toBe("ok");

    const metricsResult = detailsOf(
      await metricsGet.execute("call-health-metrics-permissions", {
        metric_types: ["cycle", "step_count"],
        lookback_days: 30,
      }),
    );
    expect(metricsResult.status).toBe("ok");

    const data = (metricsResult.data ?? {}) as Record<string, unknown>;
    const sourceStatus = (data.source_status ?? {}) as Record<string, unknown>;
    expect(sourceStatus.connection_status).toBe("connected");

    const metricSummaries = Array.isArray(data.metric_summaries) ? data.metric_summaries : [];
    const cycleCard = metricSummaries.find(
      (card) => (card as Record<string, unknown>).metric_type === "cycle",
    ) as Record<string, unknown> | undefined;
    const stepCard = metricSummaries.find(
      (card) => (card as Record<string, unknown>).metric_type === "step_count",
    ) as Record<string, unknown> | undefined;

    expect((cycleCard?.permission_toggle as Record<string, unknown>)?.permission_state).toBe("granted");
    expect(cycleCard?.recommendation_eligible).toBe(true);

    expect((stepCard?.permission_toggle as Record<string, unknown>)?.permission_state).toBe(
      "not_determined",
    );
    expect((stepCard?.permission_toggle as Record<string, unknown>)?.can_read).toBe(false);
    expect(stepCard?.recommendation_eligible).toBe(false);
  });

  it("returns dashboard payload with source status, toggles effect, recency and symptom summary", async () => {
    const dbPath = createDbPath();
    const api = createApi(dbPath);
    const ingest = createHealthkitSyncIngestTool(api, { userId: USER_ID });
    const metricsGet = createHealthMetricsGetTool(api, { userId: USER_ID });

    await ingest.execute("call-health-ingest-dashboard", {
      source_session_id: "sim-session-2",
      signals: [
        {
          metric_type: "cycle",
          summary: { phase: "luteal" },
          observed_at: "2026-02-07T09:00:00.000Z",
        },
        {
          metric_type: "step_count",
          summary: { steps: 9201 },
          observed_at: "2026-02-07T09:30:00.000Z",
        },
      ],
      connection: {
        permissions: {
          cycle: true,
          step_count: true,
        },
      },
    });

    withStore(dbPath, (store) => {
      store.symptomStates.create({
        id: randomUUID(),
        user_id: USER_ID,
        symptom: "fatigue",
        status: "active",
        severity: "moderate",
        onset_at: "2026-02-05T08:00:00.000Z",
        last_confirmed_at: "2026-02-07T08:30:00.000Z",
        expires_at: "2026-02-09T08:30:00.000Z",
        retention_class: "TIME_BOUND_STATE",
        schema_version: 1,
        memory_source: "live",
      });
    });

    const result = detailsOf(
      await metricsGet.execute("call-health-metrics-get", {
        metric_types: ["cycle", "step_count"],
        lookback_days: 30,
      }),
    );

    expect(result.status).toBe("ok");
    const data = (result.data ?? {}) as Record<string, unknown>;

    const sourceStatus = (data.source_status ?? {}) as Record<string, unknown>;
    expect(sourceStatus.source_type).toBe("apple_health");
    expect(sourceStatus.connection_status).toBe("connected");

    const metricSummaries = Array.isArray(data.metric_summaries) ? data.metric_summaries : [];
    expect(metricSummaries).toHaveLength(2);

    const cycleCard = metricSummaries.find(
      (card) => (card as Record<string, unknown>).metric_type === "cycle",
    ) as Record<string, unknown> | undefined;
    const stepCard = metricSummaries.find(
      (card) => (card as Record<string, unknown>).metric_type === "step_count",
    ) as Record<string, unknown> | undefined;

    expect(cycleCard?.enabled).toBe(true);
    expect(cycleCard?.recommendation_eligible).toBe(true);

    // step_count is disabled by plugin healthkit.enabledMetrics in createApi
    expect(stepCard?.enabled).toBe(false);
    expect(stepCard?.recommendation_eligible).toBe(false);

    const symptomSummary = (data.symptom_state_summary ?? {}) as Record<string, unknown>;
    expect(symptomSummary.active_count).toBe(1);

    const grounding = (data.grounding ?? {}) as Record<string, unknown>;
    expect(Array.isArray(grounding.sources)).toBe(true);
    expect((grounding.recency as Record<string, unknown>)?.last_sync_at).toBeTruthy();
  });
});
