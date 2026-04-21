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
 * create/update: fetch a short-lived access token via `CortiAuth.getToken`,
 * then issue the POST/PATCH ourselves. Everything else (message send,
 * contexts, etc.) keeps using the SDK.
 *
 * When the SDK is fixed, delete this file and restore the SDK path in
 * `AgentsClient.create` and `AgentHandle.update`.
 */

import { CortiAuth, type Corti } from "@corti/sdk";

export interface FetchAgentsAuthConfig {
  /**
   * Environment object (e.g. `CortiEnvironment.Eu`). Must expose an
   * `agents` origin — that's used both to exchange credentials for a
   * token and to construct the agents REST URLs.
   */
  environment: { agents: string } & Record<string, unknown>;
  tenantName: string;
  clientId: string;
  clientSecret: string;
}

async function getAccessToken(auth: FetchAgentsAuthConfig): Promise<string> {
  const client = new CortiAuth({
    // Cast: CortiAuth accepts string | CortiEnvironment — we require the
    // object form so we can also read `.agents` for the base URL below.
    environment: auth.environment as unknown as string,
    tenantName: auth.tenantName,
  });
  const token = await client.getToken({
    clientId: auth.clientId,
    clientSecret: auth.clientSecret,
  });
  return token.accessToken;
}

async function sendJson<T>(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
  token: string,
  label: string
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
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

export async function createAgentViaFetch(
  body: Corti.AgentsCreateAgent,
  auth: FetchAgentsAuthConfig
): Promise<Corti.AgentsAgent> {
  const token = await getAccessToken(auth);
  return sendJson<Corti.AgentsAgent>(
    `${auth.environment.agents}/agents`,
    "POST",
    body,
    token,
    "createAgentViaFetch"
  );
}

export async function updateAgentViaFetch(
  id: string,
  body: Corti.AgentsUpdateAgent,
  auth: FetchAgentsAuthConfig
): Promise<Corti.AgentsAgent> {
  const token = await getAccessToken(auth);
  return sendJson<Corti.AgentsAgent>(
    `${auth.environment.agents}/agents/${encodeURIComponent(id)}`,
    "PATCH",
    body,
    token,
    "updateAgentViaFetch"
  );
}
