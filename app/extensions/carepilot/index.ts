import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import { carePilotConfigSchema, parseCarePilotPluginConfig } from "./config.js";
import { registerAfterToolCallAuditHook } from "./hooks/after-tool-call-audit.js";
import { registerBeforeAgentStartContextHook } from "./hooks/before-agent-start-context.js";
import { registerBeforeToolCallConsentHook } from "./hooks/before-tool-call-consent.js";
import { registerMessageReceivedTriageHook } from "./hooks/message-received-triage.js";
import { registerMessageSendingDisclaimerHook } from "./hooks/message-sending-disclaimer.js";
import { createAppointmentBookTool } from "./tools/appointment-book.js";
import { createClinicalProfileGetTool } from "./tools/clinical-profile-get.js";
import { createClinicalProfileUpsertTool } from "./tools/clinical-profile-upsert.js";
import { createConsentTokenIssueTool } from "./tools/consent-token-issue.js";
import { createLabRecommendTool } from "./tools/lab-recommend.js";
import { createMedicationRefillRequestTool } from "./tools/medication-refill-request.js";
import { createCarePreferencesUpdateTool } from "./tools/care-preferences-update.js";
import { createHealthkitSyncIngestTool } from "./tools/healthkit-sync-ingest.js";
import { createHealthMetricsGetTool } from "./tools/health-metrics-get.js";
import { createReportExtractTool } from "./tools/report-extract.js";
import { createReportInterpretTool } from "./tools/report-interpret.js";
import { createTriageAssessTool } from "./tools/triage-assess.js";
import { createVoiceTranscribeTool } from "./tools/voice-transcribe.js";
import type { CarePilotClinicalStore, CarePilotRow } from "./services/clinical-store.js";
import { createCarePilotClinicalStore } from "./services/clinical-store.js";
import { closeCarePilotDb, openCarePilotDb } from "./services/db.js";
import {
  buildConnectionRecencySummary,
  resolveMetricPermission,
  type CarePilotHealthConnectionStatus,
} from "./services/health-connections.js";
import {
  CAREPILOT_HEALTH_METRIC_TYPES,
  isSignalStale,
  type CarePilotHealthMetricType,
  type CarePilotHealthSignalSource,
} from "./services/health-signal-normalizer.js";
import { runCarePilotMigrations } from "./services/migrations.js";
import { emitPolicyEvent } from "./services/policy-engine.js";
import { CAREPILOT_HEARTBEAT_DEFAULTS } from "./services/proactive-scheduler.js";
import { transcribeVoiceDeterministic } from "./services/stt-service.js";

const PLACEHOLDER_PARAMETERS = Type.Object({}, { additionalProperties: true });
const DAY_MS = 24 * 60 * 60 * 1000;
const QUIET_HOURS_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SUPPORTED_PROACTIVE_MODES = new Set(["active", "paused", "medication_only"]);

const CAREPILOT_PLACEHOLDER_TOOLS = [
  {
    name: "human_escalation_create",
    description: "Create escalation records for human follow-up.",
  },
] as const;

type HealthSignalRow = {
  id: string;
  user_id: string;
  metric_type: CarePilotHealthMetricType;
  source: CarePilotHealthSignalSource;
  summary_json: string;
  observed_at: string;
  synced_at: string;
  stale_after: string;
};

type ProfileSnapshot = {
  timezone: string;
  locale: string;
  date_of_birth_year: number | null;
  biological_sex: string | null;
  proactive_mode: "active" | "paused" | "medication_only";
  quiet_hours_start: string;
  quiet_hours_end: string;
  snooze_until: string | null;
};

function resolveScopedUserId(context: {
  agentId?: string;
  sessionKey?: string;
}): string {
  const sessionKey = toTrimmedString(context.sessionKey);
  if (sessionKey) {
    return sessionKey;
  }
  const agentId = toTrimmedString(context.agentId);
  if (agentId) {
    return agentId;
  }
  return "default_user";
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asNullableString(value: unknown): string | null {
  const normalized = toTrimmedString(value);
  return normalized || null;
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    const casted = Number(value);
    return Number.isFinite(casted) ? casted : null;
  }
  return null;
}

function parseInputNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safeParseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function parseIsoTimestamp(value: unknown): string | null {
  const normalized = toTrimmedString(value);
  if (!normalized) {
    return null;
  }
  const millis = Date.parse(normalized);
  if (!Number.isFinite(millis)) {
    return null;
  }
  return new Date(millis).toISOString();
}

function parseTimestampMillis(value: unknown): number {
  const normalized = toTrimmedString(value);
  if (!normalized) {
    return Number.NaN;
  }
  return Date.parse(normalized);
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

function resolveGatewayScopedUserId(params: Record<string, unknown>): string {
  return resolveScopedUserId({
    sessionKey: toTrimmedString(params.sessionKey ?? params.session_key),
    agentId: toTrimmedString(params.agentId ?? params.agent_id),
  });
}

function normalizeProactiveMode(value: unknown, fallback: ProfileSnapshot["proactive_mode"]) {
  const normalized = toTrimmedString(value);
  if (SUPPORTED_PROACTIVE_MODES.has(normalized)) {
    return normalized as ProfileSnapshot["proactive_mode"];
  }
  return fallback;
}

function normalizeQuietHours(value: unknown, fallback: string): string {
  const normalized = toTrimmedString(value);
  if (QUIET_HOURS_PATTERN.test(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeDateOfBirthYear(value: unknown, fallback: number | null): number | null {
  const candidate = parseInputNumber(value);
  if (candidate === null) {
    if (value === null) {
      return null;
    }
    return fallback;
  }
  const year = Math.trunc(candidate);
  if (year >= 1900 && year <= 2100) {
    return year;
  }
  return fallback;
}

function resolveSnoozeUntil(
  params: Record<string, unknown>,
  fallback: string | null,
  now: Date,
): string | null {
  if (Object.prototype.hasOwnProperty.call(params, "snooze_until")) {
    return parseIsoTimestamp(params.snooze_until);
  }

  if (Object.prototype.hasOwnProperty.call(params, "snooze_days")) {
    const days = parseInputNumber(params.snooze_days);
    if (days === null || days <= 0) {
      return null;
    }
    return new Date(now.getTime() + Math.floor(days) * DAY_MS).toISOString();
  }

  return fallback;
}

function buildProfileSnapshot(profile: CarePilotRow | null): ProfileSnapshot {
  const proactiveMode = toTrimmedString(profile?.proactive_mode);
  return {
    timezone: toTrimmedString(profile?.timezone) || "UTC",
    locale: toTrimmedString(profile?.locale) || "en-US",
    date_of_birth_year: asNullableNumber(profile?.date_of_birth_year),
    biological_sex: asNullableString(profile?.biological_sex),
    proactive_mode: SUPPORTED_PROACTIVE_MODES.has(proactiveMode)
      ? (proactiveMode as ProfileSnapshot["proactive_mode"])
      : "active",
    quiet_hours_start: toTrimmedString(profile?.quiet_hours_start) || "22:00",
    quiet_hours_end: toTrimmedString(profile?.quiet_hours_end) || "08:00",
    snooze_until: parseIsoTimestamp(profile?.snooze_until),
  };
}

function isOnboardingComplete(profile: ProfileSnapshot): boolean {
  return Boolean(
    profile.timezone &&
      profile.locale &&
      typeof profile.date_of_birth_year === "number" &&
      profile.biological_sex,
  );
}

function summarizeActionPayload(row: CarePilotRow): Record<string, unknown> {
  const consentSnapshot = safeParseJson(row.consent_snapshot_json);
  const consentMeta = asRecord(consentSnapshot.consent);
  const idempotencyMeta = asRecord(consentSnapshot.idempotency);

  return {
    payload_hash: asNullableString(row.payload_hash),
    idempotency_key: asNullableString(row.idempotency_key),
    replay_window_bucket: asNullableString(row.replay_window_bucket),
    consent_token_present:
      typeof consentMeta.token_present === "boolean"
        ? consentMeta.token_present
        : Boolean(toTrimmedString(row.consent_token)),
    replay_state: asNullableString(idempotencyMeta.replay_state_before_write),
  };
}

function resolveLatestPolicyEventTimestamp(rows: CarePilotRow[], eventType: string): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (toTrimmedString(row.event_type) !== eventType) {
      continue;
    }
    const createdAt = parseIsoTimestamp(row.created_at);
    if (!createdAt) {
      continue;
    }
    const millis = Date.parse(createdAt);
    if (millis > latestMs) {
      latestMs = millis;
      latest = createdAt;
    }
  }
  return latest;
}

function readUiState(api: OpenClawPluginApi, userId: string): Record<string, unknown> {
  return withStore(api, (store) => {
    const now = new Date();
    const config = parseCarePilotPluginConfig(api.pluginConfig);
    const enabledMetricSet = new Set(config.healthkit.enabledMetrics);

    const profileRow = store.patientProfiles.list({ where: { user_id: userId }, limit: 1 })[0] ?? null;
    const profile = buildProfileSnapshot(profileRow);

    const connectionRow =
      store.healthConnections.list({
        where: { user_id: userId, source_type: "apple_health" },
        limit: 1,
      })[0] ?? null;
    const connectionStatus = (toTrimmedString(connectionRow?.connection_status) ||
      "disconnected") as CarePilotHealthConnectionStatus;
    const lastSyncAt = parseIsoTimestamp(connectionRow?.last_sync_at);
    const permissions = safeParseJson(connectionRow?.permissions_json);
    const connectionMeta = safeParseJson(connectionRow?.connection_meta_json);

    const recency = buildConnectionRecencySummary({
      connection_status: connectionStatus,
      last_sync_at: lastSyncAt,
    });

    const metricSummaries = CAREPILOT_HEALTH_METRIC_TYPES.map((metricType) => {
      const rows = store.healthSignals.list({
        where: { user_id: userId, metric_type: metricType },
        limit: 5000,
      }) as unknown as HealthSignalRow[];
      rows.sort((left, right) => parseTimestampMillis(right.observed_at) - parseTimestampMillis(left.observed_at));

      const latest = rows[0] ?? null;
      const latestSummary = latest ? safeParseJson(latest.summary_json) : null;
      const stale = latest
        ? isSignalStale(
            {
              stale_after: latest.stale_after,
              observed_at: latest.observed_at,
              synced_at: latest.synced_at,
              source: latest.source,
              metric_type: latest.metric_type,
              summary: latestSummary ?? {},
            },
            now,
          )
        : true;
      const enabled = enabledMetricSet.has(metricType);
      const permission = resolveMetricPermission(permissions, metricType);
      const canRead = permission === "granted";

      return {
        metric_type: metricType,
        connected_source_status: connectionStatus,
        enabled,
        latest_value_summary: latestSummary,
        latest_observed_at: latest?.observed_at ?? null,
        last_sync: latest?.synced_at ?? lastSyncAt,
        stale,
        recommendation_eligible: enabled && canRead && connectionStatus === "connected" && !stale,
        permission_toggle: {
          metric_type: metricType,
          enabled,
          can_toggle: true,
          permission_state: permission,
          can_read: canRead,
        },
      };
    });

    const activeSymptoms = store.symptomStates
      .list({
        where: {
          user_id: userId,
          status: "active",
        },
        limit: 500,
      })
      .map((row) => ({
        symptom: toTrimmedString(row.symptom) || "unknown",
        severity: asNullableString(row.severity),
        onset_at: parseIsoTimestamp(row.onset_at),
        last_confirmed_at: parseIsoTimestamp(row.last_confirmed_at),
      }));

    const actionTimeline = store.actionAudit
      .list({
        where: { user_id: userId },
        limit: 500,
      })
      .sort((left, right) => {
        const leftStarted = parseTimestampMillis(left.started_at);
        const rightStarted = parseTimestampMillis(right.started_at);
        if (Number.isFinite(leftStarted) && Number.isFinite(rightStarted)) {
          return rightStarted - leftStarted;
        }
        if (Number.isFinite(leftStarted)) {
          return -1;
        }
        if (Number.isFinite(rightStarted)) {
          return 1;
        }
        return toTrimmedString(right.id).localeCompare(toTrimmedString(left.id));
      })
      .slice(0, 50)
      .map((row) => ({
        id: toTrimmedString(row.id),
        action_type: toTrimmedString(row.action_type) || "unknown",
        status: toTrimmedString(row.status) || "unknown",
        started_at: parseIsoTimestamp(row.started_at),
        finished_at: parseIsoTimestamp(row.finished_at),
        payload_summary: summarizeActionPayload(row),
        error_message: asNullableString(row.error_message),
      }));

    const policyEvents = store.policyEvents.list({
      where: { user_id: userId },
      limit: 1000,
    });
    const lastExportRequestedAt = resolveLatestPolicyEventTimestamp(
      policyEvents,
      "privacy_export_requested",
    );
    const lastDeleteRequestedAt = resolveLatestPolicyEventTimestamp(
      policyEvents,
      "privacy_delete_requested",
    );

    const permissionsByMetric: Record<string, string> = {};
    for (const metricType of CAREPILOT_HEALTH_METRIC_TYPES) {
      permissionsByMetric[metricType] = resolveMetricPermission(permissions, metricType);
    }

    return {
      user_id: userId,
      onboarding: {
        complete: isOnboardingComplete(profile),
        profile,
      },
      profile,
      dashboard: {
        source_status: {
          source_type: "apple_health",
          connection_status: recency.connectionStatus,
          last_sync_at: recency.lastSyncAt,
          recency_state: recency.recencyState,
          is_stale: recency.isStale,
          connection_meta: connectionMeta,
        },
        metric_summaries: metricSummaries,
        symptom_state_summary: {
          active_count: activeSymptoms.length,
          items: activeSymptoms,
        },
      },
      actions: actionTimeline,
      settings: {
        permissions: permissionsByMetric,
        proactive_mode: profile.proactive_mode,
        quiet_hours_start: profile.quiet_hours_start,
        quiet_hours_end: profile.quiet_hours_end,
        snooze_until: profile.snooze_until,
        last_export_requested_at: lastExportRequestedAt,
        last_delete_requested_at: lastDeleteRequestedAt,
      },
    };
  });
}

function upsertUiProfile(
  api: OpenClawPluginApi,
  params: Record<string, unknown>,
): { userId: string; profile: ProfileSnapshot } {
  const userId = resolveGatewayScopedUserId(params);
  const now = new Date();

  const profile = withStore(api, (store) => {
    const existingProfile =
      store.patientProfiles.list({ where: { user_id: userId }, limit: 1 })[0] ?? null;
    const existingSnapshot = buildProfileSnapshot(existingProfile);

    const timezone = toTrimmedString(params.timezone) || existingSnapshot.timezone;
    const locale = toTrimmedString(params.locale) || existingSnapshot.locale;
    const dateOfBirthYear = normalizeDateOfBirthYear(
      params.date_of_birth_year,
      existingSnapshot.date_of_birth_year,
    );
    const biologicalSex =
      Object.prototype.hasOwnProperty.call(params, "biological_sex") ||
      Object.prototype.hasOwnProperty.call(params, "biologicalSex")
        ? asNullableString(params.biological_sex ?? params.biologicalSex)
        : existingSnapshot.biological_sex;
    const proactiveMode = normalizeProactiveMode(
      params.proactive_mode ?? params.proactiveMode,
      existingSnapshot.proactive_mode,
    );
    const quietHoursStart = normalizeQuietHours(
      params.quiet_hours_start ?? params.quietHoursStart,
      existingSnapshot.quiet_hours_start,
    );
    const quietHoursEnd = normalizeQuietHours(
      params.quiet_hours_end ?? params.quietHoursEnd,
      existingSnapshot.quiet_hours_end,
    );
    const snoozeUntil = resolveSnoozeUntil(params, existingSnapshot.snooze_until, now);

    if (!existingProfile) {
      return store.patientProfiles.create({
        id: randomUUID(),
        user_id: userId,
        timezone,
        locale,
        date_of_birth_year: dateOfBirthYear,
        biological_sex: biologicalSex,
        proactive_mode: proactiveMode,
        quiet_hours_start: quietHoursStart,
        quiet_hours_end: quietHoursEnd,
        snooze_until: snoozeUntil,
      });
    }

    const profileId = toTrimmedString(existingProfile.id);
    if (!profileId) {
      throw new Error("Unable to resolve patient profile id.");
    }

    const updated = store.patientProfiles.update(profileId, {
      timezone,
      locale,
      date_of_birth_year: dateOfBirthYear,
      biological_sex: biologicalSex,
      proactive_mode: proactiveMode,
      quiet_hours_start: quietHoursStart,
      quiet_hours_end: quietHoursEnd,
      snooze_until: snoozeUntil,
    });
    if (!updated) {
      throw new Error("Unable to persist patient profile.");
    }
    return updated;
  });

  return {
    userId,
    profile: buildProfileSnapshot(profile),
  };
}

function registerCarePilotGatewayMethods(api: OpenClawPluginApi): void {
  const sendError = (respond: (ok: boolean, payload?: unknown) => void, error: unknown) => {
    respond(false, {
      error: error instanceof Error ? error.message : String(error),
    });
  };

  api.registerGatewayMethod("carepilot.ui.state.get", ({ params, respond }) => {
    try {
      const payload = readUiState(api, resolveGatewayScopedUserId(asRecord(params)));
      respond(true, payload);
    } catch (error) {
      sendError(respond, error);
    }
  });

  api.registerGatewayMethod("carepilot.ui.profile.upsert", ({ params, respond }) => {
    try {
      const result = upsertUiProfile(api, asRecord(params));
      respond(true, {
        user_id: result.userId,
        profile: result.profile,
      });
    } catch (error) {
      sendError(respond, error);
    }
  });

  const registerPrivacyMethod = (
    method: "carepilot.ui.privacy.export" | "carepilot.ui.privacy.delete",
    eventType: "privacy_export_requested" | "privacy_delete_requested",
    action: "export" | "delete",
    message: string,
  ) => {
    api.registerGatewayMethod(method, ({ params, respond }) => {
      try {
        const requestParams = asRecord(params);
        const userId = resolveGatewayScopedUserId(requestParams);
        const now = new Date();
        const event = withStore(api, (store) =>
          emitPolicyEvent({
            store,
            userId,
            toolName: method,
            eventType,
            details: {
              action,
              request_source: "carepilot_ui_gateway",
              session_key: asNullableString(requestParams.sessionKey ?? requestParams.session_key),
              agent_id: asNullableString(requestParams.agentId ?? requestParams.agent_id),
            },
            now,
          }),
        );

        respond(true, {
          action,
          receipt_id: toTrimmedString(event.id) || randomUUID(),
          requested_at: parseIsoTimestamp(event.created_at) ?? now.toISOString(),
          status: "accepted",
          message,
        });
      } catch (error) {
        sendError(respond, error);
      }
    });
  };

  registerPrivacyMethod(
    "carepilot.ui.privacy.export",
    "privacy_export_requested",
    "export",
    "Data export request recorded.",
  );
  registerPrivacyMethod(
    "carepilot.ui.privacy.delete",
    "privacy_delete_requested",
    "delete",
    "Data deletion request recorded.",
  );

  api.registerGatewayMethod("carepilot.ui.voice.transcribe", ({ params, respond }) => {
    try {
      const requestParams = asRecord(params);
      const audioUri = toTrimmedString(requestParams.audio_uri ?? requestParams.audioUri);
      if (!audioUri) {
        respond(false, { error: "audio_uri is required." });
        return;
      }

      const languageHint = toTrimmedString(requestParams.language_hint ?? requestParams.languageHint);
      const transcript = transcribeVoiceDeterministic({
        audio_uri: audioUri,
        language_hint: languageHint || undefined,
      });
      respond(true, transcript);
    } catch (error) {
      sendError(respond, error);
    }
  });
}

function registerCarePilotTools(api: OpenClawPluginApi): void {
  api.registerTool(createVoiceTranscribeTool(api));
  api.registerTool(createTriageAssessTool(api));
  api.registerTool(createLabRecommendTool(api));
  api.registerTool((toolContext) =>
    createReportExtractTool(api, {
      userId: resolveScopedUserId(toolContext),
    }),
  );
  api.registerTool((toolContext) =>
    createReportInterpretTool(api, {
      userId: resolveScopedUserId(toolContext),
    }),
  );
  api.registerTool((toolContext) =>
    createCarePreferencesUpdateTool(api, {
      userId: resolveScopedUserId(toolContext),
    }),
  );
  api.registerTool((toolContext) =>
    createHealthkitSyncIngestTool(api, {
      userId: resolveScopedUserId(toolContext),
    }),
  );
  api.registerTool((toolContext) =>
    createHealthMetricsGetTool(api, {
      userId: resolveScopedUserId(toolContext),
    }),
  );
  api.registerTool((toolContext) =>
    createClinicalProfileGetTool(api, {
      userId: resolveScopedUserId(toolContext),
    }),
  );
  api.registerTool((toolContext) =>
    createClinicalProfileUpsertTool(api, {
      userId: resolveScopedUserId(toolContext),
    }),
  );
  api.registerTool((toolContext) =>
    createAppointmentBookTool(api, {
      userId: resolveScopedUserId(toolContext),
    }),
  );
  api.registerTool((toolContext) =>
    createMedicationRefillRequestTool(api, {
      userId: resolveScopedUserId(toolContext),
    }),
  );
  api.registerTool((toolContext) =>
    createConsentTokenIssueTool(api, {
      userId: resolveScopedUserId(toolContext),
    }),
  );

  for (const tool of CAREPILOT_PLACEHOLDER_TOOLS) {
    api.registerTool({
      name: tool.name,
      description: `${tool.description} (Phase 1 placeholder).`,
      parameters: PLACEHOLDER_PARAMETERS,
      async execute() {
        return jsonResult({
          ok: false,
          status: "not_implemented",
          phase: 1,
          tool: tool.name,
          message: "CarePilot Phase 1 placeholder. Implement business logic in later phases.",
        });
      },
    });
  }
}

function registerCarePilotHooks(api: OpenClawPluginApi): void {
  registerMessageReceivedTriageHook(api);
  registerBeforeToolCallConsentHook(api);
  registerBeforeAgentStartContextHook(api);
  registerMessageSendingDisclaimerHook(api);
  registerAfterToolCallAuditHook(api);
}

function applyCarePilotHeartbeatDefaults(api: OpenClawPluginApi): void {
  const agents = (api.config.agents ??= {});
  const defaults = (agents.defaults ??= {});
  const heartbeat = (defaults.heartbeat ??= {});
  heartbeat.every ??= CAREPILOT_HEARTBEAT_DEFAULTS.every;
  heartbeat.session ??= CAREPILOT_HEARTBEAT_DEFAULTS.session;
  heartbeat.target ??= CAREPILOT_HEARTBEAT_DEFAULTS.target;
  heartbeat.prompt ??= CAREPILOT_HEARTBEAT_DEFAULTS.prompt;

  const activeHours = (heartbeat.activeHours ??= {});
  activeHours.start ??= CAREPILOT_HEARTBEAT_DEFAULTS.activeHours.start;
  activeHours.end ??= CAREPILOT_HEARTBEAT_DEFAULTS.activeHours.end;
  activeHours.timezone ??= CAREPILOT_HEARTBEAT_DEFAULTS.activeHours.timezone;
}

function registerCarePilotServices(api: OpenClawPluginApi, proactiveMaxPerDay: number): void {
  api.registerService({
    id: "carepilot-proactive-runtime",
    start: () => {
      const heartbeat = api.config.agents?.defaults?.heartbeat;
      if (!heartbeat) {
        api.logger.warn(
          `[carepilot] heartbeat not configured; recommended every=${CAREPILOT_HEARTBEAT_DEFAULTS.every}, activeHours=${CAREPILOT_HEARTBEAT_DEFAULTS.activeHours.start}-${CAREPILOT_HEARTBEAT_DEFAULTS.activeHours.end} (${CAREPILOT_HEARTBEAT_DEFAULTS.activeHours.timezone}), session=${CAREPILOT_HEARTBEAT_DEFAULTS.session}, target=${CAREPILOT_HEARTBEAT_DEFAULTS.target}.`,
        );
      } else {
        api.logger.info(
          `[carepilot] heartbeat configured (every=${heartbeat.every ?? "unset"}, session=${heartbeat.session ?? "main"}).`,
        );
      }
      api.logger.info(`[carepilot] proactive non-urgent cap/day=${proactiveMaxPerDay}`);
    },
  });
}

const carePilotPlugin = {
  id: "carepilot",
  name: "CarePilot",
  description: "Care coordination and safety orchestration extension.",
  configSchema: carePilotConfigSchema,
  register(api: OpenClawPluginApi) {
    const config = parseCarePilotPluginConfig(api.pluginConfig);
    applyCarePilotHeartbeatDefaults(api);

    api.logger.info(
      `[carepilot] plugin loaded (triageMode=${config.triageMode}, actionMode=${config.actionMode})`,
    );

    registerCarePilotTools(api);
    registerCarePilotGatewayMethods(api);
    registerCarePilotHooks(api);
    registerCarePilotServices(api, config.proactiveMaxPerDay);
  },
};

export default carePilotPlugin;
