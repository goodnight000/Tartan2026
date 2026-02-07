import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const idToken =
    (body as { idToken?: string }).idToken ??
    (body as { id_token?: string }).id_token;
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
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

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
