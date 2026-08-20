---
prev:
  text: "07 · State graph"
  link: "/examples/07-state-graph"
next: false
---

# 08 — Declarative workflows

The same execution engine that powers `workflow()` and `stateGraph()` is also available as a standalone **JSON / YAML definition format**. You describe the graph as data — nodes, edges, and CEL expressions — then compile and run it. The graph is portable, inspectable, and serialisable; it can be stored in a file, sent over the wire, or version-controlled.

<ConceptGrid>
<ConceptCard title="One engine">`workflow()`, `stateGraph()`, and the JSON DSL all compile to the same `CompiledGraph` and run through `runWorkflow()`.</ConceptCard>
<ConceptCard title="Nine node types">`agent_call`, `switch`, `set_state`, `http_call`, `interrupt`, `wait`, `parallel`, `callback`, `end`.</ConceptCard>
<ConceptCard title="CEL expressions">Inputs, outputs, conditions, and routes are [Common Expression Language](https://cel.dev) strings — compiled once, evaluated per node.</ConceptCard>
<ConceptCard title="Portable & inspectable">The definition is plain JSON. Validate it, analyse reachability, serialise it, diff it.</ConceptCard>
</ConceptGrid>

## Why declarative?

`workflow()` and `stateGraph()` are the right choice when the graph is built in code — the builder API gives you type safety, IDE autocomplete, and inline closures. But some situations call for *data* instead of code:

- **Graphs defined by non-developers** — a clinical lead edits a YAML file that describes the triage flow; no SDK rebuild needed.
- **Graphs stored in a database or CMS** — fetch a JSON document, compile it, run it. Version the graph alongside the data it processes.
- **Graphs shipped over the network** — a service returns a workflow definition; the client compiles and executes it locally with its own `CortiClient`.
- **Static analysis** — `analyzeGraphStructure()` finds unreachable nodes and dead ends before the graph ever runs.
- **Human-in-the-loop checkpoints** — the `interrupt` node yields a checkpoint token you can persist and resume from later, even across process restarts.

::: info
`workflow()` and `stateGraph()` both compile down to a `WorkflowDefinition` internally. The declarative API simply exposes that layer directly — see [Engine unification](#engine-unification) below.
:::

## Definition shape

A `WorkflowDefinition` has four top-level keys: `document`, `nodes`, `edges`, and an optional `state_schema` / `max_iterations`.

```json
{
  "document": {
    "name": "triage-flow",
    "version": "1.0.0",
    "description": "Triage → code → review loop"
  },
  "state_schema": {
    "type": "object",
    "properties": {
      "note":     { "type": "string" },
      "severity": { "type": "string" },
      "codes":    { "type": "string" },
      "approved": { "type": "boolean" }
    },
    "required": ["note"]
  },
  "max_iterations": 25,
  "nodes": [ /* … */ ],
  "edges": [ /* … */ ]
}
```

| Field | Required | Description |
|---|---|---|
| `document` | Yes | Metadata: `{ name, version, description? }`. Used in error messages and logs. |
| `nodes` | Yes | Non-empty array of node objects. Each has `id`, `type`, and (except `end`) `config`. |
| `edges` | Yes | Array of `{ source, target }`. Must include exactly one edge with `source: "__start__"`. |
| `state_schema` | No | JSON Schema for the initial state. Validated with `validateStateSchema()` — not enforced at compile time. |
| `max_iterations` | No (default 25) | Circuit breaker for cycles. Overridable per-run via `opts.maxIterations`. |

### Reserved node IDs

- `__end__` — a node with `type: "end"` that terminates the run. Every definition must include one.
- `__start__` — not a node, but a special edge `source` that marks the entry point. Exactly one edge must use it.

## Node types

Each node has a `type` and a `config` object. The config fields are CEL expression strings (compiled once at build time) unless noted otherwise.

| Type | Purpose | Key config fields |
|---|---|---|
| `agent_call` | Invoke a Corti agent and merge its response into state. | `agent` (ID), `input`, `output`, `route_from?` |
| `switch` | Branch on a CEL condition. No state change. | `cases: [{ when, target }]`, `default` |
| `set_state` | Compute one or more state fields from CEL expressions. | `set: { field: expr }`, `route_from?` |
| `http_call` | Make an HTTP request and map the response into state. | `url`, `method`, `headers?`, `body?`, `output`, `route_from?` |
| `interrupt` | Pause execution and ask an external actor (human-in-the-loop). | `prompt`, `field`, `route_from?` |
| `wait` | Delay execution for a duration or until a timestamp. | `duration?` (seconds), `until?` (ISO 8601), `route_from?` |
| `parallel` | Run multiple sub-graphs concurrently, then join. | `branches: [{ name, node, input }]`, `join: "all" \| "any"`, `output`, `route_from?` |
| `callback` | Run an arbitrary handler function registered by name. | `handler` (name), `output?`, `route_from?` |
| `end` | Terminate the run. No config. | — |

### `agent_call`

```json
{
  "id": "triage",
  "type": "agent_call",
  "config": {
    "agent": "agent_abc123",
    "input": "state.note",
    "output": {
      "severity": "response.text",
      "status":   "response.status"
    },
    "route_from": "state.severity == 'urgent' ? 'coder' : '__end__'"
  }
}
```

`agent` is the agent ID (fetched at compile time via `client.agents.get()` and wrapped in an `AgentHandle`). `input` is a CEL expression evaluated against `state`; the result is sent to the agent. `output` maps response fields into state — the bindings available are `response.text`, `response.status`, and `response.artifacts`.

### `switch`

```json
{
  "id": "route",
  "type": "switch",
  "config": {
    "cases": [
      { "when": "state.severity == 'critical'", "target": "er" },
      { "when": "state.severity == 'urgent'",   "target": "coder" }
    ],
    "default": "__end__"
  }
}
```

Cases are evaluated in order; the first match wins. If none match, the `default` target is used. `switch` does not modify state — it only routes.

### `set_state`

```json
{
  "id": "enrich",
  "type": "set_state",
  "config": {
    "set": {
      "label":     "state.severity + ' priority'",
      "timestamp": "string(timestamp())"
    }
  }
}
```

### `http_call`

```json
{
  "id": "lookup",
  "type": "http_call",
  "config": {
    "url":    "'https://api.example.com/patients/' + state.patientId",
    "method": "GET",
    "headers": { "Authorization": "'Bearer ' + state.token" },
    "output": {
      "patient_name": "response.body.name",
      "patient_age":  "response.body.age"
    }
  }
}
```

For `POST` / `PUT` / `PATCH`, add a `body` CEL expression (evaluated to a JSON object). The `response` binding exposes `response.status`, `response.headers`, and `response.body`. Non-2xx responses throw.

### `callback`

```typescript
{
  id: "normalise",
  type: "callback",
  config: {
    handler: "normaliseFn",
    output: { upper: "result.upper" }
  }
}

// Handler registered at compile time:
handlers["normaliseFn"] = async (state) => ({
  upper: (state.note as string).toUpperCase(),
});
```

`callback` is the escape hatch for logic that doesn't fit a CEL expression — arbitrary code, database queries, SDK calls, etc. The handler receives the current state and returns a partial state patch. If `output` is omitted, all fields from the handler result (except `__next`) are merged directly. A handler can set `__next` in its return value to override routing.

## CEL expressions

All dynamic fields — `input`, `output` values, `when` conditions, `route_from`, `set` values, `url`, `body`, etc. — are [CEL](https://cel.dev) expression strings. They are compiled once by `compileWorkflow()` and evaluated per node execution against a bindings object.

| Binding | Available in | Contents |
|---|---|---|
| `state` | all nodes | The accumulated state object. Fields set by earlier nodes are visible. |
| `response` | `agent_call` output, `http_call` output | `response.text`, `response.status`, `response.artifacts` (agent) or `response.status`, `response.headers`, `response.body` (HTTP). |
| `result` | `callback` output | The raw return value of the handler function. |
| `results` | `parallel` output | Map of branch name → branch final state. |

### Common CEL patterns

```typescript
// String concatenation
"state.severity + ' priority'"

// Conditional routing
"state.severity == 'urgent' ? 'coder' : '__end__'"

// Extract response text
"response.text"

// Build JSON body for an HTTP call
"{\"severity\": state.severity, \"note\": state.note}"

// Access a nested field
"response.body.patient.name"

// Boolean condition for switch
"state.approved == true"
```

::: info
CEL expressions are **compiled at build time**, not evaluated as strings at runtime. A syntax error in a CEL expression throws during `compileWorkflow()` — before any node runs.
:::

## Routing

There are three ways to decide which node runs next:

| Mechanism | Where | How |
|---|---|---|
| Static edge | `edges` array | `{ source: "triage", target: "coder" }` — always go to `coder` after `triage`. |
| `switch` node | Node of type `switch` | Evaluate `cases[].when` in order; first match → its `target`; none → `default`. |
| `route_from` | Any node's config | CEL expression returning a node ID (or `"__end__"`). Overrides the static edge. Useful for agent-decided routing. |

`route_from` takes precedence over a static edge. This lets a single `agent_call` node decide its own successor based on the response — no separate `switch` node needed:

```json
{
  "id": "decider",
  "type": "agent_call",
  "config": {
    "agent": "agent_decider",
    "input": "state.note",
    "output": { "choice": "response.text" },
    "route_from": "state.choice == 'coder' ? 'coder' : '__end__'"
  }
}
```

## Human-in-the-loop

The `interrupt` node pauses execution and asks an external actor for input. There are two modes:

### Callback mode (`runWorkflow`)

Pass an `onInterrupt` callback. The engine calls it with `(nodeName, prompt, state)` and awaits the result:

```typescript
const result = await runWorkflow(compiled, { codes: "J45.909" }, {
  onInterrupt: async (node, prompt, state) => {
    // prompt = "Approve codes: J45.909?"
    // Show to a human, return their answer:
    return "yes";
  },
});
```

### Checkpoint mode (`runWorkflowInteractive` + `resumeWorkflow`)

For long-lived pauses (e.g. waiting for a human to respond in a web UI hours later), use the interactive generator. When an `interrupt` node is reached, the generator yields a `WorkflowInterrupt` with a base64 `checkpoint` token:

```typescript
const gen = runWorkflowInteractive(compiled, { codes: "J45.909" });

const first = await gen.next();
if (first.value.kind === "interrupt") {
  const { prompt, checkpoint } = first.value;
  // Persist checkpoint, show prompt to a human …

  // … later (even in a new process), resume:
  const resumeGen = resumeWorkflow(compiled, checkpoint, "yes");
  const final = await resumeGen.next();
  console.log(final.value.state);   // { codes: "J45.909", approved: "yes" }
}
```

The checkpoint encodes the node ID, full state, step history, and iteration count — everything needed to resume from exactly where the graph paused. Multiple interrupts in a single graph are supported: resume yields the next interrupt, and so on.

## Parallel branches

The declarative `parallel` node runs multiple sub-graphs concurrently — the same concept as the code-level [`parallel()`](/examples/04-parallel), but expressed as data. Each branch starts at a named node with its own initial state (a CEL expression evaluated against the parent state).

```json
{
  "id": "fanout",
  "type": "parallel",
  "config": {
    "branches": [
      { "name": "cardio",  "node": "cardioBranch",  "input": "{ \"note\": state.note }" },
      { "name": "resp",    "node": "respBranch",    "input": "{ \"note\": state.note }" }
    ],
    "join": "all",
    "output": {
      "cardio_result": "results.cardio.result",
      "resp_result":   "results.resp.result"
    }
  }
}
```

`join: "all"` waits for every branch to succeed (throws if any branch fails). `join: "any"` returns as soon as the first branch succeeds. The `results` binding in the `output` expressions is a map of branch name → branch final state.

::: info
This is the same primitive the code-level `parallel()` uses — just expressed as a JSON node instead of a builder call. See [example 04](/examples/04-parallel) for the code-level equivalent.
:::

## YAML support

`parseYamlDefinition()` parses a YAML string into the exact same `WorkflowDefinition` shape. YAML is often more readable for hand-authored graphs:

```yaml
document:
  name: triage-flow
  version: "1.0.0"
  description: Triage → code → review loop

max_iterations: 25

nodes:
  - id: triage
    type: agent_call
    config:
      agent: agent_abc123
      input: state.note
      output:
        severity: response.text

  - id: route
    type: switch
    config:
      cases:
        - when: state.severity == 'urgent'
          target: coder
      default: __end__

  - id: coder
    type: agent_call
    config:
      agent: agent_def456
      input: state.note
      output:
        codes: response.text

  - id: __end__
    type: end

edges:
  - source: __start__
    target: triage
  - source: triage
    target: route
  - source: coder
    target: __end__
```

```typescript
const def = parseYamlDefinition(yamlString);
const compiled = await compileWorkflow(def, client);
const result = await runWorkflow(compiled, { note: "Chest pain..." });
```

## Interactive & resume

`runWorkflowInteractive()` is an async generator that yields on every `interrupt` node. If the graph has no interrupts, it yields once — the final `StateGraphResult`.

| Function | Returns | Purpose |
|---|---|---|
| `runWorkflowInteractive(compiled, state, opts?)` | `AsyncGenerator<WorkflowInterrupt \| StateGraphResult>` | Run until an interrupt or completion. Yields `WorkflowInterrupt` on pause, `StateGraphResult` on completion. |
| `resumeWorkflow(compiled, checkpoint, answer, opts?)` | `AsyncGenerator<WorkflowInterrupt \| StateGraphResult>` | Resume from a checkpoint with the human's answer. Yields subsequent interrupts or the final result. |

## Introspection

### Static analysis

`analyzeGraphStructure()` checks a definition for unreachable nodes and dead ends — without compiling or running it:

```typescript
const { unreachable, deadEnds } = analyzeGraphStructure(def);

if (unreachable.length) {
  console.warn("Unreachable nodes:", unreachable);
}
if (deadEnds.length) {
  console.warn("Dead-end nodes:", deadEnds);
}
```

### State schema validation

`validateStateSchema()` validates the initial state against the `state_schema` field using a JSON Schema validator (Ajv):

```typescript
const { valid, errors } = validateStateSchema(initialState, def.state_schema);
if (!valid) throw new Error("Invalid state: " + errors.join(", "));
```

### Engine unification {#engine-unification}

The declarative engine is not a separate runtime — it *is* the runtime. Every composition primitive in the SDK compiles down to a `WorkflowDefinition` before execution:

| Builder API | Underlying definition |
|---|---|
| `workflow([step1, step2, …])` | Linear chain of `callback` nodes (`step_0` → `step_1` → … → `__end__`) with `when` / `transform` / retry logic in the handler. |
| `stateGraph().addNode().addEdge()` | Each code-level node becomes a `callback` node; each edge becomes a static edge or a `route_from` expression. `END` → `"__end__"`. |
| `parallel([a, b, c])` | Used inside `workflow()` as a runnable wrapper; the declarative `parallel` node is the data-level equivalent for DSL graphs. |

You can inspect or export the definition a builder produced:

```typescript
const graph = stateGraph<MyState>()
  .addNode("triage", agentNode(triageAgent, s => s.note, (r) => ({ severity: r.text ?? "" })))
  .addEdge("triage", s => s.severity.includes("urgent") ? "coder" : END)
  .addNode("coder", agentNode(coderAgent, s => s.note, (r) => ({ codes: r.text ?? "" })))
  .addEdge("coder", END);

// Export to portable JSON:
const def = graph.toDefinition("triage");
// def.nodes  → [{ id: "triage", type: "callback", config: { handler: "__cb_triage" } }, …]
// def.edges  → [{ source: "__start__", target: "triage" }, { source: "triage", target: "coder" }, …]

// Round-trip through the declarative API:
const compiled = await compileWorkflow(def, client, handlers);
const result = await runWorkflow(compiled, initialState);
```

::: info
`StateGraph.toDefinition()` returns a valid `WorkflowDefinition` that passes `parseWorkflowDefinition()` — you can serialise it, store it, and re-run it later without the original builder code.
:::

## Full code

Source: `examples/ts/08-declarative-workflows.ts`

```typescript
/**
 * 08 — Declarative workflows (JSON / YAML DSL).
 *
 * Shows the definition format that underlies workflow() and stateGraph().
 * The same engine, exposed as data: parse → compile → run.
 *
 * Run: `npm run declarative-workflows`
 */
import {
  AgentsClient,
  parseWorkflowDefinition,
  compileWorkflow,
  runWorkflow,
  executeWorkflow,
  analyzeGraphStructure,
  runWorkflowInteractive,
  resumeWorkflow,
} from "@newsioaps/agent-sdk";
import { makeClient } from "./_client";

async function main() {
  const client = makeClient();
  const agents = new AgentsClient(client);

  // -- Create the agents the definition will reference ------------------
  const triageAgent = await agents.create({
    name: "dw-triage",
    description: "Classifies clinical urgency.",
    systemPrompt:
      'Read the clinical note and reply with exactly one word: "urgent" or "routine". No punctuation.',
  });

  const coderAgent = await agents.create({
    name: "dw-coder",
    description: "Assigns ICD-10 codes.",
    systemPrompt:
      "Suggest up to three ICD-10 codes. Format: comma-separated codes only.",
  });

  // -- Define the graph as JSON -----------------------------------------
  const definition = {
    document: {
      name: "triage-flow",
      version: "1.0.0",
      description: "Triage → code → review loop",
    },
    max_iterations: 25,
    nodes: [
      {
        id: "triage",
        type: "agent_call",
        config: {
          agent: triageAgent.id,
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
          agent: coderAgent.id,
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
  };

  // -- Validate the definition (throws on structural errors) ------------
  parseWorkflowDefinition(definition);

  // -- Static analysis: find unreachable nodes & dead ends -------------
  const { unreachable, deadEnds } = analyzeGraphStructure(definition);
  if (unreachable.length) console.warn("Unreachable:", unreachable);
  if (deadEnds.length)     console.warn("Dead ends:", deadEnds);

  // -- One-shot: parse + compile + run ----------------------------------
  const result = await executeWorkflow(definition, client, {
    note: "Patient presents with sudden onset chest pain radiating to the left arm.",
  });

  console.log("Severity:", result.state.severity);
  console.log("Codes:",    result.state.codes);
  console.log("Iterations:", result.iterations);
  console.log("Terminated by:", result.terminatedBy);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## What to expect

<OutputBlock>
<span style="color: #5a6478"># Static analysis (clean graph)</span>
<span style="color: #f99470">Unreachable:</span> []
<span style="color: #f99470">Dead ends:</span> []

<span style="color: #5a6478"># Execution</span>
<span style="color: #f99470">Severity:</span> urgent
<span style="color: #f99470">Codes:</span> I21.9, R07.9, R00.0
<span style="color: #f99470">Iterations:</span> 2
<span style="color: #f99470">Terminated by:</span> end
</OutputBlock>

::: info
The definition above is **plain JSON** — it could have been loaded from a file, fetched from an API, or authored in YAML. The agents it references (`dw-triage`, `dw-coder`) are looked up by ID at compile time.
:::

### Next steps

<ExampleLinks>
<a href="/examples/07-state-graph">07 · State graph<span>The code-level builder API that compiles to this same definition.</span></a>
<a href="/examples/03-workflow">03 · Workflow<span>Linear pipelines — also backed by the declarative engine.</span></a>
<a href="/#declarative-workflows">Declarative workflows concept docs<span>Full API reference for the JSON / YAML DSL.</span></a>
</ExampleLinks>
