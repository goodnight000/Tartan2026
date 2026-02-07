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

  const fallbackPlan = {
    summary: "A simple 7-day check-in plan to stay on track with your health goals.",
    days: [
      { day: "Day 1", actions: ["Review medications and refill dates", "Take a 10-15 minute walk"] },
      { day: "Day 2", actions: ["Log symptoms or energy level", "Drink an extra glass of water"] },
      { day: "Day 3", actions: ["Check upcoming appointments", "Stretch for 5 minutes"] },
      { day: "Day 4", actions: ["Review reminders and quiet hours", "Plan a balanced meal"] },
      { day: "Day 5", actions: ["Confirm pharmacy preferences", "Take a short mindfulness break"] },
      { day: "Day 6", actions: ["Update any new symptoms", "Light activity (walk or gentle yoga)"] },
      { day: "Day 7", actions: ["Review weekly progress", "Set next week’s focus"] },
    ],
  };

  if (!apiKey) {
    return new Response(JSON.stringify(fallbackPlan), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  if (siteUrl) headers["HTTP-Referer"] = siteUrl;
  if (appName) headers["X-Title"] = appName;

  const prompt = `You are a health coach for patients/caregivers. Create a 7-day plan with daily actions to maintain health.\n\nProfile: ${JSON.stringify(
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
    return new Response(JSON.stringify(fallbackPlan), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const data = (await upstream.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) {
    return new Response(JSON.stringify(fallbackPlan), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(content, {
    headers: { "Content-Type": "application/json" }
  });
}
