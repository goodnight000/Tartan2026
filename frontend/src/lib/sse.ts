export type SSEEvent = {
  event: string;
  data: unknown;
};

type ConsumeSSEOptions = {
  signal?: AbortSignal;
};

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function findEventBoundary(buffer: string): { index: number; length: number } | null {
  const lfIndex = buffer.indexOf("\n\n");
  const crlfIndex = buffer.indexOf("\r\n\r\n");
  if (lfIndex === -1 && crlfIndex === -1) return null;
  if (lfIndex === -1) return { index: crlfIndex, length: 4 };
  if (crlfIndex === -1) return { index: lfIndex, length: 2 };
  if (lfIndex < crlfIndex) return { index: lfIndex, length: 2 };
  return { index: crlfIndex, length: 4 };
}

function shouldDispatchTrailingChunk(chunk: string): boolean {
  const lines = normalizeLineEndings(chunk)
    .split("\n")
    .filter((line) => line && !line.startsWith(":"));
  if (!lines.length) return false;

  const dataLines: string[] = [];
  for (const line of lines) {
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
  }

  if (!dataLines.length) return true;
  const data = dataLines.join("\n").trim();
  if (!data) return true;
  const firstChar = data[0];
  if (firstChar === "{" || firstChar === "[") {
    try {
      JSON.parse(data);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

function parseSSEChunk(
  chunk: string,
  onEvent: (event: SSEEvent) => void
) {
  const lines = normalizeLineEndings(chunk).split("\n");
  let eventType = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") {
      eventType = value.trim() || "message";
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  const data = dataLines.join("\n");
  let parsed: unknown = data;
  if (data) {
    try {
      parsed = JSON.parse(data);
    } catch {
      parsed = data;
    }
  }

  onEvent({ event: eventType, data: parsed });
}

export async function consumeSSE(
  response: Response,
  onEvent: (event: SSEEvent) => void,
  options?: ConsumeSSEOptions
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
  const signal = options?.signal;
  let buffer = "";
  const onAbort = () => {
    void reader.cancel();
  };

  try {
    if (signal?.aborted) {
      throw createAbortError();
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    while (true) {
      if (signal?.aborted) throw createAbortError();
      const { value, done } = await reader.read();
      if (done) {
        if (signal?.aborted) throw createAbortError();
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let boundary = findEventBoundary(buffer);
      while (boundary) {
        const chunk = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        if (chunk.trim().length) {
          try {
            parseSSEChunk(chunk, onEvent);
          } catch (error) {
            void reader.cancel();
            throw error;
          }
        }
        boundary = findEventBoundary(buffer);
      }
    }

    if (signal?.aborted) throw createAbortError();
    buffer += decoder.decode();
    const trailing = normalizeLineEndings(buffer);
    if (trailing.trim().length && shouldDispatchTrailingChunk(trailing)) {
      try {
        parseSSEChunk(trailing, onEvent);
      } catch (error) {
        void reader.cancel();
        throw error;
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
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
        await consumeSSE(response, onEvent, { signal: controller.signal });
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
