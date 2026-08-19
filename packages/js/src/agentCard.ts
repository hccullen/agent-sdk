import type { CortiClient } from "./client.js";
import type { AgentCard } from "./types.js";

export class AgentCardResource {
  constructor(private readonly _client: CortiClient) {}

  async get(agentId: string): Promise<AgentCard> {
    return this._client.sdk.agentic.agents.card(agentId);
  }
}
