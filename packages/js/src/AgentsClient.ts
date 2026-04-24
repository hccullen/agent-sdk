import type { Corti, CortiClient } from "@corti/sdk";
import { AgentHandle } from "./AgentHandle";
import { connectorsToRequestFields } from "./connectors";
import type { CreateAgentOptions } from "./types";

// ── Internal helpers ─────────────────────────────────────────────────────────

function hasEnhancedFields(
  req: CreateAgentOptions | Corti.AgentsCreateAgent
): req is CreateAgentOptions {
  return "connectors" in req || "lifecycle" in req;
}

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

export class AgentsClient {
  private readonly client: CortiClient;

  private static readonly _PATCH_KEY = "__corti_agent_sdk_patched__";

  constructor(client: CortiClient) {
    this.client = client;
    this._patchClientAgents();
  }

  private _patchClientAgents(): void {
    const agents = this.client.agents as unknown as Record<string, unknown>;
    if (agents[AgentsClient._PATCH_KEY]) return;
    agents[AgentsClient._PATCH_KEY] = true;

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const originalCreate = (agents["create"] as (req: Corti.AgentsCreateAgent) => Promise<Corti.AgentsAgent>).bind(agents);

    agents["create"] = async (
      request: CreateAgentOptions | Corti.AgentsCreateAgent,
      _options?: unknown
    ): Promise<AgentHandle> => {
      const sdkRequest = hasEnhancedFields(request)
        ? toSdkRequest(request)
        : (request as Corti.AgentsCreateAgent);
      const agent = await originalCreate(sdkRequest);
      return new AgentHandle(agent as Corti.AgentsAgent, self.client);
    };
  }

  // ── Typed entry points ─────────────────────────────────────────────────────

  /**
   * Create a new agent and return a typed `AgentHandle`.
   *
   * This is the recommended entry point for TypeScript consumers.
   */
  async create(options: CreateAgentOptions): Promise<AgentHandle> {
    // Delegates to the patched client.agents.create so the implementation
    // lives in one place.
    return (
      this.client.agents as unknown as {
        create(r: CreateAgentOptions): Promise<AgentHandle>;
      }
    ).create(options);
  }

  async get(agentId: string): Promise<AgentHandle> {
    const agent = await this.client.agents.get(agentId);
    return new AgentHandle(agent as Corti.AgentsAgent, this.client);
  }

  async list(): Promise<AgentHandle[]> {
    const agents = await this.client.agents.list();
    return agents
      .filter((a): a is Corti.AgentsAgent => !("type" in a))
      .map((a) => new AgentHandle(a, this.client));
  }

  wrap(agent: Corti.AgentsAgent): AgentHandle {
    return new AgentHandle(agent, this.client);
  }
}
