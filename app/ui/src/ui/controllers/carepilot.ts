import type { GatewayBrowserClient } from "../gateway.ts";

export type CarePilotSection = "onboarding" | "chat" | "dashboard" | "actions" | "settings";
export type CarePilotProactiveMode = "active" | "paused" | "medication_only";

export type CarePilotProfileDraft = {
  timezone: string;
  locale: string;
  dateOfBirthYear: string;
  biologicalSex: string;
  proactiveMode: CarePilotProactiveMode;
  quietHoursStart: string;
  quietHoursEnd: string;
  snoozeDays: string;
};

export type CarePilotMetricCard = {
  metricType: string;
  connectedSourceStatus: string;
  enabled: boolean;
  stale: boolean;
  latestObservedAt: string | null;
  latestValueSummary: Record<string, unknown> | null;
  permissionState: string;
  canRead: boolean;
};

export type CarePilotActionReceipt = {
  id: string;
  actionType: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  payloadSummary: string;
  errorMessage: string | null;
};

export type CarePilotUiState = {
  userId: string;
  onboardingComplete: boolean;
  profile: CarePilotProfileDraft;
  sourceStatus: {
    sourceType: string;
    connectionStatus: string;
    lastSyncAt: string | null;
    recencyState: string;
    isStale: boolean;
  };
  metrics: CarePilotMetricCard[];
  activeSymptoms: Array<{
    symptom: string;
    severity: string | null;
    lastConfirmedAt: string | null;
  }>;
  actions: CarePilotActionReceipt[];
  settings: {
    permissions: Record<string, string>;
    proactiveMode: CarePilotProactiveMode;
    quietHoursStart: string;
    quietHoursEnd: string;
    snoozeUntil: string | null;
    lastExportRequestedAt: string | null;
    lastDeleteRequestedAt: string | null;
  };
};

export type CarePilotPrivacyReceipt = {
  action: "export" | "delete";
  receiptId: string;
  requestedAt: string;
  status: string;
  message: string;
};

export type CarePilotControllerState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  carepilotLoading: boolean;
  carepilotError: string | null;
  carepilotSavingProfile: boolean;
  carepilotPrivacyBusy: "export" | "delete" | null;
  carepilotState: CarePilotUiState | null;
  carepilotOnboardingDraft: CarePilotProfileDraft;
  carepilotLastReceipt: CarePilotPrivacyReceipt | null;
  carepilotTranscriptDraft: string;
  carepilotTranscriptConfidence: number | null;
  carepilotTranscriptError: string | null;
};

type RpcEnvelope<T> =
  | T
  | {
      data?: T;
      result?: { data?: T };
      status?: string;
      errors?: Array<{ message?: string }>;
      error?: string;
      message?: string;
    };

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolvePayload<T>(input: RpcEnvelope<T> | undefined): T | undefined {
  if (!input || typeof input !== "object") {
    return input as T | undefined;
  }
  const record = input as Record<string, unknown>;
  if (record.data && typeof record.data === "object") {
    return record.data as T;
  }
  const result = toRecord(record.result);
  if (result.data && typeof result.data === "object") {
    return result.data as T;
  }
  return input as T;
}

function defaultProfileDraft(): CarePilotProfileDraft {
  return {
    timezone: "UTC",
    locale: "en-US",
    dateOfBirthYear: "",
    biologicalSex: "",
    proactiveMode: "active",
    quietHoursStart: "22:00",
    quietHoursEnd: "08:00",
    snoozeDays: "",
  };
}

function normalizeProactiveMode(value: unknown): CarePilotProactiveMode {
  if (value === "paused" || value === "medication_only") {
    return value;
  }
  return "active";
}

function normalizeProfile(record: Record<string, unknown>): CarePilotProfileDraft {
  const draft = defaultProfileDraft();
  const dateOfBirthYear =
    typeof record.date_of_birth_year === "number"
      ? String(Math.trunc(record.date_of_birth_year))
      : typeof record.dateOfBirthYear === "string"
        ? record.dateOfBirthYear.trim()
        : "";

  let snoozeDays = "";
  const snoozeUntil = asNullableString(record.snooze_until ?? record.snoozeUntil);
  if (snoozeUntil) {
    const deltaMs = Date.parse(snoozeUntil) - Date.now();
    if (Number.isFinite(deltaMs) && deltaMs > 0) {
      snoozeDays = String(Math.max(1, Math.ceil(deltaMs / (24 * 60 * 60 * 1000))));
    }
  }

  return {
    timezone: asString(record.timezone, draft.timezone),
    locale: asString(record.locale, draft.locale),
    dateOfBirthYear,
    biologicalSex: asString(record.biological_sex ?? record.biologicalSex, ""),
    proactiveMode: normalizeProactiveMode(record.proactive_mode ?? record.proactiveMode),
    quietHoursStart: asString(record.quiet_hours_start ?? record.quietHoursStart, draft.quietHoursStart),
    quietHoursEnd: asString(record.quiet_hours_end ?? record.quietHoursEnd, draft.quietHoursEnd),
    snoozeDays,
  };
}

function normalizeMetrics(raw: unknown): CarePilotMetricCard[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((entry): CarePilotMetricCard => {
    const record = toRecord(entry);
    const permission = toRecord(record.permission_toggle);
    return {
      metricType: asString(record.metric_type ?? record.metricType, "unknown"),
      connectedSourceStatus: asString(
        record.connected_source_status ?? record.connectedSourceStatus,
        "disconnected",
      ),
      enabled: asBoolean(record.enabled, false),
      stale: asBoolean(record.stale, true),
      latestObservedAt: asNullableString(record.latest_observed_at ?? record.latestObservedAt),
      latestValueSummary: (() => {
        const summary = record.latest_value_summary ?? record.latestValueSummary;
        return summary && typeof summary === "object" && !Array.isArray(summary)
          ? (summary as Record<string, unknown>)
          : null;
      })(),
      permissionState: asString(permission.permission_state, "not_determined"),
      canRead: asBoolean(permission.can_read, false),
    };
  });
}

function normalizeActions(raw: unknown): CarePilotActionReceipt[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((entry): CarePilotActionReceipt => {
    const record = toRecord(entry);
    const payloadSummaryRaw = record.payload_summary ?? record.payloadSummary;
    return {
      id: asString(record.id, ""),
      actionType: asString(record.action_type ?? record.actionType, "unknown"),
      status: asString(record.status, "unknown"),
      startedAt: asNullableString(record.started_at ?? record.startedAt),
      finishedAt: asNullableString(record.finished_at ?? record.finishedAt),
      payloadSummary:
        typeof payloadSummaryRaw === "string"
          ? payloadSummaryRaw
          : JSON.stringify(payloadSummaryRaw ?? {}, null, 2),
      errorMessage: asNullableString(record.error_message ?? record.errorMessage),
    };
  });
}

function normalizeState(raw: unknown): CarePilotUiState {
  const root = toRecord(raw);
  const onboarding = toRecord(root.onboarding);
  const profile = toRecord(onboarding.profile ?? root.profile);
  const dashboard = toRecord(root.dashboard);
  const sourceStatus = toRecord(dashboard.source_status ?? dashboard.sourceStatus);
  const settings = toRecord(root.settings);
  const permissions = toRecord(settings.permissions);

  const metricSummaries = dashboard.metric_summaries ?? dashboard.metrics;
  const actionsRaw = root.actions;
  const symptoms = toRecord(dashboard.symptom_state_summary ?? dashboard.activeSymptoms);
  const symptomItems = Array.isArray(symptoms.items) ? symptoms.items : [];

  return {
    userId: asString(root.user_id ?? root.userId, "default_user"),
    onboardingComplete: asBoolean(onboarding.complete ?? root.onboarding_complete, false),
    profile: normalizeProfile(profile),
    sourceStatus: {
      sourceType: asString(sourceStatus.source_type ?? sourceStatus.sourceType, "apple_health"),
      connectionStatus: asString(
        sourceStatus.connection_status ?? sourceStatus.connectionStatus,
        "disconnected",
      ),
      lastSyncAt: asNullableString(sourceStatus.last_sync_at ?? sourceStatus.lastSyncAt),
      recencyState: asString(sourceStatus.recency_state ?? sourceStatus.recencyState, "unknown"),
      isStale: asBoolean(sourceStatus.is_stale ?? sourceStatus.isStale, true),
    },
    metrics: normalizeMetrics(metricSummaries),
    activeSymptoms: symptomItems
      .map((entry) => {
        const record = toRecord(entry);
        return {
          symptom: asString(record.symptom, "unknown"),
          severity: asNullableString(record.severity),
          lastConfirmedAt: asNullableString(record.last_confirmed_at ?? record.lastConfirmedAt),
        };
      })
      .filter((entry) => entry.symptom.trim().length > 0),
    actions: normalizeActions(actionsRaw),
    settings: {
      permissions: Object.fromEntries(
        Object.entries(permissions).map(([key, value]) => [key, asString(value, "not_determined")]),
      ),
      proactiveMode: normalizeProactiveMode(settings.proactive_mode ?? settings.proactiveMode),
      quietHoursStart: asString(settings.quiet_hours_start ?? settings.quietHoursStart, "22:00"),
      quietHoursEnd: asString(settings.quiet_hours_end ?? settings.quietHoursEnd, "08:00"),
      snoozeUntil: asNullableString(settings.snooze_until ?? settings.snoozeUntil),
      lastExportRequestedAt: asNullableString(
        settings.last_export_requested_at ?? settings.lastExportRequestedAt,
      ),
      lastDeleteRequestedAt: asNullableString(
        settings.last_delete_requested_at ?? settings.lastDeleteRequestedAt,
      ),
    },
  };
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export function createCarePilotProfileDraft(
  source?: Partial<CarePilotProfileDraft> | Record<string, unknown> | null,
): CarePilotProfileDraft {
  const base = defaultProfileDraft();
  if (!source) {
    return base;
  }
  const record = toRecord(source);
  return {
    timezone: asString(record.timezone, base.timezone),
    locale: asString(record.locale, base.locale),
    dateOfBirthYear: asString(record.dateOfBirthYear, base.dateOfBirthYear),
    biologicalSex: asString(record.biologicalSex, base.biologicalSex),
    proactiveMode: normalizeProactiveMode(record.proactiveMode),
    quietHoursStart: asString(record.quietHoursStart, base.quietHoursStart),
    quietHoursEnd: asString(record.quietHoursEnd, base.quietHoursEnd),
    snoozeDays: asString(record.snoozeDays, base.snoozeDays),
  };
}

export async function loadCarePilotState(state: CarePilotControllerState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.carepilotLoading) {
    return;
  }

  state.carepilotLoading = true;
  state.carepilotError = null;

  try {
    const response = await state.client.request<RpcEnvelope<unknown>>("carepilot.ui.state.get", {
      sessionKey: state.sessionKey,
    });
    const payload = resolvePayload(response);
    const normalized = normalizeState(payload);
    state.carepilotState = normalized;

    if (!state.carepilotOnboardingDraft.timezone) {
      state.carepilotOnboardingDraft = createCarePilotProfileDraft(normalized.profile);
    }
  } catch (err) {
    state.carepilotError = getErrorMessage(err);
  } finally {
    state.carepilotLoading = false;
  }
}

function toProfileUpsertPayload(draft: CarePilotProfileDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    timezone: draft.timezone.trim() || "UTC",
    locale: draft.locale.trim() || "en-US",
    biological_sex: draft.biologicalSex.trim() || null,
    proactive_mode: normalizeProactiveMode(draft.proactiveMode),
    quiet_hours_start: draft.quietHoursStart.trim() || "22:00",
    quiet_hours_end: draft.quietHoursEnd.trim() || "08:00",
  };

  const dobYear = Number(draft.dateOfBirthYear.trim());
  if (Number.isFinite(dobYear) && dobYear >= 1900 && dobYear <= 2100) {
    payload.date_of_birth_year = Math.trunc(dobYear);
  } else {
    payload.date_of_birth_year = null;
  }

  const snoozeDays = Number(draft.snoozeDays.trim());
  if (Number.isFinite(snoozeDays) && snoozeDays > 0) {
    payload.snooze_days = Math.floor(snoozeDays);
  } else {
    payload.snooze_days = 0;
  }

  return payload;
}

export async function saveCarePilotProfile(
  state: CarePilotControllerState,
  draft: CarePilotProfileDraft,
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }

  state.carepilotSavingProfile = true;
  state.carepilotError = null;
  try {
    await state.client.request("carepilot.ui.profile.upsert", {
      sessionKey: state.sessionKey,
      ...toProfileUpsertPayload(draft),
    });
    state.carepilotOnboardingDraft = createCarePilotProfileDraft(draft);
    await loadCarePilotState(state);
    return true;
  } catch (err) {
    state.carepilotError = getErrorMessage(err);
    return false;
  } finally {
    state.carepilotSavingProfile = false;
  }
}

export async function requestCarePilotPrivacyAction(
  state: CarePilotControllerState,
  action: "export" | "delete",
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }

  state.carepilotPrivacyBusy = action;
  state.carepilotError = null;
  try {
    const method = action === "export" ? "carepilot.ui.privacy.export" : "carepilot.ui.privacy.delete";
    const response = await state.client.request<RpcEnvelope<unknown>>(method, {
      sessionKey: state.sessionKey,
    });
    const payload = toRecord(resolvePayload(response));

    state.carepilotLastReceipt = {
      action,
      receiptId: asString(payload.receipt_id ?? payload.receiptId, "n/a"),
      requestedAt:
        asNullableString(payload.requested_at ?? payload.requestedAt) ?? new Date().toISOString(),
      status: asString(payload.status, "accepted"),
      message: asString(payload.message, "Request accepted."),
    };

    await loadCarePilotState(state);
    return true;
  } catch (err) {
    state.carepilotError = getErrorMessage(err);
    return false;
  } finally {
    state.carepilotPrivacyBusy = null;
  }
}

export async function transcribeCarePilotVoice(
  state: CarePilotControllerState,
  params: { audioUri: string; languageHint?: string },
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }

  state.carepilotTranscriptError = null;

  const audioUri = params.audioUri.trim();
  if (!audioUri) {
    state.carepilotTranscriptError = "No captured audio found. Record audio first.";
    return false;
  }

  try {
    const response = await state.client.request<RpcEnvelope<unknown>>("carepilot.ui.voice.transcribe", {
      sessionKey: state.sessionKey,
      audio_uri: audioUri,
      language_hint: params.languageHint,
    });

    const payload = toRecord(resolvePayload(response));
    const transcriptText = asString(payload.transcript_text ?? payload.transcriptText, "");
    const confidence = asNumber(payload.confidence);

    if (!transcriptText) {
      state.carepilotTranscriptError = "Transcription returned no text.";
      return false;
    }

    state.carepilotTranscriptDraft = transcriptText;
    state.carepilotTranscriptConfidence = confidence;
    return true;
  } catch (err) {
    state.carepilotTranscriptError = getErrorMessage(err);
    return false;
  }
}
