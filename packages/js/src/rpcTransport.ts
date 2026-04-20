import { randomUUID } from "crypto";
import type { CortiClient } from "@corti/sdk";

/**
 * JSON-RPC 2.0 transport for the A2A endpoint at `/agents/{id}/v1`.
 *
 * Reaches into the `CortiClient` to reuse its resolved base URL and OAuth
 * bearer token, so the caller doesn't need to duplicate auth config.
 */

type Supplier<T> = T | Promise<T> | (() => T | Promise<T>);

async function resolveSupplier<T>(s: Supplier<T>): Promise<T> {
  const v = typeof s === "function" ? (s as () => T | Promise<T>)() : s;
  return await v;
}

async function resolveAgentsBaseUrl(client: CortiClient): Promise<string> {
  const opts = (client as unknown as { _options: {
    baseUrl?: Supplier<string>;
    environment: Supplier<{ agents: string } | string>;
  } })._options;

  if (opts.baseUrl) {
    const base = await resolveSupplier(opts.baseUrl);
    if (base) return base.replace(/\/+$/, "");
  }
  const env = await resolveSupplier(opts.environment);
  const agents = typeof env === "string" ? env : env.agents;
  return agents.replace(/\/+$/, "");
}

async function getAuthHeader(client: CortiClient): Promise<string> {
  return (client.agents as unknown as {
    _getAuthorizationHeader(): Promise<string>;
  })._getAuthorizationHeader();
}

async function getTenantHeader(client: CortiClient): Promise<string | undefined> {
  const opts = (client as unknown as { _options: { tenantName?: Supplier<string> } })._options;
  if (!opts.tenantName) return undefined;
  return resolveSupplier(opts.tenantName);
}

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
    const suffix = data !== undefined ? ` — ${JSON.stringify(data)}` : "";
    throw new Error(`A2A error ${code}: ${message}${suffix}`);
  }
  return payload.result;
}

async function buildHeaders(
  client: CortiClient,
  accept: string
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: accept,
    Authorization: await getAuthHeader(client),
  };
  const tenant = await getTenantHeader(client);
  if (tenant) headers["Tenant-Name"] = tenant;
  return headers;
}

export interface RpcCallOptions {
  timeoutInSeconds?: number;
  abortSignal?: AbortSignal;
}

export async function rpcCall<T>(
  client: CortiClient,
  agentId: string,
  method: string,
  params: unknown,
  opts?: RpcCallOptions
): Promise<T | undefined> {
  const baseUrl = await resolveAgentsBaseUrl(client);
  const url = `${baseUrl}/agents/${encodeURIComponent(agentId)}/v1`;

  const controller = new AbortController();
  const timer = opts?.timeoutInSeconds !== undefined
    ? setTimeout(() => controller.abort(), opts.timeoutInSeconds * 1000)
    : undefined;
  if (opts?.abortSignal) {
    opts.abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: await buildHeaders(client, "application/json"),
      body: JSON.stringify(buildEnvelope(method, params)),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status} from ${url}${text ? `: ${text}` : ""}`);
    }
    const json = (await resp.json()) as RpcResponse<T>;
    return unwrap(json);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function* rpcStream<T>(
  client: CortiClient,
  agentId: string,
  method: string,
  params: unknown,
  opts?: RpcCallOptions
): AsyncGenerator<T> {
  const baseUrl = await resolveAgentsBaseUrl(client);
  const url = `${baseUrl}/agents/${encodeURIComponent(agentId)}/v1`;

  const controller = new AbortController();
  if (opts?.abortSignal) {
    opts.abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: await buildHeaders(client, "text/event-stream"),
    body: JSON.stringify(buildEnvelope(method, params)),
    signal: controller.signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} from ${url}${text ? `: ${text}` : ""}`);
  }
  if (!resp.body) {
    throw new Error("No response body for stream");
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
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
    reader.releaseLock();
  }
}
