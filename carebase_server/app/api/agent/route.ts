import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-5";
const AGENT_GUIDE_PATH = path.join(process.cwd(), "docs", "AGENT_GUIDE.md");

function loadAgentGuide(): string | null {
  try {
    return fs.readFileSync(AGENT_GUIDE_PATH, "utf8");
  } catch (error) {
    return null;
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing ANTHROPIC_API_KEY." },
      { status: 500 }
    );
  }

  let payload: { messages?: AgentMessage[]; system?: string };
  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const messages = payload.messages ?? [];
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "Messages are required." },
      { status: 400 }
    );
  }

  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const guide = loadAgentGuide();
  const systemPromptParts = [
    guide ? `CareBase Agent Guide:\\n${guide}` : null,
    payload.system ??
      "You are a CareBase test agent. Respond concisely and include CareBase XML tags when storing or fetching personal memory.",
  ].filter(Boolean);

  const upstream = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      system: systemPromptParts.join("\n\n"),
      messages,
    }),
  });

  if (!upstream.ok) {
    const errorPayload = await upstream.json().catch(() => ({}));
    return NextResponse.json(
      { error: errorPayload.error?.message ?? "Anthropic API error." },
      { status: upstream.status }
    );
  }

  const responsePayload = (await upstream.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const reply =
    responsePayload.content
      ?.map((chunk) => chunk.text)
      .filter(Boolean)
      .join("\n") ?? "";

  return NextResponse.json({ reply });
}
