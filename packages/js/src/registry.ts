import type { CortiClient } from "./client.js";
import { throwFromResponse } from "./errors.js";
import type {
  RegistryConnectorListResponse,
  RegistryConnector,
} from "./types.js";

export class RegistryResource {
  constructor(private readonly _client: CortiClient) {}

  async list(params?: {
    q?: string;
    pageSize?: number;
    pageOffset?: number;
  }): Promise<RegistryConnectorListResponse> {
    const { data, error, response } = await this._client.raw.GET(
      "/v2/agentic/registry/connectors",
      { params: { query: params } },
    );
    if (error || !response.ok) await throwFromResponse(response, false);
    return data!;
  }

  async get(connectorId: string): Promise<RegistryConnector> {
    const { data, error, response } = await this._client.raw.GET(
      "/v2/agentic/registry/connectors/{connectorId}",
      { params: { path: { connectorId } } },
    );
    if (error || !response.ok) await throwFromResponse(response, false);
    return data!;
  }
}
