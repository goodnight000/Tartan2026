import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import * as dbModule from "../services/db.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { runCarePilotMigrations } from "../services/migrations.js";
import { createAppointmentBookTool } from "../tools/appointment-book.js";
import { createMedicationRefillRequestTool } from "../tools/medication-refill-request.js";

const FIXED_NOW = new Date("2026-02-07T12:00:00.000Z");
const USER_ID = "phase4-user";
const createdDbs = new Set<string>();

function createDbPath(): string {
  const dbPath = path.join(os.tmpdir(), `carepilot-phase4-${randomUUID()}.sqlite`);
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

function seedMedication(dbPath: string, medicationId: string): void {
  withStore(dbPath, (store) => {
    store.medications.create({
      id: medicationId,
      user_id: USER_ID,
      name: "Metformin",
      frequency_per_day: 1,
      quantity_dispensed: 30,
      last_fill_date: "2026-02-01T00:00:00.000Z",
      status: "active",
    });
  });
}

function seedConsentToken(params: {
  dbPath: string;
  token: string;
  actionType: string;
  expiresAtIso: string;
  payloadHash?: string;
  usedAtIso?: string | null;
}): void {
  withStore(params.dbPath, (store) => {
    store.consentTokens.create({
      token: params.token,
      user_id: USER_ID,
      action_type: params.actionType,
      payload_hash: params.payloadHash ?? "phase4-payload-hash",
      issued_at: new Date(FIXED_NOW.getTime() - 60 * 1000).toISOString(),
      expires_at: params.expiresAtIso,
      used_at: params.usedAtIso ?? null,
    });
  });
}

function computeRefillPayloadHash(params: {
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

function detailsOf(result: unknown): Record<string, unknown> {
  return ((result as { details?: unknown }).details ?? {}) as Record<string, unknown>;
}

function firstErrorString(details: Record<string, unknown>): string {
  const errors = Array.isArray(details.errors) ? details.errors : [];
  const first = (errors[0] ?? {}) as Record<string, unknown>;
  return `${String(first.code ?? "")} ${String(first.message ?? "")}`.toLowerCase();
}

function appointmentCount(dbPath: string): number {
  return withStore(dbPath, (store) => store.appointments.list({ where: { user_id: USER_ID } }).length);
}

function actionAuditCount(dbPath: string, idempotencyKey?: string): number {
  return withStore(dbPath, (store) => {
    const rows = store.actionAudit.list({
      where: {
        user_id: USER_ID,
        idempotency_key: idempotencyKey,
      },
      limit: 100,
    });
    return rows.length;
  });
}

async function expectBlockedBy(
  run: () => Promise<unknown>,
  reasonPattern: RegExp,
): Promise<void> {
  const result = await run();
  const details = detailsOf(result);
  expect(details.status).toBe("error");
  expect(firstErrorString(details)).toMatch(reasonPattern);
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

describe("carepilot phase4 consent + idempotency acceptance", () => {
  it("blocks appointment_book when consent token is missing", async () => {
    const dbPath = createDbPath();
    const tool = createAppointmentBookTool(createApi(dbPath), { userId: USER_ID });

    await expectBlockedBy(
      () =>
        tool.execute("call-appointment-missing-consent", {
          provider_id: "provider-1",
          slot_datetime: "2026-02-10T09:00:00.000Z",
          location: "Main Clinic",
          mode: "simulated",
          consent_token: "",
          idempotency_key: "idem-missing-consent-1",
        }),
      /consent|token|block/,
    );
    expect(appointmentCount(dbPath)).toBe(0);
  });

  it("blocks medication_refill_request when consent token is missing", async () => {
    const dbPath = createDbPath();
    const medicationId = "med-phase4-missing-consent";
    seedMedication(dbPath, medicationId);
    const tool = createMedicationRefillRequestTool(createApi(dbPath), { userId: USER_ID });

    await expectBlockedBy(
      () =>
        tool.execute("call-refill-missing-consent", {
          medication_id: medicationId,
          pharmacy_target: "Pharmacy A",
          remaining_pills_reported: 20,
          consent_token: "",
          idempotency_key: "idem-missing-consent-2",
        }),
      /consent|token|block/,
    );
    expect(actionAuditCount(dbPath)).toBe(0);
  });

  it("blocks transactional tools when consent token is expired", async () => {
    const dbPath = createDbPath();
    const medicationId = "med-phase4-expired-consent";
    seedMedication(dbPath, medicationId);
    seedConsentToken({
      dbPath,
      token: "expired-consent-token",
      actionType: "appointment_book",
      expiresAtIso: new Date(FIXED_NOW.getTime() - 1_000).toISOString(),
    });
    seedConsentToken({
      dbPath,
      token: "expired-consent-token-refill",
      actionType: "medication_refill_request",
      expiresAtIso: new Date(FIXED_NOW.getTime() - 1_000).toISOString(),
    });

    const appointmentTool = createAppointmentBookTool(createApi(dbPath), { userId: USER_ID });
    const refillTool = createMedicationRefillRequestTool(createApi(dbPath), { userId: USER_ID });

    await expectBlockedBy(
      () =>
        appointmentTool.execute("call-appointment-expired-consent", {
          provider_id: "provider-1",
          slot_datetime: "2026-02-10T09:00:00.000Z",
          location: "Main Clinic",
          mode: "simulated",
          consent_token: "expired-consent-token",
          idempotency_key: "idem-expired-consent-1",
        }),
      /consent|expired|token|block/,
    );

    await expectBlockedBy(
      () =>
        refillTool.execute("call-refill-expired-consent", {
          medication_id: medicationId,
          pharmacy_target: "Pharmacy A",
          remaining_pills_reported: 20,
          consent_token: "expired-consent-token-refill",
          idempotency_key: "idem-expired-consent-2",
        }),
      /consent|expired|token|block/,
    );

    expect(appointmentCount(dbPath)).toBe(0);
    expect(actionAuditCount(dbPath)).toBe(0);
  });

  it("fail-closes appointment_book when policy dependency is unavailable", async () => {
    const dbPath = createDbPath();
    const openSpy = vi.spyOn(dbModule, "openCarePilotDb").mockImplementation(() => {
      throw new Error("policy_unavailable_fail_closed");
    });
    const tool = createAppointmentBookTool(createApi(dbPath), { userId: USER_ID });

    await expectBlockedBy(
      () =>
        tool.execute("call-appointment-policy-outage", {
          provider_id: "provider-1",
          slot_datetime: "2026-02-10T09:00:00.000Z",
          location: "Main Clinic",
          mode: "simulated",
          consent_token: "consent-token",
          idempotency_key: "idem-policy-outage-1",
        }),
      /policy|fail.?closed|unavailable|block/,
    );

    openSpy.mockRestore();
  });

  it("fail-closes medication_refill_request when policy dependency is unavailable", async () => {
    const dbPath = createDbPath();
    const openSpy = vi.spyOn(dbModule, "openCarePilotDb").mockImplementation(() => {
      throw new Error("policy_unavailable_fail_closed");
    });
    const tool = createMedicationRefillRequestTool(createApi(dbPath), { userId: USER_ID });

    await expectBlockedBy(
      () =>
        tool.execute("call-refill-policy-outage", {
          medication_id: "med-not-reached",
          pharmacy_target: "Pharmacy A",
          remaining_pills_reported: 20,
          consent_token: "consent-token",
          idempotency_key: "idem-policy-outage-2",
        }),
      /policy|fail.?closed|unavailable|block/,
    );

    openSpy.mockRestore();
  });

  it("replays duplicate refill requests in the same replay_window_bucket", async () => {
    const dbPath = createDbPath();
    const medicationId = "med-phase4-replay";
    const idempotencyKey = "idem-replay-window";
    const consentToken = "valid-consent-token";
    seedMedication(dbPath, medicationId);
    seedConsentToken({
      dbPath,
      token: consentToken,
      actionType: "medication_refill_request",
      expiresAtIso: new Date(FIXED_NOW.getTime() + 5 * 60 * 1000).toISOString(),
      payloadHash: computeRefillPayloadHash({
        medicationId,
        pharmacyTarget: "Pharmacy A",
        remainingPillsReported: 20,
      }),
    });
    const tool = createMedicationRefillRequestTool(createApi(dbPath), { userId: USER_ID });

    const first = await tool.execute("call-refill-replay-1", {
      medication_id: medicationId,
      pharmacy_target: "Pharmacy A",
      remaining_pills_reported: 20,
      consent_token: consentToken,
      idempotency_key: idempotencyKey,
    });
    const second = await tool.execute("call-refill-replay-2", {
      medication_id: medicationId,
      pharmacy_target: "Pharmacy A",
      remaining_pills_reported: 20,
      consent_token: consentToken,
      idempotency_key: idempotencyKey,
    });

    const firstDetails = detailsOf(first);
    const secondDetails = detailsOf(second);
    expect(firstDetails.status).toBe("ok");
    expect(secondDetails.status).toBe("ok");

    const firstData = (firstDetails.data ?? {}) as Record<string, unknown>;
    const secondData = (secondDetails.data ?? {}) as Record<string, unknown>;
    expect(secondData.request_execution_status).toBe(firstData.request_execution_status);
    expect(secondData.request_ref).toBe(firstData.request_ref);

    expect(actionAuditCount(dbPath, idempotencyKey)).toBe(1);
  });

  it("blocks refill replay when consent token differs from the original request", async () => {
    const dbPath = createDbPath();
    const medicationId = "med-phase4-replay-token-mismatch";
    const idempotencyKey = "idem-replay-token-mismatch";
    const originalConsentToken = "valid-consent-token-original";
    seedMedication(dbPath, medicationId);
    seedConsentToken({
      dbPath,
      token: originalConsentToken,
      actionType: "medication_refill_request",
      expiresAtIso: new Date(FIXED_NOW.getTime() + 5 * 60 * 1000).toISOString(),
      payloadHash: computeRefillPayloadHash({
        medicationId,
        pharmacyTarget: "Pharmacy A",
        remainingPillsReported: 20,
      }),
    });
    const tool = createMedicationRefillRequestTool(createApi(dbPath), { userId: USER_ID });

    const first = await tool.execute("call-refill-replay-mismatch-1", {
      medication_id: medicationId,
      pharmacy_target: "Pharmacy A",
      remaining_pills_reported: 20,
      consent_token: originalConsentToken,
      idempotency_key: idempotencyKey,
    });
    const firstDetails = detailsOf(first);
    expect(firstDetails.status).toBe("ok");

    await expectBlockedBy(
      () =>
        tool.execute("call-refill-replay-mismatch-2", {
          medication_id: medicationId,
          pharmacy_target: "Pharmacy A",
          remaining_pills_reported: 20,
          consent_token: "different-consent-token",
          idempotency_key: idempotencyKey,
        }),
      /consent|token|mismatch|block/,
    );
  });

  it("allows appointment_book with recently-used consent token from hook consumption", async () => {
    const dbPath = createDbPath();
    const consentToken = "appointment-recently-used";
    seedConsentToken({
      dbPath,
      token: consentToken,
      actionType: "appointment_book",
      expiresAtIso: new Date(FIXED_NOW.getTime() + 5 * 60 * 1000).toISOString(),
      payloadHash: createHash("sha256")
        .update(
          JSON.stringify({
            provider_id: "provider-1",
            slot_datetime: "2026-02-10T09:00:00.000Z",
            location: "Main Clinic",
            mode: "simulated",
          }),
          "utf8",
        )
        .digest("hex"),
      usedAtIso: new Date(FIXED_NOW.getTime() - 2_000).toISOString(),
    });

    const tool = createAppointmentBookTool(createApi(dbPath), { userId: USER_ID });
    const result = await tool.execute("call-appointment-recently-used-consent", {
      provider_id: "provider-1",
      slot_datetime: "2026-02-10T09:00:00.000Z",
      location: "Main Clinic",
      mode: "simulated",
      consent_token: consentToken,
      idempotency_key: "idem-appointment-recently-used",
    });

    const details = detailsOf(result);
    expect(details.status).toBe("ok");
    expect(appointmentCount(dbPath)).toBe(1);
  });

  it("blocks appointment_book when consent token was used too long ago", async () => {
    const dbPath = createDbPath();
    const consentToken = "appointment-stale-used";
    seedConsentToken({
      dbPath,
      token: consentToken,
      actionType: "appointment_book",
      expiresAtIso: new Date(FIXED_NOW.getTime() + 5 * 60 * 1000).toISOString(),
      payloadHash: createHash("sha256")
        .update(
          JSON.stringify({
            provider_id: "provider-1",
            slot_datetime: "2026-02-10T09:00:00.000Z",
            location: "Main Clinic",
            mode: "simulated",
          }),
          "utf8",
        )
        .digest("hex"),
      usedAtIso: new Date(FIXED_NOW.getTime() - 60_000).toISOString(),
    });

    const tool = createAppointmentBookTool(createApi(dbPath), { userId: USER_ID });

    await expectBlockedBy(
      () =>
        tool.execute("call-appointment-stale-used-consent", {
          provider_id: "provider-1",
          slot_datetime: "2026-02-10T09:00:00.000Z",
          location: "Main Clinic",
          mode: "simulated",
          consent_token: consentToken,
          idempotency_key: "idem-appointment-stale-used",
        }),
      /consent|token|block/,
    );
  });

  it("blocks refill replay when consent token was used too long ago", async () => {
    const dbPath = createDbPath();
    const medicationId = "med-phase4-replay-stale-used";
    const idempotencyKey = "idem-replay-stale-used";
    const consentToken = "refill-stale-used-token";
    seedMedication(dbPath, medicationId);
    seedConsentToken({
      dbPath,
      token: consentToken,
      actionType: "medication_refill_request",
      expiresAtIso: new Date(FIXED_NOW.getTime() + 5 * 60 * 1000).toISOString(),
      payloadHash: computeRefillPayloadHash({
        medicationId,
        pharmacyTarget: "Pharmacy A",
        remainingPillsReported: 20,
      }),
      usedAtIso: new Date(FIXED_NOW.getTime() - 60_000).toISOString(),
    });

    const tool = createMedicationRefillRequestTool(createApi(dbPath), { userId: USER_ID });

    await expectBlockedBy(
      () =>
        tool.execute("call-refill-replay-stale-used", {
          medication_id: medicationId,
          pharmacy_target: "Pharmacy A",
          remaining_pills_reported: 20,
          consent_token: consentToken,
          idempotency_key: idempotencyKey,
        }),
      /consent|token|block/,
    );
  });
});
