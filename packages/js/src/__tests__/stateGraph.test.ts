import { describe, expect, it, vi } from "vitest";
import { StateGraph, stateGraph, END, agentNode } from "../stateGraph.js";
import { AgentHandle } from "../handle.js";
import { MessageResponse } from "../response.js";
import type { CortiClient } from "../client.js";

interface TestState {
  note: string;
  severity?: string;
  codes?: string;
  approved?: boolean;
}

describe("StateGraph", () => {
  it("executes a simple linear graph", async () => {
    const graph = stateGraph<TestState>()
      .addNode("a", async (s) => ({ severity: "urgent" }))
      .addEdge("a", "b")
      .addNode("b", async (s) => ({ codes: "J45.909" }))
      .addEdge("b", END);

    const result = await graph.run("a", { note: "asthma" });

    expect(result.state.severity).toBe("urgent");
    expect(result.state.codes).toBe("J45.909");
    expect(result.iterations).toBe(2);
    expect(result.terminatedBy).toBe("end");
    expect(result.steps).toHaveLength(2);
  });

  it("supports conditional routing", async () => {
    const graph = stateGraph<TestState>()
      .addNode("triage", async (s) => ({ severity: "urgent" }))
      .addEdge("triage", (s) => (s.severity === "urgent" ? "coder" : END))
      .addNode("coder", async (s) => ({ codes: "J45.909" }))
      .addEdge("coder", END);

    const result = await graph.run("triage", { note: "asthma" });

    expect(result.iterations).toBe(2);
    expect(result.state.codes).toBe("J45.909");
  });

  it("routes to END when condition is false", async () => {
    const graph = stateGraph<TestState>()
      .addNode("triage", async (s) => ({ severity: "mild" }))
      .addEdge("triage", (s) => (s.severity === "urgent" ? "coder" : END));

    const result = await graph.run("triage", { note: "cough" });

    expect(result.iterations).toBe(1);
    expect(result.terminatedBy).toBe("end");
  });

  it("supports cycles bounded by maxIterations", async () => {
    let count = 0;
    const graph = stateGraph<{ n: number }>()
      .addNode("loop", async (s) => {
        count++;
        return { n: s.n + 1 };
      })
      .addEdge("loop", (s) => (s.n >= 5 ? END : "loop"));

    const result = await graph.run("loop", { n: 0 }, { maxIterations: 100 });

    expect(result.state.n).toBe(5);
    expect(count).toBe(5);
  });

  it("stops at maxIterations", async () => {
    const graph = stateGraph<{ n: number }>()
      .addNode("loop", async (s) => ({ n: s.n + 1 }))
      .addEdge("loop", "loop");

    const result = await graph.run("loop", { n: 0 }, { maxIterations: 3 });

    expect(result.terminatedBy).toBe("maxIterations");
    expect(result.iterations).toBe(3);
  });

  it("reports noEdge when a node has no outgoing edge", async () => {
    const graph = stateGraph<TestState>()
      .addNode("a", async (s) => ({ severity: "x" }));

    const result = await graph.run("a", { note: "test" });

    expect(result.terminatedBy).toBe("noEdge");
    expect(result.iterations).toBe(1);
  });

  it("throws on unknown node", async () => {
    const graph = stateGraph<TestState>()
      .addNode("a", async (s) => ({ severity: "x" }))
      .addEdge("a", "b");

    await expect(graph.run("a", { note: "test" })).rejects.toThrow("does not match");
  });

  it("agentNode wraps an AgentHandle", async () => {
    const mockClient = {
      sendMessage: vi.fn().mockResolvedValue({
        task: {
          id: "task.1",
          contextId: "ctx.1",
          status: {
            state: "TASK_STATE_COMPLETED",
            message: { role: "ROLE_AGENT", parts: [{ text: "J45.909" }], messageId: "msg.1" },
          },
        },
      }),
    } as unknown as CortiClient;

    const agent = new AgentHandle(
      {
        id: "agent-1",
        name: "coder",
        visibility: "private",
        lifecycle: "ephemeral",
        connectors: [],
        createdAt: "",
        updatedAt: "",
        createdBy: "",
      },
      mockClient,
    );

    const node = agentNode(
      agent,
      (s: TestState) => s.note,
      (r: MessageResponse, s: TestState) => ({ ...s, codes: r.text ?? "" }),
    );

    const delta = await node({ note: "asthma" });
    expect(delta.codes).toBe("J45.909");
  });
});
