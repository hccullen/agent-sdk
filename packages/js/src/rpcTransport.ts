import type { CortiClient, CortiEnvironmentUrls } from "@corti/sdk";
import { HttpError, RpcError } from "./errors.js";
import { randomUUID } from "./utils.js";

/**
 * JSON-RPC 2.0 transport for the A2A endpoint at `/agents/{id}/v1`.
 *
 * Reuses the `CortiClient`'s resolved base URL and OAuth bearer token via
 * its public `getAuthHeaders()` helper, so the caller doesn't need to
 * duplicate auth config.
 */

// ── URL resolution ─────────────────────────────────────────────────────────────

type Supplier<T> = T | Promise<T> | (() => T | Promise<T>);

async function resolveSupplier<T>(s: Supplier<T>): Promise<T> {
  const v = typeof s === "function" ? (s as () => T | Promise<T>)() : s;
  return await v;
}

/**
 * Shape of `CortiClient._options` we need to resolve the agents base URL.
 *
 * `_options` is `protected` (not private) in @corti/sdk ≥3.0.0 — the SDK
 * itself accesses it in `CustomAgents.getCardUrl`. There is no public
 * `client.getAgentsBaseUrl()` method yet; this cast is the only mechanism
 * available. If @corti/sdk ever exposes a stable method, remove this cast
 * and use it instead. Pass `agentsBaseUrl` explicitly to bypass this entirely.
 */
interface PartialClientOptions {
  baseUrl?: Supplier<string>;
  environment: Supplier<CortiEnvironmentUrls | { agents: string }>;
}

export async function resolveAgentsBaseUrl(
  client: CortiClient,
  override?: string,
): Promise<string> {
  if (override) return override.replace(/\/+$/, "");

  const opts = (client as unknown as { _options: PartialClientOptions })._options;

  let resolved: string | undefined;
  if (opts.baseUrl) {
    const base = await resolveSupplier(opts.baseUrl);
    if (base) resolved = base;
  }
  if (!resolved) {
    const env = await resolveSupplier(opts.environment);
    resolved = (env as { agents?: string }).agents;
  }
  if (!resolved || !/^https?:\/\//i.test(resolved)) {
    throw new Error(
      `[AgentSDK] Could not resolve agents base URL from CortiClient options ` +
      `(got ${JSON.stringify(resolved)}). Pass a CortiClient configured with ` +
      `\`environment: CortiEnvironment.Eu | CortiEnvironment.Us\`, or supply ` +
      `\`agentsBaseUrl\` explicitly to \`AgentsClient\`.`,
    );
  }
  return resolved.replace(/\/+$/, "");
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
  const baseUrl = await resolveAgentsBaseUrl(client, agentsBaseUrl);
  const url = `${baseUrl}/agents/${encodeURIComponent(agentId)}/v1`;

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
  const baseUrl = await resolveAgentsBaseUrl(client, agentsBaseUrl);
  const url = `${baseUrl}/agents/${encodeURIComponent(agentId)}/v1`;

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

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const rawLine = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const line = rawLine.replace(/\r$/, "").trim();
        if (!line || !line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") return;
        let parsed: RpcResponse<T>;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        const result = unwrap(parsed);
        if (result !== undefined) yield result;
      }
    }
  } finally {
    if (timer) clearTimeout(timer);
    if (reader) {
      try { await reader.cancel(); } catch { /* best-effort cleanup */ }
      try { reader.releaseLock(); } catch { /* already released */ }
    }
  }
}
