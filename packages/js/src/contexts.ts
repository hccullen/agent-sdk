import type { CortiClient } from "./client.js";
import type {
  ContextDetailResponse,
  ContextListResponse,
  ContextTraceResponse,
  TaskListResponse,
  Task,
  Artifact,
} from "./types.js";

export interface ListContextsParams {
  agentId?: string;
  from?: Date;
  to?: Date;
  pageSize?: number;
  pageToken?: string;
}

export class ContextsResource {
  constructor(private readonly _client: CortiClient) {}

  async list(params?: ListContextsParams): Promise<ContextListResponse> {
    const page = await this._client.sdk.agentic.contexts.list(params);
    return page.response;
  }

  async get(
    contextId: string,
    historyLength?: number,
  ): Promise<ContextDetailResponse> {
    return this._client.sdk.agentic.contexts.get(
      contextId,
      historyLength !== undefined ? { historyLength } : undefined,
    );
  }

  async delete(contextId: string): Promise<void> {
    await this._client.sdk.agentic.contexts.delete(contextId);
  }

  async getTrace(
    contextId: string,
    params?: { pageSize?: number; pageToken?: string },
  ): Promise<ContextTraceResponse> {
    const page = await this._client.sdk.agentic.contexts.trace(contextId, params);
    return page.response;
  }

  async listTasks(
    contextId: string,
    params?: { pageSize?: number; pageToken?: string },
  ): Promise<TaskListResponse> {
    const page = await this._client.sdk.agentic.contexts.tasks.list(contextId, params);
    return page.response;
  }

  async getTask(contextId: string, taskId: string): Promise<Task> {
    return this._client.sdk.agentic.contexts.tasks.get(contextId, taskId);
  }

  async getArtifact(
    contextId: string,
    taskId: string,
    artifactId: string,
  ): Promise<Artifact> {
    return this._client.sdk.agentic.contexts.tasks.artifacts.get(
      contextId,
      taskId,
      artifactId,
    );
  }
}
