import { describe, expect, it, vi } from "vitest";
import {
  parseWorkflowDefinition,
  parseYamlDefinition,
  compileWorkflow,
  runWorkflow,
  executeWorkflow,
  analyzeGraphStructure,
  runWorkflowInteractive,
  resumeWorkflow,
  validateStateSchema,
} from "../declarativeGraph.js";
import type { WorkflowDefinition } from "../declarativeGraph.js";
import type { AgentHandleFactory } from "../handle.js";
import type { Agent } from "../types.js";
import { MessageResponse } from "../response.js";
import { stateGraph, END } from "../stateGraph.js";

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

function mockFactory(agentResponses: Record<string, string> = {}): AgentHandleFactory {
  const responseTexts = new Map(Object.entries(agentResponses));
  return async (agentId: string) => {
    const text = responseTexts.get(agentId) ?? "J45.909";
    const handle = {
      run: vi.fn().mockResolvedValue(
        new MessageResponse({
          task: {
            id: "task.1",
            contextId: "ctx.1",
            status: {
              state: "TASK_STATE_COMPLETED",
              message: { role: "ROLE_AGENT", parts: [{ text }], messageId: "msg.1" },
            },
          },
        })
      ),
    };
    return handle as unknown as import("../handle.js").AgentHandle;
  };
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

    const factory = mockFactory({ "agent-a": "urgent", "agent-b": "J45.909" });
    const compiled = await compileWorkflow(def, factory);
    const result = await runWorkflow(compiled, { note: "asthma" });

    expect(result.state.severity).toBe("urgent");
    expect(result.state.codes).toBe("J45.909");
    expect(result.iterations).toBe(2);
    expect(result.terminatedBy).toBe("end");
    expect(result.steps).toHaveLength(2);
  });

  it("supports conditional routing via switch", async () => {
    const def = triageWorkflow();
    const factory = mockFactory({ "agent-triage": "urgent", "agent-coder": "J45.909" });
    const compiled = await compileWorkflow(def, factory);
    const result = await runWorkflow(compiled, { note: "asthma" });

    expect(result.state.severity).toBe("urgent");
    expect(result.state.codes).toBe("J45.909");
    expect(result.iterations).toBe(3);
    expect(result.terminatedBy).toBe("end");
  });

  it("routes to end when switch condition is false", async () => {
    const def = triageWorkflow();
    const factory = mockFactory({ "agent-triage": "mild", "agent-coder": "J45.909" });

    const compiled = await compileWorkflow(def, factory);
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

    const factory = mockFactory({ "agent-loop": "looping" });
    const compiled = await compileWorkflow(def, factory);
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

    const factory = mockFactory({ "agent-loop": "looping" });
    const compiled = await compileWorkflow(def, factory);
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

    const factory = mockFactory({ "agent-x": "J45.909" });
    const compiled = await compileWorkflow(def, factory);
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

    const factory = mockFactory({ "agent-a": "J45.909" });
    await expect(compileWorkflow(def, factory)).rejects.toThrow();
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

    const factory = mockFactory({ "agent-1": "J45.909" });
    const compiled = await compileWorkflow(def, factory);
    const result = await runWorkflow(compiled, { note: "asthma" });

    expect(result.state.result).toBe("J45.909");
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

    const factory = mockFactory({ "agent-1": "bad" });
    await expect(compileWorkflow(def, factory)).rejects.toThrow();
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

    const factory = mockFactory({ "agent-1": "coder", "agent-2": "J45.909" });
    const compiled = await compileWorkflow(def, factory);
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

    const factory = mockFactory({ "agent-1": "J45.909" });
    const compiled = await compileWorkflow(def, factory);
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

    const factory = mockFactory({
      "agent-er": "J45.909",
      "agent-coder": "J45.909",
    });

    const compiled = await compileWorkflow(def, factory);

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

    const factory = mockFactory({ "agent-1": "J45.909" });
    const result = await executeWorkflow(json, factory, { note: "asthma" });

    expect(result.state.result).toBe("J45.909");
    expect(result.iterations).toBe(1);
    expect(result.terminatedBy).toBe("end");
  });

  it("set_state transforms state via CEL expressions", async () => {
    const def: WorkflowDefinition = {
      document: { name: "set-state", version: "1.0.0" },
      nodes: [
        {
          id: "enrich",
          type: "set_state",
          config: {
            set: {
              full_text: "state.note + ' — severity: ' + state.severity",
              upper_note: "state.note",
            },
          },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "enrich" },
        { source: "enrich", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    const result = await runWorkflow(compiled, { note: "asthma", severity: "urgent" });

    expect(result.state.full_text).toBe("asthma — severity: urgent");
    expect(result.state.upper_note).toBe("asthma");
    expect(result.iterations).toBe(1);
    expect(result.terminatedBy).toBe("end");
  });

  it("set_state supports route_from", async () => {
    const def: WorkflowDefinition = {
      document: { name: "set-state-route", version: "1.0.0" },
      nodes: [
        {
          id: "decide",
          type: "set_state",
          config: {
            set: { tier: "'A'" },
            route_from: "state.tier == 'A' ? 'process' : '__end__'",
          },
        },
        {
          id: "process",
          type: "set_state",
          config: { set: { processed: "true" } },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [{ source: "__start__", target: "decide" }],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    const result = await runWorkflow(compiled, {});

    expect(result.state.tier).toBe("A");
    expect(result.state.processed).toBe(true);
    expect(result.iterations).toBe(2);
  });

  it("http_call makes an HTTP request and maps response into state", async () => {
    const def: WorkflowDefinition = {
      document: { name: "http", version: "1.0.0" },
      nodes: [
        {
          id: "lookup",
          type: "http_call",
          config: {
            url: "'https://api.example.com/patients/' + state.patientId",
            method: "GET",
            headers: { Authorization: "'Bearer ' + state.token" },
            output: {
              patient_name: "response.body.name",
              patient_age: "response.body.age",
            },
          },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "lookup" },
        { source: "lookup", target: "__end__" },
      ],
    };

    const mockHttpPort = {
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          forEach: (cb: (value: string, key: string) => void) => {
            cb("application/json", "content-type");
          },
          get: (name: string) => (name === "content-type" ? "application/json" : null),
        },
        json: async () => ({ name: "John Doe", age: 42 }),
        text: async () => JSON.stringify({ name: "John Doe", age: 42 }),
      }),
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    const result = await runWorkflow(compiled, { patientId: "123", token: "abc" }, { httpPort: mockHttpPort });

    expect(result.state.patient_name).toBe("John Doe");
    expect(result.state.patient_age).toBe(42);
    expect(result.iterations).toBe(1);
    expect(result.terminatedBy).toBe("end");
    expect(mockHttpPort.fetch).toHaveBeenCalledWith(
      "https://api.example.com/patients/123",
      expect.objectContaining({ method: "GET", headers: { Authorization: "Bearer abc" } }),
    );
  });

  it("http_call throws on non-2xx response", async () => {
    const def: WorkflowDefinition = {
      document: { name: "http-fail", version: "1.0.0" },
      nodes: [
        {
          id: "fail",
          type: "http_call",
          config: {
            url: "'https://api.example.com/missing'",
            method: "GET",
            output: {},
          },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "fail" },
        { source: "fail", target: "__end__" },
      ],
    };

    const mockHttpPort = {
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: {
          forEach: () => {},
          get: () => "text/plain",
        },
        json: async () => ({}),
        text: async () => "Not Found",
      }),
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    await expect(runWorkflow(compiled, {}, { httpPort: mockHttpPort })).rejects.toThrow("404");
  });

  it("http_call supports POST with body", async () => {
    const def: WorkflowDefinition = {
      document: { name: "http-post", version: "1.0.0" },
      nodes: [
        {
          id: "create",
          type: "http_call",
          config: {
            url: "'https://api.example.com/items'",
            method: "POST",
            body: "{\"name\": state.itemName}",
            output: { created_id: "response.body.id" },
          },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "create" },
        { source: "create", target: "__end__" },
      ],
    };

    let capturedBody: string | undefined;
    const mockHttpPort = {
      fetch: vi.fn().mockImplementation((_url: string, opts: { method: string; headers: Record<string, string>; body?: string }) => {
        capturedBody = opts.body;
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: {
            forEach: (cb: (value: string, key: string) => void) => {
              cb("application/json", "content-type");
            },
            get: (name: string) => (name === "content-type" ? "application/json" : null),
          },
          json: async () => ({ id: "new-123" }),
          text: async () => '{"id":"new-123"}',
        });
      }),
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    const result = await runWorkflow(compiled, { itemName: "widget" }, { httpPort: mockHttpPort });

    expect(result.state.created_id).toBe("new-123");
    expect(JSON.parse(capturedBody!)).toEqual({ name: "widget" });
  });

  it("interrupt pauses and resumes with onInterrupt callback", async () => {
    const def: WorkflowDefinition = {
      document: { name: "hitl", version: "1.0.0" },
      nodes: [
        {
          id: "review",
          type: "interrupt",
          config: {
            prompt: "'Review: ' + state.codes + '. Approve?'",
            field: "approved",
            route_from: "state.approved == 'yes' ? 'finalize' : '__end__'",
          },
        },
        {
          id: "finalize",
          type: "set_state",
          config: { set: { status: "'finalized'" } },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [{ source: "__start__", target: "review" }, { source: "finalize", target: "__end__" }],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);

    const onInterrupt = vi.fn().mockResolvedValue("yes");
    const result = await runWorkflow(compiled, { codes: "J45.909" }, { onInterrupt });

    expect(onInterrupt).toHaveBeenCalledWith("review", "Review: J45.909. Approve?", { codes: "J45.909" });
    expect(result.state.approved).toBe("yes");
    expect(result.state.status).toBe("finalized");
    expect(result.iterations).toBe(2);
    expect(result.terminatedBy).toBe("end");
  });

  it("interrupt routes to end when human says no", async () => {
    const def: WorkflowDefinition = {
      document: { name: "hitl-no", version: "1.0.0" },
      nodes: [
        {
          id: "review",
          type: "interrupt",
          config: {
            prompt: "'Approve?'",
            field: "approved",
            route_from: "state.approved == 'yes' ? 'finalize' : '__end__'",
          },
        },
        {
          id: "finalize",
          type: "set_state",
          config: { set: { status: "'finalized'" } },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [{ source: "__start__", target: "review" }, { source: "finalize", target: "__end__" }],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);

    const result = await runWorkflow(compiled, {}, { onInterrupt: async () => "no" });

    expect(result.state.approved).toBe("no");
    expect(result.state.status).toBeUndefined();
    expect(result.iterations).toBe(1);
    expect(result.terminatedBy).toBe("end");
  });

  it("interrupt throws when onInterrupt is not provided", async () => {
    const def: WorkflowDefinition = {
      document: { name: "hitl-no-cb", version: "1.0.0" },
      nodes: [
        {
          id: "ask",
          type: "interrupt",
          config: { prompt: "'Approve?'", field: "approved" },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "ask" },
        { source: "ask", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);

    await expect(runWorkflow(compiled, {})).rejects.toThrow("onInterrupt");
  });

  it("combined workflow: agent_call → set_state → http_call → interrupt → end", async () => {
    const mockHttpPort = {
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          forEach: (cb: (value: string, key: string) => void) => {
            cb("application/json", "content-type");
          },
          get: (name: string) => (name === "content-type" ? "application/json" : null),
        },
        json: async () => ({ validated: true }),
        text: async () => '{"validated":true}',
      }),
    };

    const def: WorkflowDefinition = {
      document: { name: "combined", version: "1.0.0" },
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
          id: "enrich",
          type: "set_state",
          config: {
            set: { label: "state.severity + ' priority'" },
          },
        },
        {
          id: "validate",
          type: "http_call",
          config: {
            url: "'https://api.example.com/validate'",
            method: "POST",
            body: "{\"severity\": state.severity}",
            output: { validated: "response.body.validated" },
          },
        },
        {
          id: "review",
          type: "interrupt",
          config: {
            prompt: "'Severity: ' + state.severity + '. Validated: ' + (state.validated ? 'yes' : 'no') + '. Approve?'",
            field: "approved",
            route_from: "state.approved == 'yes' ? '__end__' : '__end__'",
          },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "triage" },
        { source: "triage", target: "enrich" },
        { source: "enrich", target: "validate" },
        { source: "validate", target: "review" },
      ],
    };

    const factory = mockFactory({ "agent-triage": "urgent" });
    const compiled = await compileWorkflow(def, factory);
    const result = await runWorkflow(compiled, { note: "asthma" }, {
      onInterrupt: async () => "yes",
      httpPort: mockHttpPort,
    });

    expect(result.state.severity).toBe("urgent");
    expect(result.state.label).toBe("urgent priority");
    expect(result.state.validated).toBe(true);
    expect(result.state.approved).toBe("yes");
    expect(result.iterations).toBe(4);
    expect(result.terminatedBy).toBe("end");
  });

  it("wait node delays execution by duration", async () => {
    const def: WorkflowDefinition = {
      document: { name: "wait-duration", version: "1.0.0" },
      nodes: [
        {
          id: "wait",
          type: "wait",
          config: { duration: "0.01" },
        },
        {
          id: "after",
          type: "set_state",
          config: { set: { done: "true" } },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "wait" },
        { source: "wait", target: "after" },
        { source: "after", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    const start = Date.now();
    const result = await runWorkflow(compiled, {});
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(8);
    expect(result.state.done).toBe(true);
    expect(result.iterations).toBe(2);
    expect(result.terminatedBy).toBe("end");
  });

  it("wait node uses injected timerPort instead of setTimeout", async () => {
    const def: WorkflowDefinition = {
      document: { name: "wait-port", version: "1.0.0" },
      nodes: [
        {
          id: "wait",
          type: "wait",
          config: { duration: "5" },
        },
        {
          id: "after",
          type: "set_state",
          config: { set: { done: "true" } },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "wait" },
        { source: "wait", target: "after" },
        { source: "after", target: "__end__" },
      ],
    };

    const mockTimerPort = { wait: vi.fn().mockResolvedValue(undefined) };
    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    const start = Date.now();
    const result = await runWorkflow(compiled, {}, { timerPort: mockTimerPort });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(mockTimerPort.wait).toHaveBeenCalledWith(5000);
    expect(result.state.done).toBe(true);
    expect(result.iterations).toBe(2);
  });

  it("wait node with until in the past executes immediately", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const def: WorkflowDefinition = {
      document: { name: "wait-past", version: "1.0.0" },
      nodes: [
        {
          id: "wait",
          type: "wait",
          config: { until: `"${past}"` },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "wait" },
        { source: "wait", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    const start = Date.now();
    const result = await runWorkflow(compiled, {});
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
    expect(result.iterations).toBe(1);
    expect(result.terminatedBy).toBe("end");
  });

  it("wait node supports route_from", async () => {
    const def: WorkflowDefinition = {
      document: { name: "wait-route", version: "1.0.0" },
      nodes: [
        {
          id: "wait",
          type: "wait",
          config: {
            duration: "0",
            route_from: "state.go == 'a' ? 'a' : '__end__'",
          },
        },
        {
          id: "a",
          type: "set_state",
          config: { set: { reached: "true" } },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [{ source: "__start__", target: "wait" }, { source: "a", target: "__end__" }],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    const result = await runWorkflow(compiled, { go: "a" });

    expect(result.state.reached).toBe(true);
    expect(result.iterations).toBe(2);
  });

  it("wait node throws without duration or until", async () => {
    const def: WorkflowDefinition = {
      document: { name: "wait-noop", version: "1.0.0" },
      nodes: [
        { id: "wait", type: "wait", config: {} },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "wait" },
        { source: "wait", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    await expect(runWorkflow(compiled, {})).rejects.toThrow("duration or until");
  });

  it("parallel node runs branches concurrently with join: all", async () => {
    const def: WorkflowDefinition = {
      document: { name: "parallel-all", version: "1.0.0" },
      nodes: [
        {
          id: "fanout",
          type: "parallel",
          config: {
            branches: [
              { name: "a", node: "branchA", input: "{ \"val\": 1 }" },
              { name: "b", node: "branchB", input: "{ \"val\": 2 }" },
            ],
            join: "all",
            output: {
              a_val: "results.a.val",
              b_val: "results.b.val",
            },
          },
        },
        {
          id: "branchA",
          type: "set_state",
          config: { set: { val: "state.val" } },
        },
        {
          id: "branchB",
          type: "set_state",
          config: { set: { val: "state.val" } },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "fanout" },
        { source: "fanout", target: "__end__" },
        { source: "branchA", target: "__end__" },
        { source: "branchB", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    const result = await runWorkflow(compiled, {});

    expect(result.state.a_val).toBe(1);
    expect(result.state.b_val).toBe(2);
    expect(result.iterations).toBe(1);
    expect(result.terminatedBy).toBe("end");
  });

  it("parallel node with join: any returns first successful branch", async () => {
    const def: WorkflowDefinition = {
      document: { name: "parallel-any", version: "1.0.0" },
      nodes: [
        {
          id: "fanout",
          type: "parallel",
          config: {
            branches: [
              { name: "fast", node: "fastBranch", input: "{ \"result\": 'fast' }" },
              { name: "slow", node: "slowBranch", input: "{ \"result\": 'slow' }" },
            ],
            join: "any",
            output: { winner: "results.fast.result" },
          },
        },
        {
          id: "fastBranch",
          type: "set_state",
          config: { set: { result: "state.result" } },
        },
        {
          id: "slowBranch",
          type: "set_state",
          config: { set: { result: "state.result" } },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "fanout" },
        { source: "fanout", target: "__end__" },
        { source: "fastBranch", target: "__end__" },
        { source: "slowBranch", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    const result = await runWorkflow(compiled, {});

    expect(result.state.winner).toBe("fast");
    expect(result.iterations).toBe(1);
  });

  it("parallel node with join: all throws if a branch fails", async () => {
    const def: WorkflowDefinition = {
      document: { name: "parallel-fail", version: "1.0.0" },
      nodes: [
        {
          id: "fanout",
          type: "parallel",
          config: {
            branches: [
              { name: "ok", node: "okBranch", input: "{}" },
              { name: "bad", node: "badBranch", input: "{}" },
            ],
            join: "all",
            output: {},
          },
        },
        {
          id: "okBranch",
          type: "set_state",
          config: { set: { ok: "true" } },
        },
        {
          id: "badBranch",
          type: "set_state",
          config: { set: { fail: "state.nonexistent.field" } },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "fanout" },
        { source: "fanout", target: "__end__" },
        { source: "okBranch", target: "__end__" },
        { source: "badBranch", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    await expect(runWorkflow(compiled, {})).rejects.toThrow("Parallel branch failed");
  });

  it("analyzeGraphStructure finds unreachable nodes", () => {
    const def: WorkflowDefinition = {
      document: { name: "unreachable", version: "1.0.0" },
      nodes: [
        {
          id: "start",
          type: "set_state",
          config: { set: { a: "1" } },
        },
        {
          id: "orphan",
          type: "set_state",
          config: { set: { b: "2" } },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "start" },
        { source: "start", target: "__end__" },
      ],
    };

    const analysis = analyzeGraphStructure(def);
    expect(analysis.unreachable).toContain("orphan");
    expect(analysis.unreachable).not.toContain("start");
  });

  it("analyzeGraphStructure finds dead-end nodes", () => {
    const def: WorkflowDefinition = {
      document: { name: "deadend", version: "1.0.0" },
      nodes: [
        {
          id: "alive",
          type: "set_state",
          config: { set: { a: "1" } },
        },
        {
          id: "dead",
          type: "set_state",
          config: { set: { b: "2" } },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "alive" },
        { source: "alive", target: "__end__" },
        { source: "__start__", target: "dead" },
      ],
    };

    const analysis = analyzeGraphStructure(def);
    expect(analysis.deadEnds).toContain("dead");
    expect(analysis.deadEnds).not.toContain("alive");
  });

  it("analyzeGraphStructure reports clean graph with no issues", () => {
    const def: WorkflowDefinition = {
      document: { name: "clean", version: "1.0.0" },
      nodes: [
        {
          id: "a",
          type: "set_state",
          config: { set: { x: "1" } },
        },
        {
          id: "b",
          type: "set_state",
          config: { set: { y: "2" } },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "a" },
        { source: "a", target: "b" },
        { source: "b", target: "__end__" },
      ],
    };

    const analysis = analyzeGraphStructure(def);
    expect(analysis.unreachable).toHaveLength(0);
    expect(analysis.deadEnds).toHaveLength(0);
  });

  it("analyzeGraphStructure follows switch and parallel targets for reachability", () => {
    const def: WorkflowDefinition = {
      document: { name: "reachable", version: "1.0.0" },
      nodes: [
        {
          id: "route",
          type: "switch",
          config: {
            cases: [{ when: "state.x == 1", target: "a" }],
            default: "b",
          },
        },
        {
          id: "a",
          type: "set_state",
          config: { set: { val: "1" } },
        },
        {
          id: "b",
          type: "set_state",
          config: { set: { val: "2" } },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "route" },
        { source: "a", target: "__end__" },
        { source: "b", target: "__end__" },
      ],
    };

    const analysis = analyzeGraphStructure(def);
    expect(analysis.unreachable).toHaveLength(0);
  });

  it("callback node runs arbitrary handler and merges result into state", async () => {
    const def: WorkflowDefinition = {
      document: { name: "callback-basic", version: "1.0.0" },
      nodes: [
        { id: "custom", type: "callback", config: { handler: "enrichFn" } },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "custom" },
        { source: "custom", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory, {
      enrichFn: async (state) => ({ enriched: (state.note as string).toUpperCase() }),
    });
    const result = await runWorkflow(compiled, { note: "asthma" });

    expect(result.state.enriched).toBe("ASTHMA");
    expect(result.iterations).toBe(1);
    expect(result.terminatedBy).toBe("end");
  });

  it("callback node with output mapping uses CEL against result", async () => {
    const def: WorkflowDefinition = {
      document: { name: "callback-output", version: "1.0.0" },
      nodes: [
        {
          id: "custom",
          type: "callback",
          config: {
            handler: "fetchFn",
            output: { label: "result.tag", count: "result.count" },
          },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "custom" },
        { source: "custom", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory, {
      fetchFn: async () => ({ tag: "urgent", count: 42 }),
    });
    const result = await runWorkflow(compiled, {});

    expect(result.state.label).toBe("urgent");
    expect(result.state.count).toBe(42);
  });

  it("callback node supports route_from", async () => {
    const def: WorkflowDefinition = {
      document: { name: "callback-route", version: "1.0.0" },
      nodes: [
        {
          id: "decide",
          type: "callback",
          config: {
            handler: "decideFn",
            route_from: "state.tier == 'A' ? 'process' : '__end__'",
          },
        },
        {
          id: "process",
          type: "set_state",
          config: { set: { processed: "true" } },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [{ source: "__start__", target: "decide" }, { source: "process", target: "__end__" }],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory, {
      decideFn: async () => ({ tier: "A" }),
    });
    const result = await runWorkflow(compiled, {});

    expect(result.state.tier).toBe("A");
    expect(result.state.processed).toBe(true);
    expect(result.iterations).toBe(2);
  });

  it("callback node throws when handler is not registered", async () => {
    const def: WorkflowDefinition = {
      document: { name: "callback-missing", version: "1.0.0" },
      nodes: [
        { id: "custom", type: "callback", config: { handler: "missingFn" } },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "custom" },
        { source: "custom", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    await expect(runWorkflow(compiled, {})).rejects.toThrow("No handler registered");
  });

  it("callback handlers passed via runWorkflow opts override compiled handlers", async () => {
    const def: WorkflowDefinition = {
      document: { name: "callback-override", version: "1.0.0" },
      nodes: [
        { id: "custom", type: "callback", config: { handler: "fn" } },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "custom" },
        { source: "custom", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory, {
      fn: async () => ({ value: "compiled" }),
    });
    const result = await runWorkflow(compiled, {}, {
      handlers: { fn: async () => ({ value: "runtime" }) },
    });

    expect(result.state.value).toBe("runtime");
  });

  it("StateGraph.toDefinition produces a valid WorkflowDefinition", () => {
    const graph = stateGraph<{ note: string; severity?: string }>()
      .addNode("triage", async (s) => ({ severity: "urgent" }))
      .addEdge("triage", "coder")
      .addNode("coder", async (s) => ({ severity: "coded" }))
      .addEdge("coder", END);

    const def = graph.toDefinition("triage");

    expect(() => parseWorkflowDefinition(def)).not.toThrow();
    expect(def.nodes.some((n) => n.id === "triage" && n.type === "callback")).toBe(true);
    expect(def.nodes.some((n) => n.id === "coder" && n.type === "callback")).toBe(true);
    expect(def.edges).toContainEqual({ source: "__start__", target: "triage" });
    expect(def.edges).toContainEqual({ source: "triage", target: "coder" });
    expect(def.edges).toContainEqual({ source: "coder", target: "__end__" });
  });

  it("runWorkflowInteractive yields interrupt and resumes with answer", async () => {
    const def: WorkflowDefinition = {
      document: { name: "hitl-checkpoint", version: "1.0.0" },
      nodes: [
        {
          id: "review",
          type: "interrupt",
          config: {
            prompt: "'Approve codes: ' + state.codes + '?'",
            field: "approved",
            route_from: "state.approved == 'yes' ? 'finalize' : '__end__'",
          },
        },
        {
          id: "finalize",
          type: "set_state",
          config: { set: { status: "'finalized'" } },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "review" },
        { source: "finalize", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    const gen = runWorkflowInteractive(compiled, { codes: "J45.909" });

    const first = await gen.next();
    expect(first.value.kind).toBe("interrupt");
    const interrupt = first.value as { kind: string; node: string; prompt: string; checkpoint: string };
    expect(interrupt.node).toBe("review");
    expect(interrupt.prompt).toBe("Approve codes: J45.909?");

    const resumeGen = resumeWorkflow(compiled, interrupt.checkpoint, "yes");
    const result = await resumeGen.next();
    expect(result.value).toMatchObject({
      state: { codes: "J45.909", approved: "yes", status: "finalized" },
      terminatedBy: "end",
    });
  });

  it("runWorkflowInteractive yields interrupt, resume with no routes to end", async () => {
    const def: WorkflowDefinition = {
      document: { name: "hitl-reject", version: "1.0.0" },
      nodes: [
        {
          id: "review",
          type: "interrupt",
          config: {
            prompt: "'Approve?'",
            field: "approved",
            route_from: "state.approved == 'yes' ? 'finalize' : '__end__'",
          },
        },
        {
          id: "finalize",
          type: "set_state",
          config: { set: { status: "'finalized'" } },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "review" },
        { source: "finalize", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    const gen = runWorkflowInteractive(compiled, {});
    const first = await gen.next();
    const interrupt = first.value as { kind: string; checkpoint: string };

    const resumeGen = resumeWorkflow(compiled, interrupt.checkpoint, "no");
    const result = await resumeGen.next();
    expect(result.value).toMatchObject({
      state: { approved: "no" },
      terminatedBy: "end",
    });
    expect((result.value as Record<string, unknown>).status).toBeUndefined();
  });

  it("runWorkflowInteractive completes without interrupt when no interrupt nodes", async () => {
    const def: WorkflowDefinition = {
      document: { name: "no-interrupt", version: "1.0.0" },
      nodes: [
        { id: "a", type: "set_state", config: { set: { x: "1" } } },
        { id: "b", type: "set_state", config: { set: { y: "2" } } },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "a" },
        { source: "a", target: "b" },
        { source: "b", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    const gen = runWorkflowInteractive(compiled, {});

    const result = await gen.next();
    expect(result.value).toMatchObject({
      state: { x: 1, y: 2 },
      terminatedBy: "end",
    });
    expect(result.done).toBe(false);

    const done = await gen.next();
    expect(done.done).toBe(true);
  });

  it("checkpoint is a valid base64 string containing state and node", async () => {
    const def: WorkflowDefinition = {
      document: { name: "checkpoint-test", version: "1.0.0" },
      nodes: [
        {
          id: "ask",
          type: "interrupt",
          config: { prompt: "'Proceed?'", field: "answer" },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "ask" },
        { source: "ask", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);
    const gen = runWorkflowInteractive(compiled, { data: "test" });
    const first = await gen.next();
    const interrupt = first.value as { kind: string; checkpoint: string };

    const decoded = JSON.parse(atob(interrupt.checkpoint));
    expect(decoded.nodeId).toBe("ask");
    expect(decoded.state).toEqual({ data: "test" });
    expect(decoded.iterations).toBe(0);
    expect(decoded.steps).toHaveLength(0);
  });

  it("multiple interrupts — pause twice, resume twice", async () => {
    const def: WorkflowDefinition = {
      document: { name: "multi-interrupt", version: "1.0.0" },
      nodes: [
        {
          id: "first",
          type: "interrupt",
          config: { prompt: "'First?'", field: "first_answer" },
        },
        {
          id: "second",
          type: "interrupt",
          config: { prompt: "'Second?'", field: "second_answer" },
        },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "first" },
        { source: "first", target: "second" },
        { source: "second", target: "__end__" },
      ],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);

    const gen1 = runWorkflowInteractive(compiled, {});
    const first = await gen1.next();
    expect(first.value.kind).toBe("interrupt");
    const cp1 = (first.value as { checkpoint: string }).checkpoint;

    const gen2 = resumeWorkflow(compiled, cp1, "A");
    const second = await gen2.next();
    expect(second.value.kind).toBe("interrupt");
    const cp2 = (second.value as { checkpoint: string }).checkpoint;

    const gen3 = resumeWorkflow(compiled, cp2, "B");
    const result = await gen3.next();
    expect(result.value).toMatchObject({
      state: { first_answer: "A", second_answer: "B" },
      terminatedBy: "end",
    });
  });

  it("resumeWorkflow throws on invalid checkpoint", async () => {
    const def: WorkflowDefinition = {
      document: { name: "bad-checkpoint", version: "1.0.0" },
      nodes: [{ id: "__end__", type: "end" }],
      edges: [{ source: "__start__", target: "__end__" }],
    };

    const factory = mockFactory();
    const compiled = await compileWorkflow(def, factory);

    await expect(
      (async () => {
        const gen = resumeWorkflow(compiled, "not-valid-base64!!!", "answer");
        await gen.next();
      })(),
    ).rejects.toThrow();
  });

  it("parseYamlDefinition parses YAML config into WorkflowDefinition", () => {
    const yamlStr = `
document:
  name: yaml-test
  version: "1.0.0"
nodes:
  - id: enrich
    type: set_state
    config:
      set:
        label: "'hello'"
  - id: __end__
    type: end
edges:
  - source: __start__
    target: enrich
  - source: enrich
    target: __end__
`;
    const def = parseYamlDefinition(yamlStr);
    expect(def.document.name).toBe("yaml-test");
    expect(def.nodes).toHaveLength(2);
    expect(def.nodes[0].id).toBe("enrich");
    expect(def.nodes[0].type).toBe("set_state");
    expect(def.edges).toHaveLength(2);
  });

  it("parseYamlDefinition rejects invalid YAML structure", () => {
    expect(() => parseYamlDefinition("not: valid: yaml:")).toThrow();
  });

  it("parseYamlDefinition produces output equivalent to JSON", () => {
    const yamlStr = `
document:
  name: equiv
  version: "1.0.0"
nodes:
  - id: a
    type: set_state
    config:
      set:
        x: "1"
  - id: __end__
    type: end
edges:
  - source: __start__
    target: a
  - source: a
    target: __end__
`;
    const yamlDef = parseYamlDefinition(yamlStr);
    const jsonDef = parseWorkflowDefinition({
      document: { name: "equiv", version: "1.0.0" },
      nodes: [
        { id: "a", type: "set_state", config: { set: { x: "1" } } },
        { id: "__end__", type: "end" },
      ],
      edges: [
        { source: "__start__", target: "a" },
        { source: "a", target: "__end__" },
      ],
    });
    expect(yamlDef).toEqual(jsonDef);
  });

  it("validateStateSchema accepts valid state", () => {
    const schema = {
      type: "object",
      properties: {
        note: { type: "string" },
        severity: { type: "string" },
      },
      required: ["note"],
    };
    const result = validateStateSchema({ note: "asthma", severity: "urgent" }, schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validateStateSchema rejects missing required field", () => {
    const schema = {
      type: "object",
      properties: {
        note: { type: "string" },
      },
      required: ["note"],
    };
    const result = validateStateSchema({}, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("note");
  });

  it("validateStateSchema rejects wrong type", () => {
    const schema = {
      type: "object",
      properties: {
        count: { type: "number" },
      },
    };
    const result = validateStateSchema({ count: "not a number" }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("validateStateSchema accepts empty schema", () => {
    const result = validateStateSchema({ anything: true }, {});
    expect(result.valid).toBe(true);
  });
});
