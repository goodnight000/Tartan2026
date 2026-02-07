import { describe, expect, it } from "vitest";
import { assessTriage } from "../tools/triage-assess.js";

describe("carepilot triage assess", () => {
  it("keeps emergency rule precedence over llm hint", () => {
    const result = assessTriage("I have chest pain and shortness of breath", {
      triage_level: "ROUTINE",
      confidence: 0.92,
      signals: ["llm_hint_only"],
    });
    expect(result.triage_level).toBe("EMERGENT");
    expect(result.metadata.action_block).toBe(true);
  });

  it("uses llm assist hint when no emergency rule is triggered", () => {
    const result = assessTriage("mild symptoms", {
      triage_level: "URGENT_24H",
      confidence: 0.81,
      signals: ["llm_urgent_marker"],
      recommended_next_step: "Book urgent care today.",
    });
    expect(result.triage_level).toBe("URGENT_24H");
    expect(result.signals).toContain("llm_urgent_marker");
    expect(result.recommended_next_step).toBe("Book urgent care today.");
  });
});
