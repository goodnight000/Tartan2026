import type { TriageResult } from "./types";

const EMERGENT_PATTERNS = [
  /chest\s*pain/i,
  /can'?t\s*breathe/i,
  /difficulty\s*breathing/i,
  /shortness\s*of\s*breath/i,
  /heart\s*attack/i,
  /stroke/i,
  /seizure/i,
  /unconscious/i,
  /passed?\s*out/i,
  /suicid/i,
  /kill\s*(my|him|her|them)?self/i,
  /want\s*to\s*die/i,
  /overdose/i,
  /severe\s*bleeding/i,
  /anaphyla/i,
  /choking/i,
  /not\s*breathing/i,
];

const URGENT_24H_PATTERNS = [
  /high\s*fever/i,
  /fever\s*(over|above)\s*10[2-9]/i,
  /blood\s*in\s*(stool|urine|vomit)/i,
  /severe\s*headache/i,
  /worst\s*headache/i,
  /sudden\s*vision/i,
  /persistent\s*vomiting/i,
  /can'?t\s*keep\s*(anything|food|water)\s*down/i,
  /severe\s*abdominal/i,
  /broken\s*bone/i,
  /fracture/i,
  /deep\s*cut/i,
  /infected\s*wound/i,
];

const EMERGENCY_RESPONSE =
  "This sounds like it could be a medical emergency. " +
  "Please call 911 or go to your nearest emergency room immediately. " +
  "If you are experiencing suicidal thoughts, please call the 988 Suicide & Crisis Lifeline (call or text 988). " +
  "Do not wait for a chatbot response in a life-threatening situation.";

function matchPatterns(
  text: string,
  patterns: RegExp[]
): string[] {
  const matched: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      matched.push(match[0]);
    }
  }
  return matched;
}

export function triage(message: string): TriageResult {
  const emergentMatches = matchPatterns(message, EMERGENT_PATTERNS);
  if (emergentMatches.length > 0) {
    return {
      level: "EMERGENT",
      matchedKeywords: emergentMatches,
      emergencyResponse: EMERGENCY_RESPONSE,
    };
  }

  const urgentMatches = matchPatterns(message, URGENT_24H_PATTERNS);
  if (urgentMatches.length > 0) {
    return {
      level: "URGENT_24H",
      matchedKeywords: urgentMatches,
    };
  }

  return {
    level: "ROUTINE",
    matchedKeywords: [],
  };
}
