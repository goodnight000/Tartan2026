import { NextRequest, NextResponse } from "next/server";
import { firebaseAdminEnabled, getAdminAuth } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function asNonEmptyString(value: FormDataEntryValue | null): string | undefined {
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
  for (const key of fields) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

type VoiceResponse = {
  transcript_text: string;
  confidence?: number;
  segments?: unknown[];
};

function normalizeVoiceResponse(payload: unknown): VoiceResponse | null {
  if (typeof payload === "string") {
    const transcript = payload.trim();
    if (!transcript) return null;
    return { transcript_text: transcript };
  }

  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;

  if (data.data && typeof data.data === "object") {
    const nested = normalizeVoiceResponse(data.data);
    if (nested) return nested;
  }

  const transcriptCandidates = [
    data.transcript_text,
    data.transcript,
    data.text,
    data.content,
  ];
  const transcript = transcriptCandidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0
  );
  if (!transcript) return null;

  const confidence = typeof data.confidence === "number" ? data.confidence : undefined;
  const segments = Array.isArray(data.segments)
    ? data.segments
    : Array.isArray(data.chunks)
      ? data.chunks
      : undefined;

  return {
    transcript_text: transcript.trim(),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(segments ? { segments } : {}),
  };
}

function buildUpstreamForm(params: {
  audio: File;
  languageHint?: string;
  sessionKey?: string;
}) {
  const form = new FormData();
  form.append("audio", params.audio, params.audio.name || "voice-input.webm");
  if (params.languageHint) form.append("language_hint", params.languageHint);
  if (params.sessionKey) form.append("session_key", params.sessionKey);
  return form;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const audio = formData.get("audio");
  if (!(audio instanceof File)) {
    return NextResponse.json({ message: "Missing audio file." }, { status: 400 });
  }

  const idToken =
    asNonEmptyString(formData.get("idToken")) ??
    asNonEmptyString(formData.get("id_token"));
  const languageHint = asNonEmptyString(formData.get("language_hint"));
  const sessionKey = asNonEmptyString(formData.get("session_key"));

  let userId: string | null = null;
  if (idToken && firebaseAdminEnabled) {
    try {
      const decoded = await getAdminAuth().verifyIdToken(idToken);
      userId = decoded.uid;
    } catch {
      // Invalid tokens are forwarded; backend remains source of truth.
    }
  }

  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
  const upstreamPath = process.env.BACKEND_VOICE_TRANSCRIBE_PATH || "/voice/transcribe";

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  if (userId) headers["X-User-Id"] = userId;
  const upstream = await fetch(joinUrl(backendUrl, upstreamPath), {
    method: "POST",
    headers,
    body: buildUpstreamForm({
      audio,
      languageHint,
      sessionKey,
    }),
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
          `Transcription request failed (${upstream.status}).`,
      },
      { status: upstream.status }
    );
  }

  const normalized = normalizeVoiceResponse(payload);
  if (!normalized) {
    return NextResponse.json(
      { message: "Transcription service returned an empty transcript." },
      { status: 502 }
    );
  }

  return NextResponse.json(normalized);
}
