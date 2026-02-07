export type VoiceTranscribeInput = {
  audio_uri: string;
  language_hint?: string | null;
};

export type VoiceTranscribeSegment = {
  segment_index: number;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number;
  char_start: number;
  char_end: number;
  preview_text: string;
};

export type VoiceTranscribeResult = {
  transcript_text: string;
  confidence: number;
  segments: VoiceTranscribeSegment[];
  is_synthetic: boolean;
  transcript_source: "deterministic_simulation";
};

const AUDIO_TOKEN_STOPWORDS = new Set([
  "audio",
  "voice",
  "recording",
  "record",
  "memo",
  "clip",
  "wav",
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "webm",
  "mp4",
]);

const FALLBACK_TOPICS = [
  "general symptom update",
  "medication side effect concern",
  "follow up request for fatigue",
  "sleep quality and stress changes",
  "mild pain trend discussion",
];

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function roundTo3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function toCanonicalAudioTokens(audioUri: string): string[] {
  const source = audioUri.trim();
  if (!source) {
    return [];
  }

  let target = source;
  try {
    const url = new URL(source);
    target = `${url.host} ${url.pathname}`;
  } catch {
    target = source;
  }

  target = safeDecodeUri(target)
    .replace(/\?.*$/, " ")
    .replace(/#.*$/, " ")
    .replace(/\.[a-z0-9]{2,4}\b/gi, " ");

  const rawTokens = target
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const tokens: string[] = [];
  for (const token of rawTokens) {
    if (AUDIO_TOKEN_STOPWORDS.has(token)) {
      continue;
    }
    if (token.length <= 1) {
      continue;
    }
    if (!tokens.includes(token)) {
      tokens.push(token);
    }
  }
  return tokens.slice(0, 8);
}

function normalizeLanguageHint(languageHint: string | null | undefined): string {
  if (typeof languageHint !== "string") {
    return "en";
  }
  const trimmed = languageHint.trim().toLowerCase();
  return trimmed || "en";
}

function buildCanonicalTranscript(tokens: string[], seed: number): string {
  const topic =
    tokens.length > 0
      ? tokens.slice(0, 5).join(" ")
      : FALLBACK_TOPICS[seed % FALLBACK_TOPICS.length];
  const trailing = tokens.slice(5, 8).join(" ");

  if (trailing) {
    return `Patient report about ${topic}. Additional context includes ${trailing}. Requests clinical follow up guidance.`;
  }
  return `Patient report about ${topic}. Requests clinical follow up guidance.`;
}

function toPreviewText(text: string, maxChars: number = 48): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars - 3)}...`;
}

function segmentTranscript(
  transcriptText: string,
  seed: number,
  transcriptConfidence: number,
): VoiceTranscribeSegment[] {
  const wordMatches = [...transcriptText.matchAll(/\S+/g)];
  if (wordMatches.length === 0) {
    return [];
  }

  const targetWordsPerSegment = 6 + (seed % 3);
  const segments: VoiceTranscribeSegment[] = [];
  let segmentIndex = 0;
  let startWord = 0;
  let timelineMs = 0;

  while (startWord < wordMatches.length) {
    const endWord = Math.min(wordMatches.length, startWord + targetWordsPerSegment);
    const first = wordMatches[startWord];
    const last = wordMatches[endWord - 1];
    const charStart = first.index ?? 0;
    const charEnd = (last.index ?? 0) + last[0].length;
    const text = transcriptText.slice(charStart, charEnd);
    const wordCount = endWord - startWord;
    const jitter = (seed >> ((segmentIndex % 8) * 4)) & 0xf;
    const durationMs = Math.max(360, Math.round(wordCount * 360 + 120 + jitter * 11));
    const segmentConfidence = roundTo3(
      clamp(transcriptConfidence - 0.08 + ((jitter % 5) - 2) * 0.015, 0.5, 0.99),
    );

    segments.push({
      segment_index: segmentIndex,
      start_ms: timelineMs,
      end_ms: timelineMs + durationMs,
      text,
      confidence: segmentConfidence,
      char_start: charStart,
      char_end: charEnd,
      preview_text: toPreviewText(text),
    });

    timelineMs += durationMs;
    segmentIndex += 1;
    startWord = endWord;
  }

  return segments;
}

export function transcribeVoiceDeterministic(input: VoiceTranscribeInput): VoiceTranscribeResult {
  const audioUri = String(input.audio_uri ?? "").trim();
  const languageHint = normalizeLanguageHint(input.language_hint);
  const seed = fnv1aHash(`${audioUri}|${languageHint}`);
  const tokens = toCanonicalAudioTokens(audioUri);
  const transcriptText = buildCanonicalTranscript(tokens, seed);

  const languageBoost = languageHint.startsWith("en") ? 0.08 : 0;
  const transcriptConfidence = roundTo3(
    clamp(0.66 + ((seed % 17) - 8) * 0.012 + languageBoost, 0.5, 0.98),
  );
  const segments = segmentTranscript(transcriptText, seed, transcriptConfidence);

  return {
    transcript_text: transcriptText,
    confidence: transcriptConfidence,
    segments,
    is_synthetic: true,
    transcript_source: "deterministic_simulation",
  };
}
