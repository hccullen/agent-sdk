import type { CortiClient } from "./client.js";
import { throwFromResponse } from "./errors.js";
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
  from?: string;
  to?: string;
  pageSize?: number;
  pageOffset?: number;
}

export class ContextsResource {
  constructor(private readonly _client: CortiClient) {}

  async list(params?: ListContextsParams): Promise<ContextListResponse> {
    const { data, error, response } = await this._client.raw.GET(
      "/v2/agentic/contexts",
      { params: { query: params } },
    );
    if (error || !response.ok) await throwFromResponse(response, false);
    return data!;
  }

  async get(
    contextId: string,
    historyLength?: number,
  ): Promise<ContextDetailResponse> {
    const { data, error, response } = await this._client.raw.GET(
      "/v2/agentic/contexts/{contextId}",
      {
        params: {
          path: { contextId },
          query: { historyLength },
        },
      },
    );
    if (error || !response.ok) await throwFromResponse(response, false);
    return data!;
  }

  async delete(contextId: string): Promise<void> {
    const { response } = await this._client.raw.DELETE(
      "/v2/agentic/contexts/{contextId}",
      { params: { path: { contextId } } },
    );
    if (!response.ok) await throwFromResponse(response, false);
  }

  async getTrace(
    contextId: string,
    params?: { pageSize?: number; pageOffset?: number },
  ): Promise<ContextTraceResponse> {
    const { data, error, response } = await this._client.raw.GET(
      "/v2/agentic/contexts/{contextId}/trace",
      {
        params: {
          path: { contextId },
          query: params,
        },
      },
    );
    if (error || !response.ok) await throwFromResponse(response, false);
    return data!;
  }

  async listTasks(
    contextId: string,
    params?: { pageSize?: number; pageOffset?: number },
  ): Promise<TaskListResponse> {
    const { data, error, response } = await this._client.raw.GET(
      "/v2/agentic/contexts/{contextId}/tasks",
      {
        params: {
          path: { contextId },
          query: params,
        },
      },
    );
    if (error || !response.ok) await throwFromResponse(response, false);
    return data!;
  }

  async getTask(contextId: string, taskId: string): Promise<Task> {
    const { data, error, response } = await this._client.raw.GET(
      "/v2/agentic/contexts/{contextId}/tasks/{taskId}",
      {
        params: { path: { contextId, taskId } },
      },
    );
    if (error || !response.ok) await throwFromResponse(response, false);
    return data!;
  }

  async getArtifact(
    contextId: string,
    taskId: string,
    artifactId: string,
  ): Promise<Artifact> {
    const { data, error, response } = await this._client.raw.GET(
      "/v2/agentic/contexts/{contextId}/tasks/{taskId}/artifacts/{artifactId}",
      {
        params: { path: { contextId, taskId, artifactId } },
      },
    );
    if (error || !response.ok) await throwFromResponse(response, false);
    return data!;
  }
}
