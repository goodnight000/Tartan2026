import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parseCarePilotPluginConfig } from "../config.js";
import type { CarePilotClinicalStore } from "../services/clinical-store.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { closeCarePilotDb, openCarePilotDb } from "../services/db.js";
import {
  isSupportedReportFileCategory,
  parseClinicalDocument,
  type ParsedDocumentFinding,
} from "../services/document-parser.js";
import { compareLabTrend } from "../services/lab-trend-comparison.js";
import { runCarePilotMigrations } from "../services/migrations.js";

const DOCUMENT_FILE_CATEGORIES = [
  "lab_report",
  "imaging_report",
  "clinical_note",
  "voice_attachment",
  "other",
] as const;

type DocumentFileCategory = (typeof DOCUMENT_FILE_CATEGORIES)[number];

type StoredDocumentContext = {
  id: string;
  fileCategory: "lab_report" | "imaging_report";
  fileName: string;
  uploadTime: string;
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

function resolveToolUserId(userId: string | undefined): string {
  const normalized = typeof userId === "string" ? userId.trim() : "";
  return normalized || "default_user";
}

function parseIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || !Number.isFinite(Date.parse(trimmed))) {
    return null;
  }
  return new Date(trimmed).toISOString();
}

function mapRetentionDays(config: ReturnType<typeof parseCarePilotPluginConfig>, category: DocumentFileCategory): number {
  switch (category) {
    case "lab_report":
      return config.retentionPolicies.lab_report_days;
    case "imaging_report":
      return config.retentionPolicies.imaging_report_days;
    case "clinical_note":
      return config.retentionPolicies.clinical_note_days;
    case "voice_attachment":
      return config.retentionPolicies.voice_attachment_days;
    case "other":
    default:
      return config.retentionPolicies.other_days;
  }
}

function mapRetentionPolicyKey(category: DocumentFileCategory): string {
  switch (category) {
    case "lab_report":
      return "retentionPolicies.lab_report_days";
    case "imaging_report":
      return "retentionPolicies.imaging_report_days";
    case "clinical_note":
      return "retentionPolicies.clinical_note_days";
    case "voice_attachment":
      return "retentionPolicies.voice_attachment_days";
    case "other":
    default:
      return "retentionPolicies.other_days";
  }
}

function toDocumentFileCategory(value: unknown): DocumentFileCategory | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return (DOCUMENT_FILE_CATEGORIES as readonly string[]).includes(normalized)
    ? (normalized as DocumentFileCategory)
    : null;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function persistFinding(
  store: CarePilotClinicalStore,
  userId: string,
  documentContext: StoredDocumentContext,
  finding: ParsedDocumentFinding,
  observationTime: string,
  trendComparison: ReturnType<typeof compareLabTrend> | null,
) {
  const findingId = randomUUID();
  const provenance = {
    source: {
      document_id: documentContext.id,
      file_category: documentContext.fileCategory,
      file_name: documentContext.fileName,
      upload_time: documentContext.uploadTime,
      observation_time: observationTime,
    },
    parser: finding.provenance,
    risk_markers: finding.risk_markers,
    trend_comparison: trendComparison,
  };

  store.extractedFindings.create({
    id: findingId,
    document_id: documentContext.id,
    user_id: userId,
    finding_type: finding.finding_type,
    label: finding.label,
    value_text: finding.value_text,
    unit: finding.unit,
    reference_range: finding.reference_range,
    is_abnormal: finding.is_abnormal ? 1 : 0,
    confidence: Number(finding.confidence.toFixed(3)),
    provenance_json: JSON.stringify(provenance),
  });

  if (finding.finding_type === "lab_result") {
    const trend = trendComparison ?? {
      has_prior_comparable_result: false,
      prior_value: null,
      delta_absolute: null,
      delta_percent: null,
      trend_direction: "stable" as const,
      clinical_significance_hint:
        "No prior comparable result was found in the comparison window. Please review this value directly with your clinician.",
      prior_result_note: "no prior comparable result available",
      lookback_months: 24,
      prior_observed_at: null,
    };

    return {
      id: findingId,
      finding_type: finding.finding_type,
      label: finding.label,
      value_text: finding.value_text,
      unit: finding.unit,
      reference_range: finding.reference_range,
      is_abnormal: finding.is_abnormal,
      confidence: Number(finding.confidence.toFixed(3)),
      provenance,
      prior_result_available: trend.has_prior_comparable_result,
      prior_value: trend.prior_value,
      delta_absolute: trend.delta_absolute,
      delta_percent: trend.delta_percent,
      trend_direction: trend.trend_direction,
      clinical_significance_hint: trend.clinical_significance_hint,
      prior_result_note: trend.prior_result_note,
    };
  }

  return {
    id: findingId,
    finding_type: finding.finding_type,
    label: finding.label,
    value_text: finding.value_text,
    unit: finding.unit,
    reference_range: finding.reference_range,
    is_abnormal: finding.is_abnormal,
    confidence: Number(finding.confidence.toFixed(3)),
    provenance,
  };
}

function ensureDocumentRow(
  api: OpenClawPluginApi,
  store: CarePilotClinicalStore,
  userId: string,
  params: {
    document_id?: string;
    file_name?: string;
    mime_type?: string;
    file_category: DocumentFileCategory;
    encrypted_path?: string;
    upload_time: string;
    is_context_eligible: boolean;
  },
): StoredDocumentContext {
  const existingDocumentId =
    typeof params.document_id === "string" && params.document_id.trim().length > 0
      ? params.document_id.trim()
      : "";
  if (existingDocumentId) {
    const existing = store.documents.get(existingDocumentId);
    if (existing) {
      if (String(existing.user_id ?? "") !== userId) {
        throw new Error("invalid_document: Document ownership mismatch for this user scope.");
      }

      const existingCategory = String(existing.file_category ?? "");
      if (!isSupportedReportFileCategory(existingCategory)) {
        throw new Error(
          "unsupported_file_category: Only lab_report and imaging_report categories are supported in report_extract.",
        );
      }
      if (existingCategory !== params.file_category) {
        throw new Error("invalid_document: Existing document category does not match file_category.");
      }
      return {
        id: String(existing.id),
        fileCategory: existingCategory as "lab_report" | "imaging_report",
        fileName: String(existing.file_name),
        uploadTime: String(existing.upload_time),
      };
    }
  }

  const config = parseCarePilotPluginConfig(api.pluginConfig);
  const retentionDays = mapRetentionDays(config, params.file_category);
  const retentionUntil = new Date(Date.parse(params.upload_time) + retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const newId = existingDocumentId || randomUUID();
  store.documents.create({
    id: newId,
    user_id: userId,
    file_name: params.file_name ?? "uploaded-report.txt",
    mime_type: params.mime_type ?? "text/plain",
    file_category: params.file_category,
    encrypted_path: params.encrypted_path ?? "local://carepilot/unknown",
    upload_time: params.upload_time,
    retention_until: retentionUntil,
    retention_policy_key: mapRetentionPolicyKey(params.file_category),
    is_context_eligible: params.is_context_eligible ? 1 : 0,
    processing_status: "queued",
  });

  return {
    id: newId,
    fileCategory: params.file_category as "lab_report" | "imaging_report",
    fileName: params.file_name ?? "uploaded-report.txt",
    uploadTime: params.upload_time,
  };
}

function summarizeFindings(findings: Array<Record<string, unknown>>) {
  const abnormalCount = findings.filter((finding) => finding.is_abnormal === true).length;
  const labCount = findings.filter((finding) => finding.finding_type === "lab_result").length;
  const imagingCount = findings.filter((finding) => finding.finding_type === "imaging_impression").length;
  return {
    finding_count: findings.length,
    abnormal_count: abnormalCount,
    lab_finding_count: labCount,
    imaging_finding_count: imagingCount,
  };
}

export function createReportExtractTool(api: OpenClawPluginApi, options?: { userId?: string }) {
  const userId = resolveToolUserId(options?.userId);

  return {
    name: "report_extract",
    description:
      "Extract structured findings from lab/imaging reports, persist findings with provenance/confidence, and enrich lab findings with trend comparison.",
    parameters: Type.Object({
      document_id: Type.Optional(Type.String({ minLength: 1 })),
      file_name: Type.Optional(Type.String({ minLength: 1 })),
      mime_type: Type.Optional(Type.String({ minLength: 1 })),
      file_category: Type.String({ minLength: 1 }),
      encrypted_path: Type.Optional(Type.String({ minLength: 1 })),
      upload_time: Type.Optional(Type.String({ minLength: 1 })),
      observation_time: Type.Optional(Type.String({ minLength: 1 })),
      is_context_eligible: Type.Optional(Type.Boolean()),
      report_text: Type.Optional(Type.String({ minLength: 1 })),
      raw_text: Type.Optional(Type.String({ minLength: 1 })),
    }),
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const fileCategory = toDocumentFileCategory(rawParams.file_category);
      const reportText =
        typeof rawParams.report_text === "string"
          ? rawParams.report_text.trim()
          : typeof rawParams.raw_text === "string"
            ? rawParams.raw_text.trim()
            : "";

      if (!fileCategory || !reportText) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code: "invalid_input",
              message: "file_category and report_text are required.",
            },
          ],
        });
      }

      if (!isSupportedReportFileCategory(fileCategory)) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code: "unsupported_file_category",
              message: "Only lab_report and imaging_report categories are supported in report_extract.",
            },
          ],
        });
      }

      const uploadTimeParsed = parseIsoTimestamp(rawParams.upload_time);
      if (rawParams.upload_time !== undefined && !uploadTimeParsed) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code: "invalid_input",
              message: "upload_time must be a valid ISO timestamp.",
            },
          ],
        });
      }

      const observationTimeParsed = parseIsoTimestamp(rawParams.observation_time);
      if (rawParams.observation_time !== undefined && !observationTimeParsed) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code: "invalid_input",
              message: "observation_time must be a valid ISO timestamp.",
            },
          ],
        });
      }

      const uploadTime = uploadTimeParsed ?? new Date().toISOString();
      const observationTime = observationTimeParsed ?? uploadTime;

      try {
        const data = withStore(api, (store) => {
          const documentContext = ensureDocumentRow(api, store, userId, {
            document_id: typeof rawParams.document_id === "string" ? rawParams.document_id : undefined,
            file_name: typeof rawParams.file_name === "string" ? rawParams.file_name : undefined,
            mime_type: typeof rawParams.mime_type === "string" ? rawParams.mime_type : undefined,
            file_category: fileCategory,
            encrypted_path: typeof rawParams.encrypted_path === "string" ? rawParams.encrypted_path : undefined,
            upload_time: uploadTime,
            is_context_eligible: toBoolean(rawParams.is_context_eligible, true),
          });

          const parseResult = parseClinicalDocument({
            file_category: fileCategory,
            report_text: reportText,
          });

          if (!parseResult.ok) {
            store.documents.update(documentContext.id, { processing_status: "failed" });
            throw new Error(`${parseResult.error_code}: ${parseResult.message}`);
          }

          const existingFindings = store.extractedFindings.list({
            where: { user_id: userId },
            limit: 5000,
          });

          const persistedFindings = parseResult.findings.map((finding) => {
            const trendComparison =
              finding.finding_type === "lab_result"
                ? compareLabTrend({
                    user_id: userId,
                    label: finding.label,
                    unit: finding.unit,
                    current_value: finding.numeric_value,
                    current_observed_at: observationTime,
                    current_document_id: documentContext.id,
                    lookback_months: 24,
                    existing_findings: existingFindings,
                  })
                : null;

            return persistFinding(
              store,
              userId,
              documentContext,
              finding,
              observationTime,
              trendComparison,
            );
          });

          store.documents.update(documentContext.id, { processing_status: "processed" });
          const combinedRiskMarkers = [
            ...parseResult.risk_markers,
            ...persistedFindings.flatMap((finding) => {
              const provenance = toRecord(finding.provenance);
              const markers = provenance.risk_markers;
              return Array.isArray(markers)
                ? markers.filter((value): value is string => typeof value === "string")
                : [];
            }),
          ];

          return {
            document: {
              id: documentContext.id,
              user_id: userId,
              file_category: fileCategory,
              processing_status: "processed",
            },
            findings: persistedFindings,
            risk_markers: [...new Set(combinedRiskMarkers)],
            extract_summary: summarizeFindings(persistedFindings),
          };
        });

        return jsonResult({
          status: "ok",
          data,
          errors: [],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const knownCode = message.split(":")[0]?.trim();
        const code =
          knownCode === "unsupported_file_category" ||
          knownCode === "empty_report_text" ||
          knownCode === "invalid_document"
            ? knownCode
            : "report_extract_failed";

        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code,
              message,
            },
          ],
        });
      }
    },
  };
}
