import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";

export const runtime = "nodejs";

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readErrorMessage(payload: unknown): string | null {
  if (typeof payload === "string") {
    const normalized = payload.trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const fields = ["message", "error", "detail"];
  for (const field of fields) {
    const value = data[field];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Record<string, unknown>;
  const idToken =
    asNonEmptyString(body.idToken) ??
    asNonEmptyString(body.id_token) ??
    asNonEmptyString(req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));

  if (!idToken) {
    return NextResponse.json({ message: "Missing idToken." }, { status: 401 });
  }

  let userId: string | null = null;
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    userId = decoded.uid;
  } catch {
    // Invalid tokens are forwarded to backend for final auth handling.
  }

  const forwardedBody = Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== "idToken" && key !== "id_token")
  );

  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${idToken}`,
  };
  if (userId) headers["X-User-Id"] = userId;

  const upstream = await fetch(`${backendUrl}/profile`, {
    method: "POST",
    headers,
    body: JSON.stringify(forwardedBody),
  });

  const contentType = upstream.headers.get("content-type") || "";
  const payload: unknown = contentType.includes("application/json")
    ? await upstream.json()
    : await upstream.text();

  if (!upstream.ok) {
    return NextResponse.json(
      {
        message:
          readErrorMessage(payload) ||
          `Profile upsert failed (${upstream.status}).`,
      },
      { status: upstream.status }
    );
  }

  return NextResponse.json(payload);
}
