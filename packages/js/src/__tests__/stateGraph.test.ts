import { describe, expect, it, vi } from "vitest";
import { END, StateGraph, agentNode, stateGraph } from "../stateGraph";
import { MessageResponse } from "../MessageResponse";
import type { AgentHandle } from "../AgentHandle";

// ── helpers ───────────────────────────────────────────────────────────────────

function mockAgent(text: string): AgentHandle {
  return { run: vi.fn().mockResolvedValue(MessageResponse.fromText(text)) } as unknown as AgentHandle;
}

// ── StateGraph ────────────────────────────────────────────────────────────────

describe("StateGraph", () => {
  // ── basic execution ──────────────────────────────────────────────────────

  describe("basic execution", () => {
    it("runs a single node with no edge and terminates with noEdge", async () => {
      const graph = stateGraph<{ n: number }>()
        .addNode("only", async (s) => ({ n: s.n + 1 }));

      const result = await graph.run("only", { n: 0 });

      expect(result.state.n).toBe(1);
      expect(result.iterations).toBe(1);
      expect(result.terminatedBy).toBe("noEdge");
    });

    it("runs A → B → END and terminates with end", async () => {
      const graph = stateGraph<{ log: string[] }>()
        .addNode("a", async (s) => ({ log: [...s.log, "a"] }))
        .addNode("b", async (s) => ({ log: [...s.log, "b"] }))
        .addEdge("a", "b")
        .addEdge("b", END);

      const result = await graph.run("a", { log: [] });

      expect(result.state.log).toEqual(["a", "b"]);
      expect(result.iterations).toBe(2);
      expect(result.terminatedBy).toBe("end");
    });

    it("records ordered step history with correct node, delta, and post-delta state", async () => {
      const graph = stateGraph<{ n: number }>()
        .addNode("x", async (s) => ({ n: s.n + 10 }))
        .addNode("y", async (s) => ({ n: s.n + 5 }))
        .addEdge("x", "y")
        .addEdge("y", END);

      const { steps } = await graph.run("x", { n: 0 });

      expect(steps).toHaveLength(2);
      expect(steps[0].node).toBe("x");
      expect(steps[0].delta).toEqual({ n: 10 });
      expect(steps[0].state.n).toBe(10);
      expect(steps[1].node).toBe("y");
      expect(steps[1].delta).toEqual({ n: 15 });
      expect(steps[1].state.n).toBe(15);
    });
  });

  // ── state accumulation ───────────────────────────────────────────────────

  describe("state accumulation", () => {
    it("shallow-merges partial updates, leaving untouched keys intact", async () => {
      type S = { a: string; b: string; c: string };
      const graph = stateGraph<S>()
        .addNode("step1", async () => ({ a: "new-a" }))
        .addNode("step2", async () => ({ b: "new-b" }))
        .addEdge("step1", "step2")
        .addEdge("step2", END);

      const result = await graph.run("step1", { a: "orig-a", b: "orig-b", c: "orig-c" });

      expect(result.state).toEqual({ a: "new-a", b: "new-b", c: "orig-c" });
    });

    it("does not mutate the caller's initialState object", async () => {
      const initial = { count: 0 };
      const graph = stateGraph<typeof initial>()
        .addNode("inc", async (s) => ({ count: s.count + 1 }))
        .addEdge("inc", END);

      await graph.run("inc", initial);

      expect(initial.count).toBe(0);
    });

    it("each step.state snapshot is independent — mutating one does not affect others", async () => {
      const graph = stateGraph<{ v: number }>()
        .addNode("a", async (s) => ({ v: s.v + 1 }))
        .addNode("b", async (s) => ({ v: s.v + 1 }))
        .addEdge("a", "b")
        .addEdge("b", END);

      const { steps } = await graph.run("a", { v: 0 });

      // Snapshots should be independent
      steps[0].state.v = 99;
      expect(steps[1].state.v).toBe(2);
    });

    it("node receives the fully accumulated state from all prior steps", async () => {
      type S = { x: number; y: number; sum: number };
      const graph = stateGraph<S>()
        .addNode("setX",  async () => ({ x: 3 }))
        .addNode("setY",  async () => ({ y: 7 }))
        .addNode("addXY", async (s) => ({ sum: s.x + s.y }))
        .addEdge("setX", "setY")
        .addEdge("setY", "addXY")
        .addEdge("addXY", END);

      const result = await graph.run("setX", { x: 0, y: 0, sum: 0 });

      expect(result.state.sum).toBe(10);
    });
  });

  // ── conditional routing ──────────────────────────────────────────────────

  describe("conditional routing", () => {
    it("routes to different nodes based on state", async () => {
      type S = { flag: boolean; visited: string };
      const graph = stateGraph<S>()
        .addNode("router",  async (s) => s)
        .addNode("path-a",  async (s) => ({ ...s, visited: "a" }))
        .addNode("path-b",  async (s) => ({ ...s, visited: "b" }))
        .addEdge("router",  (s) => s.flag ? "path-a" : "path-b")
        .addEdge("path-a",  END)
        .addEdge("path-b",  END);

      const r1 = await graph.run("router", { flag: true,  visited: "" });
      const r2 = await graph.run("router", { flag: false, visited: "" });

      expect(r1.state.visited).toBe("a");
      expect(r2.state.visited).toBe("b");
    });

    it("router function receives the post-node state, not pre-node state", async () => {
      type S = { value: number };
      let routerSawValue = -1;

      const graph = stateGraph<S>()
        .addNode("increment", async (s) => ({ value: s.value + 10 }))
        .addEdge("increment", (s) => { routerSawValue = s.value; return END; });

      await graph.run("increment", { value: 5 });

      expect(routerSawValue).toBe(15); // post-node state
    });

    it("can route directly to END from a conditional edge", async () => {
      const graph = stateGraph<{ done: boolean }>()
        .addNode("check", async (s) => s)
        .addEdge("check", (s) => s.done ? END : "check");

      const result = await graph.run("check", { done: true });

      expect(result.terminatedBy).toBe("end");
      expect(result.iterations).toBe(1);
    });

    it("supports static string edges without a router function", async () => {
      const graph = stateGraph<{ x: number }>()
        .addNode("first",  async (s) => ({ x: s.x + 1 }))
        .addNode("second", async (s) => ({ x: s.x + 1 }))
        .addEdge("first",  "second")
        .addEdge("second", END);

      const result = await graph.run("first", { x: 0 });

      expect(result.state.x).toBe(2);
      expect(result.steps.map((s) => s.node)).toEqual(["first", "second"]);
    });

    it("supports END as a static edge value", async () => {
      const graph = stateGraph<{ x: number }>()
        .addNode("only", async (s) => ({ x: s.x + 1 }))
        .addEdge("only", END);

      const result = await graph.run("only", { x: 0 });

      expect(result.state.x).toBe(1);
      expect(result.terminatedBy).toBe("end");
    });
  });

  // ── cycles and maxIterations ─────────────────────────────────────────────

  describe("cycles and maxIterations", () => {
    it("handles a cycle that resolves before maxIterations", async () => {
      const graph = stateGraph<{ count: number }>()
        .addNode("tick", async (s) => ({ count: s.count + 1 }))
        .addEdge("tick", (s) => s.count >= 3 ? END : "tick");

      const result = await graph.run("tick", { count: 0 });

      expect(result.state.count).toBe(3);
      expect(result.iterations).toBe(3);
      expect(result.terminatedBy).toBe("end");
    });

    it("stops at maxIterations for an infinite loop", async () => {
      const graph = stateGraph<{ n: number }>()
        .addNode("loop", async (s) => ({ n: s.n + 1 }))
        .addEdge("loop", "loop");

      const result = await graph.run("loop", { n: 0 }, { maxIterations: 5 });

      expect(result.state.n).toBe(5);
      expect(result.iterations).toBe(5);
      expect(result.terminatedBy).toBe("maxIterations");
    });

    it("defaults maxIterations to 25", async () => {
      const graph = stateGraph<{ n: number }>()
        .addNode("loop", async (s) => ({ n: s.n + 1 }))
        .addEdge("loop", "loop");

      const result = await graph.run("loop", { n: 0 });

      expect(result.iterations).toBe(25);
      expect(result.terminatedBy).toBe("maxIterations");
    });

    it("captures the state at termination even when maxIterations fires", async () => {
      const graph = stateGraph<{ n: number }>()
        .addNode("loop", async (s) => ({ n: s.n + 1 }))
        .addEdge("loop", "loop");

      const result = await graph.run("loop", { n: 10 }, { maxIterations: 3 });

      expect(result.state.n).toBe(13); // 10 + 3 iterations
    });
  });

  // ── error handling ───────────────────────────────────────────────────────

  describe("error handling", () => {
    it("throws when the entry node is not registered", async () => {
      const graph = stateGraph<{ x: number }>()
        .addNode("real", async (s) => s);

      await expect(graph.run("nonexistent", { x: 0 }))
        .rejects.toThrow('[StateGraph] Unknown node: "nonexistent".');
    });

    it("throws when a routing function returns an unregistered node", async () => {
      const graph = stateGraph<{ x: number }>()
        .addNode("a", async (s) => s)
        .addEdge("a", "ghost");

      await expect(graph.run("a", { x: 0 }))
        .rejects.toThrow('[StateGraph] Unknown node: "ghost".');
    });

    it("propagates errors thrown inside a node function", async () => {
      const graph = stateGraph<{ x: number }>()
        .addNode("boom", async () => { throw new Error("node exploded"); });

      await expect(graph.run("boom", { x: 0 }))
        .rejects.toThrow("node exploded");
    });

    it("propagates errors thrown inside a router function", async () => {
      const graph = stateGraph<{ x: number }>()
        .addNode("a", async (s) => s)
        .addEdge("a", () => { throw new Error("router exploded"); });

      await expect(graph.run("a", { x: 0 }))
        .rejects.toThrow("router exploded");
    });
  });

  // ── builder API ──────────────────────────────────────────────────────────

  describe("builder API", () => {
    it("addNode and addEdge return the same instance for chaining", () => {
      const g = stateGraph<{ x: number }>();
      expect(g.addNode("a", async (s) => s)).toBe(g);
      expect(g.addEdge("a", END)).toBe(g);
    });

    it("stateGraph() factory creates a new StateGraph instance", () => {
      const g1 = stateGraph<{ x: number }>();
      const g2 = stateGraph<{ x: number }>();
      expect(g1).toBeInstanceOf(StateGraph);
      expect(g1).not.toBe(g2);
    });
  });
});

// ── agentNode ─────────────────────────────────────────────────────────────────

describe("agentNode", () => {
  it("calls agent.run() with the input extracted from state", async () => {
    type S = { query: string; result: string };
    const agent = mockAgent("I10");

    const node = agentNode<S>(
      agent,
      (s) => s.query,
      (r, s) => ({ ...s, result: r.text ?? "" }),
    );

    await node({ query: "hypertension", result: "" });

    expect(agent.run).toHaveBeenCalledOnce();
    expect(agent.run).toHaveBeenCalledWith("hypertension");
  });

  it("merges the response into state via the mergeResponse callback", async () => {
    type S = { query: string; result: string };
    const agent = mockAgent("I10");

    const node = agentNode<S>(
      agent,
      (s) => s.query,
      (r, s) => ({ ...s, result: r.text ?? "" }),
    );

    const delta = await node({ query: "hypertension", result: "" });

    expect(delta.result).toBe("I10");
  });

  it("passes a Part[] input unchanged to agent.run()", async () => {
    type S = { query: string };
    const agent = mockAgent("ok");
    const parts = [{ kind: "text" as const, text: "hello" }];

    const node = agentNode<S>(
      agent,
      () => parts,
      (_r, s) => s,
    );

    await node({ query: "irrelevant" });

    expect(agent.run).toHaveBeenCalledWith(parts);
  });

  it("the mergeResponse callback receives the full MessageResponse object", async () => {
    type S = { status: string };
    const agent = mockAgent("response text");
    let capturedResponse: MessageResponse | null = null;

    const node = agentNode<S>(
      agent,
      () => "input",
      (r, s) => { capturedResponse = r; return s; },
    );

    await node({ status: "" });

    expect(capturedResponse).toBeInstanceOf(MessageResponse);
    expect((capturedResponse as unknown as MessageResponse).text).toBe("response text");
    expect((capturedResponse as unknown as MessageResponse).status).toBe("completed");
  });

  it("works inside a StateGraph run end-to-end", async () => {
    type S = { input: string; output: string };
    const agent = mockAgent("processed");

    const graph = stateGraph<S>()
      .addNode("process", agentNode<S>(
        agent,
        (s) => s.input,
        (r, s) => ({ ...s, output: r.text ?? "" }),
      ))
      .addEdge("process", END);

    const result = await graph.run("process", { input: "raw", output: "" });

    expect(result.state.output).toBe("processed");
    expect(agent.run).toHaveBeenCalledWith("raw");
  });

  // ── retries ────────────────────────────────────────────────────────────────

  describe("retries", () => {
    function failingThenSucceedingAgent(
      failuresBefore: number,
      successText: string,
    ) {
      let calls = 0;
      const agent = {
        run: vi.fn().mockImplementation(async () => {
          calls += 1;
          if (calls <= failuresBefore) {
            // Simulate a failed task response (status === "failed").
            return new MessageResponse({
              id: "", contextId: "", kind: "task",
              status: { state: "failed", message: undefined },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
          }
          return MessageResponse.fromText(successText);
        }),
      };
      return agent as unknown as AgentHandle;
    }

    it("does not retry by default", async () => {
      const agent = failingThenSucceedingAgent(5, "ok");
      const node = agentNode<{ x: string }>(
        agent, () => "in", (r, s) => ({ ...s, x: r.text ?? "FAIL" }),
      );
      const delta = await node({ x: "" });
      expect(agent.run).toHaveBeenCalledOnce();
      expect(delta.x).toBe("FAIL");
    });

    it("retries up to `retries` times on status === 'failed'", async () => {
      const agent = failingThenSucceedingAgent(2, "recovered");
      const node = agentNode<{ x: string }>(
        agent, () => "in", (r, s) => ({ ...s, x: r.text ?? "" }),
        { retries: 3, retryDelay: 0 },
      );
      const delta = await node({ x: "" });
      expect(agent.run).toHaveBeenCalledTimes(3);
      expect(delta.x).toBe("recovered");
    });

    it("gives up after max attempts and merges the last failed response", async () => {
      const agent = failingThenSucceedingAgent(10, "never reached");
      const node = agentNode<{ status: string | undefined }>(
        agent, () => "in", (r, s) => ({ ...s, status: r.status }),
        { retries: 2, retryDelay: 0 },
      );
      const delta = await node({ status: undefined });
      expect(agent.run).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
      expect(delta.status).toBe("failed");
    });

    it("succeeds on the first attempt without retrying", async () => {
      const agent = mockAgent("ok");
      const node = agentNode<{ x: string }>(
        agent, () => "in", (r, s) => ({ ...s, x: r.text ?? "" }),
        { retries: 5, retryDelay: 0 },
      );
      await node({ x: "" });
      expect(agent.run).toHaveBeenCalledOnce();
    });
  });
});
