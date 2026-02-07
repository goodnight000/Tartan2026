import { z } from "zod";

export const DEFAULT_CAREPILOT_DB_PATH = "~/.openclaw/carepilot/carepilot.sqlite";

export const CAREPILOT_HEALTH_METRICS = [
  "cycle",
  "medication_tracking",
  "workouts",
  "sleep",
  "resting_hr",
  "step_count",
] as const;

export const DEFAULT_RETENTION_POLICIES = {
  lab_report_days: 730,
  imaging_report_days: 730,
  clinical_note_days: 365,
  voice_attachment_days: 30,
  other_days: 90,
} as const;

const CarePilotRetentionPoliciesSchema = z.strictObject({
  lab_report_days: z.number().int().min(1).default(DEFAULT_RETENTION_POLICIES.lab_report_days),
  imaging_report_days: z.number().int().min(1).default(DEFAULT_RETENTION_POLICIES.imaging_report_days),
  clinical_note_days: z.number().int().min(1).default(DEFAULT_RETENTION_POLICIES.clinical_note_days),
  voice_attachment_days: z.number().int().min(1).default(DEFAULT_RETENTION_POLICIES.voice_attachment_days),
  other_days: z.number().int().min(1).default(DEFAULT_RETENTION_POLICIES.other_days),
});

const CarePilotVoiceSchema = z.strictObject({
  provider: z.enum(["openai", "gcp", "local", "mock"]).default("openai"),
  enabled: z.boolean().default(true),
});

const CarePilotDocsSchema = z.strictObject({
  imagingAssist: z.boolean().default(true),
  directImagingInterpretation: z.boolean().default(false),
});

const CarePilotHealthkitSchema = z.strictObject({
  mode: z.enum(["simulated", "live"]).default("simulated"),
  enabledMetrics: z
    .array(z.enum(CAREPILOT_HEALTH_METRICS))
    .min(1)
    .default([...CAREPILOT_HEALTH_METRICS]),
});

export const CarePilotPluginConfigSchema = z.strictObject({
  dbPath: z.string().min(1).default(DEFAULT_CAREPILOT_DB_PATH),
  retentionPolicies: CarePilotRetentionPoliciesSchema.default(DEFAULT_RETENTION_POLICIES),
  triageMode: z.enum(["conservative", "balanced", "aggressive"]).default("conservative"),
  actionMode: z.enum(["simulated", "live"]).default("simulated"),
  proactiveMaxPerDay: z.number().int().min(0).max(10).default(1),
  voice: CarePilotVoiceSchema.default({
    provider: "openai",
    enabled: true,
  }),
  docs: CarePilotDocsSchema.default({
    imagingAssist: true,
    directImagingInterpretation: false,
  }),
  healthkit: CarePilotHealthkitSchema.default({
    mode: "simulated",
    enabledMetrics: [...CAREPILOT_HEALTH_METRICS],
  }),
});

export type CarePilotPluginConfig = z.infer<typeof CarePilotPluginConfigSchema>;

