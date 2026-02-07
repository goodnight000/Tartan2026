import { Type } from "@sinclair/typebox";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parseCarePilotPluginConfig } from "../config.js";
import type { CarePilotClinicalStore, CarePilotRow } from "../services/clinical-store.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { closeCarePilotDb, openCarePilotDb } from "../services/db.js";
import { normalizeFindingLabel } from "../services/document-parser.js";
import { runCarePilotMigrations } from "../services/migrations.js";

type ReportInterpretFinding = {
  finding_type: string;
  label: string;
  value_text: string | null;
  unit: string | null;
  is_abnormal: boolean;
  confidence: number;
  risk_markers: string[];
  trend_direction: "up" | "down" | "stable" | null;
  prior_result_available: boolean;
  clinical_significance_hint: string | null;
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

function parseRiskMarkers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const markers = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  return [...new Set(markers)];
}

function parseTrendDirection(value: unknown): "up" | "down" | "stable" | null {
  if (value === "up" || value === "down" || value === "stable") {
    return value;
  }
  return null;
}

function parsePersistedFinding(row: CarePilotRow): ReportInterpretFinding {
  let riskMarkers: string[] = [];
  let trendDirection: "up" | "down" | "stable" | null = null;
  let priorResultAvailable = false;
  let significanceHint: string | null = null;

  const provenanceRaw = typeof row.provenance_json === "string" ? row.provenance_json : "";
  if (provenanceRaw) {
    try {
      const parsed = JSON.parse(provenanceRaw) as Record<string, unknown>;
      riskMarkers = parseRiskMarkers(parsed.risk_markers);
      const trend = asRecord(parsed.trend_comparison);
      trendDirection = parseTrendDirection(trend?.trend_direction);
      priorResultAvailable = trend?.has_prior_comparable_result === true;
      significanceHint =
        typeof trend?.clinical_significance_hint === "string"
          ? trend.clinical_significance_hint
          : null;
    } catch {
      riskMarkers = [];
    }
  }

  return {
    finding_type: typeof row.finding_type === "string" ? row.finding_type : "unknown",
    label: typeof row.label === "string" ? row.label : "Unknown finding",
    value_text: typeof row.value_text === "string" ? row.value_text : null,
    unit: typeof row.unit === "string" ? row.unit : null,
    is_abnormal: Number(row.is_abnormal ?? 0) === 1,
    confidence: typeof row.confidence === "number" ? Number(row.confidence) : 0,
    risk_markers: riskMarkers,
    trend_direction: trendDirection,
    prior_result_available: priorResultAvailable,
    clinical_significance_hint: significanceHint,
  };
}

function parseInputFinding(raw: unknown): ReportInterpretFinding | null {
  const value = asRecord(raw);
  if (!value) {
    return null;
  }
  const label = typeof value.label === "string" ? value.label.trim() : "";
  if (!label) {
    return null;
  }

  return {
    finding_type: typeof value.finding_type === "string" ? value.finding_type : "unknown",
    label,
    value_text: typeof value.value_text === "string" ? value.value_text : null,
    unit: typeof value.unit === "string" ? value.unit : null,
    is_abnormal: value.is_abnormal === true,
    confidence:
      typeof value.confidence === "number" && Number.isFinite(value.confidence)
        ? Number(value.confidence)
        : 0,
    risk_markers: parseRiskMarkers(value.risk_markers),
    trend_direction: parseTrendDirection(value.trend_direction),
    prior_result_available: value.prior_result_available === true,
    clinical_significance_hint:
      typeof value.clinical_significance_hint === "string" ? value.clinical_significance_hint : null,
  };
}

function loadDocumentFindings(
  store: CarePilotClinicalStore,
  userId: string,
  documentId: string,
): ReportInterpretFinding[] {
  const rows = store.extractedFindings.list({
    where: {
      user_id: userId,
      document_id: documentId,
    },
    limit: 500,
  });
  return rows.map(parsePersistedFinding);
}

function buildAbnormalHighlights(findings: ReportInterpretFinding[]): string[] {
  const highlights = findings
    .filter((finding) => finding.is_abnormal)
    .slice(0, 6)
    .map((finding) => {
      const suffix = finding.value_text ? ` (${finding.value_text}${finding.unit ? ` ${finding.unit}` : ""})` : "";
      const trend = finding.trend_direction ? ` trend: ${finding.trend_direction}` : "";
      return `${finding.label}${suffix}${trend}`.trim();
    });
  return [...new Set(highlights)];
}

function isUrgentRiskMarker(marker: string): boolean {
  return (
    marker.startsWith("critical_") ||
    marker.includes("hemorrhage") ||
    marker.includes("embol") ||
    marker.includes("dissection") ||
    marker.includes("pneumothorax")
  );
}

function buildUrgencyGuidance(findings: ReportInterpretFinding[]): {
  level: "urgent_follow_up" | "clinician_review" | "routine_monitoring";
  message: string;
} {
  const allRiskMarkers = findings.flatMap((finding) => finding.risk_markers);
  const hasUrgent = allRiskMarkers.some(isUrgentRiskMarker);
  if (hasUrgent) {
    return {
      level: "urgent_follow_up",
      message:
        "Some findings may need urgent clinical follow-up. Contact your care team promptly; this summary is not a diagnosis.",
    };
  }

  const abnormalCount = findings.filter((finding) => finding.is_abnormal).length;
  if (abnormalCount > 0) {
    return {
      level: "clinician_review",
      message:
        "At least one finding is outside expected range. Review these results with your clinician soon for context-specific guidance.",
    };
  }

  return {
    level: "routine_monitoring",
    message:
      "No urgent risk markers detected in this summary. Continue routine monitoring and discuss questions at your next clinical follow-up.",
  };
}

function buildSuggestedQuestions(findings: ReportInterpretFinding[]): string[] {
  const questions = new Set<string>();
  const abnormalFindings = findings.filter((finding) => finding.is_abnormal);

  for (const finding of abnormalFindings.slice(0, 4)) {
    questions.add(`What could explain my ${normalizeFindingLabel(finding.label)} result?`);
    if (finding.prior_result_available && finding.trend_direction) {
      questions.add(`How important is the ${finding.trend_direction} trend in ${normalizeFindingLabel(finding.label)}?`);
    }
    if (finding.clinical_significance_hint) {
      questions.add(`Should this finding change my follow-up or treatment plan?`);
    }
  }

  if (questions.size === 0) {
    questions.add("Are there any follow-up tests I should plan from these results?");
    questions.add("What symptoms should prompt earlier check-in?");
  }

  return [...questions].slice(0, 6);
}

function buildPlainLanguageSummary(
  findings: ReportInterpretFinding[],
  urgency: { level: string; message: string },
): string {
  const total = findings.length;
  const abnormal = findings.filter((finding) => finding.is_abnormal).length;
  const withTrend = findings.filter((finding) => finding.prior_result_available).length;
  const trendSignals = findings
    .filter((finding) => finding.trend_direction && finding.trend_direction !== "stable")
    .slice(0, 2)
    .map((finding) => `${normalizeFindingLabel(finding.label)} (${finding.trend_direction})`);
  const trendText = trendSignals.length > 0 ? ` Notable trends: ${trendSignals.join(", ")}.` : "";

  return `Non-diagnostic summary: reviewed ${total} finding(s), with ${abnormal} flagged as abnormal and ${withTrend} compared against prior results.${trendText} ${urgency.message}`;
}

export function createReportInterpretTool(api: OpenClawPluginApi, options?: { userId?: string }) {
  const userId = resolveToolUserId(options?.userId);

  return {
    name: "report_interpret",
    description:
      "Generate plain-language, non-diagnostic interpretation of extracted report findings with highlights, clinician questions, and urgency guidance.",
    parameters: Type.Object({
      document_id: Type.Optional(Type.String({ minLength: 1 })),
      findings: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: true }), { minItems: 1 })),
    }),
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const documentId = typeof rawParams.document_id === "string" ? rawParams.document_id.trim() : "";
      const inputFindings = Array.isArray(rawParams.findings) ? rawParams.findings : [];

      if (!documentId && inputFindings.length === 0) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code: "invalid_input",
              message: "Provide either document_id or findings for interpretation.",
            },
          ],
        });
      }

      try {
        const findings = documentId
          ? withStore(api, (store) => loadDocumentFindings(store, userId, documentId))
          : inputFindings.map(parseInputFinding).filter((finding): finding is ReportInterpretFinding => finding !== null);

        if (findings.length === 0) {
          return jsonResult({
            status: "error",
            data: null,
            errors: [
              {
                code: "no_findings",
                message: "No extracted findings were available for interpretation.",
              },
            ],
          });
        }

        const urgency = buildUrgencyGuidance(findings);
        const data = {
          plain_language_summary: buildPlainLanguageSummary(findings, urgency),
          abnormal_highlights: buildAbnormalHighlights(findings),
          suggested_clinician_questions: buildSuggestedQuestions(findings),
          urgency_guidance: urgency,
          safety_notice:
            "This interpretation is informational and non-diagnostic. Confirm decisions with a licensed clinician.",
          interpretation_meta: {
            finding_count: findings.length,
            abnormal_count: findings.filter((finding) => finding.is_abnormal).length,
            source: documentId ? "persisted_document" : "inline_findings",
          },
        };

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
              code: "report_interpret_failed",
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        });
      }
    },
  };
}
