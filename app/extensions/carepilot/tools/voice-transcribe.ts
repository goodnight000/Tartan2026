import { Type } from "@sinclair/typebox";
import { jsonResult, type OpenClawPluginApi } from "openclaw/plugin-sdk";
import { transcribeVoiceDeterministic } from "../services/stt-service.js";

export function createVoiceTranscribeTool(_api: OpenClawPluginApi) {
  return {
    name: "voice_transcribe",
    description: "Transcribe voice audio into deterministic canonical text for downstream triage and memory.",
    parameters: Type.Object({
      audio_uri: Type.String({ minLength: 1 }),
      language_hint: Type.Optional(Type.String({ minLength: 2 })),
    }),
    async execute(_toolCallId: string, rawParams: Record<string, unknown>) {
      const audioUri = typeof rawParams.audio_uri === "string" ? rawParams.audio_uri.trim() : "";
      const languageHint =
        typeof rawParams.language_hint === "string" && rawParams.language_hint.trim().length > 0
          ? rawParams.language_hint.trim()
          : undefined;

      if (!audioUri) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [{ code: "invalid_input", message: "audio_uri is required." }],
        });
      }

      try {
        const data = transcribeVoiceDeterministic({
          audio_uri: audioUri,
          language_hint: languageHint,
        });
        return jsonResult({
          status: "ok",
          data,
          errors: [],
        });
      } catch (error) {
        return jsonResult({
          status: "error",
          data: null,
          errors: [
            {
              code: "voice_transcribe_failed",
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        });
      }
    },
  };
}
