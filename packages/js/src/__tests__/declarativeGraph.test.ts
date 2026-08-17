import { describe, expect, it, vi } from "vitest";
import {
  parseWorkflowDefinition,
  compileWorkflow,
  runWorkflow,
  executeWorkflow,
} from "../declarativeGraph.js";
import type { WorkflowDefinition } from "../declarativeGraph.js";
import type { CortiClient } from "../client.js";
import type { Agent } from "../types.js";

function mockAgent(id: string, name: string): Agent {
  return {
    id,
    name,
    visibility: "private",
    lifecycle: "ephemeral",
    connectors: [],
    createdAt: "",
    updatedAt: "",
    createdBy: "",
  } as unknown as Agent;
}

function mockTaskResponse(text: string) {
  return {
    data: {
      task: {
        id: "task.1",
        contextId: "ctx.1",
        status: {
          state: "TASK_STATE_COMPLETED",
          message: { role: "ROLE_AGENT", parts: [{ text }], messageId: "msg.1" },
        },
      },
    },
    response: { ok: true },
  };
}

function mockClient(agentResponses: Record<string, string> = {}): CortiClient {
  const agents = new Map<string, Agent>();
  const responseTexts = new Map<string, string>();
  for (const [id, responseText] of Object.entries(agentResponses)) {
    agents.set(id, mockAgent(id, id));
    responseTexts.set(id, responseText);
  }

  return {
    agents: {
      get: vi.fn().mockImplementation(async (agentId: string) => {
        const agent = agents.get(agentId);
        if (!agent) throw new Error(`Agent not found: ${agentId}`);
        return agent;
      }),
    },
    raw: {
      POST: vi.fn().mockImplementation((_path: string, opts: { params: { path: { agentId: string } } }) => {
        const agentId = opts.params.path.agentId;
        const text = responseTexts.get(agentId) ?? "J45.909";
        return Promise.resolve(mockTaskResponse(text));
      }),
    },
  } as unknown as CortiClient;
}

function triageWorkflow(): WorkflowDefinition {
  return {
    document: { name: "triage-flow", version: "1.0.0" },
    nodes: [
      {
        id: "triage",
        type: "agent_call",
        config: {
          agent: "agent-triage",
          input: "state.note",
          output: { severity: "response.text" },
        },
      },
      {
        id: "route",
        type: "switch",
        config: {
          cases: [{ when: "state.severity == 'urgent'", target: "coder" }],
          default: "__end__",
        },
      },
      {
        id: "coder",
        type: "agent_call",
        config: {
          agent: "agent-coder",
          input: "state.note",
          output: { codes: "response.text" },
        },
      },
      { id: "__end__", type: "end" },
    ],
    edges: [
      { source: "__start__", target: "triage" },
      { source: "triage", target: "route" },
      { source: "coder", target: "__end__" },
    ],
    max_iterations: 25,
  };
}

describe("DeclarativeGraph", () => {
  it("executes a simple linear graph", async () => {
    const def: WorkflowDefinition = {
      document: { name: "linear", version: "1.0.0" },
      nodes: [
        {
          id: "a",
          type: "agent_call",
          config: {
            agent: "agent-a",
            input: "state.note",
            output: { severity: "response.text" },
          },
        },
        {
          id: "b",
          type: "agent_call",
          config: {
            agent: "agent-b",
            input: "state.note",
            output: { codes: "response.text" },
          },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "a" },
        { source: "a", target: "b" },
        { source: "b", target: "__end__" },
      ],
    };

    const client = mockClient({ "agent-a": "urgent", "agent-b": "J45.909" });
    const compiled = await compileWorkflow(def, client);
    const result = await runWorkflow(compiled, { note: "asthma" });

    expect(result.state.severity).toBe("urgent");
    expect(result.state.codes).toBe("J45.909");
    expect(result.iterations).toBe(2);
    expect(result.terminatedBy).toBe("end");
    expect(result.steps).toHaveLength(2);
  });

  it("supports conditional routing via switch", async () => {
    const def = triageWorkflow();
    const client = mockClient({ "agent-triage": "urgent", "agent-coder": "J45.909" });
    const compiled = await compileWorkflow(def, client);
    const result = await runWorkflow(compiled, { note: "asthma" });

    expect(result.state.severity).toBe("urgent");
    expect(result.state.codes).toBe("J45.909");
    expect(result.iterations).toBe(3);
    expect(result.terminatedBy).toBe("end");
  });

  it("routes to end when switch condition is false", async () => {
    const def = triageWorkflow();
    const client = mockClient({ "agent-triage": "mild", "agent-coder": "J45.909" });

    const compiled = await compileWorkflow(def, client);
    const result = await runWorkflow(compiled, { note: "cough" });

    expect(result.state.severity).toBe("mild");
    expect(result.state.codes).toBeUndefined();
    expect(result.iterations).toBe(2);
    expect(result.terminatedBy).toBe("end");
  });

  it("supports cycles bounded by maxIterations", async () => {
    const def: WorkflowDefinition = {
      document: { name: "cycle", version: "1.0.0" },
      nodes: [
        {
          id: "loop",
          type: "agent_call",
          config: {
            agent: "agent-loop",
            input: "'go'",
            output: { n: "response.text" },
          },
        },
        {
          id: "check",
          type: "switch",
          config: {
            cases: [{ when: "state.n == 'done'", target: "__end__" }],
            default: "loop",
          },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "loop" },
        { source: "loop", target: "check" },
      ],
      max_iterations: 3,
    };

    const client = mockClient({ "agent-loop": "looping" });
    const compiled = await compileWorkflow(def, client);
    const result = await runWorkflow(compiled, {});

    expect(result.terminatedBy).toBe("maxIterations");
    expect(result.iterations).toBe(3);
  });

  it("stops at maxIterations on infinite loop", async () => {
    const def: WorkflowDefinition = {
      document: { name: "infinite", version: "1.0.0" },
      nodes: [
        {
          id: "loop",
          type: "agent_call",
          config: {
            agent: "agent-loop",
            input: "'go'",
            output: {},
          },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "loop" },
        { source: "loop", target: "loop" },
      ],
      max_iterations: 5,
    };

    const client = mockClient({ "agent-loop": "looping" });
    const compiled = await compileWorkflow(def, client);
    const result = await runWorkflow(compiled, {});

    expect(result.terminatedBy).toBe("maxIterations");
    expect(result.iterations).toBe(5);
  });

  it("reports noEdge when a node has no outgoing edge", async () => {
    const def: WorkflowDefinition = {
      document: { name: "no-edge", version: "1.0.0" },
      nodes: [
        {
          id: "orphan",
          type: "agent_call",
          config: {
            agent: "agent-x",
            input: "'hi'",
            output: {},
          },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [{ source: "__start__", target: "orphan" }],
    };

    const client = mockClient({ "agent-x": "J45.909" });
    const compiled = await compileWorkflow(def, client);
    const result = await runWorkflow(compiled, {});

    expect(result.terminatedBy).toBe("noEdge");
    expect(result.iterations).toBe(1);
  });

  it("throws on unknown node referenced by edge", async () => {
    const def: WorkflowDefinition = {
      document: { name: "bad-edge", version: "1.0.0" },
      nodes: [
        {
          id: "a",
          type: "agent_call",
          config: { agent: "agent-a", input: "'hi'", output: {} },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "a" },
        { source: "a", target: "nonexistent" },
      ],
    };

    const client = mockClient({ "agent-a": "J45.909" });
    await expect(compileWorkflow(def, client)).rejects.toThrow();
  });

  it("agent_call wraps AgentHandle and merges response into state", async () => {
    const def: WorkflowDefinition = {
      document: { name: "single", version: "1.0.0" },
      nodes: [
        {
          id: "call",
          type: "agent_call",
          config: {
            agent: "agent-1",
            input: "state.note",
            output: { result: "response.text" },
          },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "call" },
        { source: "call", target: "__end__" },
      ],
    };

    const client = mockClient({ "agent-1": "J45.909" });
    const compiled = await compileWorkflow(def, client);
    const result = await runWorkflow(compiled, { note: "asthma" });

    expect(result.state.result).toBe("J45.909");
    expect(client.agents.get).toHaveBeenCalledWith("agent-1");
  });

  it("rejects invalid JSON: missing document", () => {
    expect(() =>
      parseWorkflowDefinition({ nodes: [], edges: [] }),
    ).toThrow("document");
  });

  it("rejects invalid JSON: bad node type", () => {
    expect(() =>
      parseWorkflowDefinition({
        document: { name: "bad", version: "1.0.0" },
        nodes: [{ id: "x", type: "unknown", config: {} }],
        edges: [{ source: "__start__", target: "x" }],
      }),
    ).toThrow("invalid type");
  });

  it("rejects invalid JSON: duplicate node ids", () => {
    expect(() =>
      parseWorkflowDefinition({
        document: { name: "dup", version: "1.0.0" },
        nodes: [
          { id: "x", type: "end" },
          { id: "x", type: "end" },
        ],
        edges: [{ source: "__start__", target: "x" }],
      }),
    ).toThrow("Duplicate");
  });

  it("rejects invalid JSON: missing __start__ edge", () => {
    expect(() =>
      parseWorkflowDefinition({
        document: { name: "no-start", version: "1.0.0" },
        nodes: [{ id: "__end__", type: "end" }],
        edges: [],
      }),
    ).toThrow("__start__");
  });

  it("rejects invalid JSON: missing __end__ node", () => {
    expect(() =>
      parseWorkflowDefinition({
        document: { name: "no-end", version: "1.0.0" },
        nodes: [
          {
            id: "a",
            type: "agent_call",
            config: { agent: "x", input: "'hi'", output: {} },
          },
        ],
        edges: [{ source: "__start__", target: "a" }],
      }),
    ).toThrow("__end__");
  });

  it("throws on bad CEL syntax at compile time", async () => {
    const def: WorkflowDefinition = {
      document: { name: "bad-cel", version: "1.0.0" },
      nodes: [
        {
          id: "bad",
          type: "agent_call",
          config: { agent: "agent-1", input: "this is not valid!!!", output: {} },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "bad" },
        { source: "bad", target: "__end__" },
      ],
    };

    const client = mockClient({ "agent-1": "bad" });
    await expect(compileWorkflow(def, client)).rejects.toThrow();
  });

  it("supports agent-decided routing via route_from", async () => {
    const def: WorkflowDefinition = {
      document: { name: "route-from", version: "1.0.0" },
      nodes: [
        {
          id: "decider",
          type: "agent_call",
          config: {
            agent: "agent-1",
            input: "'decide'",
            output: { choice: "response.text" },
            route_from: "state.choice == 'coder' ? 'coder' : '__end__'",
          },
        },
        {
          id: "coder",
          type: "agent_call",
          config: {
            agent: "agent-2",
            input: "'code'",
            output: { codes: "response.text" },
          },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [{ source: "__start__", target: "decider" }],
    };

    const client = mockClient({ "agent-1": "coder", "agent-2": "J45.909" });
    const compiled = await compileWorkflow(def, client);
    const result = await runWorkflow(compiled, {});

    expect(result.state.choice).toBe("coder");
    expect(result.state.codes).toBe("J45.909");
    expect(result.iterations).toBe(2);
  });

  it("output mapping maps response.text into state field", async () => {
    const def: WorkflowDefinition = {
      document: { name: "output-map", version: "1.0.0" },
      nodes: [
        {
          id: "call",
          type: "agent_call",
          config: {
            agent: "agent-1",
            input: "state.note",
            output: {
              codes: "response.text",
              status: "response.status",
            },
          },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "call" },
        { source: "call", target: "__end__" },
      ],
    };

    const client = mockClient({ "agent-1": "J45.909" });
    const compiled = await compileWorkflow(def, client);
    const result = await runWorkflow(compiled, { note: "asthma" });

    expect(result.state.codes).toBe("J45.909");
    expect(result.state.status).toBe("completed");
  });

  it("multiple switch cases with default fallback", async () => {
    const def: WorkflowDefinition = {
      document: { name: "multi-switch", version: "1.0.0" },
      nodes: [
        {
          id: "check",
          type: "switch",
          config: {
            cases: [
              { when: "state.severity == 'critical'", target: "er" },
              { when: "state.severity == 'urgent'", target: "coder" },
            ],
            default: "__end__",
          },
        },
        {
          id: "er",
          type: "agent_call",
          config: {
            agent: "agent-er",
            input: "'emergency'",
            output: { result: "response.text" },
          },
        },
        {
          id: "coder",
          type: "agent_call",
          config: {
            agent: "agent-coder",
            input: "'code'",
            output: { result: "response.text" },
          },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "check" },
        { source: "er", target: "__end__" },
        { source: "coder", target: "__end__" },
      ],
    };

    const client = mockClient({
      "agent-er": "J45.909",
      "agent-coder": "J45.909",
    });

    const compiled = await compileWorkflow(def, client);

    const urgentResult = await runWorkflow(compiled, { severity: "urgent" });
    expect(urgentResult.state.result).toBe("J45.909");

    const criticalResult = await runWorkflow(compiled, { severity: "critical" });
    expect(criticalResult.state.result).toBe("J45.909");

    const mildResult = await runWorkflow(compiled, { severity: "mild" });
    expect(mildResult.state.result).toBeUndefined();
    expect(mildResult.terminatedBy).toBe("end");
  });

  it("executeWorkflow one-shot: parse + compile + run", async () => {
    const json = {
      document: { name: "one-shot", version: "1.0.0" },
      nodes: [
        {
          id: "call",
          type: "agent_call",
          config: {
            agent: "agent-1",
            input: "state.note",
            output: { result: "response.text" },
          },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "call" },
        { source: "call", target: "__end__" },
      ],
    };

    const client = mockClient({ "agent-1": "J45.909" });
    const result = await executeWorkflow(json, client, { note: "asthma" });

    expect(result.state.result).toBe("J45.909");
    expect(result.iterations).toBe(1);
    expect(result.terminatedBy).toBe("end");
  });
});
