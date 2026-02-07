import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { CarePilotClinicalStore, CarePilotRow } from "../services/clinical-store.js";
import { parseCarePilotPluginConfig } from "../config.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { closeCarePilotDb, openCarePilotDb } from "../services/db.js";
import { runCarePilotMigrations } from "../services/migrations.js";
import {
  getEmergentContextForSession,
  getTransactionalToolNames,
} from "./message-received-triage.js";

type ContextSnapshot = {
  profile: CarePilotRow | null;
  activeSymptoms: CarePilotRow[];
  recentActionAudit: CarePilotRow[];
};

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

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

function resolveScopedUserId(ctx: { sessionKey?: string; agentId?: string }): string {
  const sessionKey = toTrimmedString(ctx.sessionKey);
  if (sessionKey) {
    return sessionKey;
  }
  const agentId = toTrimmedString(ctx.agentId);
  if (agentId) {
    return agentId;
  }
  return "default_user";
}

function readContextSnapshot(store: CarePilotClinicalStore, userId: string): ContextSnapshot {
  const profile = store.patientProfiles.list({ where: { user_id: userId }, limit: 1 })[0] ?? null;
  const activeSymptoms = store.symptomStates.list({
    where: {
      user_id: userId,
      status: "active",
    },
    limit: 8,
  });
  const recentActionAudit = store.actionAudit
    .list({
      where: {
        user_id: userId,
      },
      limit: 12,
    })
    .toSorted((left, right) => {
      const leftMillis = Date.parse(toTrimmedString(left.started_at));
      const rightMillis = Date.parse(toTrimmedString(right.started_at));
      if (!Number.isFinite(leftMillis) && !Number.isFinite(rightMillis)) {
        return 0;
      }
      if (!Number.isFinite(leftMillis)) {
        return 1;
      }
      if (!Number.isFinite(rightMillis)) {
        return -1;
      }
      return rightMillis - leftMillis;
    })
    .slice(0, 5);

  return {
    profile,
    activeSymptoms,
    recentActionAudit,
  };
}

function formatProfileSection(profile: CarePilotRow | null): string | null {
  if (!profile) {
    return null;
  }

  const timezone = toTrimmedString(profile.timezone) || "unknown";
  const locale = toTrimmedString(profile.locale) || "unknown";
  const proactiveMode = toTrimmedString(profile.proactive_mode) || "active";
  const snoozeUntil = toTrimmedString(profile.snooze_until) || "none";
  const quietHoursStart = toTrimmedString(profile.quiet_hours_start) || "22:00";
  const quietHoursEnd = toTrimmedString(profile.quiet_hours_end) || "08:00";

  return [
    "<carepilot-profile>",
    `timezone=${timezone}`,
    `locale=${locale}`,
    `proactive_mode=${proactiveMode}`,
    `snooze_until=${snoozeUntil}`,
    `quiet_hours=${quietHoursStart}-${quietHoursEnd}`,
    "</carepilot-profile>",
  ].join("\n");
}

function formatActiveSymptomsSection(rows: CarePilotRow[]): string | null {
  if (rows.length === 0) {
    return null;
  }

  const lines = rows.map((row) => {
    const symptom = toTrimmedString(row.symptom) || "unspecified_symptom";
    const severity = toTrimmedString(row.severity) || "unspecified";
    const onset = toTrimmedString(row.onset_at) || "unknown";
    const lastConfirmed = toTrimmedString(row.last_confirmed_at) || "unknown";
    return `- ${symptom} (severity=${severity}, onset=${onset}, last_confirmed=${lastConfirmed})`;
  });

  return ["<carepilot-active-symptoms>", ...lines, "</carepilot-active-symptoms>"].join("\n");
}

function formatRecentActionsSection(rows: CarePilotRow[]): string | null {
  if (rows.length === 0) {
    return null;
  }

  const lines = rows.map((row) => {
    const actionType = toTrimmedString(row.action_type) || "unknown_action";
    const status = toTrimmedString(row.status) || "unknown_status";
    const startedAt = toTrimmedString(row.started_at) || "unknown_start";
    const idempotencyKey = toTrimmedString(row.idempotency_key);
    const idempotencySuffix = idempotencyKey ? ` idem=${idempotencyKey.slice(0, 12)}` : "";
    return `- ${actionType} -> ${status} at ${startedAt}${idempotencySuffix}`;
  });

  return ["<carepilot-recent-actions>", ...lines, "</carepilot-recent-actions>"].join("\n");
}

function formatEmergentSection(sessionKey: string | undefined): string | null {
  const emergent = getEmergentContextForSession(sessionKey);
  if (!emergent) {
    return null;
  }

  return [
    "<carepilot-emergent-context>",
    `triage_level=${emergent.triageLevel}`,
    `captured_at=${emergent.capturedAtIso}`,
    `expires_at=${emergent.expiresAtIso}`,
    `signals=${emergent.signals.join(",") || "none"}`,
    `recommended_next_step=${emergent.recommendedNextStep}`,
    "directive=Do not call transactional tools while this emergent context is active.",
    `blocked_transactional_tools=${getTransactionalToolNames().join(",")}`,
    "</carepilot-emergent-context>",
  ].join("\n");
}

export function registerBeforeAgentStartContextHook(api: OpenClawPluginApi): void {
  api.on("before_agent_start", async (_event, ctx) => {
    const userId = resolveScopedUserId({
      sessionKey: ctx.sessionKey,
      agentId: ctx.agentId,
    });

    const sections: string[] = [];
    const emergentSection = formatEmergentSection(ctx.sessionKey);
    if (emergentSection) {
      sections.push(emergentSection);
    }

    try {
      const snapshot = withStore(api, (store) => readContextSnapshot(store, userId));
      const profileSection = formatProfileSection(snapshot.profile);
      if (profileSection) {
        sections.push(profileSection);
      }

      const activeSymptomsSection = formatActiveSymptomsSection(snapshot.activeSymptoms);
      if (activeSymptomsSection) {
        sections.push(activeSymptomsSection);
      }

      const recentActionsSection = formatRecentActionsSection(snapshot.recentActionAudit);
      if (recentActionsSection) {
        sections.push(recentActionsSection);
      }
    } catch (error) {
      api.logger.warn(
        `[carepilot] before_agent_start context fetch failed for user=${userId}: ${String(error)}`,
      );
    }

    if (sections.length === 0) {
      return;
    }

    return {
      prependContext: ["<carepilot-context>", ...sections, "</carepilot-context>"].join("\n\n"),
    };
  });
}
