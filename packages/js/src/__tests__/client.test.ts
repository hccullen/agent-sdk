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
      expect(c.baseUrl).toBe("https://api.eu.corti.app");
    });

    it("uses us region when specified", () => {
      const c = makeClient({ region: "us" });
      expect(c.baseUrl).toBe("https://api.us.corti.app");
    });

    it("baseUrl override takes precedence over region", () => {
      const c = makeClient({ region: "us", baseUrl: "https://custom.example.com" });
      expect(c.baseUrl).toBe("https://custom.example.com");
    });

    it("strips trailing slashes from baseUrl", () => {
      const c = makeClient({ baseUrl: "https://custom.example.com///" });
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

  describe("auth middleware", () => {
    it("exposes the raw openapi-fetch client", () => {
      const c = makeClient();
      expect(c.raw).toBeDefined();
      expect(typeof c.raw.GET).toBe("function");
      expect(typeof c.raw.POST).toBe("function");
    });
  });

  describe("sdkClient auth", () => {
    it("accepts an sdkClient with getAuthHeaders", () => {
      const sdkClient = {
        getAuthHeaders: () =>
          Promise.resolve(
            new Headers({
              Authorization: "Bearer sdk-token",
              "Tenant-Name": "sdk-tenant",
            }),
          ),
      };
      const c = new CortiClient({ sdkClient });
      expect(c.baseUrl).toBe("https://api.eu.corti.app");
      expect(c.raw).toBeDefined();
    });

    it("throws when no auth source is provided", () => {
      expect(() => new CortiClient({} as CortiClientOptions)).toThrow(
        "sdkClient",
      );
    });
  });
});
