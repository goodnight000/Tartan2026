import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 180;

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

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => null);
  if (!payload?.message || typeof payload.message !== "string") {
    return NextResponse.json({ message: "Missing message" }, { status: 400 });
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
      { message: detail || "Backend stream request failed." },
      { status: upstream.status || 502 }
    );
  }

  if (!upstream.body) {
    return NextResponse.json({ message: "Backend stream returned no body." }, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") || "text/event-stream";
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
