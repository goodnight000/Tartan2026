import type { PluginConfigUiHint } from "openclaw/plugin-sdk";
import type { ZodIssue } from "zod";
import {
  type CarePilotPluginConfig,
  CarePilotPluginConfigSchema,
  CAREPILOT_HEALTH_METRICS,
  DEFAULT_CAREPILOT_DB_PATH,
  DEFAULT_RETENTION_POLICIES,
} from "./types/plugin-config.js";

function formatIssues(issues: ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function parseCarePilotPluginConfig(value: unknown): CarePilotPluginConfig {
  const result = CarePilotPluginConfigSchema.safeParse(value ?? {});
  if (result.success) {
    return result.data;
  }
  throw new Error(`Invalid CarePilot plugin config: ${formatIssues(result.error.issues)}`);
}

export const carePilotConfigSchema = {
  parse: parseCarePilotPluginConfig,
  uiHints: {
    dbPath: {
      label: "CarePilot DB Path",
      placeholder: DEFAULT_CAREPILOT_DB_PATH,
      help: "SQLite path for CarePilot clinical and audit state.",
      advanced: true,
    },
    retentionPolicies: {
      label: "Retention Policies",
      help: "Retention windows by file category in days.",
      advanced: true,
    },
    triageMode: {
      label: "Triage Mode",
      help: "Safety posture for triage classification.",
    },
    actionMode: {
      label: "Action Mode",
      help: "Use simulated actions for demo-safe behavior.",
    },
    proactiveMaxPerDay: {
      label: "Proactive Max Per Day",
      help: "Daily cap for non-urgent proactive messages.",
    },
    "voice.provider": {
      label: "Voice Provider",
      help: "Speech-to-text provider backend.",
    },
    "voice.enabled": {
      label: "Voice Enabled",
    },
    "docs.imagingAssist": {
      label: "Imaging Assist",
    },
    "docs.directImagingInterpretation": {
      label: "Direct Imaging Interpretation",
      help: "Must remain disabled for MVP safety scope.",
    },
    "healthkit.mode": {
      label: "HealthKit Mode",
      help: "Simulated now; live mode reserved for future integration.",
    },
    "healthkit.enabledMetrics": {
      label: "HealthKit Metrics",
      help: `Allowed values: ${CAREPILOT_HEALTH_METRICS.join(", ")}.`,
      advanced: true,
    },
    "retentionPolicies.lab_report_days": {
      label: "Lab Report Retention (days)",
      advanced: true,
      placeholder: String(DEFAULT_RETENTION_POLICIES.lab_report_days),
    },
    "retentionPolicies.imaging_report_days": {
      label: "Imaging Report Retention (days)",
      advanced: true,
      placeholder: String(DEFAULT_RETENTION_POLICIES.imaging_report_days),
    },
    "retentionPolicies.clinical_note_days": {
      label: "Clinical Note Retention (days)",
      advanced: true,
      placeholder: String(DEFAULT_RETENTION_POLICIES.clinical_note_days),
    },
    "retentionPolicies.voice_attachment_days": {
      label: "Voice Attachment Retention (days)",
      advanced: true,
      placeholder: String(DEFAULT_RETENTION_POLICIES.voice_attachment_days),
    },
    "retentionPolicies.other_days": {
      label: "Other File Retention (days)",
      advanced: true,
      placeholder: String(DEFAULT_RETENTION_POLICIES.other_days),
    },
  } satisfies Record<string, PluginConfigUiHint>,
};

export type { CarePilotPluginConfig };

