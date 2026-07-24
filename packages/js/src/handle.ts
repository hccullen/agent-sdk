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
import { throwFromFetchError } from "./errors.js";

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

  get connectors() {
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
    const { data, error, response } = await this._client.raw.PATCH(
      "/v2/agentic/agents/{agentId}",
      {
        params: { path: { agentId: this._agent.id } },
        body: patch,
        headers: { "Content-Type": "application/merge-patch+json" },
      },
    );
    if (error || !response.ok) {
      throwFromFetchError(error, response, false);
    }
    return new AgentHandle(data!, this._client);
  }

  async refresh(): Promise<AgentHandle> {
    const { data, error, response } = await this._client.raw.GET(
      "/v2/agentic/agents/{agentId}",
      { params: { path: { agentId: this._agent.id } } },
    );
    if (error || !response.ok) {
      throwFromFetchError(error, response, false);
    }
    return new AgentHandle(data!, this._client);
  }

  async delete(): Promise<void> {
    const { error, response } = await this._client.raw.DELETE(
      "/v2/agentic/agents/{agentId}",
      { params: { path: { agentId: this._agent.id } } },
    );
    if (error || !response.ok) {
      throwFromFetchError(error, response, false);
    }
  }
}
