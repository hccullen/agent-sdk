import { describe, expect, it, vi } from "vitest";
import { AgentContext } from "../context.js";
import { MessageResponse } from "../response.js";
import { dataPart } from "../types.js";
import type { SendMessageResponse, StreamResponse } from "../types.js";

const taskResponse: SendMessageResponse = {
  task: {
    id: "task.1",
    contextId: "ctx.from-server",
    status: {
      state: "TASK_STATE_COMPLETED",
      message: {
        role: "ROLE_AGENT",
        parts: [{ text: "hello" }],
        messageId: "msg.1",
      },
    },
  },
};

function makeMockClient(sendMessageImpl?: (agentId: string, body: unknown) => Promise<unknown>) {
  const mock = {
    sendMessage: vi.fn(sendMessageImpl ?? (async () => taskResponse)),
    streamMessage: vi.fn(),
    getTask: vi.fn(),
    cancelTask: vi.fn(),
  };
  return { client: mock as unknown as import("../client.js").CortiClient, mock };
}

describe("AgentContext", () => {
  describe("sendText", () => {
    it("sends a text part and returns a MessageResponse", async () => {
      const { client, mock } = makeMockClient();
      const ctx = new AgentContext(client, "agent-1");
      const r = await ctx.sendText("Hi");

      expect(r).toBeInstanceOf(MessageResponse);
      expect(r.text).toBe("hello");

      expect(mock.sendMessage).toHaveBeenCalledWith(
        "agent-1",
        expect.objectContaining({
          message: expect.objectContaining({
            role: "ROLE_USER",
            parts: [{ text: "Hi" }],
          }),
        }),
        expect.anything(),
      );
    });

    it("generates a messageId", async () => {
      const { client, mock } = makeMockClient();
      const ctx = new AgentContext(client, "agent-1");
      await ctx.sendText("Hi");

      const call = mock.sendMessage.mock.calls[0];
      const body = call[1] as { message: { messageId: string } };
      expect(body.message.messageId).toBeTruthy();
    });
  });

  describe("contextId tracking", () => {
    it("starts as undefined", () => {
      const { client } = makeMockClient();
      const ctx = new AgentContext(client, "agent-1");
      expect(ctx.id).toBeUndefined();
    });

    it("captures contextId from the first response", async () => {
      const { client } = makeMockClient();
      const ctx = new AgentContext(client, "agent-1");
      await ctx.sendText("Hi");
      expect(ctx.id).toBe("ctx.from-server");
    });

    it("includes contextId in subsequent calls", async () => {
      const { client, mock } = makeMockClient();
      const ctx = new AgentContext(client, "agent-1");
      await ctx.sendText("first");
      await ctx.sendText("second");

      const secondCall = mock.sendMessage.mock.calls[1];
      const body = secondCall[1] as { message: { contextId?: string } };
      expect(body.message.contextId).toBe("ctx.from-server");
    });

    it("uses an explicit initial contextId", async () => {
      const { client, mock } = makeMockClient();
      const ctx = new AgentContext(client, "agent-1", "pre-existing");
      await ctx.sendText("resume");

      const call = mock.sendMessage.mock.calls[0];
      const body = call[1] as { message: { contextId?: string } };
      expect(body.message.contextId).toBe("pre-existing");
    });
  });

  describe("streamMessage", () => {
    it("yields events from the stream", async () => {
      const events: StreamResponse[] = [
        { task: { id: "t1", contextId: "ctx-s", status: { state: "TASK_STATE_WORKING" } } },
        { statusUpdate: { taskId: "t1", contextId: "ctx-s", status: { state: "TASK_STATE_COMPLETED" } } },
      ];

      const { client, mock } = makeMockClient();
      mock.streamMessage = vi.fn().mockResolvedValue((async function* () {
        for (const e of events) yield e;
      })());

      const ctx = new AgentContext(client, "agent-1");

      const collected: StreamResponse[] = [];
      for await (const e of ctx.streamMessage([{ text: "Hi" }])) {
        collected.push(e);
      }

      expect(collected).toHaveLength(2);
      expect(collected[0].task?.id).toBe("t1");
    });

    it("captures contextId from stream events", async () => {
      const events: StreamResponse[] = [
        { statusUpdate: { taskId: "t1", contextId: "stream-ctx", status: { state: "TASK_STATE_WORKING" } } },
      ];

      const { client, mock } = makeMockClient();
      mock.streamMessage = vi.fn().mockResolvedValue((async function* () {
        for (const e of events) yield e;
      })());

      const ctx = new AgentContext(client, "agent-1");
      for await (const _ of ctx.streamMessage([{ text: "Hi" }])) { /* drain */ }

      expect(ctx.id).toBe("stream-ctx");
    });
  });

  it("getTask delegates to client.getTask with agent id and abort signal", async () => {
    const mockTask = { id: "task.1", contextId: "ctx.1", status: { state: "TASK_STATE_COMPLETED" } };
    const { client, mock } = makeMockClient();
    mock.getTask = vi.fn().mockResolvedValue(mockTask);
    const ctx = new AgentContext(client, "agent-1");
    const result = await ctx.getTask("task.1");
    expect(result).toEqual(mockTask);
    expect(mock.getTask).toHaveBeenCalledWith("agent-1", "task.1", expect.objectContaining({ abortSignal: expect.any(AbortSignal) }));
  });

  it("cancelTask delegates to client.cancelTask with agent id and abort signal", async () => {
    const mockTask = { id: "task.1", status: { state: "TASK_STATE_CANCELED" } };
    const { client, mock } = makeMockClient();
    mock.cancelTask = vi.fn().mockResolvedValue(mockTask);
    const ctx = new AgentContext(client, "agent-1");
    const result = await ctx.cancelTask("task.1");
    expect(result).toEqual(mockTask);
    expect(mock.cancelTask).toHaveBeenCalledWith("agent-1", "task.1", expect.objectContaining({ abortSignal: expect.any(AbortSignal) }));
  });

  describe("auth-required connector flow", () => {
    // When an MCP connector with bearer auth returns 401, the task transitions
    // to TASK_STATE_AUTH_REQUIRED. The client must then send a new message
    // containing a data part with the token and optional headers (e.g.
    // End-User-Id, End-User-Persona for ClinicalKey). The resume message must
    // also include a text part — auth data parts are extracted before
    // processing, leaving an empty parts array otherwise.
    //
    // Verified end-to-end against staging-eu with the clinicalkey-expert
    // registry connector: the registry connector name is "clinicalkey-expert"
    // but the auth-required hint returns mcp_name "clinicalkey" (the underlying
    // MCP server name). The mcp_name in the auth data part must match the hint,
    // not the registry connector name.

    const authRequiredResponse: SendMessageResponse = {
      task: {
        id: "task.auth.1",
        contextId: "ctx.auth.1",
        status: {
          state: "TASK_STATE_AUTH_REQUIRED",
          message: {
            role: "ROLE_AGENT",
            parts: [
              { text: "MCP server 'clinicalkey' requires authorization." },
              { data: { mcp_name: "clinicalkey", type: "token" } },
            ],
            messageId: "msg.auth.1",
          },
        },
      },
    };

    const completedAfterAuth: SendMessageResponse = {
      task: {
        id: "task.auth.1",
        contextId: "ctx.auth.1",
        status: {
          state: "TASK_STATE_COMPLETED",
          message: {
            role: "ROLE_AGENT",
            parts: [{ text: "Based on ClinicalKey, rest and hydrate." }],
            messageId: "msg.auth.2",
          },
        },
      },
    };

    it("detects auth-required status from MCP connector 401", async () => {
      const { client, mock } = makeMockClient(async () => authRequiredResponse);
      const ctx = new AgentContext(client, "agent-1");
      const r = await ctx.sendText("What should I do if I have a fever?");
      expect(r.status).toBe("auth-required");
      expect(r.taskId).toBe("task.auth.1");
    });

    it("resumes by sending auth data part + text part with contextId", async () => {
      let callCount = 0;
      const { client, mock } = makeMockClient(async () => {
        callCount++;
        return callCount === 1 ? authRequiredResponse : completedAfterAuth;
      });

      const ctx = new AgentContext(client, "agent-1");

      // First message → auth-required
      const first = await ctx.sendText("What should I do if I have a fever?");
      expect(first.status).toBe("auth-required");

      // Resume with auth data + text part.
      // The mcp_name must match the auth hint (the underlying MCP server name),
      // which may differ from the registry connector name (e.g. "clinicalkey-expert").
      const elsevierToken = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test-token";
      const authPart = dataPart({
        type: "token",
        mcp_name: "clinicalkey",
        token: elsevierToken,
        headers: {
          "End-User-Id": "test-user-001",
          "End-User-Persona": "Physician",
        },
      });

      const second = await ctx.sendMessage([
        authPart,
        { text: "What should I do if I have a fever?" },
      ]);

      expect(second.status).toBe("completed");
      expect(second.text).toBe("Based on ClinicalKey, rest and hydrate.");

      // Verify the resume message included contextId (taskId is matched server-side)
      const resumeCall = mock.sendMessage.mock.calls[1];
      const resumeBody = resumeCall[1] as { message: { contextId?: string; parts: unknown[] } };
      expect(resumeBody.message.contextId).toBe("ctx.auth.1");
      expect(resumeBody.message.parts).toHaveLength(2);
    });

    it("auth-required response exposes the MCP connector name hint", async () => {
      const { client } = makeMockClient(async () => authRequiredResponse);
      const ctx = new AgentContext(client, "agent-1");
      const r = await ctx.sendText("question");
      // The auth hint is in the status message parts — a data part containing
      // the mcp_name (underlying MCP server, not the registry connector name)
      // and type. The client must extract mcp_name from here, not assume it
      // matches the connector name. Verified against staging-eu: registry
      // connector "clinicalkey-expert" produces mcp_name "clinicalkey".
      const statusParts = r.task?.status?.message?.parts ?? [];
      const dataHint = statusParts.find((p: Record<string, unknown>) => "data" in p);
      expect(dataHint).toBeDefined();
      expect((dataHint as { data: Record<string, string> }).data.mcp_name).toBe("clinicalkey");
      expect((dataHint as { data: Record<string, string> }).data.type).toBe("token");
    });
  });
});
