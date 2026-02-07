import { describe, expect, it } from "vitest";
import {
  CAREPILOT_HEALTH_METRIC_TYPES,
  isSignalStale,
  normalizeHealthSignalInput,
} from "../services/health-signal-normalizer.js";
import {
  buildConnectionRecencySummary,
  normalizeHealthConnectionInput,
  resolveMetricPermission,
} from "../services/health-connections.js";

describe("carepilot phase6 health services", () => {
  it("normalizes valid health signal input and rejects invalid metric/source", () => {
    const normalized = normalizeHealthSignalInput({
      metric_type: "step_count",
      source: "apple_health",
      summary: {
        count: "1234",
      },
      observed_at: "2026-02-07T10:00:00.000Z",
      synced_at: "2026-02-07T10:05:00.000Z",
    });

    expect(CAREPILOT_HEALTH_METRIC_TYPES).toContain("step_count");
    expect(normalized.metricType).toBe("step_count");
    expect(normalized.source).toBe("apple_health");
    expect(normalized.summary).toEqual({
      steps: 1234,
      unit: "count",
    });
    expect(normalized.observedAt).toBe("2026-02-07T10:00:00.000Z");
    expect(normalized.syncedAt).toBe("2026-02-07T10:05:00.000Z");

    expect(() =>
      normalizeHealthSignalInput({
        metricType: "blood_pressure",
        source: "apple_health",
        summary: {},
      }),
    ).toThrow(/metricType/);

    expect(() =>
      normalizeHealthSignalInput({
        metricType: "sleep",
        source: "manual",
        summary: {},
      }),
    ).toThrow(/source/);
  });

  it("derives stale marker and reports staleness deterministically", () => {
    const now = new Date("2026-02-07T12:00:00.000Z");
    const signal = normalizeHealthSignalInput(
      {
        metricType: "resting_hr",
        source: "apple_health",
        summary: {
          bpm: 58,
        },
      },
      now,
    );

    expect(signal.staleAfter).toBe("2026-02-08T12:00:00.000Z");
    expect(isSignalStale(signal, new Date("2026-02-08T11:59:59.000Z"))).toBe(false);
    expect(isSignalStale(signal, new Date("2026-02-08T12:00:00.000Z"))).toBe(true);
  });

  it("normalizes connection status and permissions, and builds recency summaries", () => {
    const now = new Date("2026-02-07T12:00:00.000Z");
    const connection = normalizeHealthConnectionInput({
      source_type: "apple_health",
      connection_status: "connected",
      last_sync_at: "2026-02-07T11:35:00.000Z",
      permissions: {
        all: "denied",
        metrics: {
          sleep: true,
          step_count: false,
        },
      },
      connectionMeta: {
        appVersion: "1.0.0",
      },
    });

    expect(connection.sourceType).toBe("apple_health");
    expect(connection.connectionStatus).toBe("connected");
    expect(connection.lastSyncAt).toBe("2026-02-07T11:35:00.000Z");

    expect(resolveMetricPermission(connection.permissionsJson, "sleep")).toBe("granted");
    expect(resolveMetricPermission(connection.permissionsJson, "step_count")).toBe("denied");
    expect(resolveMetricPermission(connection.permissionsJson, "workouts")).toBe("denied");

    const recency = buildConnectionRecencySummary(
      {
        connectionStatus: connection.connectionStatus,
        lastSyncAt: connection.lastSyncAt,
        staleThresholdMinutes: 60,
      },
      now,
    );

    expect(recency.recencyState).toBe("fresh");
    expect(recency.isStale).toBe(false);
    expect(recency.minutesSinceLastSync).toBe(25);
  });

  it("reflects metric toggle effects through permission resolution", () => {
    const enabled = JSON.stringify({ metrics: { workouts: true } });
    const disabled = JSON.stringify({ metrics: { workouts: false } });
    const unspecified = JSON.stringify({});

    expect(resolveMetricPermission(enabled, "workouts")).toBe("granted");
    expect(resolveMetricPermission(disabled, "workouts")).toBe("denied");
    expect(resolveMetricPermission(unspecified, "workouts")).toBe("not_determined");

    const disconnectedSummary = buildConnectionRecencySummary({
      connectionStatus: "disconnected",
      staleThresholdMinutes: 30,
    });
    expect(disconnectedSummary.recencyState).toBe("disconnected");
    expect(disconnectedSummary.isStale).toBe(true);
  });
});
