import type { Corti, CortiClient } from "@corti/sdk";
import { AgentContext } from "./AgentContext";

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
  createContext(): AgentContext {
    return new AgentContext(this._agent.id, this.client);
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
