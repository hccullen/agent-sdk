import type { Corti, CortiClient } from "@corti/sdk";
import { AgentHandle } from "./AgentHandle.js";
import { connectorsToRequestFields } from "./connectors.js";
import type { CreateAgentOptions } from "./types.js";

// ── Internal helpers ─────────────────────────────────────────────────────────

function toSdkRequest(opts: CreateAgentOptions): Corti.AgentsCreateAgent {
  return {
    name: opts.name,
    description: opts.description,
    // Default lifecycle is ephemeral so agents are cleaned up automatically.
    // Pass lifecycle: "persistent" to keep an agent across sessions.
    ephemeral: opts.lifecycle !== "persistent",
    ...(opts.systemPrompt !== undefined && { systemPrompt: opts.systemPrompt }),
    ...(opts.connectors?.length ? connectorsToRequestFields(opts.connectors) : {}),
  };
}

// ── AgentsClient ─────────────────────────────────────────────────────────────

export interface AgentsClientOptions {
  /**
   * Override the agents API base URL (e.g. `"https://api.eu.corti.app"`).
   *
   * When omitted the SDK reads the URL from the `CortiClient`'s configuration.
   * Provide this if you are proxying requests or if URL auto-resolution fails.
   */
  agentsBaseUrl?: string;
}

export class AgentsClient {
  private readonly _client: CortiClient;
  private readonly _baseUrl: string | undefined;

  constructor(client: CortiClient, opts?: AgentsClientOptions) {
    this._client = client;
    this._baseUrl = opts?.agentsBaseUrl;
  }

  private _wrap(agent: Corti.AgentsAgent): AgentHandle {
    return new AgentHandle(agent, this._client, this._baseUrl);
  }

  // ── Typed entry points ─────────────────────────────────────────────────────

  /**
   * Create a new agent and return a typed `AgentHandle`.
   *
   * @example
   * ```ts
   * const agent = await agents.create({
   *   name: "my-agent",
   *   description: "Does X",
   *   systemPrompt: "You are …",
   * });
   * ```
   */
  async create(options: CreateAgentOptions): Promise<AgentHandle> {
    const raw = await this._client.agents.create(toSdkRequest(options));
    return this._wrap(raw as Corti.AgentsAgent);
  }

  async get(agentId: string): Promise<AgentHandle> {
    const raw = await this._client.agents.get(agentId);
    return this._wrap(raw as Corti.AgentsAgent);
  }

  async list(): Promise<AgentHandle[]> {
    const agents = await this._client.agents.list();
    // The SDK list response may include typed system entries (e.g. pagination
    // cursors or sentinel objects that carry a `type` discriminant).  Only
    // plain AgentsAgent objects — which have no top-level `type` field — are
    // user-created agents; the rest are filtered out.
    return agents
      .filter((a): a is Corti.AgentsAgent => !("type" in a))
      .map((a) => this._wrap(a));
  }

  /** Wrap a raw `Corti.AgentsAgent` you already hold into an `AgentHandle`. */
  wrap(agent: Corti.AgentsAgent): AgentHandle {
    return this._wrap(agent);
  }
}
