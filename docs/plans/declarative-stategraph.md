# Declarative StateGraph — Implementation Plan

## Goal

A server-side, JSON-config-driven workflow engine that executes the same graph pattern as the existing `StateGraph` but from declarative config instead of code.

Customers provide a JSON workflow definition. The engine resolves Corti agents by ID, evaluates CEL expressions for conditions and data mapping, and executes the graph — returning the same `StateGraphResult` shape as the code-first API.

## Background

### Current StateGraph (code-native)

The existing `StateGraph` (`packages/js/src/stateGraph.ts`, 94 lines) is imperative:

- **Nodes**: async functions `(state) => Partial<state>` — arbitrary code closures
- **Edges**: static string | `END` symbol | routing function `(state) => string | END` — arbitrary code
- **State**: free-form dict, shallow-merged after each node
- **`agentNode()`**: adapter wrapping an `AgentHandle` + `getInput`/`mergeResponse` lambdas into a `NodeFn`
- **Execution**: while-loop bounded by `maxIterations` (default 25)
- **No serialization** — graphs are built imperatively, nodes/edges are function closures

The non-serializable parts are: (1) node functions and (2) edge routing functions. But `agentNode()` reveals that most real nodes are:
1. Call an agent (by ID/name)
2. Extract input from a state field
3. Merge response into a state field

And most routing is:
1. Check a state field against a value
2. Return a node name or END

This means a declarative config can capture the vast majority of real workflows.

### Prior art surveyed

| Project | Format | Relevance | Verdict |
|---|---|---|---|
| **Agent Workflow Protocol** (benvdbergh/workflows) | JSON/YAML, 11 node types, jq conditions | Closest design match | Rejected as dependency — 0 stars, solo draft, no governance |
| **Microsoft Agent Framework Declarative Workflows 1.0** | YAML, Power Fx expressions | Agent-specific, just released Jul 2026 | Reference for design, not a dependency |
| **Serverless Workflow (CNCF)** | YAML, states + transitions, JSONPath | Mature, multi-runtime | General-purpose, not agent-specific. Considered as base but too different from our graph model |
| **Conductor** (Netflix) | JSON, tasks + operators | Production-grade | General workflow orchestration, not agent-specific |
| **Google ADK Graph Workflows** | Code (Python/Go) | Agent-decided routing pattern | Reference for `route_from` design |
| **XState v5** | JSON/JS object | State machines with context | Not agent-specific, no agent invocation concept |
| **PayPal Declarative Agent Pipeline Language** | Builder → JSON IR | Academic, production-tested at PayPal | Reference for cross-platform IR design |

### Expression language comparison

| Language | Used by | Typed | Implementations | Verdict |
|---|---|---|---|---|
| **CEL** (Common Expression Language) | Kubernetes, Google Cloud | Yes, gradual | Go, JS, Python, Java | Chosen — typed, non-Turing complete, safe, C-like syntax, multi-language |
| jq | Agent Workflow Protocol, shell | No | C, Go, JS, Python | JSON-native but less typed, can't do string concat for data mapping |
| JMESPath | AWS CLI | No | JS, Python, Go | JSON querying, weaker for conditions |
| JSONPath (RFC 9535) | Conductor, many | No | 50+ implementations | Path queries only, not conditions |
| Power Fx | Microsoft Agent Framework | Yes | JS, .NET | Excel-like, Microsoft ecosystem only |

### CEL verification

| Language | Package | Version | License | Status |
|---|---|---|---|---|
| TypeScript | `@bufbuild/cel` | 0.6.0 | Apache-2.0 | Buf team, beta, `run(expr, bindings)` API works on plain JS objects |
| Python | `celpy` | 0.5.0 | Apache-2.0 | Verified — conditions + string mapping work (requires `json_to_cel()` for dicts) |

### Decisions made

| Decision | Choice | Rationale |
|---|---|---|
| Config format | JSON only (YAML later) | Minimal v1 scope, no YAML parser dep |
| Expression language | CEL via `@bufbuild/cel` | Typed, safe, multi-language for future Python parity |
| Schema | Custom Corti schema | Full control, purpose-built for A2A/Corti, no external spec dependency |
| MVP node types | `agent_call`, `switch`, `end` | Covers current StateGraph use cases declaratively |
| Agent resolution | Eager at compile time | Fails fast, runtime is faster |
| Scope | TypeScript only | Python SDK needs rebuild regardless |
| Backward compat bridge | Not in v1 | New API alongside existing `stateGraph()` |
| JSON Schema validation | Hand-written (no `ajv`) | Only 3 node types, ~10 fields — not worth the dep |
| Routing | Static edges + CEL conditions + agent-decided (`route_from`) | All three patterns supported |

## Architecture

```
Customer writes JSON config
    │
    ▼
parseWorkflowDefinition()  ──▶  structural validation (hand-written)
    │
    ▼
compileWorkflow(def, client)  ──▶  CEL pre-compilation
    │                               agent resolution (eager fetch)
    │                               graph structure validation
    ▼
CompiledGraph (in-memory, ready to execute)
    │
    ▼
runWorkflow(compiled, initialState)  ──▶  while-loop executor
    │                                       same pattern as StateGraph.run()
    ▼
StateGraphResult { state, steps, iterations, terminatedBy }
```

## Phased outcomes

### Phase 1: Foundation — Parser + Types + CEL Adapter

**Deliverable**: `parseWorkflowDefinition()` works, CEL expressions can be compiled and evaluated.

**Files**:
- `packages/js/src/declarativeGraph.ts` (types + parser + CEL adapter)
- `packages/js/package.json` (add `@bufbuild/cel` dependency)

**What's built**:

Type definitions:
```typescript
interface WorkflowDefinition {
  document: { name: string; version: string; description?: string };
  state_schema?: object;
  nodes: WorkflowNode[];
  edges: { source: string; target: string }[];
  max_iterations?: number;
}

type WorkflowNode =
  | { id: string; type: "agent_call"; config: AgentCallConfig; retry?: RetryPolicy; timeout?: string }
  | { id: string; type: "switch"; config: SwitchConfig }
  | { id: string; type: "end" };

interface AgentCallConfig {
  agent: string;           // agent ID or name
  input: string;           // CEL expression → agent input (string | Part[])
  output: Record<string, string>;  // state field → CEL expression (evaluated against {state, response})
  route_from?: string;     // CEL expression → next node name (agent-decided routing)
}

interface SwitchConfig {
  cases: { when: string; target: string }[];  // CEL condition → target node
  default: string;  // fallback target (usually "__end__")
}

interface RetryPolicy {
  max_attempts: number;
  backoff_coefficient?: number;
}
```

Parser (`parseWorkflowDefinition`):
- Accept `string` (JSON) or `object` input
- Hand-validate: required top-level fields present, node types only `agent_call`/`switch`/`end`, node IDs unique, an edge with `source: "__start__"` exists (entry point), a node with `id: "__end__"` and `type: "end"` exists, all edge targets reference valid node IDs
- No `ajv` dependency — just typed checks
- Throw descriptive errors on validation failure

`state_schema` is accepted as an optional field for documentation/tooling purposes but **not validated at runtime in v1**. Deferred to when node types grow.

CEL adapter:
- Thin wrapper around `@bufbuild/cel`'s `run(expr, bindings)` API
- Pre-compile expressions at load time (catch syntax errors early)
- Evaluate at runtime with bindings: `{ state: <workflow state>, response: <MessageResponse wrapper> }`
- `response` exposes `.text` (string|null), `.status` (string), `.artifacts` (array)
- Helper functions: `compileCel(expr)`, `evalCel(compiled, bindings)`

**Verification**:
- `npm run build` compiles
- `parseWorkflowDefinition` accepts valid JSON, rejects invalid JSON with clear errors
- CEL expressions compile and evaluate (unit-tested in isolation)

### Phase 2: Compiler — Graph Validation + Agent Resolution

**Deliverable**: `compileWorkflow()` produces a `CompiledGraph` ready to execute.

**Files**:
- `packages/js/src/declarativeGraph.ts` (add compiler section)

**What's built**:

```typescript
async function compileWorkflow(
  def: WorkflowDefinition,
  client: CortiClient
): Promise<CompiledGraph>
```

Compiler steps:
1. Build node lookup `Map<string, CompiledNode>` from `def.nodes`
2. Build edge map `Map<string, string>` from `def.edges` (source → target)
3. Find entry node — the target of the edge with `source: "__start__"`
4. Validate graph structure:
   - Entry node exists
   - All edge targets reference valid node IDs
   - All switch case targets reference valid node IDs
   - All switch nodes have a `default` that references a valid node
   - `__end__` node exists and has type `"end"`
5. Pre-compile all CEL expressions:
   - `agent_call.input` → compiled CEL
   - `agent_call.output` values → compiled CEL (one per field)
   - `agent_call.route_from` (if present) → compiled CEL
   - `switch.cases[].when` → compiled CEL (one per case)
6. **Eagerly fetch all referenced agents**:
   - For each `agent_call` node, call `client.agents.get(config.agent)`
   - Create `AgentHandle` from the returned `Agent` object
   - Cache in the compiled node
   - If agent not found → throw immediately (fail fast)
7. Store `maxIterations` (from config or default 25)

```typescript
interface CompiledGraph {
  definition: WorkflowDefinition;
  nodes: Map<string, CompiledNode>;
  edges: Map<string, string>;  // source → target (static edges, pre-built from def.edges)
  entryNode: string;
  maxIterations: number;
}

interface CompiledNode {
  id: string;
  type: "agent_call" | "switch" | "end";
  config: AgentCallConfig | SwitchConfig | Record<string, never>;
  // Pre-compiled CEL:
  inputExpr?: CompiledCel;           // agent_call
  outputExprs?: Map<string, CompiledCel>;  // agent_call
  routeFromExpr?: CompiledCel;       // agent_call (optional)
  caseExprs?: CompiledCel[];         // switch
  // Eagerly resolved:
  agentHandle?: AgentHandle;        // agent_call
}
```

**Verification**:
- `compileWorkflow` rejects configs with bad graph structure (missing entry, dangling edges, invalid switch targets)
- `compileWorkflow` rejects configs with bad CEL expressions (syntax errors caught at compile time)
- `compileWorkflow` fetches agents eagerly — fails if an agent ID doesn't resolve
- Compiled graph contains pre-compiled CEL and cached AgentHandles

### Phase 3: Executor — Run the Graph

**Deliverable**: `runWorkflow()` executes the graph and returns `StateGraphResult`.

**Files**:
- `packages/js/src/declarativeGraph.ts` (add executor section)
- `packages/js/src/__tests__/declarativeGraph.test.ts` (all tests)

**What's built**:

```typescript
async function runWorkflow(
  compiled: CompiledGraph,
  initialState: Record<string, unknown>,
  opts?: { maxIterations?: number }
): Promise<StateGraphResult>
```

Executor algorithm (same while-loop pattern as `StateGraph.run()` at `stateGraph.ts:44-81`):

```
1. current = compiled.entryNode
2. state = { ...initialState }
3. steps = []
4. iterations = 0
5. terminatedBy = "end"

6. while current !== "__end__":
   a. if iterations >= maxIterations:
      terminatedBy = "maxIterations"
      break

   b. node = compiled.nodes.get(current)
      if !node: throw Error(`Unknown node: "${current}"`)

   c. switch on node.type:
      - "agent_call":
        i.   Evaluate node.inputExpr against { state } → agentInput
        ii.  response = await node.agentHandle.run(agentInput)
        iii. delta = {}
        iv.   For each (field, expr) in node.outputExprs:
             Evaluate expr against { state, response } → value
             state[field] = value
             delta[field] = value
        v.   If node.routeFromExpr:
             next = evalCel(node.routeFromExpr, { state })
        vi.  Else:
             next = compiled.edges.get(current)

      - "switch":
        i.   delta = {}
        ii.  For each (case, expr) in node.caseExprs:
             If evalCel(expr, { state }) is truthy:
               next = case.target
               break
        iii. If no case matched: next = node.config.default

      - "end":
        delta = {}
        next = "__end__"

   d. steps.push({ node: current, delta, state: { ...state } })
   e. iterations++

   f. if next is undefined:
      terminatedBy = "noEdge"
      break

   g. current = next

7. return { state, steps, iterations, terminatedBy }
```

**`response` binding**: The `MessageResponse` from `agent.run()` is wrapped for CEL access:
```typescript
{
  text: response.text,      // string | null
  status: response.status,  // string | undefined
  artifacts: response.artifacts  // Artifact[]
}
```

**Convenience function**:
```typescript
async function executeWorkflow(
  json: string | object,
  client: CortiClient,
  initialState: Record<string, unknown>,
  opts?: { maxIterations?: number }
): Promise<StateGraphResult> {
  const def = parseWorkflowDefinition(json);
  const compiled = await compileWorkflow(def, client);
  return runWorkflow(compiled, initialState, opts);
}
```

**Reuse from existing code**:
- Import `StateGraphResult`, `StateGraphStep` types from `./stateGraph.js`
- Import `CortiClient` from `./client.js`
- Import `AgentHandle` from `./handle.js`
- Import `MessageResponse` from `./response.js`

### Phase 4: Exports + Integration

**Deliverable**: Package exports updated, build passes, all tests green.

**Files**:
- `packages/js/src/index.ts` (add exports)
- `packages/js/package.json` (dependency already added in Phase 1)

**Exports added to `index.ts`**:
```typescript
export { parseWorkflowDefinition, compileWorkflow, runWorkflow, executeWorkflow } from "./declarativeGraph.js";
export type { WorkflowDefinition, WorkflowNode, CompiledGraph, AgentCallConfig, SwitchConfig } from "./declarativeGraph.js";
```

### Phase 5: Tests

**Deliverable**: 14 test cases covering parser, compiler, executor, and convenience API.

**File**: `packages/js/src/__tests__/declarativeGraph.test.ts`

**Ported from `stateGraph.test.ts`** (adapted to declarative config):

1. **Linear graph** — `agent_call` → `agent_call` → `end`. Verify state accumulation, iterations, terminatedBy.
2. **Conditional routing** — `switch` with CEL `when` routes to correct branch.
3. **Route to end when condition is false** — `switch` `default` → `__end__`.
4. **Cycles bounded by maxIterations** — `switch` routes back to previous node, loop breaks at `max_iterations`.
5. **Stop at maxIterations** — infinite loop, verify `terminatedBy: "maxIterations"`.
6. **noEdge when node has no outgoing edge** — verify `terminatedBy: "noEdge"`.
7. **Throw on unknown node** — edge references non-existent node → error.
8. **`agent_call` wraps AgentHandle** — mock `CortiClient`, verify agent is called and response merged into state.

**New tests**:

9. **Reject invalid JSON** — missing `document`, missing `nodes`, bad node type, duplicate node IDs, missing `__start__`/`__end__`.
10. **CEL compilation errors** — bad CEL syntax in `when`/`input`/`output` → error at compile time, not runtime.
11. **Agent-decided routing** — `route_from` CEL expression returns next node name.
12. **`output` mapping** — `response.text` → `state.codes`, verify state has the mapped value.
13. **Multiple switch cases with default fallback** — first case matches, second case matches, neither matches → default.
14. **`executeWorkflow` one-shot** — parse + compile + run in one call, verify full result.

**Mock pattern** (from existing `stateGraph.test.ts:99-140`):
```typescript
const mockClient = {
  raw: {
    POST: vi.fn().mockResolvedValue({
      data: {
        task: {
          id: "task.1",
          contextId: "ctx.1",
          status: {
            state: "TASK_STATE_COMPLETED",
            message: { role: "ROLE_AGENT", parts: [{ text: "J45.909" }], messageId: "msg.1" },
          },
        },
      },
      response: { ok: true },
    }),
  },
} as unknown as CortiClient;
```

For `compileWorkflow` tests that need `client.agents.get()`, mock:
```typescript
const mockClient = {
  agents: {
    get: vi.fn().mockResolvedValue({ id: "agent-1", name: "coder", /* ... */ }),
  },
  raw: { /* POST mock as above */ },
} as unknown as CortiClient;
```

## Final file inventory (v1)

| File | Action | Est. LOC |
|---|---|---|
| `packages/js/src/declarativeGraph.ts` | New | ~200 |
| `packages/js/src/__tests__/declarativeGraph.test.ts` | New | ~220 |
| `packages/js/src/index.ts` | Edit (+5 lines) | ~5 |
| `packages/js/package.json` | Edit (+1 dep) | ~1 |
| **Total** | | **~425** |

For context: current `stateGraph.ts` is 94 lines. This is ~4.5x that, covering parser + CEL adapter + compiler + executor + types.

### Projected file inventory (after Phase 2/3)

| File | Action | Est. LOC delta |
|---|---|---|
| `packages/js/src/declarativeGraph.ts` | Edit | +150 (new node types) |
| `packages/js/src/__tests__/declarativeGraph.test.ts` | Edit | +200 (new test cases) |
| `packages/js/src/index.ts` | Edit | +5 (new type exports) |
| `packages/js/src/mcpTools.ts` | New (Phase 3) | ~80 (MCP tool-call resource, blocked on API) |
| **Total** | | **~435 additional** |

## What's NOT in v1 (deferred)

| Feature | Reason | When |
|---|---|---|
| YAML authoring | Avoid `js-yaml` dep in v1 | Phase 2 |
| Python SDK | Needs rebuild regardless | Separate effort |
| Additional node types | See [Phase 2/3 node types](#phase-2--3-additional-node-types) below | Phase 2/3 |
| Backward-compat bridge (`stateGraphToDefinition`) | Needs `agentNode()` to store config metadata | Phase 2 |
| JSON Schema validation (ajv) | Hand-written validation is enough for 3 node types | When node types grow |
| Checkpoint/resume | Needs persistence layer | Phase 3+ |
| State schema runtime validation | CEL type-checking covers most cases | When needed |
| Graph structure analysis (dead-ends, unreachable nodes) | Basic validation in v1, deeper analysis later | Phase 2 |

## Phase 2 / 3: Additional node types

### Design principles

1. Every new node type follows the existing pattern: a `config` object, CEL expressions for dynamic values, `route_from` for agent-decided routing, and static edges for default routing.
2. The executor `while`-loop stays the same — each node type is a new branch in the `switch on node.type`. No structural changes to the executor.
3. The parser's `validNodeTypes` set grows by one per new type. Each type adds a focused validation function.
4. `route_from` is available on all non-terminal node types (anything that's not `end`).

### `set_state` — Pure state transform (Phase 2)

**Purpose**: Transform state via CEL expressions without calling an agent or making I/O requests. Replaces the most common use case for custom code nodes: "set field X to an expression of state fields."

**Config**:
```typescript
{ id: string; type: "set_state"; config: SetStateConfig }

interface SetStateConfig {
  set: Record<string, string>;  // state field → CEL expression (evaluated against {state})
  route_from?: string;
}
```

**Example**:
```json
{
  "id": "enrich",
  "type": "set_state",
  "config": {
    "set": {
      "full_text": "state.note + ' — severity: ' + state.severity",
      "word_count": "state.note.size()"
    }
  }
}
```

**Executor behavior**:
- For each `(field, expr)` in `set`: evaluate CEL against `{state}`, write to `state[field]`
- Routing: `route_from` if present, else static edge
- No I/O, no agent call

**Compilation**: Pre-compile all `set` CEL expressions + `route_from` (if present)

**Complexity**: Low — same as `switch` minus the routing logic. ~20 LOC in executor, ~10 LOC in compiler.

### `http_call` — HTTP endpoint call (Phase 2)

**Purpose**: Call any HTTP endpoint and map the response into state. Covers webhooks, external APIs, database lookups via REST — anything with a URL.

**Config**:
```typescript
{ id: string; type: "http_call"; config: HttpCallConfig; retry?: RetryPolicy; timeout?: string }

interface HttpCallConfig {
  url: string;                      // CEL expression → URL string
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>; // header name → CEL expression
  body?: string;                    // CEL expression → JSON-serialisable value
  output: Record<string, string>;   // state field → CEL expression (evaluated against {state, response})
  route_from?: string;
}
```

**Response binding** (available in `output` CEL expressions):
```typescript
{
  status: number,                    // HTTP status code
  headers: Record<string, string>,   // response headers
  body: unknown                       // parsed JSON body (or raw text if not JSON)
}
```

**Example**:
```json
{
  "id": "lookup-patient",
  "type": "http_call",
  "config": {
    "url": "'https://api.example.com/patients/' + state.patientId",
    "method": "GET",
    "headers": { "Authorization": "'Bearer ' + state.token" },
    "output": {
      "patient_name": "response.body.name",
      "patient_age": "response.body.age"
    }
  }
}
```

**Executor behavior**:
1. Evaluate `url`, `method`, `headers`, `body` CEL expressions against `{state}`
2. Make HTTP request (using the same `fetch` available to the SDK)
3. Parse response — JSON if `Content-Type: application/json`, else raw text
4. For each `(field, expr)` in `output`: evaluate CEL against `{state, response}`, write to `state[field]`
5. Routing: `route_from` if present, else static edge

**Compilation**: Pre-compile `url`, `headers`, `body`, all `output`, `route_from` CEL expressions

**Complexity**: Medium — needs HTTP fetch logic, response parsing, error handling for non-2xx responses. ~40 LOC in executor, ~15 LOC in compiler.

**Risk**: Network failures, timeouts. Mitigation: `retry` policy (already in the type system) + `timeout` field.

### `interrupt` — Human-in-the-loop (Phase 3)

**Purpose**: Pause execution, ask a human for input, resume with their answer. Two modes: callback (simple, in-process) and checkpoint (durable, cross-session).

#### Mode 1: Callback (Phase 3a)

**Config**:
```typescript
{ id: string; type: "interrupt"; config: InterruptConfig }

interface InterruptConfig {
  prompt: string;     // CEL expression → prompt string (what to ask the human)
  field: string;      // state field to store the human's answer
  route_from?: string; // CEL expression → next node (evaluated after resume)
}
```

**Runner API**:
```typescript
async function runWorkflow(
  compiled: CompiledGraph,
  initialState: AnyState,
  opts?: {
    maxIterations?: number;
    onInterrupt?: (node: string, prompt: string, state: AnyState) => Promise<unknown>;
  },
): Promise<StateGraphResult<AnyState>>;
```

**Executor behavior**:
1. Evaluate `prompt` CEL against `{state}` → prompt string
2. Call `opts.onInterrupt(node.id, prompt, state)` → human answer
3. Store answer in `state[field]`
4. Routing: `route_from` if present, else static edge

**Example**:
```json
{
  "id": "review",
  "type": "interrupt",
  "config": {
    "prompt": "'Review these codes: ' + state.codes + '. Approve?'",
    "field": "approved",
    "route_from": "state.approved == 'yes' ? 'finalize' : '__end__'"
  }
}
```

**Runner usage**:
```typescript
const result = await runWorkflow(compiled, { note: "asthma" }, {
  onInterrupt: async (node, prompt, state) => {
    const answer = await showUserPrompt(prompt); // your UI code
    return answer;
  },
});
```

**Compilation**: Pre-compile `prompt` and `route_from` CEL expressions

**Complexity**: Low-medium — ~15 LOC in executor. The complexity is in the caller's `onInterrupt` implementation, not the engine.

#### Mode 2: Checkpoint/resume (Phase 3b)

**Purpose**: Durable interrupts that survive process restarts. The executor yields a checkpoint, the caller persists it, and a later process resumes with the human's answer.

**Runner API**:
```typescript
interface WorkflowInterrupt {
  kind: "interrupt";
  node: string;
  prompt: string;
  state: AnyState;
  checkpoint: string;  // opaque token encoding position + state
}

interface StateGraphResult<S> {
  state: S;
  steps: StateGraphStep<S>[];
  iterations: number;
  terminatedBy: "end" | "maxIterations" | "noEdge" | "interrupted";
}

async function* runWorkflowInteractive(
  compiled: CompiledGraph,
  initialState: AnyState,
  opts?: { maxIterations?: number },
): AsyncGenerator<WorkflowInterrupt | StateGraphResult<AnyState>>;

async function resumeWorkflow(
  compiled: CompiledGraph,
  checkpoint: string,
  interruptResult: unknown,
): Promise<AsyncGenerator<WorkflowInterrupt | StateGraphResult<AnyState>>>;
```

**Checkpoint format** (base64-encoded JSON):
```typescript
{ nodeId: string; state: AnyState; steps: StateGraphStep[]; iterations: number }
```

**Complexity**: High — requires serialising/resuming executor state, changing the return type, adding `resumeWorkflow`. ~80 LOC. Blocked on a persistence story (where to store checkpoints).

**Decision**: Phase 3a (callback) ships first. Phase 3b (checkpoint) waits until we have a use case that needs cross-session persistence.

### `tool_call` — MCP tool invocation (Phase 3)

**Purpose**: Call a specific tool on an MCP connector attached to an agent. Unlike `agent_call` (which sends a message and gets a response), `tool_call` invokes a named tool directly.

**Config**:
```typescript
{ id: string; type: "tool_call"; config: ToolCallConfig; retry?: RetryPolicy; timeout?: string }

interface ToolCallConfig {
  agent: string;      // agent ID (whose connector to use)
  connector: string;  // connector name (which MCP server)
  tool: string;       // tool name
  input: string;      // CEL expression → tool input (object)
  output: Record<string, string>;   // state field → CEL expression (evaluated against {state, response})
  route_from?: string;
}
```

**Response binding**:
```typescript
{
  result: unknown,    // tool output
  error: string | null // error message if tool failed
}
```

**Executor behavior**:
1. Evaluate `input` CEL against `{state}` → tool input object
2. Invoke the MCP tool via the agent's connector
3. For each `(field, expr)` in `output`: evaluate CEL against `{state, response}`, write to `state[field]`
4. Routing: `route_from` if present, else static edge

**Compilation**: Pre-compile `input`, all `output`, `route_from` CEL. Resolve agent + connector at compile time (eager fetch, same as `agent_call`).

**Complexity**: Medium — depends on MCP tool invocation API. The A2A protocol supports tool calling, but the SDK doesn't yet expose it directly. Needs investigation of the MCP tool call endpoint.

**Blocker**: The SDK needs an MCP tool-call resource first. This is a separate effort.

### `parallel` — Fan-out execution (Phase 3)

**Purpose**: Run multiple branches concurrently, merge results, continue.

**Config**:
```typescript
{ id: string; type: "parallel"; config: ParallelConfig }

interface ParallelConfig {
  branches: {
    name: string;       // branch identifier
    node: string;       // entry node for this branch
    input: string;      // CEL expression → branch initial state
  }[];
  join: "all" | "any";  // wait for all branches or first success
  output: Record<string, string>;  // state field → CEL expression (evaluated against {state, results})
  route_from?: string;
}
```

**Results binding**:
```typescript
{
  results: Record<string, unknown>  // branch name → final state of that branch
}
```

**Executor behavior**:
1. For each branch: evaluate `input` CEL against `{state}` → branch initial state
2. Run all branches concurrently (each is a sub-execution of the graph from `node` to `__end__`)
3. Wait for `all` or `any` to complete
4. Evaluate `output` CEL expressions against `{state, results}` → merge into state
5. Routing: `route_from` if present, else static edge

**Complexity**: High — requires recursive sub-execution, concurrent branch management, merge strategy. ~100 LOC. Changes to `CompiledGraph` to support nested graphs.

**Risk**: Branch failure handling, what happens to in-flight branches when `join: "any"` completes. Needs careful error semantics.

### `subworkflow` — Run another workflow (Phase 3)

**Purpose**: Invoke another workflow definition as a node, merge its output into state.

**Config**:
```typescript
{ id: string; type: "subworkflow"; config: SubworkflowConfig; retry?: RetryPolicy; timeout?: string }

interface SubworkflowConfig {
  workflow: string;   // workflow ID (from a registry) or inline definition
  input: string;       // CEL expression → subworkflow initial state
  output: Record<string, string>;  // state field → CEL expression (evaluated against {state, result})
  route_from?: string;
}
```

**Result binding**:
```typescript
{
  state: AnyState,       // final state of subworkflow
  iterations: number,    // iterations subworkflow took
  terminatedBy: string   // how subworkflow ended
}
```

**Compilation**: If `workflow` is an inline definition, compile it recursively. If it's an ID, fetch from a workflow registry (doesn't exist yet — needs a `WorkflowsResource`).

**Complexity**: Medium — recursive `compileWorkflow` + `runWorkflow` call. ~30 LOC. Blocked on workflow registry for the ID case.

**Blocker**: No workflow registry exists in the SDK or API. Inline definitions work without one, but the ID case needs a `WorkflowsResource`.

### `wait` — Delay (Phase 3)

**Purpose**: Pause execution for a duration or until a timestamp.

**Config**:
```typescript
{ id: string; type: "wait"; config: WaitConfig }

interface WaitConfig {
  duration?: string;   // CEL expression → seconds to wait
  until?: string;       // CEL expression → ISO 8601 timestamp to wait until
  route_from?: string;
}
```

**Executor behavior**:
1. Evaluate `duration` or `until` CEL against `{state}`
2. `await sleep(durationSeconds)` or `await sleep(untilTimestamp - now)`
3. No state changes (delta = {})
4. Routing: `route_from` if present, else static edge

**Complexity**: Low — ~10 LOC. Standard `setTimeout` wrapper.

**Risk**: Long waits block the event loop. Mitigation: document that `wait` is for short delays; for long pauses use `interrupt` + checkpoint.

### Implementation order

| Phase | Node type | Complexity | Blocked by |
|---|---|---|---|
| 2 | `set_state` | Low | Nothing |
| 2 | `http_call` | Medium | Nothing |
| 3a | `interrupt` (callback) | Low-medium | Nothing |
| 3 | `tool_call` | Medium | MCP tool-call API in SDK |
| 3 | `parallel` | High | Nothing (but needs careful design) |
| 3 | `subworkflow` | Medium | Workflow registry for ID case |
| 3 | `wait` | Low | Nothing |
| 3b | `interrupt` (checkpoint) | High | Persistence layer |
| - | Backward-compat bridge | Medium | `agentNode()` config metadata |
| - | JSON Schema validation (ajv) | Low | >6 node types (justifies the dep) |

### Impact on existing code

Adding a new node type touches:

1. **`WorkflowNode` union** — add the new variant
2. **`CompiledNode`** — add new optional fields for pre-compiled expressions
3. **`parseWorkflowDefinition`** — add type to `validNodeTypes`, add config validation for the new type
4. **`compileWorkflow`** — add a branch to pre-compile the new type's CEL expressions
5. **`runWorkflow`** — add a branch in the `switch on node.type`
6. **`index.ts`** — export new config type
7. **Tests** — add test cases for the new type

Each new type is additive — no existing tests or behavior change. The `validNodeTypes` set is the gatekeeper.

## Complexity assessment

| Component | Complexity | Risk | Mitigation |
|---|---|---|---|
| Executor while-loop | Low | None — same pattern as existing `StateGraph.run()` | — |
| Type definitions | Low | None | — |
| Hand-written parser/validator | Low-medium | Will grow as node types are added | Keep validation functions small and composable |
| CEL adapter | Medium | `@bufbuild/cel` is beta (35 stars); need to verify field access on plain objects, string concat, null handling | Test CEL expressions thoroughly in Phase 1 |
| Graph structure validation | Medium | Reachability, dead-end detection | Standard algorithms, well-understood |
| Agent resolution | Medium | `client.agents.get()` is async, needs to fit in compile step | `compileWorkflow` is async — natural fit |
| `response` binding for CEL | Low-medium | Need to expose `MessageResponse` fields cleanly | Thin wrapper object |
| `set_state` node | Low | None — pure CEL evaluation | — |
| `http_call` node | Medium | Network failures, timeout, non-JSON responses | `retry` policy + `timeout` field |
| `interrupt` (callback) | Low-medium | Caller must implement `onInterrupt` | Document the contract clearly |
| `interrupt` (checkpoint) | High | Serialising/resuming executor state, persistence | Phase 3b — wait for persistence story |
| `tool_call` node | Medium | MCP tool-call API not yet in SDK | Blocked on MCP tool-call resource |
| `parallel` node | High | Branch failure, join semantics, concurrent state | Careful design + dedicated test suite |
| `subworkflow` node | Medium | Workflow registry doesn't exist | Inline definitions work without registry |
| `wait` node | Low | Blocks event loop on long waits | Document short-delay only; use `interrupt` for long pauses |
