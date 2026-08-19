import type { CortiClient } from "./client.js";
import type {
  Agent,
  AgentCreate,
  AgentListResponse,
  AgentPatch,
  Visibility,
  Lifecycle,
} from "./types.js";

export interface ListAgentsParams {
  pageSize?: number;
  pageToken?: string;
  visibility?: Visibility[];
  lifecycle?: Lifecycle;
  label?: string[];
  q?: string;
}

export class AgentsResource {
  constructor(private readonly _client: CortiClient) {}

  async create(body: AgentCreate): Promise<Agent> {
    return this._client.sdk.agentic.agents.create(body);
  }

  async get(agentId: string): Promise<Agent> {
    return this._client.sdk.agentic.agents.get(agentId);
  }

  async list(params?: ListAgentsParams): Promise<AgentListResponse> {
    const page = await this._client.sdk.agentic.agents.list(params);
    return page.response;
  }

  async update(agentId: string, body: AgentPatch): Promise<Agent> {
    return this._client.sdk.agentic.agents.update(agentId, body);
  }

  async delete(agentId: string): Promise<void> {
    await this._client.sdk.agentic.agents.delete(agentId);
  }
}
