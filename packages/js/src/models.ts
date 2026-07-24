import type { CortiClient } from "./client.js";
import { throwFromResponse } from "./errors.js";
import type { ModelResponse, ModelsListResponse } from "./types.js";

export class ModelsResource {
  constructor(private readonly _client: CortiClient) {}

  async list(params?: {
    pageSize?: number;
    pageOffset?: number;
  }): Promise<ModelsListResponse> {
    const { data, error, response } = await this._client.raw.GET(
      "/v2/agentic/models",
      { params: { query: params } },
    );
    if (error || !response.ok) await throwFromResponse(response, false);
    return data!;
  }

  async get(modelId: string): Promise<ModelResponse> {
    const { data, error, response } = await this._client.raw.GET(
      "/v2/agentic/models/{modelId}",
      { params: { path: { modelId } } },
    );
    if (error || !response.ok) await throwFromResponse(response, false);
    return data!;
  }
}
