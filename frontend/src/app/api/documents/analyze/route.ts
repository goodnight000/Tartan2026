import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 90;

type DocumentAnalysisResponse = {
  file_id?: string;
  summary: string;
  key_findings: string[];
  abnormal_highlights: string[];
  follow_up_questions: string[];
  urgency?: string;
};

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

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function pickStringArray(candidates: unknown[]): string[] {
  for (const candidate of candidates) {
    const normalized = toStringArray(candidate);
    if (normalized.length > 0) return normalized;
  }
  return [];
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

function normalizeDocumentResponse(payload: unknown): DocumentAnalysisResponse | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;

  if (data.data && typeof data.data === "object") {
    const nested = normalizeDocumentResponse(data.data);
    if (nested) return nested;
  }

  const summaryCandidates = [
    data.summary,
    data.plain_language_summary,
    data.interpretation_summary,
    data.message,
  ];
  const summary = summaryCandidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0
  );

  if (!summary) return null;

  const keyFindings = pickStringArray([
    data.key_findings,
    data.findings,
    data.highlights,
  ]);
  const abnormalHighlights = pickStringArray([
    data.abnormal_highlights,
    data.abnormal_markers,
    data.risk_markers,
  ]);
  const followUpQuestions = pickStringArray([
    data.follow_up_questions,
    data.suggested_questions,
    data.clinician_questions,
  ]);
  const safetyFraming =
    data.safety_framing && typeof data.safety_framing === "object"
      ? (data.safety_framing as Record<string, unknown>)
      : null;
  const urgency =
    typeof data.urgency === "string" && data.urgency.trim().length > 0
      ? data.urgency.trim()
      : typeof data.urgency_level === "string" && data.urgency_level.trim().length > 0
        ? data.urgency_level.trim()
        : safetyFraming && typeof safetyFraming.urgency_level === "string" && safetyFraming.urgency_level.trim().length > 0
          ? safetyFraming.urgency_level.trim()
      : undefined;
  const fileId =
    typeof data.file_id === "string" && data.file_id.trim().length > 0
      ? data.file_id.trim()
      : typeof data.document_id === "string" && data.document_id.trim().length > 0
        ? data.document_id.trim()
      : undefined;
  const riskFlagsFromSafety = safetyFraming ? toStringArray(safetyFraming.high_risk_flags) : [];

  return {
    summary: summary.trim(),
    key_findings: keyFindings,
    abnormal_highlights: abnormalHighlights.length > 0 ? abnormalHighlights : riskFlagsFromSafety,
    follow_up_questions: followUpQuestions,
    ...(urgency ? { urgency } : {}),
    ...(fileId ? { file_id: fileId } : {}),
  };
}

function buildUpstreamForm(params: {
  file: File;
  docType?: string;
  sessionKey?: string;
}) {
  const form = new FormData();
  form.append("file", params.file, params.file.name || "medical-document");
  if (params.docType) {
    form.append("doc_type", params.docType);
    form.append("file_category", params.docType);
  }
  if (params.sessionKey) form.append("session_key", params.sessionKey);
  return form;
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ message: "Missing upload file." }, { status: 400 });
  }

  const docType = asNonEmptyString(formData.get("doc_type"));
  const sessionKey = asNonEmptyString(formData.get("session_key"));
  const idToken =
    asNonEmptyString(formData.get("idToken")) ??
    asNonEmptyString(formData.get("id_token"));

  let userId: string | null = null;
  if (idToken) {
    try {
      const decoded = await getAdminAuth().verifyIdToken(idToken);
      userId = decoded.uid;
    } catch {
      // Invalid tokens are forwarded; backend enforces final auth decisions.
    }
  }

  const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
  const upstreamPath = process.env.BACKEND_DOCUMENTS_ANALYZE_PATH || "/documents/analyze";

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  if (userId) headers["X-User-Id"] = userId;
  const upstream = await fetch(joinUrl(backendUrl, upstreamPath), {
    method: "POST",
    headers,
    body: buildUpstreamForm({
      file,
      docType,
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
          `Document analysis failed (${upstream.status}).`,
      },
      { status: upstream.status }
    );
  }

  const normalized = normalizeDocumentResponse(payload);
  if (!normalized) {
    return NextResponse.json(
      { message: "Document analysis returned an empty summary." },
      { status: 502 }
    );
  }

  return NextResponse.json(normalized);
}
