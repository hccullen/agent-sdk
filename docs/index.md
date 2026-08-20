---
title: "@newsioaps/agent-sdk — docs"
description: Developer-friendly wrapper for building agents with the Corti SDK.
---

# @newsioaps/agent-sdk

A thin, opinionated wrapper around the Corti SDK that makes building multi-agent systems feel like writing ordinary TypeScript — no raw `experts` arrays, no manual context plumbing, no boilerplate for MCP auth.

<ConceptGrid>
<ConceptCard title="Typed connectors">Wire up MCP servers, registry experts, and sub-agents with one-liners.</ConceptCard>
<ConceptCard title="Conversation contexts">Threads are auto-managed — the `contextId` just works.</ConceptCard>
<ConceptCard title="Composable">`workflow()` and `parallel()` give you deterministic pipelines and fan-out.</ConceptCard>
<ConceptCard title="Auth, handled">Forward MCP credentials once — the SDK re-sends on `auth-required`.</ConceptCard>
</ConceptGrid>

## Install

```bash
npm install @newsioaps/agent-sdk @corti/sdk
```

`@corti/sdk` is a peer dependency — install it alongside the wrapper.

## Quick start

```typescript
import { CortiClient } from "@corti/sdk";
import { AgentsClient, connectors } from "@newsioaps/agent-sdk";

const client = new CortiClient({
  tenantName: "my-tenant",
  environment: "eu",
  auth: { clientId: "...", clientSecret: "..." },
});

const agents = new AgentsClient(client);

const agent = await agents.create({
  name: "coder",
  description: "Returns ICD-10 codes for clinical terms.",
  systemPrompt: "Respond with only the ICD-10 code.",
  connectors: [connectors.registry({ name: "coding-expert" })],
});

const ctx = agent.createContext();
const reply = await ctx.sendText("Hypertension?");
console.log(reply.text);        // "I10"
console.log(reply.status);      // "completed"
```

See the [examples](#examples) section below for runnable versions of every pattern on this page.

## Agents

An *agent* is a reusable unit of behaviour — a name, a description, a system prompt, and a set of tools (connectors). `AgentsClient` creates, fetches, and updates them, and returns typed `AgentHandle` objects.

### Creating

```typescript
const agent = await agents.create({
  name: "triage",                   // slug, unique per tenant
  description: "Triage clinical notes.",
  systemPrompt: "Classify the note urgent/routine.",
  lifecycle: "ephemeral",           // default — auto-cleaned
  connectors: [ /* see below */ ],
});
```

### Fetching & listing

```typescript
const existing = await agents.get("agent_abc123");
const all = await agents.list();
```

### Updating

Only the fields you pass are sent. Passing `connectors` **replaces** the full set.

```typescript
const updated = await agent.update({
  systemPrompt: "Be more concise.",
});
```

### Lifecycle: ephemeral vs persistent

Agents default to `lifecycle: "ephemeral"`. This is the right choice for the vast majority of use cases — the server cleans them up automatically and they never accumulate in your tenant.

|  | `ephemeral` (default) | `persistent` |
|---|---|---|
| Cleaned up by server | Yes, automatically | No — call `agent.delete()` |
| Visible in `agents.list()` | No | Yes |
| Survives process restarts | No | Yes — store `agent.id` |
| Best for | Scripts, request handlers, tests | Long-lived bots; avoid recreating on every deploy |

**Use ephemeral unless you have a specific reason not to.** Persistent agents accumulate if you forget to delete them.

```typescript
// Ephemeral (default) — no cleanup needed
const agent = await agents.create({ name: "my-agent", description: "..." });

// Persistent — store the id and reuse it across deploys
const agent = await agents.create({
  name: "my-bot",
  description: "...",
  lifecycle: "persistent",
});
localStorage.set("agentId", agent.id);
```

Note: *lifecycle* controls the agent definition (system prompt, connectors). Conversation threads are always managed automatically — see [Contexts & threads](#contexts).

## Agent lifecycle

Agent lifecycle (`ephemeral` vs `persistent`) is separate from conversation threads. See the [Agents → Lifecycle](#agents) section above for the full comparison table. The short version:

- Use `ephemeral` (the default) for everything — scripts, request handlers, tests. The server cleans up automatically.
- Use `persistent` only when you need the agent definition (system prompt, connectors) to survive process restarts without recreating it.
- Conversation threads are always managed automatically regardless of lifecycle — you never create or delete them manually.

## Connectors

The `connectors` helper turns common expert types into the raw `experts` shape the API expects. Everything is typed.

```typescript
import { connectors } from "@newsioaps/agent-sdk";

connectors.mcp({ mcpUrl: "https://mcp.example.com" });
connectors.registry({ name: "coding-expert" });      // ICD-10 / medical coding
connectors.registry({ name: "web-search-expert" });  // live web search
connectors.fromAgent({ agentId: subAgent.id });
```

Typical registry experts:

| Name | What it does |
|---|---|
| `"coding-expert"` | ICD-10 / medical coding — translates clinical terms to codes |
| `"web-search-expert"` | Live web search — recent guidelines, drug approvals |
| `"pubmed-expert"` | PubMed literature search — finds relevant clinical studies |

Use them together to build a well-rounded clinical orchestrator:

```typescript
const agent = await agents.create({
  name: "clinical-orchestrator",
  description: "Answers clinical questions with coding, search, and literature.",
  systemPrompt: "You are a clinical assistant. Use coding-expert for ICD-10 lookups, web-search-expert for recent guidelines, and pubmed-expert to find supporting studies.",
  connectors: [
    connectors.registry({ name: "coding-expert" }),
    connectors.registry({ name: "web-search-expert" }),
    connectors.registry({ name: "pubmed-expert" }),
  ],
});
```

| Connector | Purpose | Required fields |
|---|---|---|
| `mcp` | Attach an MCP server | `mcpUrl` |
| `registry` | Use a named Corti expert | `name` |
| `fromAgent` | Delegate to another agent | `agentId` |
| `a2a` | A2A protocol (reserved) | — |

### Discovering available registry experts

To see what experts are available in your tenant, call `getRegistryExperts()` on the underlying Corti client:

```typescript
const { experts } = await corti.agents.getRegistryExperts();
// e.g. [{ name: "coding-expert", description: "..." },
//       { name: "web-search-expert", description: "..." },
//       { name: "pubmed-expert", description: "..." }, ...]

// Pass the name directly to connectors.registry:
connectors.registry({ name: experts[0].name })
```

## Contexts & threads

`agent.createContext()` returns an `AgentContext`. It's lazy — no network call happens until the first message. The server assigns a thread ID (`contextId`) on the first response; the SDK tracks it and passes it on every subsequent call automatically.

**You should never need to handle context IDs yourself.** Keep the `AgentContext` object in memory across turns and the thread just works. Only read `ctx.id` if you need to resume the thread after a process restart.

```typescript
const ctx = agent.createContext();

await ctx.sendText("Hi");           // starts the thread
await ctx.sendText("And now?");     // continues the same thread — no extra work
```

### Resuming a thread across sessions

If you need to continue a thread after a process restart, persist `ctx.id` (only available after the first turn) and use `agent.getContext(id)` next time.

```typescript
// Session 1
const ctx = agent.createContext();
await ctx.sendText("Hello");
const savedId = ctx.id!;            // persist this

// Session 2 — resume the same thread
const ctx2 = agent.getContext(savedId);
await ctx2.sendText("What did I say last time?");
```

::: info
This is the *only* valid way to pass a context ID — do not try to construct `AgentContext` yourself or pass IDs to `createContext()`.
:::

### One-shot

```typescript
// No context object needed for single-shot invocations.
const r = await agent.run("What's the ICD-10 code for asthma?");
```

## Response shape

`MessageResponse` wraps the raw A2A v1 response and surfaces the fields you'll reach for 99% of the time.

| Getter | Type | Notes |
|---|---|---|
| `text` | `string?` | Joined text from all text parts. |
| `status` | `TaskState?` | `"completed"`, `"failed"`, `"input-required"`, `"auth-required"`, … |
| `artifacts` | `Artifact[]` | Structured outputs, deduplicated. |
| `contextId` | `string?` | Thread ID. |
| `taskId` | `string?` | This invocation's ID. |
| `raw` | `AgentsMessageSendResponse` | Full response object. |

## Workflows

`workflow()` builds a deterministic chain of steps. Each step's output feeds the next. Steps can be bare `AgentHandle`s, `Parallel` groups, or configuration objects with `when`, `transform`, and `retries`.

```typescript
import { workflow, parallel } from "@newsioaps/agent-sdk";

const result = await workflow([
  summarizer,                                  // bare handle
  classifier,
  {
    agent: escalator,
    when: (prev) => (prev.text ?? "").includes("urgent"),
    transform: () => originalNote,
    retries: 2,
    retryDelay: 500,
  },
]).run(note);

result.output.text;     // last step's text
result.steps.length;    // number of steps actually executed
result.stoppedEarly;    // true if a step failed and halted the run
```

- **`when`** — predicate on the previous response; `false` skips this step and the previous response passes forward unchanged.
- **`transform`** — maps the previous response to this step's input. Default: `prev.text`.
- **`retries`** — additional attempts when a step returns `status: "failed"`.

## Parallel fan-out

`parallel()` runs several agents concurrently on the same input. Use it standalone (`Promise.allSettled`-like output) or drop it straight into a workflow step list — fulfilled results are text-joined for the next step.

```typescript
// Standalone
const { fulfilled, rejected } = await parallel([a, b, c]).run("prompt");

// Inside a workflow
await workflow([
  parallel([a, b, c]),
  merger,
]).run("prompt");
```

Per-step overrides are supported when you need different inputs or credentials per branch:

```typescript
parallel([
  { agent: a, input: "specialised prompt for a" },
  { agent: b, credentials: { "mcp-x": { type: "token", token: "..." } } },
  c,
]);
```

## State graph

A `StateGraph` is a routing graph that carries a typed shared-state object across nodes. Unlike the linear `workflow()`, edges can be routing functions that inspect the accumulated state and return the next node name — or `END` to terminate. Cycles are supported and bounded by `maxIterations` (default 25).

### Concepts

- **State** — a plain typed object that accumulates across every node execution. Each node returns a `Partial<S>` that is shallow-merged in.
- **Nodes** — async functions `(state: S) => Promise<Partial<S>>`. Use `agentNode()` to wrap an `AgentHandle`.
- **Edges** — a static node name, `END`, or a routing function `(state: S) => string | END` that runs *after* the node updates the state.
- **`END`** — sentinel that stops execution. A node with no registered edge also terminates the run.

### Minimal example

```typescript
import { stateGraph, agentNode, END } from "@newsioaps/agent-sdk";

interface TriageState {
  note: string;
  severity: string;
  codes: string;
  approved: boolean;
}

const graph = stateGraph<TriageState>()
  .addNode("triage",
    agentNode(triageAgent,  s => s.note,  (r, s) => ({ ...s, severity: r.text ?? "" })))
  .addNode("coder",
    agentNode(coderAgent,   s => s.note,  (r, s) => ({ ...s, codes: r.text ?? "" })))
  .addNode("reviewer",
    agentNode(reviewerAgent, s => `Note: ${s.note}\nCodes: ${s.codes}`,
      (r, s) => ({ ...s, approved: (r.text ?? "").startsWith("approved") })))
  // Route: only code urgent cases.
  .addEdge("triage",   s => s.severity.includes("urgent") ? "coder" : END)
  .addEdge("coder",    "reviewer")
  // Loop back to coder if reviewer rejects — maxIterations prevents runaway.
  .addEdge("reviewer", s => s.approved ? END : "coder");

const { state, steps, terminatedBy } = await graph.run(
  "triage",
  { note: "Chest pain...", severity: "", codes: "", approved: false },
  { maxIterations: 10 },
);

console.log(state.codes);      // "I20.9, R07.9"
console.log(steps.length);     // number of nodes that ran
console.log(terminatedBy);     // "end" | "maxIterations" | "noEdge"
```

### `agentNode()`

Wraps an `AgentHandle` as a node function. Provide two callbacks: one to extract the agent's input from state, and one to merge the response back.

```typescript
agentNode(
  myAgent,
  (state) => state.input,                     // extract input
  (response, state) => ({ ...state,
    output: response.text ?? "" }),            // merge response
)
```

### Result shape

| Field | Type | Description |
|---|---|---|
| `state` | `S` | Final accumulated state after all nodes ran. |
| `steps` | `StateGraphStep<S>[]` | Per-node history: `node`, `delta`, post-delta `state`. |
| `iterations` | `number` | Total node executions (including repeated nodes in cycles). |
| `terminatedBy` | `"end" \| "maxIterations" \| "noEdge"` | Why the graph stopped. |

### Choosing between `workflow` and `stateGraph`

|  | `workflow()` | `stateGraph()` |
|---|---|---|
| Shape | Linear list of steps | Named nodes with explicit edges |
| Shared state | Previous response text only | Typed object, accumulated |
| Branching | `when` predicate (skip or run) | Routing function (pick any node) |
| Cycles | None | Supported, bounded by `maxIterations` |
| Best for | Known fixed pipelines | Conditional flows, review loops, dynamic routing |

## Declarative workflows

The JSON / YAML definition format is the portable, data-level surface of the same engine that powers `workflow()` and `stateGraph()`. You describe the graph as data — nodes, edges, and [CEL](https://cel.dev) expressions — then `parseWorkflowDefinition()`, `compileWorkflow()`, and `runWorkflow()`.

### Why declarative?

- **Graphs as data** — store them in a file, database, or CMS; version-control them; ship them over the network.
- **Non-developer authoring** — a clinical lead edits a YAML file; no SDK rebuild needed.
- **Static analysis** — `analyzeGraphStructure()` finds unreachable nodes and dead ends before the graph runs.
- **Human-in-the-loop** — `interrupt` nodes yield checkpoint tokens you can persist and resume from later, even across process restarts.

### Node types

Nine node types cover agent calls, conditional routing, state transforms, HTTP calls, human interrupts, waits, parallel fan-out, arbitrary code callbacks, and termination:

| Type | Purpose |
|---|---|
| `agent_call` | Invoke a Corti agent; map response into state. |
| `switch` | Branch on a CEL condition (no state change). |
| `set_state` | Compute state fields from CEL expressions. |
| `http_call` | Make an HTTP request; map response into state. |
| `interrupt` | Pause for human-in-the-loop input. |
| `wait` | Delay for a duration or until a timestamp. |
| `parallel` | Run sub-graphs concurrently, then join. |
| `callback` | Run a registered handler function. |
| `end` | Terminate the run. |

### Minimal example

```typescript
import {
  executeWorkflow,
  parseWorkflowDefinition,
} from "@newsioaps/agent-sdk";

const definition = {
  document: { name: "triage-flow", version: "1.0.0" },
  nodes: [
    {
      id: "triage",
      type: "agent_call",
      config: {
        agent: triageAgent.id,            // looked up at compile time
        input: "state.note",               // CEL: extract from state
        output: { severity: "response.text" }, // CEL: map response → state
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
    { source: "triage",    target: "route" },
    { source: "coder",     target: "__end__" },
  ],
};

parseWorkflowDefinition(definition);          // validate structure
const result = await executeWorkflow(          // parse + compile + run
  definition,
  client,
  { note: "Patient presents with chest pain..." },
);

console.log(result.state.severity);  // "urgent"
console.log(result.state.codes);     // "I21.9, R07.9"
```

### Engine unification

The declarative engine *is* the runtime — `workflow()` and `stateGraph()` both compile down to a `WorkflowDefinition` before execution. You can export a builder-built graph with `StateGraph.toDefinition()`:

```typescript
const graph = stateGraph<TriageState>()
  .addNode("triage", agentNode(triageAgent, s => s.note, (r) => ({ severity: r.text ?? "" })))
  .addEdge("triage", s => s.severity.includes("urgent") ? "coder" : END)
  .addNode("coder", agentNode(coderAgent, s => s.note, (r) => ({ codes: r.text ?? "" })))
  .addEdge("coder", END);

// Export to portable JSON:
const def = graph.toDefinition("triage");

// def.nodes  → [{ id: "triage", type: "callback", config: { handler: "__cb_triage" } }, …]
// def.edges  → [{ source: "__start__", target: "triage" }, { source: "triage", target: "coder" }, …]
```

See [example 08](/examples/08-declarative-workflows) for the full walkthrough — all nine node types, YAML support, human-in-the-loop checkpoints, and static analysis.

## Streaming

```typescript
const stream = await ctx.streamMessage([{ kind: "text", text: "Hello" }]);

for await (const event of stream) {
  if (event.statusUpdate) { /* working → completed/failed */ }
  if (event.message)      { /* partial or final message parts */ }
}
```

`streamMessage` tracks the same `contextId` as `sendMessage` — you can freely mix the two on a single context.

## Credentials

When a connector needs auth, the agent may respond with `status: "auth-required"`. Provide a `CredentialStore` and the SDK:

1. Sends the credentials as a DataPart on the first message of the context, **and**
2. Re-sends them as a follow-up if the agent still asks.

```typescript
const ctx = agent.createContext({
  credentials: {
    "my-mcp":       { type: "token", token: "..." },
    "another-mcp":  { type: "credentials", clientId: "...", clientSecret: "..." },
  },
});
```

Keys in the store are the MCP server names — either the `name` you passed to `connectors.mcp()`, or the hostname-derived default.

## API reference

### `AgentsClient`

| Method | Returns | Purpose |
|---|---|---|
| `create(opts)` | `AgentHandle` | Create a new agent. |
| `get(id)` | `AgentHandle` | Fetch an agent by ID. |
| `list()` | `AgentHandle[]` | List all agents. |
| `wrap(raw)` | `AgentHandle` | Wrap an existing raw agent — no network call. |

### `AgentHandle`

| Member | Type | Purpose |
|---|---|---|
| `id`, `name`, `description`, `systemPrompt`, `raw` | — | Agent metadata. |
| `createContext(opts?)` | `AgentContext` | Start a new (lazy) thread. `opts.credentials` are auto-forwarded on `auth-required`. |
| `getContext(contextId, opts?)` | `AgentContext` | Resume an existing thread by ID. Use only when resuming across process restarts. |
| `run(input, opts?)` | `Promise<MessageResponse>` | One-shot invoke. `opts`: `{ credentials?, timeoutInSeconds? }`. |
| `update(opts)` | `Promise<AgentHandle>` | Partial update; returns a new handle. |
| `refresh()` | `Promise<AgentHandle>` | Re-fetch the latest state. |
| `delete()` | `Promise<void>` | Delete the agent. |

### `AgentContext`

| Member | Type | Purpose |
|---|---|---|
| `id` | `string?` | Thread ID, once known. |
| `sendMessage(parts)` | `Promise<MessageResponse>` | Send rich parts. |
| `sendText(text)` | `Promise<MessageResponse>` | Plain-text shortcut. |
| `streamMessage(parts)` | `Promise<AsyncIterable<StreamEvent>>` | Server-sent stream. |

### Top-level

| Export | Purpose |
|---|---|
| `workflow(steps)` / `Workflow` | Deterministic linear pipeline. |
| `parallel(steps)` / `Parallel` | Concurrent fan-out. |
| `stateGraph()` / `StateGraph` | Typed stateful routing graph with conditional edges and cycles. |
| `agentNode(agent, getInput, merge)` | Wrap an `AgentHandle` as a `StateGraph` node function. |
| `END` | Sentinel returned by edge routers to terminate a `StateGraph` run. |
| `connectors` | Typed connector factories. |
| `MessageResponse` | Response wrapper. |

### Declarative workflow engine

| Export | Purpose |
|---|---|
| `parseWorkflowDefinition(input)` | Validate a JSON object or string as a `WorkflowDefinition`. Throws on structural errors. |
| `parseYamlDefinition(yaml)` | Parse a YAML string into a `WorkflowDefinition`. |
| `compileWorkflow(def, client, handlers?)` | Compile a definition into a `CompiledGraph` (resolves agent IDs, compiles CEL). |
| `runWorkflow(compiled, state, opts?)` | Execute a compiled graph. Returns `StateGraphResult`. |
| `executeWorkflow(json, client, state, opts?)` | One-shot: parse + compile + run. |
| `runWorkflowInteractive(compiled, state, opts?)` | Async generator — yields `WorkflowInterrupt` on pause, `StateGraphResult` on completion. |
| `resumeWorkflow(compiled, checkpoint, answer, opts?)` | Resume from a checkpoint after a human-in-the-loop interrupt. |
| `analyzeGraphStructure(def)` | Static analysis — returns `{ unreachable, deadEnds }`. |
| `validateStateSchema(state, schema)` | Validate state against a JSON Schema (Ajv). |
| `StateGraph.toDefinition(entryNode)` | Export a builder-built graph as a portable `WorkflowDefinition`. |

## Examples

Every pattern on this page has a runnable counterpart under `examples/ts/`. They use the published `@corti/sdk` and the local `@newsioaps/agent-sdk`, and clean up the agents they create. Click any row for a deep-dive walkthrough with annotated code.

| Script | Deep dive | Shows |
|---|---|---|
| `npm run hello` | [01 — Hello, agent](/examples/01-hello-agent) | Create agent, send two messages, conversation threads. |
| `npm run connectors` | [02 — Connectors](/examples/02-connectors) | MCP, registry, and sub-agent connectors; timeout tuning. |
| `npm run workflow` | [03 — Workflow](/examples/03-workflow) | `when`, `transform`, retries, result shape. |
| `npm run parallel` | [04 — Parallel fan-out](/examples/04-parallel) | Concurrent fan-out standalone and inside a workflow. |
| `npm run streaming` | [05 — Streaming](/examples/05-streaming) | Async iteration over `streamMessage()` events. |
| `npm run credentials` | [06 — Credentials](/examples/06-credentials) | Transparent MCP bearer-token forwarding. |
| `npm run state-graph` | [07 — State graph](/examples/07-state-graph) | Typed state, routing functions, reviewer loop, `agentNode()`. |
| `npm run declarative-workflows` | [08 — Declarative workflows](/examples/08-declarative-workflows) | JSON / YAML DSL, nine node types, CEL expressions, HITL checkpoints, `toDefinition()`. |

Setup: `npm install` at the repo root, copy `examples/ts/.env.example` to `.env`, then run any of the scripts above from `examples/ts/`.
