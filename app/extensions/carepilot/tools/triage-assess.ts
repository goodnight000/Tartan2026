import { Type } from "@sinclair/typebox";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk";

export type TriageLevel = "EMERGENT" | "URGENT_24H" | "ROUTINE";
export type ConfidenceLabel = "high" | "medium" | "low";

export type TriageAssessment = {
  triage_level: TriageLevel;
  signals: string[];
  recommended_next_step: string;
  confidence: number;
  confidence_label: ConfidenceLabel;
  metadata: {
    action_block: boolean;
  };
};

type LlmAssistHint = {
  triage_level: TriageLevel;
  confidence?: number;
  signals?: string[];
  recommended_next_step?: string;
};

const EMERGENT_PATTERNS: Array<{ signal: string; pattern: RegExp }> = [
  { signal: "chest_pain_breathing", pattern: /\b(chest pain|chest pressure).*(shortness of breath|can't breathe)\b/i },
  { signal: "stroke_like", pattern: /\b(face droop|arm weakness|slurred speech|stroke)\b/i },
  { signal: "severe_bleeding", pattern: /\b(severe bleeding|bleeding won't stop|hemorrhage)\b/i },
  { signal: "anaphylaxis", pattern: /\b(anaphylaxis|throat closing|swollen tongue|hives with breathing)\b/i },
  { signal: "self_harm_intent", pattern: /\b(kill myself|self harm|suicide|end my life)\b/i },
  { signal: "overdose", pattern: /\b(overdose|too many pills|poisoned)\b/i },
];

const URGENT_PATTERNS: Array<{ signal: string; pattern: RegExp }> = [
  { signal: "persistent_fever", pattern: /\b(fever|temperature).*(3 days|three days|worse)\b/i },
  { signal: "severe_pain", pattern: /\b(severe pain|pain is getting worse|unbearable pain)\b/i },
  { signal: "new_neuro", pattern: /\b(new confusion|fainted|dizzy and weak)\b/i },
];

function normalizeInput(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function confidenceLabel(value: number): ConfidenceLabel {
  if (value >= 0.85) {
    return "high";
  }
  if (value >= 0.65) {
    return "medium";
  }
  return "low";
}

function normalizeLlmAssistHint(input: unknown): LlmAssistHint | null {
  const raw = asObject(input);
  if (!raw) {
    return null;
  }

  const triageLevel = raw.triage_level;
  if (triageLevel !== "EMERGENT" && triageLevel !== "URGENT_24H" && triageLevel !== "ROUTINE") {
    return null;
  }

  const confidenceRaw = raw.confidence;
  const confidence =
    typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : undefined;
  const signals = Array.isArray(raw.signals)
    ? raw.signals.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : undefined;
  const recommendedNextStep =
    typeof raw.recommended_next_step === "string" && raw.recommended_next_step.trim().length > 0
      ? raw.recommended_next_step.trim()
      : undefined;

  return {
    triage_level: triageLevel,
    confidence,
    signals,
    recommended_next_step: recommendedNextStep,
  };
}

export function assessTriage(messageText: string, llmAssistHint?: LlmAssistHint | null): TriageAssessment {
  const normalized = normalizeInput(messageText);
  const emergentSignals = EMERGENT_PATTERNS.filter((rule) => rule.pattern.test(normalized)).map(
    (rule) => rule.signal,
  );
  const urgentSignals = URGENT_PATTERNS.filter((rule) => rule.pattern.test(normalized)).map(
    (rule) => rule.signal,
  );

  if (emergentSignals.length > 0) {
    const confidence = 0.96;
    return {
      triage_level: "EMERGENT",
      signals: emergentSignals,
      recommended_next_step:
        "Seek emergency care now (call emergency services or go to the nearest ER).",
      confidence,
      confidence_label: confidenceLabel(confidence),
      metadata: { action_block: true },
    };
  }

  if (llmAssistHint) {
    const confidence =
      typeof llmAssistHint.confidence === "number"
        ? llmAssistHint.confidence
        : llmAssistHint.triage_level === "URGENT_24H"
          ? 0.76
          : 0.66;
    return {
      triage_level: llmAssistHint.triage_level,
      signals: llmAssistHint.signals ?? [],
      recommended_next_step:
        llmAssistHint.recommended_next_step ??
        (llmAssistHint.triage_level === "URGENT_24H"
          ? "Arrange clinician evaluation within 24 hours."
          : "Continue routine care and monitor symptoms."),
      confidence,
      confidence_label: confidenceLabel(confidence),
      metadata: { action_block: llmAssistHint.triage_level === "EMERGENT" },
    };
  }

  if (urgentSignals.length > 0) {
    const confidence = 0.78;
    return {
      triage_level: "URGENT_24H",
      signals: urgentSignals,
      recommended_next_step: "Arrange clinician evaluation within 24 hours.",
      confidence,
      confidence_label: confidenceLabel(confidence),
      metadata: { action_block: false },
    };
  }

  const confidence = 0.62;
  return {
    triage_level: "ROUTINE",
    signals: [],
    recommended_next_step: "Continue routine care and monitor symptoms.",
    confidence,
    confidence_label: confidenceLabel(confidence),
    metadata: { action_block: false },
  };
}

export function createTriageAssessTool(_api: OpenClawPluginApi) {
  return {
    name: "triage_assess",
    description: "Assess triage urgency using fixed clinical safety labels.",
    parameters: Type.Object({
      message_text: Type.String(),
      user_context: Type.Optional(Type.Object({}, { additionalProperties: true })),
    }),
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const messageText =
        typeof rawParams.message_text === "string" ? rawParams.message_text.trim() : "";
      const userContext = asObject(rawParams.user_context);
      if (!messageText) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [{ code: "invalid_input", message: "message_text is required." }],
        });
      }

      const llmAssistHint = normalizeLlmAssistHint(userContext?.llm_triage_hint);
      const assessment = assessTriage(messageText, llmAssistHint);
      return jsonResult({
        status: "ok",
        data: assessment,
        errors: [],
      });
    },
  };
}
