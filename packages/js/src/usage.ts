import type { CortiClient } from "./client.js";
import { throwFromResponse } from "./errors.js";
import type { UsageReportResponse, UsageGranularity } from "./types.js";

export class UsageResource {
  constructor(private readonly _client: CortiClient) {}

  async get(
    agentId: string,
    params?: {
      from?: string;
      to?: string;
      granularity?: UsageGranularity;
    },
  ): Promise<UsageReportResponse> {
    const { data, error, response } = await this._client.raw.GET(
      "/v2/agentic/agents/{agentId}/usage",
      {
        params: {
          path: { agentId },
          query: params,
        },
      },
    );
    if (error || !response.ok) await throwFromResponse(response, false);
    return data!;
  }
}
