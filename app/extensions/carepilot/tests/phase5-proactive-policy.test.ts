import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import * as dbModule from "../services/db.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { runCarePilotMigrations } from "../services/migrations.js";
import { evaluateProactivePolicy } from "../services/proactive-policy.js";
import { createCarePreferencesUpdateTool } from "../tools/care-preferences-update.js";

const FIXED_NOW = new Date("2026-02-07T12:00:00.000Z");
const USER_ID = "phase5-user";
const OTHER_USER_ID = "phase5-other-user";
const createdDbs = new Set<string>();

function createDbPath(): string {
  const dbPath = path.join(os.tmpdir(), `carepilot-phase5-${randomUUID()}.sqlite`);
  createdDbs.add(dbPath);
  return dbPath;
}

function createApi(dbPath: string): OpenClawPluginApi {
  return {
    pluginConfig: { dbPath },
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

function seedProfile(params: {
  dbPath: string;
  userId: string;
  proactiveMode?: "active" | "paused" | "medication_only";
  snoozeUntil?: string | null;
}): void {
  withStore(params.dbPath, (store) => {
    store.patientProfiles.create({
      id: randomUUID(),
      user_id: params.userId,
      timezone: "UTC",
      proactive_mode: params.proactiveMode ?? "active",
      snooze_until: params.snoozeUntil ?? null,
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
    });
  });
}

function seedActionAudit(params: {
  dbPath: string;
  userId: string;
  actionType: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
}): void {
  withStore(params.dbPath, (store) => {
    store.actionAudit.create({
      id: randomUUID(),
      user_id: params.userId,
      action_type: params.actionType,
      payload_hash: randomUUID().replaceAll("-", ""),
      idempotency_key: randomUUID(),
      consent_token: null,
      status: params.status,
      error_code: null,
      error_message: null,
      consent_snapshot_json: "{}",
      replay_window_bucket: "2026-02-07T00:00:00.000Z",
      started_at: params.startedAt,
      finished_at: params.finishedAt ?? params.startedAt,
    });
  });
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
        // Best-effort cleanup.
      }
    }
  }
  createdDbs.clear();
});

describe("carepilot phase5 proactive policy", () => {
  it("suppresses reminders during quiet hours", () => {
    const decision = evaluateProactivePolicy({
      profile: {
        proactive_mode: "active",
        timezone: "UTC",
        quiet_hours_start: "22:00",
        quiet_hours_end: "08:00",
      },
      messageKind: "non_urgent",
      now: new Date("2026-02-07T23:10:00.000Z"),
      nonUrgentSentToday: 0,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("quiet_hours");
  });

  it("applies mode flags and snooze-until suppression", () => {
    const paused = evaluateProactivePolicy({
      profile: {
        proactive_mode: "paused",
        timezone: "UTC",
      },
      messageKind: "medication",
      now: FIXED_NOW,
    });
    expect(paused.allowed).toBe(false);
    expect(paused.reason).toBe("paused_mode");

    const snoozed = evaluateProactivePolicy({
      profile: {
        proactive_mode: "active",
        snooze_until: "2026-02-10T00:00:00.000Z",
        timezone: "UTC",
      },
      messageKind: "medication",
      now: FIXED_NOW,
    });
    expect(snoozed.allowed).toBe(false);
    expect(snoozed.reason).toBe("snoozed");

    const medicationOnlyBlocked = evaluateProactivePolicy({
      profile: {
        proactive_mode: "medication_only",
        timezone: "UTC",
      },
      messageKind: "non_urgent",
      now: FIXED_NOW,
    });
    expect(medicationOnlyBlocked.allowed).toBe(false);
    expect(medicationOnlyBlocked.reason).toBe("medication_only_mode");

    const medicationOnlyAllowed = evaluateProactivePolicy({
      profile: {
        proactive_mode: "medication_only",
        timezone: "UTC",
      },
      messageKind: "medication",
      now: FIXED_NOW,
    });
    expect(medicationOnlyAllowed.allowed).toBe(true);
    expect(medicationOnlyAllowed.reason).toBe("allowed");
  });

  it("enforces default and custom non-urgent daily cap", () => {
    const blockedByDefaultCap = evaluateProactivePolicy({
      profile: {
        proactive_mode: "active",
        timezone: "UTC",
      },
      messageKind: "non_urgent",
      now: FIXED_NOW,
      nonUrgentSentToday: 1,
    });
    expect(blockedByDefaultCap.allowed).toBe(false);
    expect(blockedByDefaultCap.reason).toBe("non_urgent_daily_cap");

    const allowedByCustomCap = evaluateProactivePolicy({
      profile: {
        proactive_mode: "active",
        timezone: "UTC",
      },
      messageKind: "non_urgent",
      now: FIXED_NOW,
      nonUrgentSentToday: 1,
      nonUrgentDailyCap: 2,
    });
    expect(allowedByCustomCap.allowed).toBe(true);

    const blockedByCustomCap = evaluateProactivePolicy({
      profile: {
        proactive_mode: "active",
        timezone: "UTC",
      },
      messageKind: "non_urgent",
      now: FIXED_NOW,
      nonUrgentSentToday: 2,
      nonUrgentDailyCap: 2,
    });
    expect(blockedByCustomCap.allowed).toBe(false);
    expect(blockedByCustomCap.reason).toBe("non_urgent_daily_cap");
  });

  it("derives non-urgent count from action audit when caller does not provide it", () => {
    const dbPath = createDbPath();
    seedProfile({ dbPath, userId: USER_ID, proactiveMode: "active" });

    seedActionAudit({
      dbPath,
      userId: USER_ID,
      actionType: "carepilot_proactive_non_urgent",
      status: "succeeded",
      startedAt: "2026-02-07T04:55:00.000Z",
    });
    seedActionAudit({
      dbPath,
      userId: USER_ID,
      actionType: "carepilot_proactive_non_urgent",
      status: "succeeded",
      startedAt: "2026-02-07T05:05:00.000Z",
    });
    seedActionAudit({
      dbPath,
      userId: USER_ID,
      actionType: "carepilot_proactive_non_urgent",
      status: "failed",
      startedAt: "2026-02-07T05:06:00.000Z",
    });
    seedActionAudit({
      dbPath,
      userId: USER_ID,
      actionType: "carepilot_proactive_medication",
      status: "succeeded",
      startedAt: "2026-02-07T05:07:00.000Z",
    });

    const actionAuditRows = withStore(dbPath, (store) =>
      store.actionAudit.list({
        where: { user_id: USER_ID },
        limit: 20,
      }),
    );

    const decision = evaluateProactivePolicy({
      profile: {
        proactive_mode: "active",
        timezone: "America/New_York",
        quiet_hours_start: "02:00",
        quiet_hours_end: "03:00",
      },
      messageKind: "non_urgent",
      now: new Date("2026-02-07T05:10:00.000Z"),
      actionAuditRows,
    });

    expect(decision.nonUrgentSentToday).toBe(1);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("non_urgent_daily_cap");
  });
});

describe("carepilot phase5 care_preferences_update", () => {
  it("maps pause/resume/snooze/only medication reminders and persists by scoped user", async () => {
    const dbPath = createDbPath();
    seedProfile({ dbPath, userId: OTHER_USER_ID, proactiveMode: "active" });
    const tool = createCarePreferencesUpdateTool(createApi(dbPath), { userId: USER_ID });

    const paused = detailsOf(
      await tool.execute("call-pause", {
        command: "pause proactive care",
      }),
    );
    expect(paused.status).toBe("ok");

    const snoozed = detailsOf(
      await tool.execute("call-snooze", {
        command: "snooze for 3 days",
      }),
    );
    expect(snoozed.status).toBe("ok");

    const resumed = detailsOf(
      await tool.execute("call-resume", {
        command: "resume proactive care",
      }),
    );
    expect(resumed.status).toBe("ok");

    const medicationOnly = detailsOf(
      await tool.execute("call-medication-only", {
        command: "only medication reminders",
      }),
    );
    expect(medicationOnly.status).toBe("ok");

    withStore(dbPath, (store) => {
      const userProfile = store.patientProfiles.list({ where: { user_id: USER_ID }, limit: 1 })[0];
      const otherProfile = store.patientProfiles.list({ where: { user_id: OTHER_USER_ID }, limit: 1 })[0];
      expect(userProfile).toBeTruthy();
      expect(userProfile?.proactive_mode).toBe("medication_only");
      expect(userProfile?.snooze_until).toBeNull();
      expect(otherProfile?.proactive_mode).toBe("active");
    });
  });

  it("sets snooze_until to UTC ISO based on snooze X days command", async () => {
    const dbPath = createDbPath();
    const tool = createCarePreferencesUpdateTool(createApi(dbPath), { userId: USER_ID });

    const result = detailsOf(
      await tool.execute("call-snooze-exact", {
        command: "snooze 2 days",
      }),
    );
    expect(result.status).toBe("ok");

    withStore(dbPath, (store) => {
      const profile = store.patientProfiles.list({ where: { user_id: USER_ID }, limit: 1 })[0];
      expect(profile).toBeTruthy();
      expect(profile?.snooze_until).toBe("2026-02-09T12:00:00.000Z");
    });
  });
});
