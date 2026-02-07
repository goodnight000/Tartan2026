import { NextRequest } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

type CanonicalEventType = "token" | "message" | "action_plan" | "error";

function sseEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function parseSseChunk(rawChunk: string): { event: string; dataRaw: string } {
  const lines = rawChunk.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  return { event, dataRaw: dataLines.join("\n") };
}

function parseJsonMaybe(raw: string): unknown {
  if (!raw) return "";
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function pickString(
  value: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}

function extractTokenDelta(payload: unknown): string | null {
  if (typeof payload === "string") {
    if (!payload || payload === "[DONE]") return null;
    return payload;
  }
  if (!payload || typeof payload !== "object") return null;

  const data = payload as Record<string, unknown>;
  const direct = pickString(data, ["delta", "token"]);
  if (direct) return direct;

  const choice = Array.isArray(data.choices)
    ? (data.choices[0] as Record<string, unknown> | undefined)
    : undefined;
  if (choice && typeof choice === "object") {
    const deltaObj =
      choice.delta && typeof choice.delta === "object"
        ? (choice.delta as Record<string, unknown>)
        : null;
    const fromChoice = pickString(choice, ["content"]);
    const fromDelta = deltaObj ? pickString(deltaObj, ["content", "delta"]) : null;
    return fromDelta ?? fromChoice;
  }

  if (typeof data.output_text === "string") return data.output_text;
  return null;
}

function extractMessageText(payload: unknown): string | null {
  if (typeof payload === "string") {
    if (!payload || payload === "[DONE]") return null;
    return payload;
  }
  if (!payload || typeof payload !== "object") return null;

  const data = payload as Record<string, unknown>;
  const direct = pickString(data, ["text", "message", "content"]);
  if (direct) return direct;

  if (data.message && typeof data.message === "object") {
    const messageObj = data.message as Record<string, unknown>;
    const nested = pickString(messageObj, ["text", "content"]);
    if (nested) return nested;
  }

  const choice = Array.isArray(data.choices)
    ? (data.choices[0] as Record<string, unknown> | undefined)
    : undefined;
  if (choice && typeof choice === "object") {
    const messageObj =
      choice.message && typeof choice.message === "object"
        ? (choice.message as Record<string, unknown>)
        : null;
    const fromChoice = pickString(choice, ["content"]);
    const fromMessage = messageObj ? pickString(messageObj, ["content"]) : null;
    return fromMessage ?? fromChoice;
  }

  return null;
}

function isActionPlanShape(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const data = payload as Record<string, unknown>;
  const plan = data.plan && typeof data.plan === "object"
    ? (data.plan as Record<string, unknown>)
    : data;
  return typeof plan.tier === "number" && typeof plan.tool === "string";
}

function extractErrorMessage(payload: unknown): string | null {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const msg = pickString(data, ["message", "error", "detail"]);
  return msg;
}

function normalizeEventType(event: string, payload: unknown): CanonicalEventType | null {
  const lower = event.toLowerCase();
  const hints: string[] = [lower];

  if (payload && typeof payload === "object") {
    const data = payload as Record<string, unknown>;
    if (typeof data.event === "string") hints.push(data.event.toLowerCase());
    if (typeof data.type === "string") hints.push(data.type.toLowerCase());
  }

  if (hints.some((hint) => hint.includes("action_plan") || hint.includes("actionplan"))) {
    return "action_plan";
  }
  if (hints.some((hint) => hint.includes("error") || hint.includes("failed"))) {
    return "error";
  }
  if (
    hints.some(
      (hint) =>
        hint === "token" ||
        hint.includes("delta") ||
        hint.includes("assistant_token") ||
        hint.includes("output_text.delta")
    )
  ) {
    return "token";
  }
  if (
    hints.some(
      (hint) =>
        hint === "message" ||
        hint.includes("assistant_message") ||
        hint.includes("final")
    )
  ) {
    if (extractTokenDelta(payload) && !extractMessageText(payload)) {
      return "token";
    }
    return "message";
  }

  if (isActionPlanShape(payload)) return "action_plan";
  if (extractErrorMessage(payload)) return "error";
  if (extractTokenDelta(payload)) return "token";
  if (extractMessageText(payload)) return "message";
  return null;
}

function normalizeEventPayload(
  eventType: CanonicalEventType,
  payload: unknown
): unknown | null {
  if (eventType === "token") {
    const delta = extractTokenDelta(payload);
    if (!delta) return null;
    return { delta };
  }

  if (eventType === "message") {
    const text = extractMessageText(payload);
    if (!text) return null;
    return { text };
  }

  if (eventType === "action_plan") {
    if (!payload || typeof payload !== "object") return null;
    const data = payload as Record<string, unknown>;
    return data.plan && typeof data.plan === "object" ? data.plan : data;
  }

  const message = extractErrorMessage(payload);
  if (!message) return null;
  return { message };
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function openBackendStream(
  backendUrl: string,
  requestBody: Record<string, unknown>,
  headers: Record<string, string>,
  signal?: AbortSignal
) {
  const preferred = process.env.BACKEND_CHAT_STREAM_PATH || "/chat/stream";
  const candidatePaths = [preferred];

  let lastResponse: Response | null = null;
  for (const path of candidatePaths) {
    const response = await fetch(joinUrl(backendUrl, path), {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal,
    });

    if (response.status !== 404 || path === candidatePaths[candidatePaths.length - 1]) {
      return response;
    }

    lastResponse = response;
  }

  return lastResponse;
}

export async function POST(req: NextRequest) {
  const { message, history, idToken, session_key, client_context } = (await req.json()) as {
    message: string;
    history?: Array<{ role: string; content: string }>;
    idToken?: string;
    session_key?: string;
    client_context?: { timezone?: string; location_text?: string };
  };

  if (!message || typeof message !== "string") {
    return new Response(JSON.stringify({ message: "Missing message" }), {
      status: 400,
    });
  }

  let userId: string | null = null;
  if (idToken) {
    try {
      const decoded = await getAdminAuth().verifyIdToken(idToken);
      userId = decoded.uid;
    } catch {
      // Invalid tokens are forwarded as-is; backend decides how to handle auth.
    }
  }

  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
  const timezone =
    client_context?.timezone || req.headers.get("x-timezone") || "UTC";
  const locationText =
    client_context?.location_text || req.headers.get("x-location-text") || undefined;

  const requestBody: Record<string, unknown> = {
    message,
    session_key: session_key ?? undefined,
    history: history ?? [],
    user_id: userId ?? undefined,
    id_token: idToken ?? undefined,
    client_context: {
      timezone,
      location_text: locationText,
    },
  };

  const upstreamHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (idToken) upstreamHeaders.Authorization = `Bearer ${idToken}`;
  if (userId) upstreamHeaders["X-User-Id"] = userId;

  const stream = new ReadableStream({
    async start(controller) {
      let emittedToken = false;
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      const onAbort = () => {
        void reader?.cancel();
      };
      req.signal.addEventListener("abort", onAbort, { once: true });
      try {
        if (req.signal.aborted) {
          return;
        }
        const upstream = await openBackendStream(
          backendUrl,
          requestBody,
          upstreamHeaders,
          req.signal
        );

        if (!upstream || !upstream.ok || !upstream.body) {
          const detail = upstream
            ? await upstream.text()
            : "No response from backend stream endpoint";
          const status = upstream?.status;
          controller.enqueue(
            sseEvent("error", {
              message: status ? `Backend ${status}: ${detail}` : detail,
            })
          );
          return;
        }

        reader = upstream.body.getReader();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder
            .decode(value, { stream: true })
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const chunk = buffer.slice(0, boundary).trim();
            buffer = buffer.slice(boundary + 2);

            if (!chunk) {
              boundary = buffer.indexOf("\n\n");
              continue;
            }

            const parsedChunk = parseSseChunk(chunk);
            const payload = parseJsonMaybe(parsedChunk.dataRaw);
            const eventType = normalizeEventType(parsedChunk.event, payload);
            if (!eventType) {
              boundary = buffer.indexOf("\n\n");
              continue;
            }

            if (eventType === "message" && emittedToken) {
              boundary = buffer.indexOf("\n\n");
              continue;
            }

            const normalized = normalizeEventPayload(eventType, payload);
            if (normalized !== null) {
              if (eventType === "token") emittedToken = true;
              controller.enqueue(sseEvent(eventType, normalized));
            }

            boundary = buffer.indexOf("\n\n");
          }
        }

        const tail = buffer.trim();
        if (tail) {
          const parsedChunk = parseSseChunk(tail);
          const payload = parseJsonMaybe(parsedChunk.dataRaw);
          const eventType = normalizeEventType(parsedChunk.event, payload);
          if (eventType && !(eventType === "message" && emittedToken)) {
            const normalized = normalizeEventPayload(eventType, payload);
            if (normalized !== null) {
              controller.enqueue(sseEvent(eventType, normalized));
            }
          }
        }
      } catch (error) {
        if (req.signal.aborted) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Backend stream error";
        controller.enqueue(
          sseEvent("error", {
            message,
          })
        );
      } finally {
        req.signal.removeEventListener("abort", onAbort);
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
