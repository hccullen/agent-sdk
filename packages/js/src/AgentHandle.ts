import type { Corti, CortiClient } from "@corti/sdk";
import { AgentContext } from "./AgentContext";
import { MessageResponse } from "./MessageResponse";
import { connectorsToExperts } from "./connectors";
import type { CredentialStore, Part, UpdateAgentOptions } from "./types";

/**
 * A handle to a Corti agent that enriches the raw SDK agent with
 * conversation-management helpers.
 *
 * Returned by `AgentsClient.create()` (and the patched `client.agents.create()`).
 */
export class AgentHandle {
  constructor(
    private readonly _agent: Corti.AgentsAgent,
    private readonly client: CortiClient
  ) {}

  get id(): string {
    return this._agent.id;
  }

  get name(): string {
    return this._agent.name;
  }

  get description(): string {
    return this._agent.description;
  }

  get systemPrompt(): string {
    return this._agent.systemPrompt;
  }

  /** The underlying raw agent object from the Corti SDK. */
  get raw(): Corti.AgentsAgent {
    return this._agent;
  }

  /**
   * Create a new conversation context with this agent.
   *
   * The context is lazy — no network call is made until the first
   * `sendMessage()` call, at which point the server creates the thread
   * and returns a `contextId` that is transparently managed for you.
   *
   * @example
   * ```ts
   * const ctx = myAgent.createContext();
   * const r1 = await ctx.sendMessage([{ kind: "text", text: "Hello" }]);
   * const r2 = await ctx.sendMessage([{ kind: "text", text: "And now?" }]);
   * ```
   */
  /**
   * Create a new conversation context with this agent.
   *
   * @param opts.credentials  Service credentials forwarded automatically if the
   *   agent returns `auth-required`.
   */
  createContext(opts?: { credentials?: CredentialStore }): AgentContext {
    return new AgentContext(this._agent.id, this.client, undefined, opts?.credentials);
  }

  /**
   * One-shot invoke: create a fresh context, send the message, return the response.
   *
   * @example
   * ```ts
   * const r1 = await agentA.run("Classify this note.");
   * const r2 = await agentB.run(r1.text ?? "");
   *
   * // With credentials:
   * const r = await agent.run("Query", { credentials: { "my-mcp": "tok_123" } });
   * ```
   */
  async run(
    input: string | Part[],
    opts?: { contextId?: string; credentials?: CredentialStore }
  ): Promise<MessageResponse> {
    const ctx = new AgentContext(
      this._agent.id,
      this.client,
      opts?.contextId,
      opts?.credentials
    );
    return typeof input === "string" ? ctx.sendText(input) : ctx.sendMessage(input);
  }

  /**
   * Partially update this agent and return a new handle reflecting the changes.
   *
   * Only the fields you provide are sent; everything else keeps its current value.
   * Passing `connectors` **replaces** the full connector set for the agent.
   *
   * @example
   * ```ts
   * const updated = await agent.update({
   *   systemPrompt: "You are now more concise.",
   *   connectors: [{ type: "mcp", mcpUrl: "https://mcp.corti.ai" }],
   * });
   * ```
   */
  async update(opts: UpdateAgentOptions): Promise<AgentHandle> {
    // The 0.3.0-agents SDK update() expects a full AgentsAgent object;
    // we merge current state with the caller's partial overrides.
    const experts =
      opts.connectors !== undefined
        ? // Cast: connectorsToExperts returns AgentsCreateAgentExpertsItem[] which
          // the REST API accepts even though the TS type says AgentsAgentExpertsItem[]
          (connectorsToExperts(opts.connectors) as unknown as Corti.AgentsAgentExpertsItem[])
        : this._agent.experts;

    const updated = await this.client.agents.update(this._agent.id, {
      id: this._agent.id,
      name: opts.name ?? this._agent.name,
      description: opts.description ?? this._agent.description,
      systemPrompt: opts.systemPrompt ?? this._agent.systemPrompt,
      ...(experts !== undefined && { experts }),
    });

    return new AgentHandle(updated, this.client);
  }

  /**
   * Fetch the latest state of this agent from the API.
   * Useful after updates made via `client.agents.update()`.
   */
  async refresh(): Promise<AgentHandle> {
    const updated = await this.client.agents.get(this._agent.id);
    const agent = "id" in updated ? (updated as Corti.AgentsAgent) : this._agent;
    return new AgentHandle(agent, this.client);
  }

  /** Delete this agent. After this call the handle should no longer be used. */
  async delete(): Promise<void> {
    await this.client.agents.delete(this._agent.id);
  }
}
