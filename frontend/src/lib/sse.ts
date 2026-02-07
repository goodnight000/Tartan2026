export type SSEEvent = {
  event: string;
  data: unknown;
};

function parseSSEChunk(
  chunk: string,
  onEvent: (event: SSEEvent) => void
) {
  const lines = chunk.split("\n");
  let eventType = "message";
  let data = "";
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventType = line.replace("event:", "").trim();
    } else if (line.startsWith("data:")) {
      data += line.replace("data:", "").trim();
    }
  }
  let parsed: unknown = data;
  try {
    parsed = JSON.parse(data);
  } catch {
    parsed = data;
  }
  onEvent({ event: eventType, data: parsed });
}

export async function consumeSSE(
  response: Response,
  onEvent: (event: SSEEvent) => void
) {
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).trim();
    } catch {
      detail = "";
    }
    const suffix = detail ? `: ${detail.slice(0, 240)}` : "";
    throw new Error(
      `Failed to open SSE stream (${response.status} ${response.statusText})${suffix}`
    );
  }
  if (!response.body) {
    throw new Error("Failed to open SSE stream (empty response body)");
  }

  const reader = response.body.getReader();
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
        if (chunk.length) {
          parseSSEChunk(chunk, onEvent);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Opens an SSE stream with automatic reconnection on network failures.
 * Returns an AbortController that can be used to cancel the stream.
 */
export function consumeSSEWithReconnect(
  openStream: (signal: AbortSignal) => Promise<Response>,
  onEvent: (event: SSEEvent) => void,
  options?: { maxRetries?: number; baseDelayMs?: number; onError?: (error: Error) => void }
): AbortController {
  const controller = new AbortController();
  const maxRetries = options?.maxRetries ?? 2;
  const baseDelayMs = options?.baseDelayMs ?? 500;

  (async () => {
    let attempts = 0;
    while (!controller.signal.aborted && attempts <= maxRetries) {
      try {
        const response = await openStream(controller.signal);
        attempts = 0; // reset on successful connection
        await consumeSSE(response, onEvent);
        break; // stream ended normally
      } catch (error) {
        if (controller.signal.aborted) break;
        attempts++;
        if (attempts > maxRetries) {
          options?.onError?.(error as Error);
          break;
        }
        // Exponential backoff
        const delay = baseDelayMs * Math.pow(2, attempts - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  })();

  return controller;
}
