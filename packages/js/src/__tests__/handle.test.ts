import { describe, expect, it, vi } from "vitest";
import { AgentHandle } from "../handle.js";
import type { Agent, SendMessageResponse } from "../types.js";

const agentResponse: Agent = {
  id: "agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40",
  name: "coder",
  description: "Returns ICD-10 codes.",
  systemPrompt: "Respond with only the ICD-10 code.",
  model: "corti-default",
  visibility: "private",
  lifecycle: "persistent",
  connectors: [],
};

function mockSendMessageResponse(text: string): SendMessageResponse {
  return {
    task: {
      id: "task.1",
      contextId: "ctx.1",
      status: {
        state: "TASK_STATE_COMPLETED",
        message: { role: "ROLE_AGENT", parts: [{ text }], messageId: "msg.1" },
      },
    },
  };
}

function makeMockClient(sendMessageImpl?: (agentId: string, body: unknown) => Promise<unknown>) {
  const mock = {
    agents: {
      get: vi.fn().mockResolvedValue(agentResponse),
      update: vi.fn().mockResolvedValue(agentResponse),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    sendMessage: vi.fn(sendMessageImpl ?? (async () => mockSendMessageResponse("J45.909"))),
    streamMessage: vi.fn(),
    getTask: vi.fn(),
    cancelTask: vi.fn(),
  };
  return { client: mock as unknown as import("../client.js").CortiClient, mock };
}

describe("AgentHandle", () => {
  it("exposes agent properties", () => {
    const { client } = makeMockClient();
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
    const { client } = makeMockClient();
    const h = new AgentHandle(agentResponse, client);
    const ctx = h.createContext();
    expect(ctx).toBeDefined();
    expect(ctx.id).toBeUndefined();
  });

  it("getContext returns an AgentContext with the given contextId", () => {
    const { client } = makeMockClient();
    const h = new AgentHandle(agentResponse, client);
    const ctx = h.getContext("ctx.123");
    expect(ctx.id).toBe("ctx.123");
  });

  it("run creates a fresh context, sends text, and returns the response", async () => {
    const { client } = makeMockClient();
    const h = new AgentHandle(agentResponse, client);
    const r = await h.run("Code this encounter");

    expect(r.text).toBe("J45.909");
    expect(r.status).toBe("completed");
  });

  it("run accepts Part[] input", async () => {
    const { client, mock } = makeMockClient(async (_agentId, body) => {
      const parts = (body as { message: { parts: { text?: string }[] } }).message.parts;
      return mockSendMessageResponse(parts.map(p => p.text ?? "").join(""));
    });
    const h = new AgentHandle(agentResponse, client);
    const r = await h.run([{ text: "Hypertension" }]);

    expect(r.text).toBe("Hypertension");
    expect(mock.sendMessage).toHaveBeenCalledWith(
      agentResponse.id,
      expect.objectContaining({
        message: expect.objectContaining({
          parts: [{ text: "Hypertension" }],
        }),
      }),
      expect.anything(),
    );
  });

  it("refresh fetches the latest agent state", async () => {
    const updated = { ...agentResponse, name: "coder-v2" };
    const { client, mock } = makeMockClient();
    mock.agents.get = vi.fn().mockResolvedValue(updated);
    const h = new AgentHandle(agentResponse, client);
    const refreshed = await h.refresh();
    expect(refreshed.name).toBe("coder-v2");
  });

  it("update delegates to agents.update", async () => {
    const updated = { ...agentResponse, name: "coder-v2" };
    const { client, mock } = makeMockClient();
    mock.agents.update = vi.fn().mockResolvedValue(updated);
    const h = new AgentHandle(agentResponse, client);
    const result = await h.update({ name: "coder-v2" });

    expect(result.name).toBe("coder-v2");
    expect(mock.agents.update).toHaveBeenCalledWith(
      agentResponse.id,
      { name: "coder-v2" },
    );
  });
});
