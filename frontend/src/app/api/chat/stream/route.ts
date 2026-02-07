import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

const encoder = new TextEncoder();

function sseEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ message: "Missing ANTHROPIC_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = await req.json().catch(() => null);
  if (!payload?.message || typeof payload.message !== "string") {
    return new Response(JSON.stringify({ message: "Missing message" }), {
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

  const upstream = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 800,
      stream: true,
      system: systemPrompt,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return new Response(JSON.stringify({ message: detail || "Upstream error" }), {
      status: upstream.status || 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let fullText = "";

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const chunk = buffer.slice(0, boundary).trim();
            buffer = buffer.slice(boundary + 2);

            if (!chunk) {
              boundary = buffer.indexOf("\n\n");
              continue;
            }

            const lines = chunk.split("\n");
            const dataLines = lines
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.replace(/^data:\s*/, ""));
            const data = dataLines.join("\n").trim();
            if (!data) {
              boundary = buffer.indexOf("\n\n");
              continue;
            }

            let parsed: any = null;
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = null;
            }

            const eventType = parsed?.type;
            if (eventType === "error") {
              controller.enqueue(sseEvent("error", { message: parsed?.error?.message ?? "Stream error" }));
            }
            if (eventType === "content_block_delta") {
              const delta = parsed?.delta?.text ?? "";
              if (delta) {
                fullText += delta;
                controller.enqueue(sseEvent("token", { delta }));
              }
            }

            boundary = buffer.indexOf("\n\n");
          }
        }

        controller.enqueue(sseEvent("message", { text: fullText }));
        controller.close();
      } catch (error) {
        controller.enqueue(sseEvent("error", { message: "Stream error" }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
