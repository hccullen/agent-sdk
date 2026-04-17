import type { Corti } from "@corti/sdk";

// ── Lifecycle ────────────────────────────────────────────────────────────────

/** Controls whether an agent persists or is cleaned up automatically. */
export type Lifecycle = "ephemeral" | "persistent";

// ── Connector definitions ────────────────────────────────────────────────────

/** An MCP server attached directly to the agent. */
export interface McpConnector {
  type: "mcp";
  /** Full URL of the MCP server. */
  mcpUrl: string;
  /** Human-readable name; auto-derived from the URL if omitted. */
  name?: string;
  /** Transport protocol. Defaults to "sse". */
  transport?: "sse" | "streamable_http";
  /** Bearer token for "bearer" auth. Omit to inherit the agent's credentials. */
  token?: string;
}

/** A named expert from the Corti registry (e.g. "@corti/medical-coding"). */
export interface RegistryConnector {
  type: "registry";
  /** Registry package name, e.g. "@corti/medical-coding". */
  name: string;
  /** Additional instructions appended to the expert's default system prompt. */
  systemPrompt?: string;
}

/** Another Corti agent referenced by ID. */
export interface CortiAgentConnector {
  type: "cortiAgent";
  agentId: string;
}

/** An agent reachable via the A2A protocol (not yet supported). */
export interface A2aConnector {
  type: "a2a";
  a2aUrl: string;
}

export type ConnectorDef =
  | McpConnector
  | RegistryConnector
  | CortiAgentConnector
  | A2aConnector;

// ── Agent creation options ───────────────────────────────────────────────────

export interface UpdateAgentOptions {
  name?: string;
  description?: string;
  systemPrompt?: string;
  /** Replace the agent's connectors entirely. Omit to leave connectors unchanged. */
  connectors?: ConnectorDef[];
}

export interface CreateAgentOptions {
  /** Slug-like name, unique within the tenant. */
  name: string;
  description: string;
  systemPrompt?: string;
  /**
   * "ephemeral" (default) – agent is auto-deleted periodically and not listed.
   * "persistent"          – agent persists and appears in agent listings.
   */
  lifecycle?: Lifecycle;
  /** MCPs, registry experts, and agent references to attach to this agent. */
  connectors?: ConnectorDef[];
}

// ── Re-exports of SDK types used at the boundary ────────────────────────────

export type Part = Corti.AgentsPart;
export type TextPart = Corti.AgentsTextPart;
export type StreamEvent = Corti.AgentsMessageStreamResponse;
