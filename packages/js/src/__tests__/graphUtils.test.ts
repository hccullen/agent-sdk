import { describe, expect, it, vi } from "vitest";
import { END } from "../stateGraph";
import { MessageResponse } from "../MessageResponse";
import type { AgentHandle } from "../AgentHandle";
import {
  JSON_END,
  stateGraphFromDef,
  workflowFromDef,
  toReactFlow,
} from "../graphUtils";
import type { StateGraphDef, WorkflowDef } from "../graphUtils";

// ── helpers ───────────────────────────────────────────────────────────────────

function mockAgent(text: string): AgentHandle {
  return { run: vi.fn().mockResolvedValue(MessageResponse.fromText(text)) } as unknown as AgentHandle;
}

// ── stateGraphFromDef ─────────────────────────────────────────────────────────

describe("stateGraphFromDef", () => {
  it("builds and runs a linear graph from a def", async () => {
    const def: StateGraphDef = {
      type: "stateGraph",
      entry: "a",
      nodes: [
        { id: "a", agent: "agentA" },
        { id: "b", agent: "agentB" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: JSON_END },
      ],
    };

    const graph = stateGraphFromDef<{ aResult?: string; bResult?: string }>(def, {
      agents: { agentA: mockAgent("hello from a"), agentB: mockAgent("hello from b") },
    });

    const { state, terminatedBy } = await graph.run("a", {});
    expect(state.aResult).toBe("hello from a");
    expect(state.bResult).toBe("hello from b");
    expect(terminatedBy).toBe("end");
  });

  it("routes conditionally based on state", async () => {
    interface S { value: number; result?: string }

    const def: StateGraphDef = {
      type: "stateGraph",
      entry: "check",
      nodes: [
        { id: "check", agent: "checker" },
        { id: "high", agent: "highAgent" },
        { id: "low", agent: "lowAgent" },
      ],
      edges: [
        { from: "check", to: "high", condition: "isHigh" },
        { from: "check", to: "low" },
        { from: "high", to: JSON_END },
        { from: "low", to: JSON_END },
      ],
    };

    // checker returns "42" so we patch the default merge manually via nodeMappings
    const graph = stateGraphFromDef<S>(def, {
      agents: {
        checker: mockAgent("ignored"),
        highAgent: mockAgent("high path"),
        lowAgent: mockAgent("low path"),
      },
      conditions: { isHigh: (s) => s.value > 10 },
      nodes: {
        check: { getInput: (s) => String(s.value), mergeResponse: (_r, s) => s },
        high: { getInput: () => "x", mergeResponse: (r, s) => ({ ...s, result: r.text ?? "" }) },
        low: { getInput: () => "x", mergeResponse: (r, s) => ({ ...s, result: r.text ?? "" }) },
      },
    });

    const { state: highState } = await graph.run("check", { value: 100 });
    expect(highState.result).toBe("high path");

    const { state: lowState } = await graph.run("check", { value: 1 });
    expect(lowState.result).toBe("low path");
  });

  it("throws when an agent key is missing from the registry", () => {
    const def: StateGraphDef = {
      type: "stateGraph",
      entry: "a",
      nodes: [{ id: "a", agent: "missing" }],
      edges: [],
    };
    expect(() => stateGraphFromDef(def, { agents: {} })).toThrow(
      '[stateGraphFromDef] Unknown agent: "missing"',
    );
  });

  it("throws at runtime when a condition key is missing", async () => {
    const def: StateGraphDef = {
      type: "stateGraph",
      entry: "a",
      nodes: [{ id: "a", agent: "agentA" }],
      edges: [{ from: "a", to: JSON_END, condition: "noSuchCond" }],
    };

    const graph = stateGraphFromDef(def, { agents: { agentA: mockAgent("x") } });
    await expect(graph.run("a", {})).rejects.toThrow(
      '[stateGraphFromDef] Unknown condition: "noSuchCond"',
    );
  });
});

// ── workflowFromDef ───────────────────────────────────────────────────────────

describe("workflowFromDef", () => {
  it("builds and runs a sequential workflow from a def", async () => {
    const def: WorkflowDef = {
      type: "workflow",
      steps: [
        { type: "agent", id: "step-0", agent: "agentA" },
        { type: "agent", id: "step-1", agent: "agentB" },
      ],
    };

    const wf = workflowFromDef(def, {
      agentA: mockAgent("step a output"),
      agentB: mockAgent("step b output"),
    });

    const { output, steps } = await wf.run("start");
    expect(steps).toHaveLength(2);
    expect(output.text).toBe("step b output");
  });

  it("gates a step with a condition", async () => {
    const def: WorkflowDef = {
      type: "workflow",
      steps: [
        { type: "agent", id: "step-0", agent: "agentA" },
        { type: "agent", id: "step-1", agent: "agentB", when: "hasYes" },
      ],
    };

    const run = (firstResponse: string) =>
      workflowFromDef(
        def,
        { agentA: mockAgent(firstResponse), agentB: mockAgent("b output") },
        { hasYes: (prev) => (prev.text ?? "").includes("yes") },
      ).run("start");

    const skipped = await run("no");
    expect(skipped.steps).toHaveLength(1);

    const executed = await run("yes please");
    expect(executed.steps).toHaveLength(2);
  });

  it("builds a workflow with a parallel step", async () => {
    const def: WorkflowDef = {
      type: "workflow",
      steps: [
        { type: "parallel", id: "fan-out", agents: ["agentA", "agentB"] },
        { type: "agent", id: "merge", agent: "agentC" },
      ],
    };

    const wf = workflowFromDef(def, {
      agentA: mockAgent("a"),
      agentB: mockAgent("b"),
      agentC: mockAgent("merged"),
    });

    const { output } = await wf.run("start");
    expect(output.text).toBe("merged");
  });

  it("throws when an agent key is missing from the registry", () => {
    const def: WorkflowDef = {
      type: "workflow",
      steps: [{ type: "agent", id: "s0", agent: "missing" }],
    };
    expect(() => workflowFromDef(def, {})).toThrow(
      '[workflowFromDef] Unknown agent: "missing"',
    );
  });
});

// ── toReactFlow ───────────────────────────────────────────────────────────────

describe("toReactFlow", () => {
  describe("StateGraphDef", () => {
    const def: StateGraphDef = {
      type: "stateGraph",
      entry: "triage",
      nodes: [
        { id: "triage", agent: "triageAgent" },
        { id: "coder", agent: "coderAgent" },
        { id: "reviewer", agent: "reviewerAgent" },
      ],
      edges: [
        { from: "triage", to: "coder", condition: "isUrgent" },
        { from: "triage", to: JSON_END },
        { from: "coder", to: "reviewer" },
        { from: "reviewer", to: JSON_END, condition: "isApproved" },
        { from: "reviewer", to: "coder" },
      ],
    };

    it("produces a node for every defined node plus __END__", () => {
      const { nodes } = toReactFlow(def);
      const ids = nodes.map((n) => n.id);
      expect(ids).toContain("triage");
      expect(ids).toContain("coder");
      expect(ids).toContain("reviewer");
      expect(ids).toContain(JSON_END);
    });

    it("produces an edge for every edge def", () => {
      const { edges } = toReactFlow(def);
      expect(edges).toHaveLength(def.edges.length);
    });

    it("maps __END__ target to the JSON_END sentinel node id", () => {
      const { edges } = toReactFlow(def);
      const endEdges = edges.filter((e) => e.target === JSON_END);
      expect(endEdges.length).toBeGreaterThan(0);
    });

    it("carries condition name as edge label", () => {
      const { edges } = toReactFlow(def);
      const urgentEdge = edges.find(
        (e) => e.source === "triage" && e.target === "coder",
      );
      expect(urgentEdge?.label).toBe("isUrgent");
    });

    it("entry node is positioned at y=0", () => {
      const { nodes } = toReactFlow(def);
      const entry = nodes.find((n) => n.id === "triage")!;
      expect(entry.position.y).toBe(0);
    });

    it("all nodes have numeric positions", () => {
      const { nodes } = toReactFlow(def);
      for (const n of nodes) {
        expect(typeof n.position.x).toBe("number");
        expect(typeof n.position.y).toBe("number");
      }
    });

    it("does not add __END__ node when no edges target it", () => {
      const noEndDef: StateGraphDef = {
        type: "stateGraph",
        entry: "a",
        nodes: [{ id: "a", agent: "x" }, { id: "b", agent: "y" }],
        edges: [{ from: "a", to: "b" }],
      };
      const { nodes } = toReactFlow(noEndDef);
      expect(nodes.find((n) => n.id === JSON_END)).toBeUndefined();
    });
  });

  describe("WorkflowDef", () => {
    const def: WorkflowDef = {
      type: "workflow",
      steps: [
        { type: "agent", id: "s0", agent: "agentA", label: "Step A" },
        { type: "parallel", id: "s1", agents: ["agentB", "agentC"] },
        { type: "agent", id: "s2", agent: "agentD" },
      ],
    };

    it("produces one node per step", () => {
      const { nodes } = toReactFlow(def);
      expect(nodes.map((n) => n.id)).toEqual(["s0", "s1", "s2"]);
    });

    it("produces sequential edges", () => {
      const { edges } = toReactFlow(def);
      expect(edges).toHaveLength(2);
      expect(edges[0]).toMatchObject({ source: "s0", target: "s1" });
      expect(edges[1]).toMatchObject({ source: "s1", target: "s2" });
    });

    it("uses label from def when provided", () => {
      const { nodes } = toReactFlow(def);
      expect(nodes[0].data.label).toBe("Step A");
    });

    it("falls back to agent key as label", () => {
      const { nodes } = toReactFlow(def);
      expect(nodes[2].data.label).toBe("agentD");
    });

    it("marks parallel node with nodeType parallel and lists agents", () => {
      const { nodes } = toReactFlow(def);
      const parallel = nodes.find((n) => n.id === "s1")!;
      expect(parallel.data.nodeType).toBe("parallel");
      expect(parallel.data.agents).toEqual(["agentB", "agentC"]);
    });

    it("nodes are positioned with increasing y values", () => {
      const { nodes } = toReactFlow(def);
      const ys = nodes.map((n) => n.position.y);
      expect(ys[0]).toBeLessThan(ys[1]);
      expect(ys[1]).toBeLessThan(ys[2]);
    });
  });
});
