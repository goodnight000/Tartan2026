import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { CarePilotClinicalStore } from "../services/clinical-store.js";
import { parseCarePilotPluginConfig } from "../config.js";
import { createCarePilotClinicalStore } from "../services/clinical-store.js";
import { closeCarePilotDb, openCarePilotDb } from "../services/db.js";
import { runCarePilotMigrations } from "../services/migrations.js";
import { emitPolicyEvent } from "../services/policy-engine.js";
import { assessTriage, type TriageAssessment } from "../tools/triage-assess.js";

const EMERGENT_CONTEXT_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_MESSAGE_PREVIEW_CHARS = 280;

const TRANSACTIONAL_TOOL_NAMES = [
  "appointment_book",
  "medication_refill_request",
  "human_escalation_create",
] as const;

export type EmergentContextSnapshot = {
  key: string;
  sessionKey?: string;
  triageLevel: TriageAssessment["triage_level"];
  recommendedNextStep: string;
  signals: string[];
  capturedAtIso: string;
  expiresAtIso: string;
  messagePreview: string;
};

type MessageReceivedLike = {
  from: string;
  content: string;
  metadata?: Record<string, unknown>;
};

type MessageContextLike = {
  channelId: string;
  accountId?: string;
  conversationId?: string;
};

type EmergentRuntimeState = {
  key: string;
  capturedAtMs: number;
  expiresAtMs: number;
  assessment: TriageAssessment;
  messagePreview: string;
};

const emergentStateByKey = new Map<string, EmergentRuntimeState>();

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function truncatePreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_MESSAGE_PREVIEW_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_MESSAGE_PREVIEW_CHARS - 3)}...`;
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

function pruneExpiredEmergentState(nowMs: number): void {
  for (const [key, state] of emergentStateByKey.entries()) {
    if (state.expiresAtMs <= nowMs) {
      emergentStateByKey.delete(key);
    }
  }
}

function deriveRuntimeKeysFromMessage(
  event: MessageReceivedLike,
  ctx: MessageContextLike,
): string[] {
  const metadata = asRecord(event.metadata);
  const channelId = toTrimmedString(ctx.channelId).toLowerCase();
  const conversationId = toTrimmedString(ctx.conversationId);
  const threadId = toTrimmedString(metadata?.threadId);
  const accountId = toTrimmedString(ctx.accountId);
  const from = toTrimmedString(event.from);
  const metadataSessionKey = toTrimmedString(metadata?.sessionKey);

  const keys = new Set<string>();
  if (metadataSessionKey) {
    keys.add(`session:${metadataSessionKey}`);
  }
  if (channelId && conversationId) {
    keys.add(`channel:${channelId}|conversation:${conversationId}`);
  }
  if (channelId && conversationId && threadId) {
    keys.add(`channel:${channelId}|conversation:${conversationId}|thread:${threadId}`);
  }
  if (channelId && threadId) {
    keys.add(`channel:${channelId}|thread:${threadId}`);
  }
  if (accountId) {
    keys.add(`account:${accountId}`);
  }
  if (from) {
    keys.add(`from:${from}`);
  }
  return [...keys];
}

function findThreadLabel(parts: string[]): string | null {
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (part === "thread" || part === "topic") {
      return toTrimmedString(parts[index + 1]) || null;
    }
  }
  return null;
}

export function deriveRuntimeKeysFromSessionKey(sessionKey: string | undefined): string[] {
  const normalizedSessionKey = toTrimmedString(sessionKey);
  if (!normalizedSessionKey) {
    return [];
  }

  const keys = new Set<string>([`session:${normalizedSessionKey}`]);
  const parts = normalizedSessionKey.split(":");
  if (parts.length >= 5 && parts[0] === "agent") {
    const channelId = toTrimmedString(parts[2]).toLowerCase();
    const conversationId = toTrimmedString(parts[4]);
    const threadLabel = findThreadLabel(parts);
    if (channelId && conversationId) {
      keys.add(`channel:${channelId}|conversation:${conversationId}`);
    }
    if (channelId && conversationId && threadLabel) {
      keys.add(`channel:${channelId}|conversation:${conversationId}|thread:${threadLabel}`);
    }
    if (channelId && threadLabel) {
      keys.add(`channel:${channelId}|thread:${threadLabel}`);
    }
  }
  return [...keys];
}

function setEmergentState(keys: string[], state: Omit<EmergentRuntimeState, "key">): void {
  for (const key of keys) {
    emergentStateByKey.set(key, {
      key,
      ...state,
    });
  }
}

function clearEmergentState(keys: string[]): void {
  for (const key of keys) {
    emergentStateByKey.delete(key);
  }
}

export function getTransactionalToolNames(): string[] {
  return [...TRANSACTIONAL_TOOL_NAMES];
}

export function isTransactionalTool(toolName: string): boolean {
  return TRANSACTIONAL_TOOL_NAMES.includes(
    toTrimmedString(toolName).toLowerCase() as (typeof TRANSACTIONAL_TOOL_NAMES)[number],
  );
}

export function getEmergentContextForSession(
  sessionKey: string | undefined,
): EmergentContextSnapshot | null {
  const nowMs = Date.now();
  pruneExpiredEmergentState(nowMs);
  const keys = deriveRuntimeKeysFromSessionKey(sessionKey);
  for (const key of keys) {
    const state = emergentStateByKey.get(key);
    if (!state) {
      continue;
    }
    return {
      key,
      sessionKey: toTrimmedString(sessionKey) || undefined,
      triageLevel: state.assessment.triage_level,
      recommendedNextStep: state.assessment.recommended_next_step,
      signals: state.assessment.signals,
      capturedAtIso: new Date(state.capturedAtMs).toISOString(),
      expiresAtIso: new Date(state.expiresAtMs).toISOString(),
      messagePreview: state.messagePreview,
    };
  }
  return null;
}

export function registerMessageReceivedTriageHook(api: OpenClawPluginApi): void {
  api.on("message_received", async (event, ctx) => {
    const content = toTrimmedString(event.content);
    if (!content) {
      return;
    }

    const nowMs = Date.now();
    pruneExpiredEmergentState(nowMs);

    const assessment = assessTriage(content);
    const runtimeKeys = deriveRuntimeKeysFromMessage(event, ctx);
    if (runtimeKeys.length > 0) {
      if (assessment.metadata.action_block || assessment.triage_level === "EMERGENT") {
        setEmergentState(runtimeKeys, {
          capturedAtMs: nowMs,
          expiresAtMs: nowMs + EMERGENT_CONTEXT_TTL_MS,
          assessment,
          messagePreview: truncatePreview(content),
        });
      } else {
        clearEmergentState(runtimeKeys);
      }
    }

    const policyUserId = toTrimmedString(ctx.accountId) || toTrimmedString(event.from) || null;

    try {
      withStore(api, (store) => {
        emitPolicyEvent({
          store,
          userId: policyUserId,
          toolName: "triage_assess",
          eventType:
            assessment.metadata.action_block || assessment.triage_level === "EMERGENT"
              ? "triage_emergent_detected"
              : "triage_assessed",
          details: {
            triage_level: assessment.triage_level,
            signals: assessment.signals,
            confidence: assessment.confidence,
            confidence_label: assessment.confidence_label,
            action_block: assessment.metadata.action_block,
            recommended_next_step: assessment.recommended_next_step,
            runtime_keys: runtimeKeys,
            channel_id: toTrimmedString(ctx.channelId).toLowerCase() || null,
            conversation_id: toTrimmedString(ctx.conversationId) || null,
            message_preview: truncatePreview(content),
          },
        });
      });
    } catch (error) {
      api.logger.warn(
        `[carepilot] message_received triage policy event write failed: ${String(error)}`,
      );
    }
  });
}
