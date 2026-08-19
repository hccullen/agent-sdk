import type { CortiClient } from "./client.js";
import type { UsageReportResponse, UsageGranularity } from "./types.js";

export class UsageResource {
  constructor(private readonly _client: CortiClient) {}

  async get(
    agentId: string,
    params?: {
      from?: Date;
      to?: Date;
      granularity?: UsageGranularity;
    },
  ): Promise<UsageReportResponse> {
    return this._client.sdk.agentic.agents.usage(agentId, params);
  }
}
