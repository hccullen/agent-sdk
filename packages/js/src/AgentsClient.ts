import type { Corti, CortiClient } from "@corti/sdk";
import { AgentHandle } from "./AgentHandle";
import { connectorsToExperts } from "./connectors";
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
    ...(opts.connectors?.length
      ? { experts: connectorsToExperts(opts.connectors) }
      : {}),
  };
}

// ── AgentsClient ─────────────────────────────────────────────────────────────

/**
 * A developer-friendly wrapper around `client.agents` that adds:
 *
 * - A `connectors` API to attach MCPs, registry experts, and other agents
 *   without manually building `experts` arrays.
 * - `lifecycle` shorthand (`"ephemeral"` | `"persistent"`) instead of the raw
 *   `ephemeral` boolean.
 * - Rich `AgentHandle` return values with `createContext()` for conversation
 *   management.
 *
 * **Initialisation patches `client.agents.create`** so that it also accepts
 * the extended options and returns `AgentHandle` objects at runtime.
 * TypeScript consumers get full type-safety through `agentClient.create()`.
 *
 * @example
 * ```ts
 * import { CortiClient } from "@corti/sdk";
 * import { AgentsClient, connectors } from "@corti/agent-sdk";
 *
 * const client = new CortiClient({ ... });
 * const agentClient = new AgentsClient(client);
 *
 * const subAgent = await agentClient.create({
 *   name: "my-sub-agent",
 *   description: "Handles weather queries",
 *   lifecycle: "persistent",
 *   connectors: [
 *     { type: "mcp", mcpUrl: "https://mcp.corti.ai" },
 *     { type: "registry", name: "@corti/medical-coding" },
 *   ],
 * });
 *
 * const ctx = subAgent.createContext();
 * const response = await ctx.sendText("What is the ICD-10 code for hypertension?");
 * ```
 */
export class AgentsClient {
  private readonly client: CortiClient;

  constructor(client: CortiClient) {
    this.client = client;
    this._patchClientAgents();
  }

  /**
   * Monkey-patches `client.agents.create` so that:
   *  1. It accepts `CreateAgentOptions` (with `connectors` / `lifecycle`) in
   *     addition to the raw `AgentsCreateAgent` shape.
   *  2. It always returns an `AgentHandle` at runtime.
   *
   * TypeScript types on `client.agents.create` remain unchanged; use
   * `agentClient.create()` when you need the typed `AgentHandle` return.
   */
  private _patchClientAgents(): void {
    const agents = this.client.agents;
    const originalCreate = agents.create.bind(agents);

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    // Cast to any to allow return-type widening.
    (agents as unknown as Record<string, unknown>)["create"] = async (
      request: CreateAgentOptions | Corti.AgentsCreateAgent,
      options?: unknown
    ): Promise<AgentHandle> => {
      const sdkRequest = hasEnhancedFields(request)
        ? toSdkRequest(request)
        : (request as Corti.AgentsCreateAgent);

      const agent = await originalCreate(
        sdkRequest,
        options as Parameters<typeof originalCreate>[1]
      );
      return new AgentHandle(agent, self.client);
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

  /**
   * Fetch an existing agent by ID and return an `AgentHandle`.
   */
  async get(agentId: string): Promise<AgentHandle> {
    const agent = await this.client.agents.get(agentId);
    const resolved = "id" in agent ? (agent as Corti.AgentsAgent) : agent;
    return new AgentHandle(resolved as Corti.AgentsAgent, this.client);
  }

  /**
   * List all agents and return `AgentHandle` wrappers.
   */
  async list(): Promise<AgentHandle[]> {
    const agents = await this.client.agents.list();
    return agents
      .filter((a): a is Corti.AgentsAgent => "id" in a)
      .map((a) => new AgentHandle(a, this.client));
  }

  /**
   * Wrap an existing raw `AgentsAgent` in an `AgentHandle` without a network
   * call — useful when you already have an agent object from `client.agents.*`.
   */
  wrap(agent: Corti.AgentsAgent): AgentHandle {
    return new AgentHandle(agent, this.client);
  }
}
