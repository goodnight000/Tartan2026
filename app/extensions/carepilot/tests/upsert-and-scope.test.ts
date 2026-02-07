import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createClinicalProfileGetTool } from "../tools/clinical-profile-get.js";
import { createClinicalProfileUpsertTool } from "../tools/clinical-profile-upsert.js";

const createdDbs = new Set<string>();

function createApi(dbPath: string): OpenClawPluginApi {
  createdDbs.add(dbPath);
  return {
    pluginConfig: {
      dbPath,
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  } as OpenClawPluginApi;
}

function createDbPath(): string {
  return path.join(os.tmpdir(), `carepilot-test-${randomUUID()}.sqlite`);
}

afterEach(async () => {
  const fs = await import("node:fs/promises");
  for (const dbPath of createdDbs) {
    try {
      await fs.unlink(dbPath);
    } catch {
      // Best-effort cleanup.
    }
  }
  createdDbs.clear();
});

describe("carepilot clinical upsert + scoping", () => {
  it("rejects unsupported entity operation combinations at contract layer", async () => {
    const api = createApi(createDbPath());
    const tool = createClinicalProfileUpsertTool(api, { userId: "user-a" });
    const result = await tool.execute("call-1", {
      entity_type: "patient_profile",
      operation: "resolve",
      payload: { id: "profile-1", reconfirm_ack: true },
      source: "user_direct",
    });

    // oxlint-disable-next-line typescript/no-explicit-any
    const details = (result as any).details;
    expect(details.status).toBe("error");
    expect(details.errors[0]?.code).toBe("invalid_operation");
  });

  it("sanitizes update payloads and ignores non-column / non-scalar fields", async () => {
    const api = createApi(createDbPath());
    const tool = createClinicalProfileUpsertTool(api, { userId: "user-a" });
    const created = await tool.execute("call-2", {
      entity_type: "conditions",
      operation: "create",
      payload: {
        name: "Hypertension",
        status: "active",
        severity: "moderate",
        source: "user_direct",
        confidence: 0.95,
      },
      source: "user_direct",
    });

    // oxlint-disable-next-line typescript/no-explicit-any
    const createdEntityId = (created as any).details.data.updated_entity.id as string;
    const updated = await tool.execute("call-3", {
      entity_type: "conditions",
      operation: "update",
      payload: {
        id: createdEntityId,
        status: "resolved",
        confidence: 0.9,
        reconfirm_ack: true,
        bogus_object: { nested: true },
      },
      source: "user_direct",
    });

    // oxlint-disable-next-line typescript/no-explicit-any
    const details = (updated as any).details;
    expect(details.status).toBe("ok");
    expect(details.data.updated_entity.status).toBe("resolved");
    expect(details.data.updated_entity.bogus_object).toBeUndefined();
  });

  it("scopes profile reads by user", async () => {
    const api = createApi(createDbPath());
    const upsertUserA = createClinicalProfileUpsertTool(api, { userId: "user-a" });
    const getUserA = createClinicalProfileGetTool(api, { userId: "user-a" });
    const getUserB = createClinicalProfileGetTool(api, { userId: "user-b" });

    await upsertUserA.execute("call-4", {
      entity_type: "medications",
      operation: "create",
      payload: {
        name: "Metformin",
        frequency_per_day: 2,
        status: "active",
      },
      source: "user_direct",
    });

    const aResult = await getUserA.execute("call-5", {
      sections: ["medications"],
    });
    const bResult = await getUserB.execute("call-6", {
      sections: ["medications"],
    });

    // oxlint-disable-next-line typescript/no-explicit-any
    const aMedications = ((aResult as any).details.data.medications ?? []) as unknown[];
    // oxlint-disable-next-line typescript/no-explicit-any
    const bMedications = ((bResult as any).details.data.medications ?? []) as unknown[];
    expect(aMedications.length).toBe(1);
    expect(bMedications.length).toBe(0);
  });
});
