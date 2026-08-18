import type { CortiClient } from "./client.js";
import { AgentContext } from "./context.js";
import type { SendMessageOptions } from "./context.js";
import type { AbortOptions } from "./streaming.js";
import type { MessageResponse } from "./response.js";
import type {
  Agent,
  AgentPatch,
  Part,
  StreamResponse,
} from "./types.js";

export class AgentHandle {
  private _agent: Agent;

  constructor(
    agent: Agent,
    private readonly _client: CortiClient,
  ) {
    this._agent = agent;
  }

  get id(): string {
    return this._agent.id;
  }

  get name(): string {
    return this._agent.name;
  }

  get description(): string | undefined | null {
    return this._agent.description;
  }

  get systemPrompt(): string | undefined | null {
    return this._agent.systemPrompt;
  }

  get model(): string | undefined | null {
    return this._agent.model;
  }

  get visibility(): string {
    return this._agent.visibility;
  }

  get lifecycle(): string {
    return this._agent.lifecycle;
  }

  get connectors(): import("@corti/sdk").Corti.CommonConnectorResponse[] {
    return this._agent.connectors;
  }

  get labels(): Record<string, string> | undefined {
    return this._agent.labels;
  }

  get raw(): Agent {
    return this._agent;
  }

  createContext(): AgentContext {
    return new AgentContext(this._client, this._agent.id);
  }

  getContext(contextId: string): AgentContext {
    return new AgentContext(this._client, this._agent.id, contextId);
  }

  async run(
    input: string | Part[],
    opts?: SendMessageOptions,
  ): Promise<MessageResponse> {
    const ctx = new AgentContext(this._client, this._agent.id);
    return typeof input === "string"
      ? ctx.sendText(input, opts)
      : ctx.sendMessage(input, opts);
  }

  async *stream(
    input: string | Part[],
    opts?: AbortOptions,
  ): AsyncGenerator<StreamResponse> {
    const ctx = new AgentContext(this._client, this._agent.id);
    const parts: Part[] =
      typeof input === "string" ? [{ text: input }] : input;
    yield* ctx.streamMessage(parts, opts);
  }

  async update(patch: AgentPatch): Promise<AgentHandle> {
    const updated = await this._client.sdk.agentic.agents.update(this._agent.id, patch);
    return new AgentHandle(updated, this._client);
  }

  async refresh(): Promise<AgentHandle> {
    const agent = await this._client.sdk.agentic.agents.get(this._agent.id);
    return new AgentHandle(agent, this._client);
  }

  async delete(): Promise<void> {
    await this._client.sdk.agentic.agents.delete(this._agent.id);
  }
}
