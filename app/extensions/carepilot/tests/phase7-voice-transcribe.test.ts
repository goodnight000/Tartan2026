import { describe, expect, it } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createVoiceTranscribeTool } from "../tools/voice-transcribe.js";

function createApi(): OpenClawPluginApi {
  return {
    pluginConfig: {},
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  } as OpenClawPluginApi;
}

function detailsOf(result: unknown): Record<string, unknown> {
  return ((result as { details?: unknown }).details ?? {}) as Record<string, unknown>;
}

function asSegments(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
}

describe("carepilot phase7 voice transcribe tool", () => {
  it("returns the expected transcript contract for downstream triage and memory", async () => {
    const tool = createVoiceTranscribeTool(createApi());

    const result = detailsOf(
      await tool.execute("call-voice-contract", {
        audio_uri: "https://cdn.example.org/audio/patient-cough-morning-followup-note.m4a",
        language_hint: "en-US",
      }),
    );

    expect(result.status).toBe("ok");
    const data = (result.data ?? {}) as Record<string, unknown>;
    expect(typeof data.transcript_text).toBe("string");
    expect((data.transcript_text as string).length).toBeGreaterThan(30);
    expect(typeof data.confidence).toBe("number");
    expect((data.confidence as number)).toBeGreaterThanOrEqual(0);
    expect((data.confidence as number)).toBeLessThanOrEqual(1);
    expect(data.is_synthetic).toBe(true);
    expect(data.transcript_source).toBe("deterministic_simulation");

    const segments = asSegments(data.segments);
    expect(segments.length).toBeGreaterThan(0);
    const first = segments[0] ?? {};
    expect(first.segment_index).toBe(0);
    expect(typeof first.start_ms).toBe("number");
    expect(typeof first.end_ms).toBe("number");
    expect(typeof first.text).toBe("string");
    expect(typeof first.confidence).toBe("number");
    expect(typeof first.char_start).toBe("number");
    expect(typeof first.char_end).toBe("number");
    expect(typeof first.preview_text).toBe("string");
  });

  it("is deterministic for the same input and varies transcript text for different audio uris", async () => {
    const tool = createVoiceTranscribeTool(createApi());
    const params = {
      audio_uri: "https://cdn.example.org/audio/case-2201-night-cough-and-fatigue.wav",
      language_hint: "en-US",
    };

    const first = detailsOf(await tool.execute("call-voice-deterministic-1", params));
    const second = detailsOf(await tool.execute("call-voice-deterministic-2", params));
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    expect(second.data).toEqual(first.data);

    const changed = detailsOf(
      await tool.execute("call-voice-deterministic-3", {
        ...params,
        audio_uri: "https://cdn.example.org/audio/case-2202-morning-dizziness-checkin.wav",
      }),
    );
    const firstData = (first.data ?? {}) as Record<string, unknown>;
    const changedData = (changed.data ?? {}) as Record<string, unknown>;
    expect(changedData.transcript_text).not.toBe(firstData.transcript_text);
  });

  it("emits preview/edit friendly segment metadata with stable offsets and timeline ordering", async () => {
    const tool = createVoiceTranscribeTool(createApi());
    const result = detailsOf(
      await tool.execute("call-voice-segments", {
        audio_uri:
          "https://voice.example.net/intake/new-patient-note-followup-symptoms-medication-and-sleep-pattern.ogg",
        language_hint: "en",
      }),
    );

    expect(result.status).toBe("ok");
    const data = (result.data ?? {}) as Record<string, unknown>;
    const transcript = String(data.transcript_text ?? "");
    const segments = asSegments(data.segments);
    expect(segments.length).toBeGreaterThan(1);

    let previousEndMs = -1;
    for (const [index, segment] of segments.entries()) {
      const startMs = Number(segment.start_ms);
      const endMs = Number(segment.end_ms);
      const text = String(segment.text ?? "");
      const charStart = Number(segment.char_start);
      const charEnd = Number(segment.char_end);
      const preview = String(segment.preview_text ?? "");

      expect(segment.segment_index).toBe(index);
      expect(startMs).toBeGreaterThanOrEqual(previousEndMs);
      expect(endMs).toBeGreaterThan(startMs);
      expect(charStart).toBeGreaterThanOrEqual(0);
      expect(charEnd).toBeGreaterThan(charStart);
      expect(charEnd).toBeLessThanOrEqual(transcript.length);
      expect(transcript.slice(charStart, charEnd)).toBe(text);
      expect(preview.length).toBeLessThanOrEqual(48);
      expect(text.startsWith(preview.replace(/\.\.\.$/, ""))).toBe(true);

      previousEndMs = endMs;
    }
  });

  it("returns non-throwing invalid_input error shape when audio_uri is missing", async () => {
    const tool = createVoiceTranscribeTool(createApi());
    const result = detailsOf(await tool.execute("call-voice-invalid", { audio_uri: "   " }));

    expect(result.status).toBe("error");
    expect(result.data).toBeNull();
    const errors = Array.isArray(result.errors) ? result.errors : [];
    expect((errors[0] as Record<string, unknown>)?.code).toBe("invalid_input");
  });
});
