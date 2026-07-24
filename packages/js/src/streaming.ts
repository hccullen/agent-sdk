import type { StreamResponse } from "./types.js";

export interface SSEEvent {
  data: string;
  event?: string;
  id?: string;
  retry?: number;
}

export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let eventEnd: number;
      while ((eventEnd = buffer.indexOf("\n\n")) !== -1) {
        const eventBlock = buffer.slice(0, eventEnd);
        buffer = buffer.slice(eventEnd + 2);

        const event = parseSSEBlock(eventBlock);
        if (event) yield event;
      }
    }

    if (buffer.trim()) {
      const event = parseSSEBlock(buffer);
      if (event) yield event;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // best-effort cleanup
    }
  }
}

function parseSSEBlock(block: string): SSEEvent | null {
  const normalized = block.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");

  const dataLines: string[] = [];
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;

  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(
        line.length > 5 && line[5] === " " ? line.slice(6) : line.slice(5),
      );
    } else if (line === "data") {
      dataLines.push("");
    } else if (line.startsWith("event:")) {
      event = line.slice(6).trimStart();
    } else if (line.startsWith("id:")) {
      id = line.slice(3).trimStart();
    } else if (line.startsWith("retry:")) {
      const val = parseInt(line.slice(6).trim(), 10);
      if (!isNaN(val)) retry = val;
    }
  }

  if (dataLines.length === 0) return null;

  const data = dataLines.join("\n");
  if (data === "[DONE]") return null;

  return { data, event, id, retry };
}

export async function* parseA2AStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamResponse> {
  for await (const sse of parseSSEStream(body)) {
    try {
      const parsed = JSON.parse(sse.data) as StreamResponse;
      yield parsed;
    } catch {
      // Skip malformed JSON events
    }
  }
}

export interface AbortOptions {
  timeoutInSeconds?: number;
  abortSignal?: AbortSignal;
}

export function makeAbortController(opts?: AbortOptions): {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | undefined;
} {
  const controller = new AbortController();
  if (opts?.abortSignal?.aborted) {
    controller.abort();
  } else if (opts?.abortSignal) {
    opts.abortSignal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }
  const timer =
    opts?.timeoutInSeconds !== undefined
      ? setTimeout(() => controller.abort(), opts.timeoutInSeconds * 1000)
      : undefined;
  return { controller, timer };
}
