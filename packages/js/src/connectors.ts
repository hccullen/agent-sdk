import type { Corti } from "@corti/sdk";

export type RegistryConnectorCreate = Corti.CommonRegistryConnectorCreate;
export type McpConnectorCreate = Corti.CommonMcpConnectorCreate;
export type AgentConnectorCreate = Corti.CommonAgentConnectorCreate;
export type A2AConnectorCreate = Corti.CommonA2AConnectorCreate;
export type SchemaConnectorCreate = Corti.CommonSchemaConnectorCreate;
export type ConnectorCreateRequest = Corti.CommonConnectorCreateRequest;
export type ConnectorAuth = Corti.CommonConnectorAuth;

export const connectors = {
  registry(
    name: string,
    opts?: { enabled?: boolean; config?: Record<string, unknown> },
  ): RegistryConnectorCreate {
    return {
      type: "registry",
      name,
      ...(opts?.enabled !== undefined && { enabled: opts.enabled }),
      ...(opts?.config !== undefined && { config: opts.config }),
    };
  },

  mcp(opts: {
    name: string;
    url: string;
    enabled?: boolean;
    auth?: ConnectorAuth;
  }): McpConnectorCreate {
    return {
      type: "mcp",
      name: opts.name,
      url: opts.url,
      ...(opts.enabled !== undefined && { enabled: opts.enabled }),
      ...(opts.auth !== undefined && { auth: opts.auth }),
    };
  },

  agent(agentId: string, opts?: { enabled?: boolean }): AgentConnectorCreate {
    return {
      type: "agent",
      agentId,
      ...(opts?.enabled !== undefined && { enabled: opts.enabled }),
    };
  },

  a2a(
    url: string,
    opts?: { name?: string; enabled?: boolean },
  ): A2AConnectorCreate {
    return {
      type: "a2a",
      url,
      ...(opts?.name !== undefined && { name: opts.name }),
      ...(opts?.enabled !== undefined && { enabled: opts.enabled }),
    };
  },

  schema(opts: {
    name: string;
    schema: Record<string, unknown>;
    description?: string;
    transition?: "complete" | "input_required";
    enabled?: boolean;
  }): SchemaConnectorCreate {
    return {
      type: "schema",
      name: opts.name,
      schema: opts.schema,
      ...(opts.description !== undefined && { description: opts.description }),
      ...(opts.transition !== undefined && { transition: opts.transition }),
      ...(opts.enabled !== undefined && { enabled: opts.enabled }),
    };
  },
};

export const auth = {
  none(): ConnectorAuth {
    return { type: "none" };
  },
  bearer(): ConnectorAuth {
    return { type: "bearer" };
  },
  apiKey(ref?: string): ConnectorAuth {
    return { type: "apiKey", ...(ref !== undefined && { ref }) };
  },
  oauth2(opts: { scope?: string; redirectUrl?: string; ref?: string }): ConnectorAuth {
    return {
      type: "oauth2",
      ...(opts.scope !== undefined && { scope: opts.scope }),
      ...(opts.redirectUrl !== undefined && { redirectUrl: opts.redirectUrl }),
      ...(opts.ref !== undefined && { ref: opts.ref }),
    };
  },
};
