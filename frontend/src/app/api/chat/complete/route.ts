import { NextRequest } from "next/server";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const ANTHROPIC_MAX_TOKENS = Number.parseInt(process.env.ANTHROPIC_MAX_TOKENS || "2000", 10);
const SAFE_MAX_TOKENS = Number.isFinite(ANTHROPIC_MAX_TOKENS) && ANTHROPIC_MAX_TOKENS > 0
  ? ANTHROPIC_MAX_TOKENS
  : 2000;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing ANTHROPIC_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = await req.json().catch(() => null);
  if (!payload?.message || typeof payload.message !== "string") {
    return new Response(JSON.stringify({ error: "Missing message" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const history = Array.isArray(payload.history) ? payload.history : [];
  const systemFromClient = typeof payload.system === "string" ? payload.system : "";

  const systemPrompt = [
    "You are a clinical assistant.",
    "Use CareBase XML tags to store any patient details that could help future medical diagnosis.",
    "Proactively log relevant clinical facts even if the user does not explicitly ask you to store them.",
    "Store symptoms, conditions, medications, allergies, vitals, test results, timelines, family history, and care preferences when mentioned.",
    "Use only absolute timestamps (include date and time with timezone) when storing time information.",
    "Do not store relative times like 'yesterday' or 'last week'.",
    "If you need stored info, fetch it using CareBase tags.",
    "You must not claim access to any memory system other than CareBase.",
    "Do not reference backend memory, database profiles, or external memory tools.",
    "If you need memory, use CareBase tags and wait for results.",
    "When you request CareBase data, STOP your response and wait for the CareBase result before answering.",
    "If you need data, output ONLY the CareBase fetch tag and nothing else.",
    "Always store clinically relevant user facts using <carebase-store: ...> tags; do not claim you stored data unless the tag is present.",
    "Entry guide: profile:{user_id} = demographics, conditions, allergies, meds, procedures, family_history, preferences, reminders.",
    "Entry guide: symptom_logs:{user_id} = array of symptom entries; action_logs:{user_id} = array of action/refill entries. Always append new items; never overwrite existing logs.",
    "Maintain an index of custom keys you create in <carebase-store: entry_index:{user_id}> as JSON mapping of key -> description.",
    "Profile format (JSON, arrays of objects): {consent:{health_data_use,accepted_at,privacy_version},profile_mode:{managing_for,dependent_label,relationship},demographics:{first_name,year_of_birth,sex_assigned_at_birth,height_cm,weight_kg},lifestyle:{smoking_status,alcohol_use,activity_level},conditions:[{name,diagnosed_year,under_treatment}],procedures:[{name,approximate_year}],meds:[{name,dose,frequency_per_day,cadence,start_date,last_fill_date,refill_days}],allergies:[{allergen,reaction,category}],family_history:{heart_disease,stroke,diabetes,cancer,hypertension,none_or_unsure},preferences:{radius_miles,preferred_pharmacy,preferred_days,appointment_windows,provider_gender_preference,care_priority},reminders:{med_runout,checkup_due,followup_nudges,reminder_mode,proactive_state,quiet_hours:{start,end}},onboarding:{completed,completed_at,step_last_seen,version},updated_at}.",
    "Symptom log format (array items): {created_at, symptom_text, severity, onset_time, notes}. Severity must be an integer (0-10). Use ISO timestamps.",
    "Action log format (array items): {created_at, action_type, status}. Use ISO timestamps.",
    "Always include CareBase tags immediately after the sentence that justifies storing or fetching.",
    "Example: \"You mentioned a penicillin allergy. <carebase-store: allergies>Penicillin</carebase-store>\"",
    "Example: \"Let me check your medications. <carebase-fetch>medications</carebase-fetch>\"",
    systemFromClient,
  ].filter(Boolean).join("\n");

  const messages = [
    ...history.map((item: { role: string; content: string }) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: item.content,
    })),
    { role: "user", content: payload.message },
  ];

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      messages,
      system: systemPrompt,
      temperature: 0.2,
      max_tokens: SAFE_MAX_TOKENS,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return new Response(JSON.stringify({ error: text || "Provider error" }), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const data = await response.json();
  const content = Array.isArray(data?.content)
    ? data.content.map((block: { text?: string }) => block.text).filter(Boolean).join("\n")
    : "";

  return new Response(JSON.stringify({ reply: content }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
