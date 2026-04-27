import type { Corti, CortiClient } from "@corti/sdk";
import { AgentContext } from "./AgentContext.js";
import { MessageResponse } from "./MessageResponse.js";
import { connectorsToRequestFields } from "./connectors.js";
import type { CredentialStore, Part, UpdateAgentOptions } from "./types.js";

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
   * Create a new conversation thread with this agent.
   *
   * The context is lazy — no network call is made until the first message.
   * The server assigns a `contextId` on the first response; the SDK tracks it
   * automatically. You should never need to manage context IDs yourself.
   *
   * @param opts.credentials  Service credentials forwarded automatically if the
   *   agent returns `auth-required`.
   *
   * @example
   * ```ts
   * const ctx = myAgent.createContext();
   * const r1 = await ctx.sendText("Hello");
   * const r2 = await ctx.sendText("And now?");  // same thread
   * ```
   */
  createContext(opts?: { credentials?: CredentialStore }): AgentContext {
    return new AgentContext(this._agent.id, this.client, undefined, opts?.credentials);
  }

  /**
   * Resume an existing conversation thread by its context ID.
   *
   * Use this when you have persisted a `contextId` from a previous session and
   * want to continue that thread. In most applications you won't need this —
   * keep the `AgentContext` object in memory across turns instead.
   *
   * @param contextId  The thread ID to resume (from a prior `ctx.id`).
   * @param opts.credentials  Service credentials forwarded automatically if the
   *   agent returns `auth-required`.
   *
   * @example
   * ```ts
   * // Session 1
   * const ctx = agent.createContext();
   * await ctx.sendText("Hello");
   * const savedId = ctx.id!;   // persist this somewhere
   *
   * // Session 2 — resume the same thread
   * const ctx2 = agent.getContext(savedId);
   * await ctx2.sendText("Pick up where we left off.");
   * ```
   */
  getContext(contextId: string, opts?: { credentials?: CredentialStore }): AgentContext {
    return new AgentContext(this._agent.id, this.client, contextId, opts?.credentials);
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
    opts?: { credentials?: CredentialStore; timeoutInSeconds?: number }
  ): Promise<MessageResponse> {
    const ctx = new AgentContext(
      this._agent.id,
      this.client,
      undefined,
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
