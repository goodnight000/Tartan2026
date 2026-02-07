import { NextRequest } from "next/server";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

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
      max_tokens: 800,
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
