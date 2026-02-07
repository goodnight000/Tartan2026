import { NextRequest } from "next/server";
import Dedalus from "dedalus-labs";
import { DedalusRunner } from "dedalus-labs";
import { getAdminAuth } from "@/lib/firebase-admin";
import { triage } from "@/lib/agent/triage";
import { loadProfile } from "@/lib/agent/profile-loader";
import { buildSystemPrompt } from "@/lib/agent/system-prompt";
import { createAgentTools } from "@/lib/agent/create-tools";
import type { ActionPlan } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const encoder = new TextEncoder();

function sseEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  );
}

export async function POST(req: NextRequest) {
  const { message, history, idToken } = (await req.json()) as {
    message: string;
    history?: Array<{ role: string; content: string }>;
    idToken?: string;
  };

  const apiKey = process.env.DEDALUS_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ message: "Missing DEDALUS_API_KEY" }),
      { status: 500 }
    );
  }

  // --- 1. Authenticate (optional — degrade gracefully if no token) ---
  let userId: string | null = null;
  if (idToken) {
    try {
      const decoded = await getAdminAuth().verifyIdToken(idToken);
      userId = decoded.uid;
    } catch {
      // Token invalid — continue without profile
    }
  }

  // --- 2. Triage ---
  const triageResult = triage(message);

  if (triageResult.level === "EMERGENT") {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          sseEvent("message", { text: triageResult.emergencyResponse })
        );
        controller.close();
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

  // --- 3. Load profile ---
  const profile = userId ? await loadProfile(userId) : null;

  // --- 4. Build system prompt ---
  const systemPrompt = buildSystemPrompt(profile, triageResult.level);

  // --- 5. Prepare tools (request-scoped) ---
  const pendingActions: ActionPlan[] = [];
  const tools = createAgentTools(pendingActions);

  // --- 6. Build conversation input ---
  const transcript = [...(history ?? []), { role: "user", content: message }]
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join("\n");

  // --- 7. Run agent ---
  const client = new Dedalus({ apiKey });
  const runner = new DedalusRunner(client);

  const mcpServers = (process.env.DEDALUS_MCP_SERVERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await runner.run({
          instructions: systemPrompt,
          input: transcript,
          model: process.env.DEDALUS_MODEL || "anthropic/claude-sonnet-4-5",
          tools,
          mcp_servers: mcpServers.length ? mcpServers : undefined,
          stream: true,
        });

        // If streaming returns an async iterable, consume it
        if (
          response &&
          typeof response === "object" &&
          Symbol.asyncIterator in response
        ) {
          for await (const chunk of response as AsyncIterable<unknown>) {
            const delta =
              typeof chunk === "string"
                ? chunk
                : (chunk as { delta?: string; content?: string }).delta ??
                  (chunk as { delta?: string; content?: string }).content ??
                  "";
            if (delta) {
              controller.enqueue(sseEvent("token", { delta }));
            }
          }
        } else {
          // Non-streaming fallback: response is RunResult
          const result = response as { finalOutput?: string };
          const finalText = result.finalOutput || "";
          controller.enqueue(sseEvent("message", { text: finalText }));
        }

        // Emit any pending Tier 2 action plans
        for (const plan of pendingActions) {
          controller.enqueue(sseEvent("action_plan", plan));
        }
      } catch (error) {
        const errMsg =
          error instanceof Error ? error.message : "Agent error";
        controller.enqueue(sseEvent("error", { message: errMsg }));
      } finally {
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
