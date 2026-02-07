export type SSEEvent = {
  event: string;
  data: unknown;
};

export async function consumeSSE(
  response: Response,
  onEvent: (event: SSEEvent) => void
) {
  if (!response.ok || !response.body) {
    throw new Error("Failed to open SSE stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);
      if (chunk.length) {
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
      boundary = buffer.indexOf("\n\n");
    }
  }
}
