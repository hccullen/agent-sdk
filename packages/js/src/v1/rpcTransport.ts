import type { CortiClient } from "@corti/sdk";
import { HttpError, RpcError } from "./errors.js";
import { randomUUID } from "./utils.js";

/**
 * JSON-RPC 2.0 transport for the A2A endpoint at `/agents/{id}/v1`.
 *
 * Uses `client.agents.getCardUrl(agentId)` to resolve the per-agent RPC URL
 * without accessing any private or protected SDK internals. Auth headers come
 * from the public `client.getAuthHeaders()` method.
 */

// ── URL resolution ─────────────────────────────────────────────────────────────

/**
 * Derive the JSON-RPC endpoint URL for a given agent.
 *
 * `getCardUrl` returns: `https://<host>/agents/<id>/agent-card.json`
 * The relative reference `"v1"` resolves the last path segment to `v1`:
 *   → `https://<host>/agents/<id>/v1`
 *
 * When `agentsBaseUrlOverride` is supplied (proxy / custom deployment), the
 * URL is built directly from that base instead.
 */
async function resolveRpcUrl(
  client: CortiClient,
  agentId: string,
  agentsBaseUrlOverride?: string,
): Promise<string> {
  if (agentsBaseUrlOverride) {
    const base = agentsBaseUrlOverride.replace(/\/+$/, "");
    return `${base}/agents/${encodeURIComponent(agentId)}/v1`;
  }
  const cardUrl = await client.agents.getCardUrl(agentId);
  return new URL("v1", cardUrl).href;
}

// ── JSON-RPC envelope ─────────────────────────────────────────────────────────

interface RpcEnvelope {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: unknown;
}

interface RpcResponse<T> {
  jsonrpc: "2.0";
  id: string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

function buildEnvelope(method: string, params: unknown): RpcEnvelope {
  return { jsonrpc: "2.0", id: randomUUID(), method, params };
}

function unwrap<T>(payload: RpcResponse<T>): T | undefined {
  if (payload.error) {
    const { code, message, data } = payload.error;
    throw new RpcError(code, message, data);
  }
  return payload.result;
}

// ── Headers ───────────────────────────────────────────────────────────────────

async function buildHeaders(
  client: CortiClient,
  accept: string,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: accept,
  };
  const authHeaders = await client.getAuthHeaders();
  authHeaders.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

// ── Abort / timeout ───────────────────────────────────────────────────────────

export interface RpcCallOptions {
  timeoutInSeconds?: number;
  abortSignal?: AbortSignal;
}

function makeAbortController(opts?: RpcCallOptions): {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | undefined;
} {
  const controller = new AbortController();
  if (opts?.abortSignal?.aborted) {
    controller.abort();
  } else if (opts?.abortSignal) {
    opts.abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const timer =
    opts?.timeoutInSeconds !== undefined
      ? setTimeout(() => controller.abort(), opts.timeoutInSeconds * 1000)
      : undefined;
  return { controller, timer };
}

// ── rpcCall ───────────────────────────────────────────────────────────────────

export async function rpcCall<T>(
  client: CortiClient,
  agentId: string,
  method: string,
  params: unknown,
  agentsBaseUrl?: string,
  opts?: RpcCallOptions,
): Promise<T | undefined> {
  const url = await resolveRpcUrl(client, agentId, agentsBaseUrl);
  const { controller, timer } = makeAbortController(opts);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: await buildHeaders(client, "application/json"),
      body: JSON.stringify(buildEnvelope(method, params)),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new HttpError(resp.status, `HTTP ${resp.status} from ${url}${text ? `: ${text}` : ""}`);
    }
    const json = (await resp.json()) as RpcResponse<T>;
    return unwrap(json);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── rpcStream ─────────────────────────────────────────────────────────────────

export async function* rpcStream<T>(
  client: CortiClient,
  agentId: string,
  method: string,
  params: unknown,
  agentsBaseUrl?: string,
  opts?: RpcCallOptions,
): AsyncGenerator<T> {
  const url = await resolveRpcUrl(client, agentId, agentsBaseUrl);
  const { controller, timer } = makeAbortController(opts);

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: await buildHeaders(client, "text/event-stream"),
      body: JSON.stringify(buildEnvelope(method, params)),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new HttpError(resp.status, `HTTP ${resp.status} from ${url}${text ? `: ${text}` : ""}`);
    }
    if (!resp.body) {
      throw new Error("[AgentSDK] No response body for stream");
    }

    reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // SSE spec: normalize line endings, dispatch on blank-line event boundary.
    // Multiple `data:` lines within one event are concatenated with \n.
    // https://html.spec.whatwg.org/multipage/server-sent-events.html
    //
    // Returns accumulated results and whether [DONE] was encountered.
    // Mutates `buffer` via closure to keep only the unconsumed tail.
    const drainBuffer = (): { results: T[]; done: boolean } => {
      // Normalise \r\n and bare \r so we only need to handle \n.
      const normalised = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      let searchFrom = 0;
      let eventEnd: number;
      const results: T[] = [];

      while ((eventEnd = normalised.indexOf("\n\n", searchFrom)) !== -1) {
        const eventBlock = normalised.slice(searchFrom, eventEnd);
        searchFrom = eventEnd + 2;

        const dataLines: string[] = [];
        for (const rawLine of eventBlock.split("\n")) {
          if (rawLine.startsWith("data:")) {
            // Per spec: strip one optional space after the colon.
            dataLines.push(rawLine.length > 5 && rawLine[5] === " " ? rawLine.slice(6) : rawLine.slice(5));
          } else if (rawLine === "data") {
            dataLines.push("");
          }
          // event:, id:, retry:, and comment (:) lines are intentionally ignored.
        }

        if (dataLines.length === 0) continue;
        const payload = dataLines.join("\n");
        if (payload === "[DONE]") {
          buffer = "";
          return { results, done: true };
        }

        let parsed: RpcResponse<T>;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        const result = unwrap(parsed);
        if (result !== undefined) results.push(result);
      }

      buffer = normalised.slice(searchFrom);
      return { results, done: false };
    };

    let streamDone = false;
    while (!streamDone) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { results, done: signalled } = drainBuffer();
      for (const r of results) yield r;
      if (signalled) { streamDone = true; }
    }
    // Flush any remaining data the server sent without a trailing blank line.
    if (!streamDone) {
      buffer += "\n\n";
      const { results } = drainBuffer();
      for (const r of results) yield r;
    }
  } finally {
    if (timer) clearTimeout(timer);
    if (reader) {
      try { await reader.cancel(); } catch { /* best-effort cleanup */ }
      try { reader.releaseLock(); } catch { /* already released */ }
    }
  }
}
