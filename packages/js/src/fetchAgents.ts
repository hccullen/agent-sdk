/**
 * Direct-fetch create/update for Corti agents.
 *
 * Why this exists
 * ---------------
 * `@corti/sdk@1.2.0-rc` declares top-level `mcpServers` on
 * `AgentsCreateAgent` / `AgentsUpdateAgent` in its TypeScript types, but the
 * Fern-generated runtime serialisers for those request bodies omit the
 * field — so any `mcpServers` passed via `client.agents.create/update` is
 * silently stripped before the HTTP request.
 *
 * Until the SDK ships a fix, we bypass the SDK request pipeline for agent
 * create/update: we POST/PATCH directly with `fetch()`, reusing the
 * existing `CortiClient`'s base URL, auth provider, and static headers so
 * the call behaves identically (proxies, tenant, logging) *except* that
 * the body is sent verbatim — `mcpServers` included.
 *
 * When the SDK is fixed, delete this file and restore the SDK path in
 * `AgentsClient.create` and `AgentHandle.update`.
 */

import { CortiAuth, type Corti, type CortiClient } from "@corti/sdk";

/** Optional override: supply fresh client-credential auth instead of
 *  reusing the CortiClient's own auth provider. Only needed when the
 *  caller wants to scope agent create/update to different credentials. */
export interface FetchAgentsAuthConfig {
  environment: { agents: string } & Record<string, unknown>;
  tenantName: string;
  clientId: string;
  clientSecret: string;
}

interface ResolvedRequest {
  baseUrl: string;
  headers: Record<string, string>;
}

async function resolveFromAuthConfig(
  auth: FetchAgentsAuthConfig
): Promise<ResolvedRequest> {
  const cortiAuth = new CortiAuth({
    // CortiAuth accepts string | CortiEnvironment; the object form is fine.
    environment: auth.environment as unknown as string,
    tenantName: auth.tenantName,
  });
  const token = await cortiAuth.getToken({
    clientId: auth.clientId,
    clientSecret: auth.clientSecret,
  });
  return {
    baseUrl: auth.environment.agents,
    headers: {
      authorization: `Bearer ${token.accessToken}`,
      "tenant-name": auth.tenantName,
    },
  };
}

async function resolveFromClient(client: CortiClient): Promise<ResolvedRequest> {
  // Reach into the CortiClient's normalised options. Shape is stable
  // across SDK minor versions: baseUrl / environment / authProvider /
  // headers / tenantName all live here.
  const options = (client as unknown as {
    _options: {
      baseUrl?: string | (() => string | Promise<string>);
      environment?: unknown;
      authProvider: {
        getAuthRequest(): Promise<{ headers: Record<string, string> }>;
      };
      headers?: Record<string, string>;
      tenantName?: string | (() => string | Promise<string>);
    };
  })._options;

  const baseUrl = await resolveBaseUrl(options);
  const { headers: authHeaders } = await options.authProvider.getAuthRequest();
  const tenantName =
    typeof options.tenantName === "function"
      ? await options.tenantName()
      : options.tenantName;

  return {
    baseUrl,
    headers: {
      ...(options.headers ?? {}),
      ...(tenantName ? { "tenant-name": tenantName } : {}),
      ...authHeaders,
    },
  };
}

async function resolveBaseUrl(options: {
  baseUrl?: string | (() => string | Promise<string>);
  environment?: unknown;
}): Promise<string> {
  if (options.baseUrl) {
    return typeof options.baseUrl === "function"
      ? await options.baseUrl()
      : options.baseUrl;
  }
  const env =
    typeof options.environment === "function"
      ? await (options.environment as () => unknown)()
      : options.environment;
  if (env && typeof env === "object" && "agents" in env) {
    return (env as { agents: string }).agents;
  }
  throw new Error("[AgentSDK] Could not resolve agents base URL from CortiClient");
}

async function sendJson<T>(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
  headers: Record<string, string>,
  label: string
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `[AgentSDK] ${label} failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`
    );
  }
  return (await res.json()) as T;
}

/** POST /agents. `ephemeral` is extracted from the body and sent as a query
 *  param to match SDK semantics. */
export async function createAgent(
  client: CortiClient,
  body: Corti.AgentsCreateAgent,
  authOverride?: FetchAgentsAuthConfig
): Promise<Corti.AgentsAgent> {
  const { baseUrl, headers } = authOverride
    ? await resolveFromAuthConfig(authOverride)
    : await resolveFromClient(client);

  const { ephemeral, ...rest } = body;
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/agents`);
  if (ephemeral !== undefined) url.searchParams.set("ephemeral", String(ephemeral));

  return sendJson<Corti.AgentsAgent>(url.toString(), "POST", rest, headers, "createAgent");
}

/** PATCH /agents/{id}. */
export async function updateAgent(
  client: CortiClient,
  id: string,
  body: Corti.AgentsUpdateAgent,
  authOverride?: FetchAgentsAuthConfig
): Promise<Corti.AgentsAgent> {
  const { baseUrl, headers } = authOverride
    ? await resolveFromAuthConfig(authOverride)
    : await resolveFromClient(client);

  const url = `${baseUrl.replace(/\/$/, "")}/agents/${encodeURIComponent(id)}`;
  return sendJson<Corti.AgentsAgent>(url, "PATCH", body, headers, "updateAgent");
}
