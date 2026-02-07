import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";

export const runtime = "nodejs";

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const idToken =
    asNonEmptyString((body as { idToken?: unknown }).idToken) ??
    asNonEmptyString((body as { id_token?: unknown }).id_token);
  const forwardedBody =
    body && typeof body === "object"
      ? Object.fromEntries(
          Object.entries(body as Record<string, unknown>).filter(
            ([key]) => key !== "idToken" && key !== "id_token"
          )
        )
      : body;
  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let userId: string | null = null;
  if (idToken) {
    try {
      const decoded = await getAdminAuth().verifyIdToken(idToken);
      userId = decoded.uid;
    } catch {
      // Invalid tokens are forwarded as-is; backend decides auth outcomes.
    }
    headers.Authorization = `Bearer ${idToken}`;
  }
  if (userId) headers["X-User-Id"] = userId;

  const res = await fetch(`${backendUrl}/actions/execute`, {
    method: "POST",
    headers,
    body: JSON.stringify(forwardedBody),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { status: "failure", result: { message: text } },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
