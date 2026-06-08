import { describe, expect, it } from "vitest";
import { connectors, connectorsToRequestFields } from "../connectors.js";

describe("connectors factory", () => {
  it("fromAgent builds a cortiAgent connector", () => {
    const c = connectors.fromAgent({ agentId: "agent-99" });
    expect(c).toEqual({ type: "cortiAgent", agentId: "agent-99" });
  });

  it("mcp builds a minimal MCP connector", () => {
    const c = connectors.mcp({ mcpUrl: "https://mcp.example.com" });
    expect(c.type).toBe("mcp");
    expect(c.mcpUrl).toBe("https://mcp.example.com");
    expect(c.name).toBeUndefined();
    expect(c.authType).toBeUndefined();
  });

  it("mcp preserves all optional fields", () => {
    const c = connectors.mcp({
      mcpUrl: "https://mcp.example.com",
      name: "my-mcp",
      transport: "streamable_http",
      authType: "bearer",
      token: "tok_abc",
    });
    expect(c).toEqual({
      type: "mcp",
      mcpUrl: "https://mcp.example.com",
      name: "my-mcp",
      transport: "streamable_http",
      authType: "bearer",
      token: "tok_abc",
    });
  });

  it("registry builds a registry connector", () => {
    const c = connectors.registry({ name: "@corti/medical-coding" });
    expect(c).toEqual({ type: "registry", name: "@corti/medical-coding" });
  });

  it("registry preserves systemPrompt and config", () => {
    const c = connectors.registry({
      name: "@corti/foo",
      systemPrompt: "Be precise.",
      config: { lang: "da" },
    });
    expect(c.systemPrompt).toBe("Be precise.");
    expect(c.config).toEqual({ lang: "da" });
  });

  it("a2a builds an a2a connector", () => {
    const c = connectors.a2a({ a2aUrl: "https://a2a.example.com" });
    expect(c).toEqual({ type: "a2a", a2aUrl: "https://a2a.example.com" });
  });
});

describe("connectorsToRequestFields", () => {
  it("returns empty object for empty array", () => {
    expect(connectorsToRequestFields([])).toEqual({});
  });

  it("maps an MCP connector to mcpServers", () => {
    const { mcpServers, experts } = connectorsToRequestFields([
      connectors.mcp({ mcpUrl: "https://mcp.example.com", name: "my-mcp" }),
    ]);
    expect(mcpServers).toHaveLength(1);
    expect(mcpServers![0].name).toBe("my-mcp");
    expect(mcpServers![0].url).toBe("https://mcp.example.com");
    expect(mcpServers![0].authorizationType).toBe("none");
    expect(experts).toBeUndefined();
  });

  it("auto-derives MCP name from URL hostname", () => {
    const { mcpServers } = connectorsToRequestFields([
      connectors.mcp({ mcpUrl: "https://mcp.corti.ai/path" }),
    ]);
    expect(mcpServers![0].name).toBe("mcp-corti-ai");
  });

  it("sets authorizationType to bearer when token is provided without explicit authType", () => {
    const { mcpServers } = connectorsToRequestFields([
      connectors.mcp({ mcpUrl: "https://mcp.example.com", token: "tok_x" }),
    ]);
    expect(mcpServers![0].authorizationType).toBe("bearer");
    expect(mcpServers![0].token).toBe("tok_x");
  });

  it("maps a registry connector to experts", () => {
    const { experts, mcpServers } = connectorsToRequestFields([
      connectors.registry({ name: "@corti/medical-coding" }),
    ]);
    expect(experts).toHaveLength(1);
    expect(experts![0]).toMatchObject({ type: "reference", name: "@corti/medical-coding" });
    expect(mcpServers).toBeUndefined();
  });

  it("maps a cortiAgent connector to experts by id", () => {
    const { experts } = connectorsToRequestFields([
      connectors.fromAgent({ agentId: "agent-42" }),
    ]);
    expect(experts).toHaveLength(1);
    expect(experts![0]).toMatchObject({ type: "reference", id: "agent-42" });
  });

  it("mixes MCP and registry connectors into both fields", () => {
    const result = connectorsToRequestFields([
      connectors.mcp({ mcpUrl: "https://mcp.example.com", name: "m" }),
      connectors.registry({ name: "@corti/x" }),
    ]);
    expect(result.mcpServers).toHaveLength(1);
    expect(result.experts).toHaveLength(1);
  });

  it("throws for A2A connectors (not yet supported)", () => {
    expect(() =>
      connectorsToRequestFields([connectors.a2a({ a2aUrl: "https://a2a.example.com" })])
    ).toThrow(/A2A connectors are not yet supported/);
  });
});
