import { describe, expect, it, vi, beforeEach } from "vitest";
import { AgentContext } from "../AgentContext.js";
import { MessageResponse } from "../MessageResponse.js";
import type { Corti, CortiClient } from "@corti/sdk";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../rpcTransport.js", () => ({
  rpcCall: vi.fn(),
  rpcStream: vi.fn(),
}));

import { rpcCall, rpcStream } from "../rpcTransport.js";

const mockedRpcCall = vi.mocked(rpcCall);
const mockedRpcStream = vi.mocked(rpcStream);

function makeTask(
  overrides: Partial<Corti.AgentsTask> = {}
): Corti.AgentsTask {
  return {
    id: "task-1",
    contextId: "ctx-from-server",
    kind: "task",
    status: {
      state: "completed",
      message: {
        role: "agent",
        parts: [{ kind: "text", text: "hello" }],
        messageId: "m1",
        kind: "message",
      },
    },
    ...overrides,
  } as Corti.AgentsTask;
}

const fakeClient = {} as CortiClient;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AgentContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── sendText / sendMessage ────────────────────────────────────────────────

  describe("sendText", () => {
    it("calls rpcCall with message/send and a text part", async () => {
      mockedRpcCall.mockResolvedValue(makeTask());
      const ctx = new AgentContext("agent-1", fakeClient, undefined);
      await ctx.sendText("Hi");

      expect(mockedRpcCall).toHaveBeenCalledOnce();
      const [, agentId, method, params] = mockedRpcCall.mock.calls[0];
      expect(agentId).toBe("agent-1");
      expect(method).toBe("message/send");
      const msg = (params as { message: Corti.AgentsMessage }).message;
      expect(msg.parts).toEqual(expect.arrayContaining([{ kind: "text", text: "Hi" }]));
    });

    it("returns a MessageResponse with the server reply", async () => {
      mockedRpcCall.mockResolvedValue(makeTask());
      const ctx = new AgentContext("agent-1", fakeClient, undefined);
      const r = await ctx.sendText("Hi");
      expect(r).toBeInstanceOf(MessageResponse);
      expect(r.text).toBe("hello");
    });
  });

  // ── contextId tracking ────────────────────────────────────────────────────

  describe("context ID tracking", () => {
    it("starts as undefined", () => {
      const ctx = new AgentContext("agent-1", fakeClient, undefined);
      expect(ctx.id).toBeUndefined();
    });

    it("captures contextId from the first response", async () => {
      mockedRpcCall.mockResolvedValue(makeTask({ contextId: "ctx-42" }));
      const ctx = new AgentContext("agent-1", fakeClient, undefined);
      await ctx.sendText("Hi");
      expect(ctx.id).toBe("ctx-42");
    });

    it("includes contextId in subsequent calls", async () => {
      mockedRpcCall
        .mockResolvedValueOnce(makeTask({ contextId: "ctx-42" }))
        .mockResolvedValueOnce(makeTask({ contextId: "ctx-42" }));

      const ctx = new AgentContext("agent-1", fakeClient, undefined);
      await ctx.sendText("first");
      await ctx.sendText("second");

      const secondParams = mockedRpcCall.mock.calls[1][3] as { message: Corti.AgentsMessage };
      expect(secondParams.message.contextId).toBe("ctx-42");
    });

    it("uses an explicit initial contextId from getContext", async () => {
      mockedRpcCall.mockResolvedValue(makeTask({ contextId: "pre-existing" }));
      const ctx = new AgentContext("agent-1", fakeClient, undefined, "pre-existing");
      await ctx.sendText("resume");

      const params = mockedRpcCall.mock.calls[0][3] as { message: Corti.AgentsMessage };
      expect(params.message.contextId).toBe("pre-existing");
    });
  });

  // ── credential injection ──────────────────────────────────────────────────

  describe("credential injection", () => {
    const creds = {
      "my-mcp": { type: "token" as const, token: "tok_abc" },
    };

    it("injects auth DataParts on the first message of a new context", async () => {
      mockedRpcCall.mockResolvedValue(makeTask());
      const ctx = new AgentContext("agent-1", fakeClient, undefined, undefined, creds);
      await ctx.sendText("Hello");

      const params = mockedRpcCall.mock.calls[0][3] as { message: Corti.AgentsMessage };
      const dataPart = params.message.parts.find((p) => p.kind === "data") as Corti.AgentsDataPart;
      expect(dataPart).toBeDefined();
      expect((dataPart.data as { mcp_name: string }).mcp_name).toBe("my-mcp");
    });

    it("does not inject credentials on subsequent turns", async () => {
      mockedRpcCall
        .mockResolvedValueOnce(makeTask({ contextId: "ctx-1" }))
        .mockResolvedValueOnce(makeTask({ contextId: "ctx-1" }));

      const ctx = new AgentContext("agent-1", fakeClient, undefined, undefined, creds);
      await ctx.sendText("first");
      await ctx.sendText("second");

      const secondParams = mockedRpcCall.mock.calls[1][3] as { message: Corti.AgentsMessage };
      const hasDataPart = secondParams.message.parts.some((p) => p.kind === "data");
      expect(hasDataPart).toBe(false);
    });

    it("auto-resends credentials when agent returns auth-required", async () => {
      const authRequired = makeTask({ status: { state: "auth-required" } as Corti.AgentsTaskStatus });
      const completed = makeTask();

      mockedRpcCall
        .mockResolvedValueOnce(authRequired)
        .mockResolvedValueOnce(completed);

      const ctx = new AgentContext("agent-1", fakeClient, undefined, undefined, creds);
      const result = await ctx.sendText("Hello");

      expect(mockedRpcCall).toHaveBeenCalledTimes(2);
      expect(result.status).toBe("completed");

      // Second call should contain only the auth DataParts (the retry)
      const retryParams = mockedRpcCall.mock.calls[1][3] as { message: Corti.AgentsMessage };
      expect(retryParams.message.parts.every((p) => p.kind === "data")).toBe(true);
    });

    it("does not retry when no credentials are set", async () => {
      const authRequired = makeTask({ status: { state: "auth-required" } as Corti.AgentsTaskStatus });
      mockedRpcCall.mockResolvedValue(authRequired);

      const ctx = new AgentContext("agent-1", fakeClient, undefined);
      const result = await ctx.sendText("Hello");

      expect(mockedRpcCall).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("auth-required");
    });
  });

  // ── streamMessage ─────────────────────────────────────────────────────────

  describe("streamMessage", () => {
    it("yields events from the stream", async () => {
      const events = [
        { kind: "status-update", taskId: "t1", contextId: "ctx-s", status: { state: "working" }, final: false },
        { kind: "status-update", taskId: "t1", contextId: "ctx-s", status: { state: "completed" }, final: true },
      ];

      async function* gen() { for (const e of events) yield e; }
      mockedRpcStream.mockReturnValue(gen() as never);

      const ctx = new AgentContext("agent-1", fakeClient, undefined);
      const collected: unknown[] = [];
      for await (const e of ctx.streamMessage([{ kind: "text", text: "Hi" }])) {
        collected.push(e);
      }

      expect(collected).toHaveLength(2);
    });

    it("captures contextId from stream events", async () => {
      async function* gen() {
        yield { kind: "status-update", taskId: "t1", contextId: "stream-ctx", status: { state: "working" }, final: false };
      }
      mockedRpcStream.mockReturnValue(gen() as never);

      const ctx = new AgentContext("agent-1", fakeClient, undefined);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of ctx.streamMessage([{ kind: "text", text: "Hi" }])) { /* drain */ }

      expect(ctx.id).toBe("stream-ctx");
    });

    it("injects credential DataParts on the first stream call", async () => {
      async function* gen() { /* empty stream */ }
      mockedRpcStream.mockReturnValue(gen() as never);

      const creds = { "my-mcp": { type: "token" as const, token: "tok_s" } };
      const ctx = new AgentContext("agent-1", fakeClient, undefined, undefined, creds);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of ctx.streamMessage([{ kind: "text", text: "Hi" }])) { /* drain */ }

      const [, , , params] = mockedRpcStream.mock.calls[0];
      const msg = (params as { message: Corti.AgentsMessage }).message;
      const hasAuthPart = msg.parts.some((p) => p.kind === "data");
      expect(hasAuthPart).toBe(true);
    });
  });
});
