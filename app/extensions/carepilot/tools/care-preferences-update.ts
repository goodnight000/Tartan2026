import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import { parseCarePilotPluginConfig } from "../config.js";
import type { CarePilotClinicalStore, CarePilotRow } from "../services/clinical-store.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { closeCarePilotDb, openCarePilotDb } from "../services/db.js";
import { runCarePilotMigrations } from "../services/migrations.js";

const DAY_MS = 24 * 60 * 60 * 1000;

type ParsedPreferenceCommand =
  | {
      kind: "pause";
      normalizedCommand: "pause";
    }
  | {
      kind: "resume";
      normalizedCommand: "resume";
    }
  | {
      kind: "medication_only";
      normalizedCommand: "only medication reminders";
    }
  | {
      kind: "snooze";
      normalizedCommand: "snooze X days";
      days: number;
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

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveToolUserId(value: string | undefined): string {
  const userId = toTrimmedString(value);
  return userId || "default_user";
}

function normalizeCommand(raw: unknown): string {
  return toTrimmedString(raw).toLowerCase().replace(/\s+/g, " ");
}

function parsePreferenceCommand(raw: unknown): ParsedPreferenceCommand | null {
  const command = normalizeCommand(raw);
  if (command === "pause" || command === "pause proactive care") {
    return {
      kind: "pause",
      normalizedCommand: "pause",
    };
  }
  if (command === "resume" || command === "resume proactive care") {
    return {
      kind: "resume",
      normalizedCommand: "resume",
    };
  }
  if (command === "only medication reminders") {
    return {
      kind: "medication_only",
      normalizedCommand: "only medication reminders",
    };
  }
  const snoozeMatch = /^snooze(?:\s+for)?\s+(\d+)\s+days?$/.exec(command);
  if (snoozeMatch) {
    const days = Number(snoozeMatch[1]);
    if (Number.isFinite(days) && days > 0) {
      return {
        kind: "snooze",
        normalizedCommand: "snooze X days",
        days: Math.floor(days),
      };
    }
  }
  return null;
}

function getOrCreateProfile(store: CarePilotClinicalStore, userId: string): CarePilotRow {
  const existing = store.patientProfiles.list({ where: { user_id: userId }, limit: 1 })[0] ?? null;
  if (existing) {
    return existing;
  }
  return store.patientProfiles.create({
    id: randomUUID(),
    user_id: userId,
    timezone: "UTC",
  });
}

function applyPreferenceCommand(
  store: CarePilotClinicalStore,
  userId: string,
  command: ParsedPreferenceCommand,
): CarePilotRow | null {
  const profile = getOrCreateProfile(store, userId);
  const profileId = toTrimmedString(profile.id);
  if (!profileId) {
    throw new Error("Unable to resolve patient profile id.");
  }

  if (command.kind === "pause") {
    return store.patientProfiles.update(profileId, {
      proactive_mode: "paused",
    });
  }
  if (command.kind === "resume") {
    return store.patientProfiles.update(profileId, {
      proactive_mode: "active",
      snooze_until: null,
    });
  }
  if (command.kind === "medication_only") {
    return store.patientProfiles.update(profileId, {
      proactive_mode: "medication_only",
    });
  }
  return store.patientProfiles.update(profileId, {
    snooze_until: new Date(Date.now() + command.days * DAY_MS).toISOString(),
  });
}

export function createCarePreferencesUpdateTool(
  api: OpenClawPluginApi,
  options?: { userId?: string },
) {
  const userId = resolveToolUserId(options?.userId);
  return {
    name: "care_preferences_update",
    description:
      "Update proactive care preferences (pause/resume/snooze/medication-only) for the scoped user profile.",
    parameters: Type.Object({
      command: Type.String(),
    }),
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const command = parsePreferenceCommand(rawParams.command);
      if (!command) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code: "invalid_command",
              message:
                "command must be one of: pause | resume | snooze X days | only medication reminders.",
            },
          ],
        });
      }

      try {
        const updatedProfile = withStore(api, (store) => {
          const profile = applyPreferenceCommand(store, userId, command);
          if (!profile) {
            throw new Error("Unable to persist care preferences.");
          }
          return profile;
        });

        return jsonResult({
          status: "ok",
          data: {
            user_id: userId,
            mapped_command: command.normalizedCommand,
            patient_profile: updatedProfile,
          },
          errors: [],
        });
      } catch (error) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code: "care_preferences_update_failed",
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        });
      }
    },
  };
}
