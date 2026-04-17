import type { Corti } from "@corti/sdk";
import type {
  A2aConnector,
  ConnectorDef,
  CortiAgentConnector,
  McpConnector,
  RegistryConnector,
} from "./types";

// ── Connector factory helpers ────────────────────────────────────────────────

/**
 * Pre-built connector factories for common patterns.
 *
 * @example
 * ```ts
 * connectors.fromAgent({ agentId: subAgent.id })
 * connectors.mcp({ mcpUrl: "https://mcp.corti.ai" })
 * connectors.registry({ name: "@corti/medical-coding" })
 * ```
 */
export const connectors = {
  /** Reference another Corti agent as a sub-agent connector. */
  fromAgent: (opts: { agentId: string }): CortiAgentConnector => ({
    type: "cortiAgent",
    agentId: opts.agentId,
  }),

  /** Attach an MCP server directly to the agent. */
  mcp: (opts: {
    mcpUrl: string;
    name?: string;
    transport?: "sse" | "streamable_http";
    token?: string;
  }): McpConnector => ({
    type: "mcp",
    mcpUrl: opts.mcpUrl,
    ...(opts.name !== undefined && { name: opts.name }),
    ...(opts.transport !== undefined && { transport: opts.transport }),
    ...(opts.token !== undefined && { token: opts.token }),
  }),

  /** Reference a named expert from the Corti registry. */
  registry: (opts: { name: string; systemPrompt?: string }): RegistryConnector => ({
    type: "registry",
    name: opts.name,
    ...(opts.systemPrompt !== undefined && { systemPrompt: opts.systemPrompt }),
  }),

  /** Connect via the A2A protocol (not yet supported — reserved for future use). */
  a2a: (opts: { a2aUrl: string }): A2aConnector => ({
    type: "a2a",
    a2aUrl: opts.a2aUrl,
  }),
};

// ── Internal: map ConnectorDef[] → AgentsCreateAgentExpertsItem[] ────────────

function mcpUrlToName(url: string): string {
  const match = url.match(/^https?:\/\/([^/?#]+)/);
  const hostname = match?.[1] ?? "";
  return (
    hostname
      .replace(/\./g, "-")
      .replace(/[^a-z0-9-]/gi, "")
      .slice(0, 48) || "mcp-server"
  );
}

export function connectorsToExperts(
  defs: ConnectorDef[]
): Corti.AgentsCreateAgentExpertsItem[] {
  return defs.map((conn): Corti.AgentsCreateAgentExpertsItem => {
    switch (conn.type) {
      case "mcp": {
        const name = conn.name ?? mcpUrlToName(conn.mcpUrl);
        return {
          type: "new",
          name,
          description: `MCP server at ${conn.mcpUrl}`,
          mcpServers: [
            {
              name,
              transportType: conn.transport ?? "sse",
              authorizationType: conn.token ? "bearer" : "inherit",
              url: conn.mcpUrl,
              ...(conn.token !== undefined && { token: conn.token }),
            },
          ],
        };
      }
      case "registry":
        return {
          type: "reference",
          name: conn.name,
          ...(conn.systemPrompt !== undefined && { systemPrompt: conn.systemPrompt }),
        };
      case "cortiAgent":
        return {
          type: "reference",
          id: conn.agentId,
        };
      case "a2a":
        throw new Error(
          `[AgentSDK] A2A connectors are not yet supported (url: ${conn.a2aUrl}). ` +
            `Use type "mcp" with an MCP-compatible endpoint instead.`
        );
      default: {
        const exhaustive: never = conn;
        throw new Error(`[AgentSDK] Unknown connector type: ${(exhaustive as ConnectorDef).type}`);
      }
    }
  });
}
