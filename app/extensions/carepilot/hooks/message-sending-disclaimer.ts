import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const DISCLAIMER_MARKER = "[carepilot-disclaimer-v1]";
const DISCLAIMER_TEXT =
  "CarePilot guidance is informational only and does not replace licensed medical care. If symptoms are severe, rapidly worsening, or feel unsafe, seek emergency services immediately.";

const sentDisclaimerByThreadKey = new Set<string>();

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function buildThreadKey(params: {
  channelId?: string;
  conversationId?: string;
  fallbackTo?: string;
  metadata?: Record<string, unknown>;
}): string {
  const channelId = toTrimmedString(params.channelId).toLowerCase() || "unknown";
  const conversationId = toTrimmedString(params.conversationId);
  const threadId = toTrimmedString(params.metadata?.threadId);
  const sessionKey = toTrimmedString(params.metadata?.sessionKey);
  const fallbackTo = toTrimmedString(params.fallbackTo);

  if (sessionKey) {
    return `session:${sessionKey}`;
  }
  if (conversationId && threadId) {
    return `channel:${channelId}|conversation:${conversationId}|thread:${threadId}`;
  }
  if (conversationId) {
    return `channel:${channelId}|conversation:${conversationId}`;
  }
  if (threadId) {
    return `channel:${channelId}|thread:${threadId}`;
  }
  if (fallbackTo) {
    return `channel:${channelId}|to:${fallbackTo}`;
  }
  return `channel:${channelId}|global`;
}

export function registerMessageSendingDisclaimerHook(api: OpenClawPluginApi): void {
  api.on("message_sending", async (event, ctx) => {
    const content = toTrimmedString(event.content);
    if (!content) {
      return;
    }

    const metadata = asRecord(event.metadata);
    const threadKey = buildThreadKey({
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
      fallbackTo: event.to,
      metadata: metadata ?? undefined,
    });

    if (sentDisclaimerByThreadKey.has(threadKey)) {
      return;
    }

    if (content.includes(DISCLAIMER_MARKER)) {
      sentDisclaimerByThreadKey.add(threadKey);
      return;
    }

    const disclaimerBlock = `${DISCLAIMER_MARKER}\n${DISCLAIMER_TEXT}`;
    sentDisclaimerByThreadKey.add(threadKey);
    return {
      content: `${content}\n\n${disclaimerBlock}`,
    };
  });
}
