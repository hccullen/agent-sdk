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

// ---------------------------------------------------------------------------
// Text accumulation helpers
// ---------------------------------------------------------------------------

/**
 * A text chunk yielded by {@link collectText}.
 */
export interface StreamTextChunk {
  /** The incremental text fragment from this event. Empty on the final `lastChunk` event when the server sends the complete text separately. */
  delta: string;
  /** All text accumulated so far. On the final event this is the authoritative complete text from the server. */
  text: string;
  /** `true` when the stream has reached the final `lastChunk` event. */
  done: boolean;
}

/**
 * Extract text from an `artifactUpdate` event's artifact parts.
 * Returns the concatenated text from all `text` parts, or an empty string
 * if there are no text parts.
 */
function artifactText(artifact: { parts?: Array<Record<string, unknown>> } | undefined): string {
  if (!artifact?.parts) return "";
  return artifact.parts
    .filter((p): p is { text: string } => "text" in p && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}

/**
 * Consume a `StreamResponse` async iterable and yield accumulated text chunks.
 *
 * This is the primary helper for token-by-token streaming. It handles the
 * three kinds of `artifactUpdate` events the server sends:
 *
 * 1. **First chunk** (no `append`, no `lastChunk`): the initial token fragment.
 * 2. **Append chunks** (`append: true`): incremental token fragments.
 * 3. **Final chunk** (`lastChunk: true`): the complete text — used as the
 *    authoritative version, replacing the accumulated deltas.
 *
 * Non-`artifactUpdate` events (task, statusUpdate, message) are skipped
 * silently.
 *
 * @example
 * ```ts
 * const stream = await ctx.streamMessage([{ text: "Explain photosynthesis." }]);
 * for await (const chunk of collectText(stream)) {
 *   process.stdout.write(chunk.delta);   // print each token as it arrives
 *   if (chunk.done) console.log("\n\nComplete:", chunk.text);
 * }
 * ```
 *
 * @returns an async generator of {@link StreamTextChunk} objects.
 */
export async function* collectText(
  stream: AsyncIterable<StreamResponse>,
): AsyncGenerator<StreamTextChunk> {
  let accumulated = "";

  for await (const event of stream) {
    if (!event.artifactUpdate) continue;

    const au = event.artifactUpdate;
    const chunkText = artifactText(au.artifact);

    if (au.lastChunk) {
      // The final event carries the authoritative complete text.
      yield { delta: "", text: chunkText, done: true };
      return;
    }

    // First chunk (no append) and append chunks are incremental deltas.
    accumulated += chunkText;
    yield { delta: chunkText, text: accumulated, done: false };
  }
}

/**
 * A stateful collector for consumers who iterate the raw event stream
 * themselves but want automatic text accumulation as a side effect.
 *
 * Call {@link StreamCollector.update} with each `StreamResponse` event.
 * Read {@link StreamCollector.text} for the accumulated text and
 * {@link StreamCollector.done} to check whether the stream is finished.
 *
 * @example
 * ```ts
 * const collector = new StreamCollector();
 * for await (const event of ctx.streamMessage([{ text: "Hello" }])) {
 *   const delta = collector.update(event);
 *   if (delta) process.stdout.write(delta);
 * }
 * console.log("\nFinal:", collector.text);
 * ```
 */
export class StreamCollector {
  private _text = "";
  private _done = false;

  /** The accumulated text so far. On completion this is the authoritative full text from the server. */
  get text(): string {
    return this._text;
  }

  /** `true` once a `lastChunk` artifact event has been received. */
  get done(): boolean {
    return this._done;
  }

  /**
   * Process a single `StreamResponse` event.
   *
   * @returns The incremental text delta (may be empty string), or `null`
   *   if the event is not an `artifactUpdate`.
   */
  update(event: StreamResponse): string | null {
    if (!event.artifactUpdate) return null;

    const au = event.artifactUpdate;
    const chunkText = artifactText(au.artifact);

    if (au.lastChunk) {
      // The final event carries the authoritative complete text.
      this._text = chunkText;
      this._done = true;
      return ""; // no new delta — the text was already accumulated
    }

    this._text += chunkText;
    return chunkText;
  }

  /** Reset the collector to its initial state for reuse. */
  reset(): void {
    this._text = "";
    this._done = false;
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
