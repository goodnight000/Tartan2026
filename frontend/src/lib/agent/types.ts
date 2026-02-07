export type TriageLevel = "EMERGENT" | "URGENT_24H" | "ROUTINE";

export type TriageResult = {
  level: TriageLevel;
  matchedKeywords: string[];
  emergencyResponse?: string;
};
