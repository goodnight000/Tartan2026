import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    profile?: Record<string, unknown>;
    reminders?: Array<Record<string, unknown>>;
  };

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

  const prompt = `You are a health coach. Create a 7-day plan with daily actions to maintain health.\n\nProfile: ${JSON.stringify(
    body.profile ?? {}
  )}\n\nReminders: ${JSON.stringify(body.reminders ?? [])}\n\nReturn JSON with shape: {"summary": string, "days": [{"day": string, "actions": string[]}]}`;

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Respond with valid JSON only." },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    return new Response(text, { status: upstream.status });
  }

  const data = (await upstream.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content ?? "";
  return new Response(content, {
    headers: { "Content-Type": "application/json" }
  });
}
