import { describe, expect, it, vi } from "vitest";
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

function makeMockSdk(overrides: Record<string, unknown> = {}) {
  return {
    agentic: {
      agents: {
        create: vi.fn().mockResolvedValue({}),
        get: vi.fn().mockResolvedValue({}),
        list: vi.fn().mockResolvedValue({ response: { agents: [], nextPageToken: null }, data: [] }),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue(undefined),
        connectors: {
          list: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockResolvedValue({}),
          get: vi.fn().mockResolvedValue({}),
          update: vi.fn().mockResolvedValue({}),
          delete: vi.fn().mockResolvedValue(undefined),
        },
        usage: vi.fn().mockResolvedValue({}),
        card: vi.fn().mockResolvedValue({}),
        getCardUrl: vi.fn().mockResolvedValue(new URL("https://api.dev-weu.corti.app/v2/card.json")),
        sendMessage: vi.fn().mockResolvedValue({}),
        streamMessage: vi.fn().mockResolvedValue((async function* () {})()),
        tasks: {
          list: vi.fn().mockResolvedValue({ response: { tasks: [], nextPageToken: null } }),
          get: vi.fn().mockResolvedValue({}),
          cancel: vi.fn().mockResolvedValue({}),
          subscribe: vi.fn().mockResolvedValue((async function* () {})()),
        },
      },
      contexts: {
        list: vi.fn().mockResolvedValue({ response: { contexts: [], nextPageToken: null } }),
        get: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue(undefined),
        trace: vi.fn().mockResolvedValue({ response: {} }),
        tasks: {
          list: vi.fn().mockResolvedValue({ response: { tasks: [], nextPageToken: null } }),
          get: vi.fn().mockResolvedValue({}),
          artifacts: {
            get: vi.fn().mockResolvedValue({}),
          },
          feedback: {
            create: vi.fn().mockResolvedValue({}),
            list: vi.fn().mockResolvedValue({}),
            delete: vi.fn().mockResolvedValue(undefined),
          },
        },
      },
      registry: {
        connectors: {
          list: vi.fn().mockResolvedValue({ response: { connectors: [], nextPageToken: null } }),
          get: vi.fn().mockResolvedValue({}),
        },
      },
    },
    ...overrides,
  };
}

function makeMockClient(overrides: Record<string, unknown> = {}) {
  const mockSdk = makeMockSdk(overrides);
  return { client: new CortiClient({ sdkClient: mockSdk as never }), mockSdk };
}

describe("CortiClient", () => {
  describe("baseUrl resolution", () => {
    it("defaults to eu region", () => {
      const c = makeClient();
      expect(c.baseUrl).toContain("corti.app");
    });

    it("baseUrl override takes precedence over region and appends /v2", () => {
      const c = makeClient({ region: "us", baseUrl: "https://custom.example.com" });
      expect(c.baseUrl).toBe("https://custom.example.com/v2");
    });

    it("baseUrl with /v2 already present is not doubled", () => {
      const c = makeClient({ baseUrl: "https://custom.example.com/v2" });
      expect(c.baseUrl).toBe("https://custom.example.com/v2");
    });
  });

  describe("constructor", () => {
    it("throws when no auth source is provided", () => {
      expect(() => new CortiClient({} as CortiClientOptions)).toThrow();
    });
  });

  describe("resource delegation", () => {
    it("contexts.list delegates and unwraps .response", async () => {
      const { client, mockSdk } = makeMockClient();
      const result = await client.contexts.list();
      expect(mockSdk.agentic.contexts.list).toHaveBeenCalledWith(undefined, undefined);
      expect(result).toEqual({ contexts: [], nextPageToken: null });
    });

    it("contexts.get with historyLength passes { historyLength } as 2nd arg", async () => {
      const { client, mockSdk } = makeMockClient();
      await client.contexts.get("ctx.1", 5);
      expect(mockSdk.agentic.contexts.get).toHaveBeenCalledWith("ctx.1", { historyLength: 5 }, undefined);
    });

    it("contexts.get without historyLength passes undefined as 2nd arg", async () => {
      const { client, mockSdk } = makeMockClient();
      await client.contexts.get("ctx.1");
      expect(mockSdk.agentic.contexts.get).toHaveBeenCalledWith("ctx.1", undefined, undefined);
    });

    it("contexts.getTrace delegates and unwraps .response", async () => {
      const { client, mockSdk } = makeMockClient();
      const result = await client.contexts.getTrace("ctx.1", { pageSize: 10 });
      expect(mockSdk.agentic.contexts.trace).toHaveBeenCalledWith("ctx.1", { pageSize: 10 }, undefined);
      expect(result).toEqual({});
    });

    it("contexts.listTasks delegates and unwraps .response", async () => {
      const { client, mockSdk } = makeMockClient();
      const result = await client.contexts.listTasks("ctx.1", { pageSize: 5 });
      expect(mockSdk.agentic.contexts.tasks.list).toHaveBeenCalledWith("ctx.1", { pageSize: 5 }, undefined);
      expect(result).toEqual({ tasks: [], nextPageToken: null });
    });

    it("connectors.create delegates with (agentId, body, opts)", async () => {
      const { client, mockSdk } = makeMockClient();
      const body = { type: "mcp", name: "test", url: "https://example.com" };
      await client.connectors.create("agt.1", body);
      expect(mockSdk.agentic.agents.connectors.create).toHaveBeenCalledWith("agt.1", body, undefined);
    });

    it("registry.list delegates and unwraps .response", async () => {
      const { client, mockSdk } = makeMockClient();
      const result = await client.registry.list({ pageSize: 5 });
      expect(mockSdk.agentic.registry.connectors.list).toHaveBeenCalledWith({ pageSize: 5 }, undefined);
      expect(result).toEqual({ connectors: [], nextPageToken: null });
    });

    it("feedback.create delegates with (contextId, taskId, body, opts)", async () => {
      const { client, mockSdk } = makeMockClient();
      await client.feedback.create("ctx.1", "task.1", { rating: 1 });
      expect(mockSdk.agentic.contexts.tasks.feedback.create).toHaveBeenCalledWith("ctx.1", "task.1", { rating: 1 }, undefined);
    });

    it("agentCard.getUrl delegates to getCardUrl", async () => {
      const { client, mockSdk } = makeMockClient();
      const result = await client.agentCard.getUrl("agt.1");
      expect(mockSdk.agentic.agents.getCardUrl).toHaveBeenCalledWith("agt.1");
      expect(result).toEqual(new URL("https://api.dev-weu.corti.app/v2/card.json"));
    });

    it("sendMessage delegates with (agentId, body, opts)", async () => {
      const { client, mockSdk } = makeMockClient();
      const body = { message: { role: "ROLE_USER", parts: [{ text: "hi" }], messageId: "msg.1" } };
      await client.sendMessage("agt.1", body);
      expect(mockSdk.agentic.agents.sendMessage).toHaveBeenCalledWith("agt.1", body, undefined);
    });

    it("createAgentHandle calls agents.get and wraps in AgentHandle", async () => {
      const mockAgent = { id: "agt.1", name: "test-agent", visibility: "private", lifecycle: "persistent", connectors: [] };
      const { client, mockSdk } = makeMockClient({
        agentic: {
          agents: {
            get: vi.fn().mockResolvedValue(mockAgent),
          },
        },
      });
      const handle = await client.createAgentHandle("agt.1");
      expect(mockSdk.agentic.agents.get).toHaveBeenCalledWith("agt.1", undefined);
      expect(handle.id).toBe("agt.1");
    });

    it("agentHandleFactory returns a function that creates handles", async () => {
      const mockAgent = { id: "agt.1", name: "test-agent", visibility: "private", lifecycle: "persistent", connectors: [] };
      const { client, mockSdk } = makeMockClient({
        agentic: {
          agents: {
            get: vi.fn().mockResolvedValue(mockAgent),
          },
        },
      });
      const factory = client.agentHandleFactory;
      expect(typeof factory).toBe("function");
      const handle = await factory("agt.1");
      expect(mockSdk.agentic.agents.get).toHaveBeenCalledWith("agt.1", undefined);
      expect(handle.id).toBe("agt.1");
    });

    it("listTasks delegates and unwraps .response", async () => {
      const { client, mockSdk } = makeMockClient();
      const result = await client.listTasks("agt.1", { pageSize: 5 });
      expect(mockSdk.agentic.agents.tasks.list).toHaveBeenCalledWith("agt.1", { pageSize: 5 }, undefined);
      expect(result).toEqual({ tasks: [], nextPageToken: null });
    });

    it("subscribe delegates to agents.tasks.subscribe", async () => {
      const { client, mockSdk } = makeMockClient();
      await client.subscribe("agt.1", "task.1");
      expect(mockSdk.agentic.agents.tasks.subscribe).toHaveBeenCalledWith("agt.1", "task.1", undefined);
    });

    it("getTask delegates to agents.tasks.get with undefined historyLength", async () => {
      const mockTask = { id: "task.1", status: { state: "TASK_STATE_COMPLETED" } };
      const { client, mockSdk } = makeMockClient({
        agentic: {
          agents: {
            tasks: {
              get: vi.fn().mockResolvedValue(mockTask),
            },
          },
        },
      });
      const result = await client.getTask("agt.1", "task.1");
      expect(mockSdk.agentic.agents.tasks.get).toHaveBeenCalledWith("agt.1", "task.1", undefined, undefined);
      expect(result).toEqual(mockTask);
    });

    it("cancelTask delegates to agents.tasks.cancel", async () => {
      const mockTask = { id: "task.1", status: { state: "TASK_STATE_CANCELED" } };
      const { client, mockSdk } = makeMockClient({
        agentic: {
          agents: {
            tasks: {
              cancel: vi.fn().mockResolvedValue(mockTask),
            },
          },
        },
      });
      const result = await client.cancelTask("agt.1", "task.1");
      expect(mockSdk.agentic.agents.tasks.cancel).toHaveBeenCalledWith("agt.1", "task.1", undefined);
      expect(result).toEqual(mockTask);
    });

    it("streamMessage delegates to agents.streamMessage with full body", async () => {
      const { client, mockSdk } = makeMockClient();
      const body = { message: { role: "ROLE_USER", parts: [{ text: "hi" }], messageId: "msg.1" } };
      await client.streamMessage("agt.1", body);
      expect(mockSdk.agentic.agents.streamMessage).toHaveBeenCalledWith("agt.1", body, undefined);
    });

    it("connectors.list delegates with (agentId, opts)", async () => {
      const { client, mockSdk } = makeMockClient();
      const result = await client.connectors.list("agt.1");
      expect(mockSdk.agentic.agents.connectors.list).toHaveBeenCalledWith("agt.1", undefined);
      expect(result).toEqual([]);
    });

    it("connectors.get delegates with (agentId, connectorId, opts)", async () => {
      const { client, mockSdk } = makeMockClient();
      await client.connectors.get("agt.1", "con.1");
      expect(mockSdk.agentic.agents.connectors.get).toHaveBeenCalledWith("agt.1", "con.1", undefined);
    });

    it("connectors.update delegates with (agentId, connectorId, body, opts)", async () => {
      const { client, mockSdk } = makeMockClient();
      const body = { enabled: false };
      await client.connectors.update("agt.1", "con.1", body);
      expect(mockSdk.agentic.agents.connectors.update).toHaveBeenCalledWith("agt.1", "con.1", body, undefined);
    });

    it("connectors.delete delegates with (agentId, connectorId, opts)", async () => {
      const { client, mockSdk } = makeMockClient();
      await client.connectors.delete("agt.1", "con.1");
      expect(mockSdk.agentic.agents.connectors.delete).toHaveBeenCalledWith("agt.1", "con.1", undefined);
    });

    it("connectors.create preserves auth config in body", async () => {
      const { client, mockSdk } = makeMockClient();
      const body = {
        type: "mcp" as const,
        name: "auth-connector",
        url: "https://mcp.example.com",
        auth: { type: "bearer" as const, ref: "secret-ref" },
      };
      await client.connectors.create("agt.1", body);
      expect(mockSdk.agentic.agents.connectors.create).toHaveBeenCalledWith("agt.1", body, undefined);
      // Verify auth config is passed through unchanged
      const callArg = mockSdk.agentic.agents.connectors.create.mock.calls[0][1];
      expect(callArg.auth).toEqual({ type: "bearer", ref: "secret-ref" });
    });

    it("contexts.getArtifact delegates with (contextId, taskId, artifactId, opts)", async () => {
      const { client, mockSdk } = makeMockClient();
      await client.contexts.getArtifact("ctx.1", "task.1", "art.1");
      expect(mockSdk.agentic.contexts.tasks.artifacts.get).toHaveBeenCalledWith("ctx.1", "task.1", "art.1", undefined);
    });

    it("feedback.list delegates with (contextId, taskId, opts)", async () => {
      const { client, mockSdk } = makeMockClient();
      await client.feedback.list("ctx.1", "task.1");
      expect(mockSdk.agentic.contexts.tasks.feedback.list).toHaveBeenCalledWith("ctx.1", "task.1", undefined);
    });

    it("feedback.delete delegates with (contextId, taskId, feedbackId, opts)", async () => {
      const { client, mockSdk } = makeMockClient();
      await client.feedback.delete("ctx.1", "task.1", "fb.1");
      expect(mockSdk.agentic.contexts.tasks.feedback.delete).toHaveBeenCalledWith("ctx.1", "task.1", "fb.1", undefined);
    });

    it("usage.get delegates with (agentId, params, opts)", async () => {
      const { client, mockSdk } = makeMockClient();
      await client.usage.get("agt.1", { granularity: "day" });
      expect(mockSdk.agentic.agents.usage).toHaveBeenCalledWith("agt.1", { granularity: "day" }, undefined);
    });

    it("registry.get delegates with (connectorId, opts)", async () => {
      const { client, mockSdk } = makeMockClient();
      await client.registry.get("reg.1");
      expect(mockSdk.agentic.registry.connectors.get).toHaveBeenCalledWith("reg.1", undefined);
    });

    it("agentCard.get delegates to agents.card", async () => {
      const { client, mockSdk } = makeMockClient();
      await client.agentCard.get("agt.1");
      expect(mockSdk.agentic.agents.card).toHaveBeenCalledWith("agt.1", undefined);
    });
  });
});
