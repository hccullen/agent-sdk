import type { CortiClient } from "./client.js";
import { throwFromFetchError } from "./errors.js";
import type { FeedbackCreateRequest, FeedbackResponse } from "./types.js";

export class FeedbackResource {
  constructor(private readonly _client: CortiClient) {}

  async create(
    contextId: string,
    taskId: string,
    body: FeedbackCreateRequest,
  ): Promise<FeedbackResponse> {
    const { data, error, response } = await this._client.raw.POST(
      "/v2/agentic/contexts/{contextId}/tasks/{taskId}/feedback",
      {
        params: { path: { contextId, taskId } },
        body,
      },
    );
    if (error || !response.ok) throwFromFetchError(error, response, false);
    return data!;
  }
}
