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

// ---------------------------------------------------------------------------
// Citation extraction
// ---------------------------------------------------------------------------

export interface Citation {
  /** Character offset in the text where this citation should be displayed. */
  offset: number;
  /** Source URL. */
  url: string;
  /** Source page title. */
  title?: string;
  /** Snippet of source content that supports the claim. */
  snippet?: string;
  /** Site name (e.g. "fifa.com"). */
  siteName?: string;
  /** Favicon URL for the source site. */
  faviconUrl?: string;
}

export interface StreamTextWithCitations {
  /** Incremental text fragment (empty on final event). */
  delta: string;
  /** Accumulated text so far (authoritative on done). */
  text: string;
  /** True when the lastChunk event has been received. */
  done: boolean;
  /** Extracted citations (empty until done=true, then populated from lastChunk metadata). */
  citations: Citation[];
}

/**
 * Resolve a JSON pointer like "/results/0/snippet" into a data object.
 * Returns the value at that path, or undefined if the path doesn't exist.
 */
function resolveLocator(data: unknown, locator: string): unknown {
  if (!locator || locator === "") return data;
  const parts = locator.split("/").filter(Boolean);
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Extract the parent result object from a locator path.
 * Given "/results/0/snippet", returns data.results[0].
 * Given "" (empty), returns the whole data object.
 */
function extractSourceResult(data: unknown, locator: string): Record<string, unknown> | undefined {
  if (!locator) {
    return typeof data === "object" && data !== null ? data as Record<string, unknown> : undefined;
  }
  const parts = locator.split("/").filter(Boolean);
  let current: unknown = data;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[parts[i]];
  }
  return typeof current === "object" && current !== null ? current as Record<string, unknown> : undefined;
}

/**
 * Extract citations from a lastChunk artifactUpdate event.
 * Reads text part metadata.citations and resolves them against data parts.
 */
function extractCitationsFromEvent(event: StreamResponse): Citation[] {
  const au = event.artifactUpdate;
  if (!au?.artifact?.parts) return [];

  const textParts = au.artifact.parts.filter((p) => "text" in p && typeof (p as { text: unknown }).text === "string");
  const dataParts = au.artifact.parts.filter((p) => "data" in p);

  if (textParts.length === 0) return [];

  const textPartWithCitations = textParts.find((p) => {
    const meta = (p as { metadata?: Record<string, unknown> }).metadata;
    return meta && Array.isArray(meta.citations);
  });
  if (!textPartWithCitations) return [];

  const meta = (textPartWithCitations as { metadata: Record<string, unknown> }).metadata;
  const rawCitations = meta.citations as Array<{
    data_part_id?: string;
    locator?: string;
    offset?: number;
  }>;

  if (!Array.isArray(rawCitations) || rawCitations.length === 0) return [];

  const dataMap = new Map<string, unknown>();
  for (const dp of dataParts) {
    const dpMeta = (dp as { metadata?: Record<string, unknown> }).metadata;
    const dpId = dpMeta?.dataPartId as string | undefined;
    if (dpId) {
      dataMap.set(dpId, (dp as { data: unknown }).data);
    }
  }

  const citations: Citation[] = [];
  for (const raw of rawCitations) {
    if (raw.offset === undefined) continue;

    const data = raw.data_part_id ? dataMap.get(raw.data_part_id) : undefined;
    if (!data) continue;

    const sourceResult = extractSourceResult(data, raw.locator ?? "");
    if (!sourceResult) continue;

    const site = sourceResult.site as Record<string, unknown> | undefined;
    const url = sourceResult.url as string | undefined;
    if (!url) continue;

    citations.push({
      offset: raw.offset,
      url,
      title: sourceResult.title as string | undefined,
      snippet: sourceResult.snippet as string | undefined,
      siteName: site?.name as string | undefined,
      faviconUrl: site?.favicon_url as string | undefined,
    });
  }

  return citations;
}

/**
 * Consume a `StreamResponse` stream and yield text deltas + extracted citations.
 *
 * Works like {@link collectText} for the streaming portion — each artifact
 * chunk yields `{ delta, text, done: false, citations: [] }`. On the
 * `lastChunk` event, citations are extracted from the text part's
 * `metadata.citations` and resolved against the data parts' source data.
 *
 * @example
 * ```ts
 * const stream = await ctx.streamMessage([{ text: "Who won the World Cup?" }]);
 * for await (const chunk of collectCitations(stream)) {
 *   if (chunk.delta) process.stdout.write(chunk.delta);
 *   if (chunk.done) {
 *     console.log(toMarkdown(chunk.text, chunk.citations));
 *   }
 * }
 * ```
 */
export async function* collectCitations(
  stream: AsyncIterable<StreamResponse>,
): AsyncGenerator<StreamTextWithCitations> {
  let accumulated = "";

  for await (const event of stream) {
    if (!event.artifactUpdate) continue;

    const au = event.artifactUpdate;
    const chunkText = artifactText(au.artifact);

    if (au.lastChunk) {
      const citations = extractCitationsFromEvent(event);
      yield { delta: "", text: chunkText, done: true, citations };
      return;
    }

    accumulated += chunkText;
    yield { delta: chunkText, text: accumulated, done: false, citations: [] };
  }
}

/**
 * Render text + citations as markdown with inline `[n]` markers and a
 * Sources section.
 *
 * Citations are inserted at their character offsets in the text. If
 * multiple citations share the same offset, they are rendered as
 * `[1][2]`. A `## Sources` section is appended with numbered entries.
 *
 * @example
 * ```ts
 * const md = toMarkdown("Spain won the World Cup.", [
 *   { offset: 23, url: "https://fifa.com/...", title: "FIFA Final" },
 * ]);
 * // → "Spain won the World Cup.[1]\n\n## Sources\n[1] FIFA Final — https://fifa.com/..."
 * ```
 */
export function toMarkdown(text: string, citations: Citation[]): string {
  if (citations.length === 0) return text;

  const sorted = [...citations].sort((a, b) => a.offset - b.offset);

  let result = "";
  let lastPos = 0;
  const numberForUrl = new Map<string, number>();
  let nextNumber = 1;

  for (const citation of sorted) {
    const offset = Math.min(citation.offset, text.length);

    let num = numberForUrl.get(citation.url);
    if (num === undefined) {
      num = nextNumber++;
      numberForUrl.set(citation.url, num);
    }

    result += text.slice(lastPos, offset);
    result += `[${num}]`;
    lastPos = offset;
  }

  result += text.slice(lastPos);

  const sources: string[] = [];
  const seenUrls = new Set<string>();
  const sortedByNumber = [...numberForUrl.entries()].sort((a, b) => a[1] - b[1]);
  for (const [url, num] of sortedByNumber) {
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    const citation = sorted.find((c) => c.url === url);
    if (citation) {
      const title = citation.title || citation.siteName || url;
      sources.push(`[${num}] ${title} — ${url}`);
    }
  }

  if (sources.length > 0) {
    result += `\n\n## Sources\n${sources.join("\n")}`;
  }

  return result;
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
