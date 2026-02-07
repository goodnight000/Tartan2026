import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import * as dbModule from "../services/db.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { runCarePilotMigrations } from "../services/migrations.js";
import { createReportExtractTool } from "../tools/report-extract.js";
import { createReportInterpretTool } from "../tools/report-interpret.js";

const USER_ID = "phase7-user";
const createdDbs = new Set<string>();

function createDbPath(): string {
  const dbPath = path.join(os.tmpdir(), `carepilot-phase7-${randomUUID()}.sqlite`);
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

function detailsOf(result: unknown): Record<string, unknown> {
  return ((result as { details?: unknown }).details ?? {}) as Record<string, unknown>;
}

afterEach(async () => {
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

describe("carepilot phase7 report pipeline", () => {
  it("extracts, persists, and enriches lab findings with trend comparison and explicit fallback", async () => {
    const dbPath = createDbPath();
    const extractTool = createReportExtractTool(createApi(dbPath), { userId: USER_ID });

    const olderResult = detailsOf(
      await extractTool.execute("call-report-extract-old", {
        document_id: "doc-old-labs",
        file_name: "labs-2025-12.txt",
        file_category: "lab_report",
        upload_time: "2025-12-01T10:00:00.000Z",
        observation_time: "2025-12-01T10:00:00.000Z",
        report_text: [
          "Glucose: 100 mg/dL Ref: 70-99",
          "Creatinine: 1.0 mg/dL Ref: 0.7-1.3",
        ].join("\n"),
      }),
    );
    expect(olderResult.status).toBe("ok");

    const newerResult = detailsOf(
      await extractTool.execute("call-report-extract-new", {
        document_id: "doc-new-labs",
        file_name: "labs-2026-02.txt",
        file_category: "lab_report",
        upload_time: "2026-02-07T10:00:00.000Z",
        observation_time: "2026-02-07T10:00:00.000Z",
        report_text: [
          "Glucose: 130 mg/dL Ref: 70-99 High",
          "LDL Cholesterol: 140 mg/dL Ref: 0-100 High",
        ].join("\n"),
      }),
    );

    expect(newerResult.status).toBe("ok");
    const data = (newerResult.data ?? {}) as Record<string, unknown>;
    const findings = Array.isArray(data.findings) ? data.findings : [];
    expect(findings.length).toBeGreaterThanOrEqual(2);

    const glucose = findings.find(
      (item) => (item as Record<string, unknown>).label === "Glucose",
    ) as Record<string, unknown> | undefined;
    const ldl = findings.find(
      (item) => (item as Record<string, unknown>).label === "LDL Cholesterol",
    ) as Record<string, unknown> | undefined;

    expect(glucose?.prior_result_available).toBe(true);
    expect(glucose?.prior_value).toBe(100);
    expect(glucose?.delta_absolute).toBe(30);
    expect(glucose?.trend_direction).toBe("up");
    expect(typeof glucose?.clinical_significance_hint).toBe("string");

    expect(ldl?.prior_result_available).toBe(false);
    expect(ldl?.prior_value).toBeNull();
    expect(ldl?.prior_result_note).toContain("no prior comparable result");

    withStore(dbPath, (store) => {
      const docs = store.documents.list({ where: { user_id: USER_ID }, limit: 10 });
      const persistedFindings = store.extractedFindings.list({ where: { user_id: USER_ID }, limit: 50 });
      expect(docs).toHaveLength(2);
      expect(persistedFindings.length).toBeGreaterThanOrEqual(4);
    });
  });

  it("rejects non-lab/imaging file categories", async () => {
    const dbPath = createDbPath();
    const extractTool = createReportExtractTool(createApi(dbPath), { userId: USER_ID });
    const result = detailsOf(
      await extractTool.execute("call-report-unsupported", {
        document_id: "doc-unsupported",
        file_category: "clinical_note",
        report_text: "free text clinical note",
      }),
    );

    expect(result.status).toBe("error");
    const errors = Array.isArray(result.errors) ? result.errors : [];
    expect((errors[0] as Record<string, unknown>)?.code).toBe("unsupported_file_category");
  });

  it("rejects invalid upload/observation timestamps", async () => {
    const dbPath = createDbPath();
    const extractTool = createReportExtractTool(createApi(dbPath), { userId: USER_ID });
    const result = detailsOf(
      await extractTool.execute("call-report-invalid-time", {
        file_category: "lab_report",
        upload_time: "not-an-iso-timestamp",
        report_text: "Glucose: 100 mg/dL Ref: 70-99",
      }),
    );

    expect(result.status).toBe("error");
    const errors = Array.isArray(result.errors) ? result.errors : [];
    expect((errors[0] as Record<string, unknown>)?.code).toBe("invalid_input");
  });

  it("interprets persisted findings with non-diagnostic language and urgency guidance", async () => {
    const dbPath = createDbPath();
    const api = createApi(dbPath);
    const extractTool = createReportExtractTool(api, { userId: USER_ID });
    const interpretTool = createReportInterpretTool(api, { userId: USER_ID });

    const extractResult = detailsOf(
      await extractTool.execute("call-report-imaging", {
        document_id: "doc-imaging-1",
        file_name: "ct-head.txt",
        file_category: "imaging_report",
        upload_time: "2026-02-07T11:00:00.000Z",
        observation_time: "2026-02-07T11:00:00.000Z",
        report_text: "Impression: Intracranial hemorrhage is present.",
      }),
    );
    expect(extractResult.status).toBe("ok");

    const interpretResult = detailsOf(
      await interpretTool.execute("call-report-interpret", {
        document_id: "doc-imaging-1",
      }),
    );

    expect(interpretResult.status).toBe("ok");
    const data = (interpretResult.data ?? {}) as Record<string, unknown>;
    expect(String(data.plain_language_summary ?? "")).toContain("Non-diagnostic");
    expect(String(data.safety_notice ?? "").toLowerCase()).toContain("non-diagnostic");

    const abnormalHighlights = Array.isArray(data.abnormal_highlights) ? data.abnormal_highlights : [];
    expect(abnormalHighlights.length).toBeGreaterThan(0);

    const questions = Array.isArray(data.suggested_clinician_questions)
      ? data.suggested_clinician_questions
      : [];
    expect(questions.length).toBeGreaterThan(0);

    const urgency = (data.urgency_guidance ?? {}) as Record<string, unknown>;
    expect(urgency.level).toBe("urgent_follow_up");
    expect(String(urgency.message ?? "").length).toBeGreaterThan(20);
  });
});
