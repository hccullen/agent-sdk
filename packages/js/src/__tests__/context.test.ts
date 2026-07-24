import { describe, expect, it, vi } from "vitest";
import { CortiClient } from "../client.js";
import { AgentContext } from "../context.js";
import { MessageResponse } from "../response.js";
import type { SendMessageResponse, StreamResponse } from "../types.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sseResponse(events: object[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function makeClient(fetchFn: ReturnType<typeof vi.fn>): CortiClient {
  return new CortiClient({
    token: "test-token",
    tenant: "test-tenant",
    baseUrl: "https://api.test.corti.app",
    fetch: fetchFn as unknown as typeof fetch,
  });
}

function getRequest(fetchFn: ReturnType<typeof vi.fn>): Request {
  return fetchFn.mock.calls[0][0] as Request;
}

async function getRequestBody(fetchFn: ReturnType<typeof vi.fn>): Promise<unknown> {
  const req = fetchFn.mock.calls[0][0] as Request;
  return JSON.parse(await req.text());
}

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

describe("AgentContext", () => {
  describe("sendText", () => {
    it("sends a text part and returns a MessageResponse", async () => {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse(taskResponse));
      const client = makeClient(fetchFn);
      const ctx = new AgentContext(client, "agent-1");
      const r = await ctx.sendText("Hi");

      expect(r).toBeInstanceOf(MessageResponse);
      expect(r.text).toBe("hello");

      const req = getRequest(fetchFn);
      expect(req.url).toContain("/v2/agentic/agents/agent-1/a2a/message:send");
      expect(req.method).toBe("POST");
      const body = await getRequestBody(fetchFn) as { message: { role: string; parts: unknown[] } };
      expect(body.message.role).toBe("ROLE_USER");
      expect(body.message.parts).toEqual([{ text: "Hi" }]);
    });

    it("generates a messageId", async () => {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse(taskResponse));
      const client = makeClient(fetchFn);
      const ctx = new AgentContext(client, "agent-1");
      await ctx.sendText("Hi");

      const body = await getRequestBody(fetchFn) as { message: { messageId: string } };
      expect(body.message.messageId).toBeTruthy();
    });
  });

  describe("contextId tracking", () => {
    it("starts as undefined", () => {
      const client = makeClient(vi.fn());
      const ctx = new AgentContext(client, "agent-1");
      expect(ctx.id).toBeUndefined();
    });

    it("captures contextId from the first response", async () => {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse(taskResponse));
      const client = makeClient(fetchFn);
      const ctx = new AgentContext(client, "agent-1");
      await ctx.sendText("Hi");
      expect(ctx.id).toBe("ctx.from-server");
    });

    it("includes contextId in subsequent calls", async () => {
      const fetchFn = vi.fn().mockImplementation(() =>
        Promise.resolve(jsonResponse(taskResponse))
      );
      const client = makeClient(fetchFn);
      const ctx = new AgentContext(client, "agent-1");
      await ctx.sendText("first");
      await ctx.sendText("second");

      const req = fetchFn.mock.calls[1][0] as Request;
      const body = JSON.parse(await req.text());
      expect(body.message.contextId).toBe("ctx.from-server");
    });

    it("uses an explicit initial contextId", async () => {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse(taskResponse));
      const client = makeClient(fetchFn);
      const ctx = new AgentContext(client, "agent-1", "pre-existing");
      await ctx.sendText("resume");

      const body = await getRequestBody(fetchFn) as { message: { contextId: string } };
      expect(body.message.contextId).toBe("pre-existing");
    });
  });

  describe("streamMessage", () => {
    it("yields events from the stream", async () => {
      const events: StreamResponse[] = [
        { task: { id: "t1", contextId: "ctx-s", status: { state: "TASK_STATE_WORKING" } } },
        { statusUpdate: { taskId: "t1", contextId: "ctx-s", status: { state: "TASK_STATE_COMPLETED" }, final: true } },
      ];
      const fetchFn = vi.fn().mockResolvedValue(sseResponse(events));
      const client = makeClient(fetchFn);
      const ctx = new AgentContext(client, "agent-1");

      const collected: StreamResponse[] = [];
      for await (const e of ctx.streamMessage([{ text: "Hi" }])) {
        collected.push(e);
      }

      expect(collected).toHaveLength(2);
      expect(collected[0].task?.id).toBe("t1");
      expect(collected[1].statusUpdate?.final).toBe(true);
    });

    it("captures contextId from stream events", async () => {
      const fetchFn = vi.fn().mockResolvedValue(sseResponse([
        { statusUpdate: { taskId: "t1", contextId: "stream-ctx", status: { state: "TASK_STATE_WORKING" }, final: false } },
      ]));
      const client = makeClient(fetchFn);
      const ctx = new AgentContext(client, "agent-1");

      for await (const _ of ctx.streamMessage([{ text: "Hi" }])) { /* drain */ }

      expect(ctx.id).toBe("stream-ctx");
    });
  });

  describe("auth headers", () => {
    it("includes bearer token and tenant header", async () => {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse(taskResponse));
      const client = makeClient(fetchFn);
      const ctx = new AgentContext(client, "agent-1");
      await ctx.sendText("Hi");

      const req = getRequest(fetchFn);
      expect(req.headers.get("Authorization")).toBe("Bearer test-token");
      expect(req.headers.get("Tenant-Name")).toBe("test-tenant");
    });

    it("includes A2A-Version header on a2a endpoints", async () => {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse(taskResponse));
      const client = makeClient(fetchFn);
      const ctx = new AgentContext(client, "agent-1");
      await ctx.sendText("Hi");

      const req = getRequest(fetchFn);
      expect(req.headers.get("A2A-Version")).toBe("1.0");
    });
  });
});
