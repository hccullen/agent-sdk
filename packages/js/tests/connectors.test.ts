import { describe, expect, it } from "vitest";
import { auth, connectors } from "../src/connectors.js";

describe("connectors.registry", () => {
  it("builds a minimal registry connector", () => {
    const c = connectors.registry("@dedalus/coding-expert");
    expect(c).toEqual({ type: "registry", name: "@dedalus/coding-expert" });
  });

  it("includes enabled and config when provided", () => {
    const c = connectors.registry("@dedalus/coding-expert", {
      enabled: false,
      config: { lang: "da" },
    });
    expect(c.type).toBe("registry");
    expect(c.name).toBe("@dedalus/coding-expert");
    expect(c.enabled).toBe(false);
    expect(c.config).toEqual({ lang: "da" });
  });
});

describe("connectors.mcp", () => {
  it("builds a minimal MCP connector", () => {
    const c = connectors.mcp({
      name: "my-mcp",
      url: "https://mcp.example.com",
    });
    expect(c).toEqual({
      type: "mcp",
      name: "my-mcp",
      url: "https://mcp.example.com",
    });
  });

  it("includes auth when provided", () => {
    const c = connectors.mcp({
      name: "my-mcp",
      url: "https://mcp.example.com",
      auth: { type: "bearer" },
    });
    expect(c.auth).toEqual({ type: "bearer" });
  });

  it("includes enabled when provided", () => {
    const c = connectors.mcp({
      name: "my-mcp",
      url: "https://mcp.example.com",
      enabled: false,
    });
    expect(c.enabled).toBe(false);
  });
});

describe("connectors.agent", () => {
  it("builds a minimal agent connector", () => {
    const c = connectors.agent("agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40");
    expect(c).toEqual({
      type: "agent",
      agentId: "agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40",
    });
  });

  it("includes enabled when provided", () => {
    const c = connectors.agent("agt.123", { enabled: false });
    expect(c.enabled).toBe(false);
  });
});

describe("connectors.a2a", () => {
  it("builds a minimal A2A connector", () => {
    const c = connectors.a2a("https://example.com/.well-known/agent-card.json");
    expect(c).toEqual({
      type: "a2a",
      url: "https://example.com/.well-known/agent-card.json",
    });
  });

  it("includes name and enabled when provided", () => {
    const c = connectors.a2a("https://example.com", {
      name: "remote-agent",
      enabled: false,
    });
    expect(c.name).toBe("remote-agent");
    expect(c.enabled).toBe(false);
  });
});

describe("connectors.schema", () => {
  it("builds a minimal schema connector", () => {
    const c = connectors.schema({
      name: "submit_code",
      schema: { type: "object", properties: { code: { type: "string" } } },
    });
    expect(c.type).toBe("schema");
    expect(c.name).toBe("submit_code");
    expect(c.schema).toEqual({
      type: "object",
      properties: { code: { type: "string" } },
    });
  });

  it("includes description and transition when provided", () => {
    const c = connectors.schema({
      name: "submit_code",
      schema: { type: "object" },
      description: "Submit the final code",
      transition: "complete",
    });
    expect(c.description).toBe("Submit the final code");
    expect(c.transition).toBe("complete");
  });
});

describe("auth factories", () => {
  it("auth.none() returns { type: 'none' }", () => {
    expect(auth.none()).toEqual({ type: "none" });
  });

  it("auth.bearer() returns { type: 'bearer' }", () => {
    expect(auth.bearer()).toEqual({ type: "bearer" });
  });

  it("auth.apiKey() includes ref when provided", () => {
    expect(auth.apiKey("secret-ref")).toEqual({
      type: "apiKey",
      ref: "secret-ref",
    });
  });

  it("auth.oauth2() includes scope, redirectUrl, ref", () => {
    const a = auth.oauth2({
      scope: "read:policies",
      redirectUrl: "https://app.corti.ai/oauth/callback",
    });
    expect(a).toEqual({
      type: "oauth2",
      scope: "read:policies",
      redirectUrl: "https://app.corti.ai/oauth/callback",
    });
  });

  it("auth.oauth2() without args returns { type: 'oauth2' }", () => {
    expect(auth.oauth2()).toEqual({ type: "oauth2" });
  });

  it("auth.bearer() includes ref when provided", () => {
    expect(auth.bearer("secret-ref")).toEqual({
      type: "bearer",
      ref: "secret-ref",
    });
  });

  it("auth.bearer() returns { type: 'bearer' } without ref", () => {
    expect(auth.bearer()).toEqual({ type: "bearer" });
  });

  it("auth.inherit() returns { type: 'inherit' }", () => {
    expect(auth.inherit()).toEqual({ type: "inherit" });
  });
});

describe("auth factory round-trip via connectors.mcp", () => {
  it("bearer auth passes through connectors.mcp unchanged", () => {
    const c = connectors.mcp({
      name: "test",
      url: "https://mcp.example.com",
      auth: auth.bearer("my-ref"),
    });
    expect(c.auth).toEqual({ type: "bearer", ref: "my-ref" });
  });

  it("inherit auth passes through connectors.mcp unchanged", () => {
    const c = connectors.mcp({
      name: "test",
      url: "https://mcp.example.com",
      auth: auth.inherit(),
    });
    expect(c.auth).toEqual({ type: "inherit" });
  });

  it("oauth2 auth passes through connectors.mcp with scope and redirectUrl", () => {
    const c = connectors.mcp({
      name: "test",
      url: "https://mcp.example.com",
      auth: auth.oauth2({
        scope: "read",
        redirectUrl: "https://app.example.com/cb",
      }),
    });
    expect(c.auth).toEqual({
      type: "oauth2",
      scope: "read",
      redirectUrl: "https://app.example.com/cb",
    });
  });

  it("none auth passes through connectors.mcp unchanged", () => {
    const c = connectors.mcp({
      name: "test",
      url: "https://mcp.example.com",
      auth: auth.none(),
    });
    expect(c.auth).toEqual({ type: "none" });
  });

  // NOTE: The API docs list apiKey as a supported auth type, but the dev-weu API
  // rejects it with "Connector auth type 'apiKey' is not supported." The SDK
  // factory still produces the shape for forward-compatibility, but consumers
  // should use bearer, inherit, oauth2, or none until the API supports it.
  it("apiKey auth factory produces the right shape (API may reject)", () => {
    const c = connectors.mcp({
      name: "test",
      url: "https://mcp.example.com",
      auth: auth.apiKey("key-ref"),
    });
    expect(c.auth).toEqual({ type: "apiKey", ref: "key-ref" });
  });
});
