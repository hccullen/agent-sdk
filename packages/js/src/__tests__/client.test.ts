import { describe, expect, it } from "vitest";
import { CortiClient } from "../client.js";
import type { CortiClientOptions } from "../client.js";

const TOKEN = "test-token";
const TENANT = "test-tenant";

function makeClient(opts: Partial<CortiClientOptions> = {}): CortiClient {
  return new CortiClient({
    token: TOKEN,
    tenant: TENANT,
    ...opts,
  });
}

describe("CortiClient", () => {
  describe("baseUrl resolution", () => {
    it("defaults to eu region", () => {
      const c = makeClient();
      expect(c.baseUrl).toContain("corti.app");
    });

    it("baseUrl override takes precedence over region", () => {
      const c = makeClient({ region: "us", baseUrl: "https://custom.example.com" });
      expect(c.baseUrl).toBe("https://custom.example.com");
    });
  });

  describe("resource clients", () => {
    it("exposes agents resource", () => {
      const c = makeClient();
      expect(c.agents).toBeDefined();
    });

    it("exposes contexts resource", () => {
      const c = makeClient();
      expect(c.contexts).toBeDefined();
    });

    it("exposes registry resource", () => {
      const c = makeClient();
      expect(c.registry).toBeDefined();
    });

    it("exposes usage resource", () => {
      const c = makeClient();
      expect(c.usage).toBeDefined();
    });

    it("exposes feedback resource", () => {
      const c = makeClient();
      expect(c.feedback).toBeDefined();
    });

    it("exposes agentCard resource", () => {
      const c = makeClient();
      expect(c.agentCard).toBeDefined();
    });
  });

  describe("messaging methods", () => {
    it("exposes sendMessage, streamMessage, getTask, cancelTask", () => {
      const c = makeClient();
      expect(c.sendMessage).toBeDefined();
      expect(c.streamMessage).toBeDefined();
      expect(c.getTask).toBeDefined();
      expect(c.cancelTask).toBeDefined();
    });

    it("exposes createAgentHandle and agentHandleFactory", () => {
      const c = makeClient();
      expect(c.createAgentHandle).toBeDefined();
      expect(c.agentHandleFactory).toBeDefined();
    });
  });

  describe("sdkClient auth", () => {
    it("accepts an sdkClient instance", () => {
      const mockSdk = { agentic: { agents: {} } };
      const c = new CortiClient({ sdkClient: mockSdk as never });
      expect(c).toBeDefined();
      expect(c.agents).toBeDefined();
    });

    it("throws when no auth source is provided", () => {
      expect(() => new CortiClient({} as CortiClientOptions)).toThrow();
    });
  });
});
