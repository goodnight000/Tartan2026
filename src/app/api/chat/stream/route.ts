import { NextRequest } from "next/server";
import Dedalus from "dedalus-labs";
import { DedalusRunner } from "dedalus-labs";

export const runtime = "nodejs";

const encoder = new TextEncoder();

export async function POST(req: NextRequest) {
  const { message, history } = (await req.json()) as {
    message: string;
    history?: Array<{ role: string; content: string }>;
  };

  const apiKey = process.env.DEDALUS_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ message: "Missing DEDALUS_API_KEY" }),
      { status: 500 }
    );
  }

  const client = new Dedalus({ apiKey });
  const runner = new DedalusRunner(client);

  const transcript = [...(history ?? []), { role: "user", content: message }]
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join("\n");

  const response = await runner.run({
    input: `Use the following conversation history to respond.\n\n${transcript}`,
    model: process.env.DEDALUS_MODEL || "anthropic/claude-opus-4-5"
  });

  const finalText = response.finalOutput || "";

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `event: message\ndata: ${JSON.stringify({ text: finalText })}\n\n`
        )
      );
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
