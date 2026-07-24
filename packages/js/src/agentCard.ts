import type { CortiClient } from "./client.js";
import { throwFromResponse } from "./errors.js";
import type { AgentCard } from "./types.js";

export class AgentCardResource {
  constructor(private readonly _client: CortiClient) {}

  async get(agentId: string): Promise<AgentCard> {
    const { data, error, response } = await this._client.raw.GET(
      "/v2/agentic/agents/{agentId}/.well-known/agent-card.json",
      { params: { path: { agentId } } },
    );
    if (error || !response.ok) await throwFromResponse(response, false);
    return data!;
  }
}
