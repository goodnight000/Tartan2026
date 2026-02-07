import type { MedicalProfile } from "@/lib/types";
import type { TriageLevel } from "./types";

export function buildSystemPrompt(
  profile: MedicalProfile | null,
  triageLevel: TriageLevel
): string {
  const sections: string[] = [];

  // Identity & role
  sections.push(
    "You are MedClaw, an AI medical assistant. " +
      "You help users manage their health by answering questions, finding nearby services, " +
      "and coordinating care actions. You are NOT a doctor and cannot diagnose or prescribe. " +
      "Always recommend consulting a healthcare professional for medical decisions."
  );

  // Safety rules
  sections.push(
    "SAFETY RULES:\n" +
      "- Never diagnose conditions or prescribe medications.\n" +
      "- If the user describes symptoms that could be serious, advise them to seek professional care.\n" +
      "- Always err on the side of caution.\n" +
      "- Respect patient privacy and do not ask for information beyond what is needed."
  );

  // Urgency note
  if (triageLevel === "URGENT_24H") {
    sections.push(
      "URGENCY NOTE: The user may be describing symptoms that warrant medical attention within 24 hours. " +
        "Acknowledge the urgency, recommend they contact their healthcare provider or visit urgent care today, " +
        "and then assist with their request."
    );
  }

  // Clinical profile
  if (profile) {
    const parts: string[] = ["PATIENT PROFILE:"];

    if (profile.conditions.length > 0) {
      parts.push(`- Conditions: ${profile.conditions.join(", ")}`);
    }
    if (profile.allergies.length > 0) {
      parts.push(`- Allergies: ${profile.allergies.join(", ")}`);
    }
    if (profile.meds.length > 0) {
      const medList = profile.meds
        .map((m) => `${m.name} ${m.dose} (${m.frequency_per_day}x/day)`)
        .join("; ");
      parts.push(`- Medications: ${medList}`);
    }
    if (profile.family_history) {
      parts.push(`- Family history: ${profile.family_history}`);
    }
    if (profile.preferences) {
      parts.push(
        `- Preferences: radius ${profile.preferences.radius_miles} miles, ` +
          `open now: ${profile.preferences.open_now}, ` +
          `preferred days: ${profile.preferences.preferred_days.join(", ")}`
      );
    }

    sections.push(parts.join("\n"));
  } else {
    sections.push(
      "No patient profile is on file. Suggest the user complete their profile in the Profile tab " +
        "so you can provide more personalized assistance."
    );
  }

  // Tool usage instructions
  sections.push(
    "TOOL USAGE:\n" +
      "- You have access to tools for finding nearby pharmacies, labs, and specialists (Tier 1, auto-executed).\n" +
      "- You also have tools for booking appointments and requesting prescription refills (Tier 2, requires user confirmation).\n" +
      "- When the user asks to find a nearby service, use the appropriate search tool.\n" +
      "- When the user asks to book or request a refill, use the appropriate Tier 2 tool. " +
      "The user will be asked to confirm before the action executes.\n" +
      "- Format tool results in a readable way for the user.\n" +
      "- Ask for missing information (e.g., location, specialty) before calling tools."
  );

  return sections.join("\n\n");
}
