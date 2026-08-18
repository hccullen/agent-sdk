import type { CortiClient } from "./client.js";
import type {
  RegistryConnectorListResponse,
  RegistryConnector,
} from "./types.js";

export class RegistryResource {
  constructor(private readonly _client: CortiClient) {}

  async list(params?: {
    q?: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<RegistryConnectorListResponse> {
    const page = await this._client.sdk.agentic.registry.connectors.list(params);
    return page.response;
  }

  async get(connectorId: string): Promise<RegistryConnector> {
    return this._client.sdk.agentic.registry.connectors.get(connectorId);
  }
}
