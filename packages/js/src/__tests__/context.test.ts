import { describe, expect, it, vi } from "vitest";
import { AgentContext } from "../context.js";
import { MessageResponse } from "../response.js";
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
});
