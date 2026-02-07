import { NextRequest } from "next/server";

export const runtime = "nodejs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function POST(req: NextRequest) {
  const { message } = (await req.json()) as { message: string };

  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  const siteUrl = process.env.OPENROUTER_SITE_URL;
  const appName = process.env.OPENROUTER_APP_NAME || "MedClaw";

  if (!apiKey) {
    return new Response(
      JSON.stringify({ message: "Missing OPENROUTER_API_KEY" }),
      { status: 500 }
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  if (siteUrl) headers["HTTP-Referer"] = siteUrl;
  if (appName) headers["X-Title"] = appName;

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        {
          role: "system",
          content:
            "You are MedClaw, a careful medical assistant. Be concise and ask clarifying questions."
        },
        { role: "user", content: message }
      ]
    })
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return new Response(text, { status: upstream.status });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx = buffer.indexOf("\n");
        while (idx !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);

          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") {
              controller.close();
              return;
            }
            try {
              const json = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const delta = json.choices?.[0]?.delta?.content || "";
              if (delta) {
                controller.enqueue(
                  encoder.encode(
                    `event: token\ndata: ${JSON.stringify({ delta })}\n\n`
                  )
                );
              }
            } catch {
              // ignore parse errors
            }
          }
          idx = buffer.indexOf("\n");
        }
      }

      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
}
