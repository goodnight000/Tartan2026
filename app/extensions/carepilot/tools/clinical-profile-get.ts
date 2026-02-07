import { Type } from "@sinclair/typebox";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parseCarePilotPluginConfig } from "../config.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { closeCarePilotDb, openCarePilotDb } from "../services/db.js";
import { runCarePilotMigrations } from "../services/migrations.js";

const PROFILE_SECTIONS = [
  "conditions",
  "allergies",
  "medications",
  "preferences",
  "active_symptoms",
] as const;

type ProfileSection = (typeof PROFILE_SECTIONS)[number];

function withStore<T>(api: OpenClawPluginApi, run: ReturnType<typeof createCarePilotClinicalStore> extends infer S ? (store: S) => T : never): T {
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

function normalizeSections(input: unknown): ProfileSection[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [...PROFILE_SECTIONS];
  }
  const requested = new Set<ProfileSection>();
  for (const section of input) {
    if (typeof section === "string" && (PROFILE_SECTIONS as readonly string[]).includes(section)) {
      requested.add(section as ProfileSection);
    }
  }
  if (requested.size === 0) {
    return [...PROFILE_SECTIONS];
  }
  return Array.from(requested);
}

function resolveToolUserId(userId: string | undefined): string {
  const value = typeof userId === "string" ? userId.trim() : "";
  return value || "default_user";
}

export function createClinicalProfileGetTool(
  api: OpenClawPluginApi,
  options?: { userId?: string },
) {
  const userId = resolveToolUserId(options?.userId);
  return {
    name: "clinical_profile_get",
    description: "Read normalized patient profile sections from clinical_store.",
    parameters: Type.Object({
      sections: Type.Optional(
        Type.Array(Type.Union(PROFILE_SECTIONS.map((value) => Type.Literal(value))), { minItems: 1 }),
      ),
    }),
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const sections = normalizeSections(rawParams.sections);

      const data = withStore(api, (store) => {
        const result: Record<string, unknown> = {
          source_of_truth: "clinical_store",
        };

        if (sections.includes("conditions")) {
          result.conditions = store.conditions.list({ where: { user_id: userId }, limit: 500 });
        }
        if (sections.includes("allergies")) {
          result.allergies = store.allergies.list({ where: { user_id: userId }, limit: 500 });
        }
        if (sections.includes("medications")) {
          result.medications = store.medications.list({ where: { user_id: userId }, limit: 500 });
        }
        if (sections.includes("preferences")) {
          result.preferences = store.patientProfiles.list({ where: { user_id: userId }, limit: 1 })[0] ?? null;
        }
        if (sections.includes("active_symptoms")) {
          result.active_symptoms = store.symptomStates.list({
            where: { user_id: userId, status: "active" },
            limit: 500,
          });
        }

        return result;
      });

      return jsonResult({
        status: "ok",
        data,
        errors: [],
      });
    },
  };
}
