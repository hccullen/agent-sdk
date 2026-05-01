import { describe, expect, it, vi } from "vitest";
import { fromConfig } from "../config.js";
import { Workflow } from "../workflow.js";
import { MessageResponse } from "../MessageResponse.js";
import type { AgentHandle } from "../AgentHandle.js";
import type { AgentsClient } from "../AgentsClient.js";
import type { WorkflowConfig } from "../config.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function mockAgent(text: string, state: "completed" | "failed" = "completed"): AgentHandle {
  const raw = {
    id: "", contextId: "", kind: "task" as const,
    status: {
      state,
      message: { role: "agent" as const, parts: [{ kind: "text" as const, text }], messageId: "", kind: "message" as const },
    },
  };
  return { run: vi.fn().mockResolvedValue(new MessageResponse(raw)) } as unknown as AgentHandle;
}

function mockAgentsClient(agentMap: Record<string, AgentHandle>): AgentsClient {
  return {
    create: vi.fn().mockImplementation(({ name }: { name: string }) => {
      const h = agentMap[name];
      if (!h) throw new Error(`No mock agent for "${name}"`);
      return Promise.resolve(h);
    }),
  } as unknown as AgentsClient;
}

// ── fromConfig ────────────────────────────────────────────────────────────────

describe("fromConfig", () => {
  it("returns a Workflow instance", async () => {
    const agentA = mockAgent("hello");
    const client = mockAgentsClient({ a: agentA });

    const wf = await fromConfig({ agents: [{ name: "a", description: "A" }], workflow: ["a"] }, client);

    expect(wf).toBeInstanceOf(Workflow);
  });

  it("creates all agents concurrently and resolves by name", async () => {
    const agentA = mockAgent("from-a");
    const agentB = mockAgent("from-b");
    const client = mockAgentsClient({ a: agentA, b: agentB });

    const wf = await fromConfig(
      {
        agents: [
          { name: "a", description: "A" },
          { name: "b", description: "B" },
        ],
        workflow: ["a", "b"],
      },
      client,
    );

    const result = await wf.run("start");
    expect(result.steps).toHaveLength(2);
    expect(result.output.text).toBe("from-b");
  });

  it("applies retries and retryDelay from FullStepConfig", async () => {
    const failing = mockAgent("err", "failed");
    const client = mockAgentsClient({ flaky: failing });

    const config: WorkflowConfig = {
      agents: [{ name: "flaky", description: "Flaky" }],
      workflow: [{ agent: "flaky", retries: 2, retryDelay: 0 }],
    };

    const wf = await fromConfig(config, client);
    const result = await wf.run("go");

    expect(failing.run).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(result.stoppedEarly).toBe(true);
  });

  it("evaluates when: { text: { includes } } and skips the step when false", async () => {
    const agentA = mockAgent("routine");
    const agentB = mockAgent("escalated");
    const client = mockAgentsClient({ a: agentA, b: agentB });

    const wf = await fromConfig(
      {
        agents: [
          { name: "a", description: "A" },
          { name: "b", description: "B" },
        ],
        workflow: [
          "a",
          { agent: "b", when: { text: { includes: "urgent" } } },
        ],
      },
      client,
    );

    const result = await wf.run("start");
    // "routine" does not include "urgent" → step b is skipped
    expect(agentB.run).not.toHaveBeenCalled();
    expect(result.output.text).toBe("routine");
  });

  it("evaluates when: { text: { notIncludes } } and runs the step when true", async () => {
    const agentA = mockAgent("all clear");
    const agentB = mockAgent("ran");
    const client = mockAgentsClient({ a: agentA, b: agentB });

    const wf = await fromConfig(
      {
        agents: [
          { name: "a", description: "A" },
          { name: "b", description: "B" },
        ],
        workflow: [
          "a",
          { agent: "b", when: { text: { notIncludes: "urgent" } } },
        ],
      },
      client,
    );

    const result = await wf.run("start");
    expect(agentB.run).toHaveBeenCalledOnce();
    expect(result.output.text).toBe("ran");
  });

  it("evaluates when: { status } correctly", async () => {
    const agentA = mockAgent("done", "completed");
    const agentB = mockAgent("ran");
    const client = mockAgentsClient({ a: agentA, b: agentB });

    const wf = await fromConfig(
      {
        agents: [
          { name: "a", description: "A" },
          { name: "b", description: "B" },
        ],
        workflow: [
          "a",
          { agent: "b", when: { status: "completed" } },
        ],
      },
      client,
    );

    const result = await wf.run("start");
    expect(agentB.run).toHaveBeenCalledOnce();
    expect(result.output.text).toBe("ran");
  });

  it("builds a parallel group and merges fulfilled results", async () => {
    const agentA = mockAgent("diagnosis");
    const agentB = mockAgent("red-flags");
    const agentC = mockAgent("final");
    const client = mockAgentsClient({ a: agentA, b: agentB, c: agentC });

    const wf = await fromConfig(
      {
        agents: [
          { name: "a", description: "A" },
          { name: "b", description: "B" },
          { name: "c", description: "C" },
        ],
        workflow: [
          { parallel: ["a", "b"] },
          "c",
        ],
      },
      client,
    );

    const result = await wf.run("start");
    // parallel merged text fed into c; c returns "final"
    expect(agentA.run).toHaveBeenCalledOnce();
    expect(agentB.run).toHaveBeenCalledOnce();
    expect(result.output.text).toBe("final");
  });

  it("passes per-agent input override inside a parallel group", async () => {
    const agentA = mockAgent("a-out");
    const agentB = mockAgent("b-out");
    const client = mockAgentsClient({ a: agentA, b: agentB });

    const wf = await fromConfig(
      {
        agents: [
          { name: "a", description: "A" },
          { name: "b", description: "B" },
        ],
        workflow: [
          { parallel: [{ agent: "a", input: "fixed-for-a" }, "b"] },
        ],
      },
      client,
    );

    await wf.run("shared");
    // Parallel.run passes (input, credentials) — credentials is undefined when unset
    expect((agentA.run as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("fixed-for-a");
    expect((agentB.run as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("shared");
  });

  it("throws when a workflow step references an unknown agent", async () => {
    const client = mockAgentsClient({});

    await expect(
      fromConfig({ agents: [], workflow: ["ghost"] }, client),
    ).rejects.toThrow('[AgentSDK] fromConfig: unknown agent "ghost"');
  });
});
