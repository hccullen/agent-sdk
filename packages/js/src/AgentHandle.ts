import type { Corti, CortiClient } from "@corti/sdk";
import { AgentContext } from "./AgentContext";
import { MessageResponse } from "./MessageResponse";
import { connectorsToRequestFields } from "./connectors";
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
    opts?: { contextId?: string; credentials?: CredentialStore; timeoutInSeconds?: number }
  ): Promise<MessageResponse> {
    const ctx = new AgentContext(
      this._agent.id,
      this.client,
      opts?.contextId,
      opts?.credentials
    );
    const sendOpts =
      opts?.timeoutInSeconds !== undefined
        ? { timeoutInSeconds: opts.timeoutInSeconds }
        : undefined;
    return typeof input === "string" ? ctx.sendText(input, sendOpts) : ctx.sendMessage(input, sendOpts);
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
    // When `connectors` is provided, semantics is "replace entirely" — we must
    // send both `experts` and `mcpServers` so either side clears if it's empty.
    const connectorFields = opts.connectors !== undefined
      ? (() => {
          const f = connectorsToRequestFields(opts.connectors);
          return { experts: f.experts ?? [], mcpServers: f.mcpServers ?? [] };
        })()
      : undefined;

    const body: Corti.AgentsUpdateAgent = {
      ...(opts.name !== undefined && { name: opts.name }),
      ...(opts.description !== undefined && { description: opts.description }),
      ...(opts.systemPrompt !== undefined && { systemPrompt: opts.systemPrompt }),
      ...(connectorFields ?? {}),
    };

    const updated = await this.client.agents.update(this._agent.id, body);
    return new AgentHandle(updated as Corti.AgentsAgent, this.client);
  }

  /**
   * Fetch the latest state of this agent from the API.
   * Useful after updates made via `client.agents.update()`.
   */
  async refresh(): Promise<AgentHandle> {
    const updated = await this.client.agents.get(this._agent.id);
    const agent = !("type" in updated) ? (updated as Corti.AgentsAgent) : this._agent;
    return new AgentHandle(agent, this.client);
  }

  /** Delete this agent. After this call the handle should no longer be used. */
  async delete(): Promise<void> {
    await this.client.agents.delete(this._agent.id);
  }
}
