import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";

const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/+$/, "");
const BACKEND_CHAT_STREAM_PATH = process.env.BACKEND_CHAT_STREAM_PATH || "/chat/stream";

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function stripIdToken(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).filter(
      ([key]) => key !== "idToken" && key !== "id_token"
    )
  );
}

function parseSSEChunk(chunk: string): { event: string; data: unknown } | null {
  const lines = chunk.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value.trim() || "message";
    if (field === "data") dataLines.push(value);
  }

  if (dataLines.length === 0) return null;
  const rawData = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(rawData) };
  } catch {
    return { event, data: rawData };
  }
}

function findEventBoundary(buffer: string): { index: number; length: number } | null {
  const lfIndex = buffer.indexOf("\n\n");
  const crlfIndex = buffer.indexOf("\r\n\r\n");
  if (lfIndex === -1 && crlfIndex === -1) return null;
  if (lfIndex === -1) return { index: crlfIndex, length: 4 };
  if (crlfIndex === -1) return { index: lfIndex, length: 2 };
  return lfIndex < crlfIndex ? { index: lfIndex, length: 2 } : { index: crlfIndex, length: 4 };
}

async function collectReplyFromSSE(response: Response): Promise<{ reply: string; actionPlan: unknown | null }> {
  if (!response.body) return { reply: "", actionPlan: null };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let finalMessageText = "";
  let actionPlan: unknown | null = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = findEventBoundary(buffer);
      while (boundary) {
        const chunk = buffer.slice(0, boundary.index).trim();
        buffer = buffer.slice(boundary.index + boundary.length);

        if (chunk) {
          const parsed = parseSSEChunk(chunk);
          if (parsed) {
            if (parsed.event === "token") {
              if (typeof parsed.data === "string") {
                fullText += parsed.data;
              } else if (parsed.data && typeof parsed.data === "object") {
                const delta = (parsed.data as { delta?: unknown }).delta;
                if (typeof delta === "string") fullText += delta;
              }
            } else if (parsed.event === "message") {
              if (typeof parsed.data === "string") {
                finalMessageText = parsed.data;
              } else if (parsed.data && typeof parsed.data === "object") {
                const text = (parsed.data as { text?: unknown }).text;
                if (typeof text === "string") finalMessageText = text;
              }
            } else if (parsed.event === "action_plan") {
              actionPlan = parsed.data;
            }
          }
        }

        boundary = findEventBoundary(buffer);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { reply: finalMessageText || fullText, actionPlan };
}

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => null);
  if (!payload?.message || typeof payload.message !== "string") {
    return NextResponse.json({ error: "Missing message" }, { status: 400 });
  }

  const idToken =
    asNonEmptyString((payload as { idToken?: unknown }).idToken) ??
    asNonEmptyString((payload as { id_token?: unknown }).id_token);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };

  let userId: string | null = null;
  if (idToken) {
    try {
      const decoded = await getAdminAuth().verifyIdToken(idToken);
      userId = decoded.uid;
    } catch {
      // Invalid token handling is delegated to backend auth.
    }
    headers.Authorization = `Bearer ${idToken}`;
  }
  if (userId) headers["X-User-Id"] = userId;

  const upstream = await fetch(`${BACKEND_URL}${normalizePath(BACKEND_CHAT_STREAM_PATH)}`, {
    method: "POST",
    headers,
    body: JSON.stringify(stripIdToken(payload)),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: detail || "Backend chat request failed." },
      { status: upstream.status || 502 }
    );
  }

  const { reply, actionPlan } = await collectReplyFromSSE(upstream);
  return NextResponse.json({ reply, action_plan: actionPlan }, { status: 200 });
}
