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

    const client = mockClient();
    const compiled = await compileWorkflow(def, client);
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

    const client = mockClient();
    const compiled = await compileWorkflow(def, client);
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

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
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
    }) as unknown as typeof fetch;

    try {
      const client = mockClient();
      const compiled = await compileWorkflow(def, client);
      const result = await runWorkflow(compiled, { patientId: "123", token: "abc" });

      expect(result.state.patient_name).toBe("John Doe");
      expect(result.state.patient_age).toBe(42);
      expect(result.iterations).toBe(1);
      expect(result.terminatedBy).toBe("end");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.example.com/patients/123",
        expect.objectContaining({ method: "GET", headers: { Authorization: "Bearer abc" } }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
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

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: {
        forEach: () => {},
        get: () => "text/plain",
      },
      json: async () => ({}),
      text: async () => "Not Found",
    }) as unknown as typeof fetch;

    try {
      const client = mockClient();
      const compiled = await compileWorkflow(def, client);
      await expect(runWorkflow(compiled, {})).rejects.toThrow("404");
    } finally {
      globalThis.fetch = originalFetch;
    }
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

    const originalFetch = globalThis.fetch;
    let capturedBody: string | undefined;
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
      capturedBody = opts.body as string;
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
    }) as unknown as typeof fetch;

    try {
      const client = mockClient();
      const compiled = await compileWorkflow(def, client);
      const result = await runWorkflow(compiled, { itemName: "widget" });

      expect(result.state.created_id).toBe("new-123");
      expect(JSON.parse(capturedBody!)).toEqual({ name: "widget" });
    } finally {
      globalThis.fetch = originalFetch;
    }
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

    const client = mockClient();
    const compiled = await compileWorkflow(def, client);

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

    const client = mockClient();
    const compiled = await compileWorkflow(def, client);

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

    const client = mockClient();
    const compiled = await compileWorkflow(def, client);

    await expect(runWorkflow(compiled, {})).rejects.toThrow("onInterrupt");
  });

  it("combined workflow: agent_call → set_state → http_call → interrupt → end", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
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
    }) as unknown as typeof fetch;

    try {
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

      const client = mockClient({ "agent-triage": "urgent" });
      const compiled = await compileWorkflow(def, client);
      const result = await runWorkflow(compiled, { note: "asthma" }, {
        onInterrupt: async () => "yes",
      });

      expect(result.state.severity).toBe("urgent");
      expect(result.state.label).toBe("urgent priority");
      expect(result.state.validated).toBe(true);
      expect(result.state.approved).toBe("yes");
      expect(result.iterations).toBe(4);
      expect(result.terminatedBy).toBe("end");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
