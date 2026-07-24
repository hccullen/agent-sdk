import { describe, expect, it, vi } from "vitest";
import { CortiClient } from "../client.js";
import { AgentHandle } from "../handle.js";
import type { Agent } from "../types.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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

const agentResponse: Agent = {
  id: "agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40",
  name: "coder",
  description: "Returns ICD-10 codes.",
  systemPrompt: "Respond with only the ICD-10 code.",
  model: "corti-default",
  visibility: "private",
  lifecycle: "persistent",
  connectors: [],
  createdAt: "2026-05-19T12:00:00Z",
  updatedAt: "2026-05-19T12:00:00Z",
  createdBy: "usr.0192f4c8-8bc0-7194-8570-92e3ce81d0a6",
};

describe("AgentHandle", () => {
  it("exposes agent properties", () => {
    const client = makeClient(vi.fn());
    const h = new AgentHandle(agentResponse, client);
    expect(h.id).toBe(agentResponse.id);
    expect(h.name).toBe("coder");
    expect(h.description).toBe("Returns ICD-10 codes.");
    expect(h.systemPrompt).toBe("Respond with only the ICD-10 code.");
    expect(h.model).toBe("corti-default");
    expect(h.visibility).toBe("private");
    expect(h.lifecycle).toBe("persistent");
    expect(h.raw).toBe(agentResponse);
  });

  it("createContext returns an AgentContext with the agent id", () => {
    const client = makeClient(vi.fn());
    const h = new AgentHandle(agentResponse, client);
    const ctx = h.createContext();
    expect(ctx).toBeDefined();
    expect(ctx.id).toBeUndefined();
  });

  it("getContext returns an AgentContext with the given contextId", () => {
    const client = makeClient(vi.fn());
    const h = new AgentHandle(agentResponse, client);
    const ctx = h.getContext("ctx.123");
    expect(ctx.id).toBe("ctx.123");
  });

  it("run creates a fresh context, sends text, and returns the response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({
      task: {
        id: "task.1",
        contextId: "ctx.1",
        status: {
          state: "TASK_STATE_COMPLETED",
          message: { role: "ROLE_AGENT", parts: [{ text: "J45.909" }], messageId: "msg.1" },
        },
      },
    }));
    const client = makeClient(fetchFn);
    const h = new AgentHandle(agentResponse, client);
    const r = await h.run("Code this encounter");

    expect(r.text).toBe("J45.909");
    expect(r.status).toBe("completed");
  });

  it("run accepts Part[] input", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({
      task: {
        id: "task.1",
        contextId: "ctx.1",
        status: {
          state: "TASK_STATE_COMPLETED",
          message: { role: "ROLE_AGENT", parts: [{ text: "I10" }], messageId: "msg.1" },
        },
      },
    }));
    const client = makeClient(fetchFn);
    const h = new AgentHandle(agentResponse, client);
    const r = await h.run([{ text: "Hypertension" }]);

    expect(r.text).toBe("I10");
    const req = fetchFn.mock.calls[0][0] as Request;
    const body = JSON.parse(await req.text());
    expect(body.message.parts).toEqual([{ text: "Hypertension" }]);
  });

  it("refresh fetches the latest agent state", async () => {
    const updated = { ...agentResponse, name: "coder-v2" };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(updated));
    const client = makeClient(fetchFn);
    const h = new AgentHandle(agentResponse, client);
    const refreshed = await h.refresh();
    expect(refreshed.name).toBe("coder-v2");
  });

  it("update sends a PATCH with merge-patch body", async () => {
    const updated = { ...agentResponse, name: "coder-v2" };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(updated));
    const client = makeClient(fetchFn);
    const h = new AgentHandle(agentResponse, client);
    const result = await h.update({ name: "coder-v2" });

    expect(result.name).toBe("coder-v2");
    const req = fetchFn.mock.calls[0][0] as Request;
    expect(req.method).toBe("PATCH");
    expect(req.headers.get("Content-Type")).toBe("application/merge-patch+json");
    const body = JSON.parse(await req.text());
    expect(body).toEqual({ name: "coder-v2" });
  });
});
