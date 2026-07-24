import type { CortiClient } from "./client.js";
import { throwFromResponse } from "./errors.js";
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
  pageOffset?: number;
  visibility?: Visibility[];
  lifecycle?: Lifecycle;
  label?: string[];
  q?: string;
}

export class AgentsResource {
  constructor(private readonly _client: CortiClient) {}

  async create(body: AgentCreate): Promise<Agent> {
    const { data, error, response } = await this._client.raw.POST(
      "/v2/agentic/agents",
      { body },
    );
    if (error || !response.ok) {
      await throwFromResponse(response, false);
    }
    return data!;
  }

  async get(agentId: string): Promise<Agent> {
    const { data, error, response } = await this._client.raw.GET(
      "/v2/agentic/agents/{agentId}",
      { params: { path: { agentId } } },
    );
    if (error || !response.ok) {
      await throwFromResponse(response, false);
    }
    return data!;
  }

  async list(params?: ListAgentsParams): Promise<AgentListResponse> {
    const { data, error, response } = await this._client.raw.GET(
      "/v2/agentic/agents",
      { params: { query: params } },
    );
    if (error || !response.ok) {
      await throwFromResponse(response, false);
    }
    return data!;
  }

  async update(agentId: string, body: AgentPatch): Promise<Agent> {
    const { data, error, response } = await this._client.raw.PATCH(
      "/v2/agentic/agents/{agentId}",
      {
        params: { path: { agentId } },
        body,
        headers: { "Content-Type": "application/merge-patch+json" },
      },
    );
    if (error || !response.ok) {
      await throwFromResponse(response, false);
    }
    return data!;
  }

  async delete(agentId: string): Promise<void> {
    const { response } = await this._client.raw.DELETE(
      "/v2/agentic/agents/{agentId}",
      { params: { path: { agentId } } },
    );
    if (!response.ok) {
      await throwFromResponse(response, false);
    }
  }
}
