import type { CortiClient } from "./client.js";
import type { FeedbackCreateRequest, FeedbackResponse, FeedbackListResponse } from "./types.js";

export class FeedbackResource {
  constructor(private readonly _client: CortiClient) {}

  async create(
    contextId: string,
    taskId: string,
    body: FeedbackCreateRequest,
  ): Promise<FeedbackResponse> {
    return this._client.sdk.agentic.contexts.tasks.feedback.create(
      contextId,
      taskId,
      body,
    );
  }

  async list(
    contextId: string,
    taskId: string,
  ): Promise<FeedbackListResponse> {
    return this._client.sdk.agentic.contexts.tasks.feedback.list(
      contextId,
      taskId,
    );
  }

  async delete(
    contextId: string,
    taskId: string,
    feedbackId: string,
  ): Promise<void> {
    await this._client.sdk.agentic.contexts.tasks.feedback.delete(
      contextId,
      taskId,
      feedbackId,
    );
  }
}
