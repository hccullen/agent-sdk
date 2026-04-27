# @newsioaps/agent-sdk

A developer-friendly TypeScript wrapper around the [Corti SDK](https://www.npmjs.com/package/@corti/sdk) for building **multi-agent systems**: single agents, deterministic workflows, parallel fan-out, streaming replies, MCP credentials, and stateful graph routing.

📚 **Full documentation & live examples:** https://hccullen.github.io/agent-sdk
🧪 **Runnable TypeScript examples:** [`examples/ts/`](https://github.com/hccullen/agent-sdk/tree/main/examples/ts)

> **For LLMs reading this:** every section below is a self-contained recipe with full imports, types, and a runnable code block. If you are generating code that uses this package, copy the imports verbatim — they are the public API surface. The `Decision guide` section maps user requests ("I want X") to the right primitive.

---

## Table of contents

- [Install](#install)
- [Setup: the Corti client](#setup-the-corti-client)
- [Public API surface](#public-api-surface)
- [Decision guide — which primitive should I use?](#decision-guide--which-primitive-should-i-use)
- [1. Single agent + conversation context](#1-single-agent--conversation-context)
- [2. Connectors (sub-agents, registry experts, MCP)](#2-connectors-sub-agents-registry-experts-mcp)
- [3. Workflow — deterministic pipelines](#3-workflow--deterministic-pipelines)
- [4. Parallel fan-out](#4-parallel-fan-out)
- [5. Streaming responses](#5-streaming-responses)
- [6. MCP credentials](#6-mcp-credentials)
- [7. State graphs (cycles, shared state, conditional routing)](#7-state-graphs-cycles-shared-state-conditional-routing)
- [`sendText` vs `sendMessage` vs `streamMessage`](#sendtext-vs-sendmessage-vs-streammessage)
- [API reference — methods](#api-reference--methods)
- [API reference — types](#api-reference--types)
- [Common pitfalls](#common-pitfalls)
- [License](#license)

---

## Install

```bash
npm install @newsioaps/agent-sdk @corti/sdk
```

Requirements:

- Node.js **>= 18** (uses native `fetch` and `AsyncIterable`).
- A Corti API tenant with credentials (`CORTI_CLIENT_ID`, `CORTI_CLIENT_SECRET`, `CORTI_TENANT_NAME`, `CORTI_ENVIRONMENT`).
- `@corti/sdk` **>= 1.2.0** as a peer dependency.

The package is ESM-only (`"type": "module"`). For CommonJS projects, use dynamic `import()` or set your project to ESM.

---

## Setup: the Corti client

Every entry point requires a `CortiClient`. Build one once and pass it into `AgentsClient`.

```ts
import { CortiClient } from "@corti/sdk";
import { AgentsClient } from "@newsioaps/agent-sdk";

const corti = new CortiClient({
  auth: {
    clientId: process.env.CORTI_CLIENT_ID!,
    clientSecret: process.env.CORTI_CLIENT_SECRET!,
  },
  tenantName: process.env.CORTI_TENANT_NAME!,
  environment: process.env.CORTI_ENVIRONMENT!, // e.g. "https://api.eu.corti.app"
});

const agents = new AgentsClient(corti);
```

`AgentsClient` is the **only stateful object** you need. From it you create agents, and each agent gives you handles to start conversations.

---

## Public API surface

```ts
// Core
import {
  AgentsClient,        // factory: create / list / get agents
  AgentHandle,         // a created agent (has .id, .createContext(), .run())
  AgentContext,        // a single conversation thread (has .sendText(), .streamMessage())
  MessageResponse,     // result of a non-streaming call (.text, .status, .artifacts)
} from "@newsioaps/agent-sdk";

// Connectors — attach external capabilities to an agent
import { connectors } from "@newsioaps/agent-sdk";
//   connectors.fromAgent({ agentId })           — wire another agent in
//   connectors.registry({ name })               — pull a published Corti expert
//   connectors.mcp({ mcpUrl, name?, authType?, token? })  — attach an MCP server
//   connectors.a2a({ url })                     — attach an A2A endpoint

// Composition primitives
import { workflow, parallel, Workflow, Parallel } from "@newsioaps/agent-sdk";

// State-graph routing (cycles, shared state)
import { stateGraph, agentNode, END, StateGraph } from "@newsioaps/agent-sdk";

// Types
import type {
  CreateAgentOptions, UpdateAgentOptions, Lifecycle,
  ConnectorDef, McpConnector, RegistryConnector, CortiAgentConnector, A2aConnector,
  Credential, CredentialStore, TokenCredential, OAuth2Credential,
  Part, TextPart, DataPart, FilePart,
  Artifact, Message, Task, TaskState, TaskStatus,
  StreamEvent,
  Runnable, WorkflowStep, WorkflowResult, ParallelStep, ParallelResult,
  EdgeRouter, NodeFn, StateGraphStep, StateGraphResult,
} from "@newsioaps/agent-sdk";
```

---

## Decision guide — which primitive should I use?

| You want to...                                                | Use                                  |
| ------------------------------------------------------------- | ------------------------------------ |
| Send one message and get one reply                            | `agent.run(text)` or `ctx.sendText`  |
| Hold a multi-turn conversation                                | `agent.createContext()` + `sendText` |
| Resume a thread from a previous process/session               | `agent.getContext(contextId)`        |
| Stream tokens as the agent writes them                        | `ctx.streamMessage([...])`           |
| Run a fixed pipeline of agents (A → B → C)                    | `workflow([...])`                    |
| Run agents concurrently on the same input                     | `parallel([...])`                    |
| Conditionally branch / loop / share typed state across agents | `stateGraph<State>()`                |
| Attach an MCP server, sub-agent, or registry expert           | `connectors.*` in `create({...})`    |
| Forward a token to an MCP server that requires auth           | `createContext({ credentials })`     |

**Rule of thumb:** start with `workflow`. Only reach for `stateGraph` when you need cycles or branching that depends on accumulated state.

---

## 1. Single agent + conversation context

```ts
import { AgentsClient } from "@newsioaps/agent-sdk";

const agents = new AgentsClient(corti);

const agent = await agents.create({
  name: "hello-agent",
  description: "A minimal greeting agent.",
  systemPrompt: "You are a friendly assistant. Keep replies to one sentence.",
  // lifecycle: "ephemeral" (default) — server cleans up automatically.
  // lifecycle: "persistent" — agent survives process restarts; store the id.
});

// Conversation context — turns share memory automatically.
const ctx = agent.createContext();

const reply = await ctx.sendText("Say hello and tell me one fun fact.");
console.log(reply.text);     // string
console.log(reply.status);   // "completed" | "failed" | "auth-required" | ...

// Follow-ups on the same ctx remember prior turns — no extra work needed.
const follow = await ctx.sendText("Tell me another one.");
```

> **You should never need to manage context IDs yourself.** Keep the `AgentContext`
> object in memory across turns; the SDK tracks the thread automatically. Only
> persist `ctx.id` if you need to resume the exact same thread after a process
> restart — and use `agent.getContext(id)` to do so.

**One-shot helper** (no context object):

```ts
const reply = await agent.run("Summarise this for me.", {
  timeoutInSeconds: 60, // default 60s; raise for orchestrators
});
```

**Resuming a thread across sessions** (rare):

```ts
// Session 1 — save the thread ID somewhere durable
const ctx = agent.createContext();
await ctx.sendText("Hello");
const savedId = ctx.id!;   // ctx.id is set after the first turn

// Session 2 — pick up the conversation
const ctx2 = agent.getContext(savedId);
await ctx2.sendText("What did I say last time?");
```

`MessageResponse` shape:

```ts
interface MessageResponse {
  text: string | undefined;        // joined text parts
  status: TaskState;               // "completed" | "failed" | "auth-required" | ...
  artifacts: Artifact[];           // structured outputs (files, data)
  parts: Part[];                   // raw parts (text, data, file)
  contextId: string | undefined;   // populated on first turn
}
```

---

## Agent lifecycle: ephemeral vs persistent

Agents default to `lifecycle: "ephemeral"`. This is the right choice for the vast majority of use cases.

| | `ephemeral` (default) | `persistent` |
|-|-----------------------|--------------|
| Cleaned up by server | Yes, automatically | No — you must call `agent.delete()` |
| Visible in `agents.list()` | No | Yes |
| Survives process restarts | No | Yes — store `agent.id` |
| When to use | Scripts, request handlers, tests, one-off tasks | Long-lived bots or services where recreating the agent on every deploy is undesirable |

**Use ephemeral unless you have a specific reason not to.** Persistent agents accumulate in your tenant if you forget to delete them.

```ts
// Default — ephemeral, server GCs it
const agent = await agents.create({ name: "my-agent", description: "..." });

// Persistent — outlives this process
const agent = await agents.create({
  name: "my-bot",
  description: "...",
  lifecycle: "persistent",
});
const agentId = agent.id;  // store this; use agents.get(agentId) next time
```

Note: lifecycle controls the **agent** (its definition, system prompt, connectors). The **conversation thread** (`AgentContext`) is always managed for you — you never need to create or delete threads manually.

## 2. Connectors (sub-agents, registry experts, MCP)

Connectors are declared at agent **creation time** in the `connectors` array. The agent can call them autonomously when its prompt suggests doing so.

```ts
import { AgentsClient, connectors } from "@newsioaps/agent-sdk";

// A small worker agent.
const symptomExtractor = await agents.create({
  name: "symptom-extractor",
  description: "Extracts symptoms from a clinical note.",
  systemPrompt:
    "You are a symptom extractor. Reply with ONLY a comma-separated list of symptoms. Never ask for clarification.",
});

// An orchestrator that wires sub-agent + registry experts + (optional) MCP.
// Typical registry experts: "web-search-expert" (live web search),
//                           "coding-expert" (ICD-10 / medical coding).
const orchestrator = await agents.create({
  name: "triage-orchestrator",
  description: "Triages a clinical note.",
  systemPrompt:
    "Pass the note to `symptom-extractor`, then write a one-paragraph triage recommendation.",
  connectors: [
    connectors.fromAgent({ agentId: symptomExtractor.id }),
    connectors.registry({ name: "web-search-expert" }),  // live web search
    connectors.registry({ name: "coding-expert" }),       // ICD-10 / medical coding
    connectors.mcp({
      mcpUrl: "https://my-mcp.example.com",
      name: "my-mcp",         // becomes the credential key (see §6)
      authType: "bearer",
    }),
  ],
});

// Orchestrators fan out — raise the timeout.
const reply = await orchestrator.run(
  "62yo with sudden severe headache, photophobia, neck stiffness.",
  { timeoutInSeconds: 180 },
);
```

Connector helpers:

```ts
connectors.fromAgent({ agentId: string })                     // CortiAgentConnector
connectors.registry({ name: string })                         // RegistryConnector
connectors.mcp({
  mcpUrl: string,
  name?: string,
  authType?: "bearer" | "oauth2" | "none",
  token?: string,                                             // shorthand for static auth
})                                                            // McpConnector
connectors.a2a({ url: string })                               // A2aConnector
```

Typical registry experts (check availability with `getRegistryExperts()` below):

| Name | What it does |
|------|-------------|
| `"web-search-expert"` | Live web search — good for recent guidelines, drug approvals |
| `"coding-expert"` | ICD-10 / medical coding — translates clinical terms to codes |
| `"pubmed-expert"` | PubMed literature search — finds relevant clinical studies |

**Discovering all available registry experts** in your tenant:

```ts
const { experts } = await corti.agents.getRegistryExperts();
// experts: Array<{ name: string; description: string; mcpServers?: ... }>
// Pass expert.name directly to connectors.registry({ name: expert.name })
```

---

## 3. Workflow — deterministic pipelines

A **Workflow** is a fixed list of steps. Each step receives the previous step's response (or a transform of it) and returns a new response.

```ts
import { AgentsClient, workflow } from "@newsioaps/agent-sdk";

const summarizer = await agents.create({ name: "sum", description: "...", systemPrompt: "Summarise in 1 sentence." });
const classifier = await agents.create({ name: "cls", description: "...", systemPrompt: "Reply 'urgent' or 'routine'." });
const escalator  = await agents.create({ name: "esc", description: "...", systemPrompt: "Draft a one-line escalation." });

const note = "Severe chest pain radiating to left arm, onset 30min ago.";

const result = await workflow([
  summarizer,                               // step 1: agent (shorthand)
  classifier,                               // step 2: agent
  {                                         // step 3: full step config
    agent: escalator,
    when: (prev) => (prev.text ?? "").toLowerCase().includes("urgent"),
    transform: () => note,                  // override input to escalator
    retries: 2,
    retryDelay: 500,                        // ms
  },
]).run(note);

console.log(result.output.text);    // final step's text
console.log(result.steps);          // per-step input/output trace
console.log(result.stoppedEarly);   // true if a `when` skipped tail steps
```

Step shapes:

```ts
type WorkflowStep =
  | AgentHandle                         // shorthand
  | Parallel                            // a parallel block (see §4)
  | {
      agent: AgentHandle | Runnable;
      when?: (prev: MessageResponse) => boolean;       // skip if false
      transform?: (prev: MessageResponse) => string | Part[];
      retries?: number;
      retryDelay?: number;
      timeoutInSeconds?: number;
    };
```

---

## 4. Parallel fan-out

`parallel([...]).run(input)` calls every step concurrently with the **same** input. Use it standalone, or drop it into a `workflow` step list.

```ts
import { parallel, workflow } from "@newsioaps/agent-sdk";

// Standalone
const fanout = await parallel([differential, redFlags, workup]).run(presentation);
fanout.fulfilled;   // MessageResponse[] — successful results
fanout.rejected;    // { index, reason }[] — failed steps

// Inside a workflow — fulfilled outputs are joined with newlines and fed to next step.
const { output } = await workflow([
  parallel([differential, redFlags, workup]),
  synthesizer,                  // gets the joined text as input
]).run(presentation);
```

`ParallelResult` shape:

```ts
interface ParallelResult {
  fulfilled: MessageResponse[];
  rejected: { index: number; reason: unknown }[];
}
```

---

## 5. Streaming responses

```ts
import { AgentsClient } from "@newsioaps/agent-sdk";

const agent = await agents.create({
  name: "stream-demo", description: "...",
  systemPrompt: "Reply in 4–6 sentences.",
});

const ctx = agent.createContext();
const stream = await ctx.streamMessage([
  { kind: "text", text: "Describe how photosynthesis works." },
]);

for await (const event of stream) {
  // Status transitions: "submitted" → "working" → "completed" | "failed"
  if (event.statusUpdate) {
    process.stdout.write(`[${event.statusUpdate.status.state}] `);
  }
  // Incremental message parts
  if (event.message) {
    for (const p of event.message.parts) {
      if (p.kind === "text") process.stdout.write(p.text);
    }
  }
  // event.artifact — emitted when the agent attaches structured outputs
}
```

`StreamEvent` shape:

```ts
interface StreamEvent {
  message?: Message;            // a (partial or final) message
  statusUpdate?: { status: TaskStatus; final?: boolean };
  artifact?: { artifact: Artifact };
}
```

---

## 6. MCP credentials

When an MCP connector is declared with `authType: "bearer"`, the agent will reply with status `"auth-required"` until you provide a token. Pass `credentials` to `createContext` (or to `agent.run`) — the SDK forwards them transparently.

The credential **key** must match the connector's `name`.

```ts
import { connectors } from "@newsioaps/agent-sdk";

const agent = await agents.create({
  name: "auth-demo",
  description: "Calls an auth-protected MCP server.",
  connectors: [
    connectors.mcp({ mcpUrl: process.env.MCP_URL!, name: "my-mcp", authType: "bearer" }),
  ],
});

const ctx = agent.createContext({
  credentials: {
    "my-mcp": { type: "token", token: process.env.MCP_TOKEN! },
  },
});

const reply = await ctx.sendText("List the tools you have access to.");
console.log(reply.status);  // "completed"
```

`Credential` union:

```ts
type Credential =
  | { type: "token"; token: string }                                                       // TokenCredential
  | { type: "oauth2"; accessToken: string; refreshToken?: string; expiresAt?: number };    // OAuth2Credential
```

---

## 7. State graphs (cycles, shared state, conditional routing)

When you need **cycles** or branching that depends on accumulated state, use `stateGraph<TState>()`. Each node mutates a typed state object; edges (functions or strings) route to the next node — including loops bounded by `maxIterations`.

```ts
import { stateGraph, agentNode, END } from "@newsioaps/agent-sdk";

interface TriageState {
  note: string;
  severity: string;
  codes: string;
  reviewerFeedback: string;
  approved: boolean;
}

const graph = stateGraph<TriageState>()
  .addNode("triage", agentNode(
    triageAgent,
    (s) => s.note,                                      // build input from state
    (r) => ({ severity: r.text ?? "" }),                // merge response into state
  ))
  .addNode("coder", agentNode(
    coderAgent,
    (s) => s.note,
    (r) => ({ codes: r.text ?? "" }),
  ))
  .addNode("reviewer", agentNode(
    reviewerAgent,
    (s) => `Note: ${s.note}\n\nProposed codes: ${s.codes}`,
    (r) => ({
      reviewerFeedback: r.text ?? "",
      approved: (r.text ?? "").trim().toLowerCase().startsWith("approved"),
    }),
  ))
  .addEdge("triage", (s) =>
    s.severity.toLowerCase().includes("urgent") ? "coder" : END,
  )
  .addEdge("coder", "reviewer")
  .addEdge("reviewer", (s) => (s.approved ? END : "coder"));   // loop on reject

const result = await graph.run("triage", initialState, { maxIterations: 10 });

result.state;          // final TriageState
result.steps;          // per-node deltas
result.iterations;     // number of node executions
result.terminatedBy;   // "END" | "maxIterations" | "error"
```

Custom (non-agent) nodes are also supported — pass a `NodeFn<TState>`:

```ts
type NodeFn<TState> = (state: TState) => Promise<Partial<TState>> | Partial<TState>;

graph.addNode("normalize", (s) => ({ note: s.note.trim().toLowerCase() }));
```

---

## `sendText` vs `sendMessage` vs `streamMessage`

All three live on `AgentContext` and send to the **same** thread (the `contextId` is shared). The only differences are the input shape and whether the response is buffered or streamed.

| Method                       | Input                          | Output                         | Use when                                                                         |
| ---------------------------- | ------------------------------ | ------------------------------ | -------------------------------------------------------------------------------- |
| `sendText(text, opts?)`      | `string`                       | `Promise<MessageResponse>`     | You only need to send plain text. Convenience wrapper.                           |
| `sendMessage(parts, opts?)`  | `Part[]` (text / data / file)  | `Promise<MessageResponse>`     | You need to attach data, files, or mix part kinds in one turn.                   |
| `streamMessage(parts)`       | `Part[]`                       | `Promise<AsyncIterable<StreamEvent>>` | You want incremental tokens / status updates as they arrive (UX, long replies). |

Equivalences:

```ts
// sendText is exactly:
ctx.sendText("hello")
// ≡
ctx.sendMessage([{ kind: "text", text: "hello" }]);
```

When to reach for `sendMessage` over `sendText`:

```ts
// Mix text + structured data in one turn
await ctx.sendMessage([
  { kind: "text", text: "Use the attached patient record:" },
  { kind: "data", data: { patientId: "abc", age: 62 } },
]);

// Send a file
await ctx.sendMessage([
  { kind: "file", file: { name: "scan.pdf", mimeType: "application/pdf", uri: "https://…" } },
]);
```

`streamMessage` returns events incrementally; `sendMessage` waits for `completed`/`failed` and returns the final aggregate. Streaming has **no** buffered `MessageResponse` — assemble the text yourself by concatenating `event.message.parts`.

> **Auth-required follow-up** is handled automatically by `sendText` / `sendMessage` (credentials forwarded as a DataPart) but **not** by `streamMessage`. If you need streaming + MCP auth, send a non-streaming first turn to satisfy auth, then stream subsequent turns on the same context.

---

## API reference — methods

### `AgentsClient`

| Method                        | Returns                       | Description                                            |
| ----------------------------- | ----------------------------- | ------------------------------------------------------ |
| `new AgentsClient(corti)`     | `AgentsClient`                | Wrap a `CortiClient`. Patches `corti.agents.create` to return `AgentHandle`. |
| `create(options)`             | `Promise<AgentHandle>`        | Create a new agent. Takes `CreateAgentOptions`.        |
| `get(agentId)`                | `Promise<AgentHandle>`        | Fetch an existing agent by ID.                         |
| `list()`                      | `Promise<AgentHandle[]>`      | List all agents in the tenant.                         |
| `wrap(agent)`                 | `AgentHandle`                 | Wrap a raw `Corti.AgentsAgent` (e.g. from low-level SDK calls). |

### `AgentHandle`

| Member                        | Type                                                                  | Description                                            |
| ----------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------ |
| `id`                          | `string`                                                              | Agent ID (server-assigned).                            |
| `name` / `description` / `systemPrompt` | `string`                                                    | Agent metadata.                                        |
| `raw`                         | `Corti.AgentsAgent`                                                   | Underlying SDK object — escape hatch.                  |
| `createContext(opts?)`        | `AgentContext`                                                        | Open a new conversation thread. `opts.credentials` are auto-forwarded on `auth-required`. |
| `getContext(contextId, opts?)` | `AgentContext`                                                       | Resume an existing thread by ID. Use only when resuming across process restarts. |
| `run(input, opts?)`           | `Promise<MessageResponse>`                                            | One-shot: open a context, send `string` or `Part[]`, return the reply. `opts`: `{ credentials?, timeoutInSeconds? }`. |
| `update(opts)`                | `Promise<AgentHandle>`                                                | Patch fields. Passing `connectors` **replaces** the full set. |
| `refresh()`                   | `Promise<AgentHandle>`                                                | Re-fetch the agent from the API.                       |
| `delete()`                    | `Promise<void>`                                                       | Delete this agent. Don't reuse the handle afterwards.  |

### `AgentContext`

| Member                                | Type                                          | Description                                            |
| ------------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| `id`                                  | `string \| undefined`                         | The thread/context ID. `undefined` until the first turn completes. |
| `sendText(text, opts?)`               | `Promise<MessageResponse>`                    | Send plain text. `opts.timeoutInSeconds` (default 60). |
| `sendMessage(parts, opts?)`           | `Promise<MessageResponse>`                    | Send arbitrary `Part[]` (text/data/file).              |
| `streamMessage(parts)`                | `Promise<AsyncIterable<StreamEvent>>`         | Stream incremental events for the reply.               |

### `MessageResponse`

| Member        | Type                          | Description                                            |
| ------------- | ----------------------------- | ------------------------------------------------------ |
| `text`        | `string \| undefined`         | All text parts joined.                                 |
| `status`      | `TaskState`                   | `"completed"`, `"failed"`, `"auth-required"`, etc.     |
| `parts`       | `Part[]`                      | Raw response parts.                                    |
| `artifacts`   | `Artifact[]`                  | Structured outputs the agent attached.                 |
| `contextId`   | `string \| undefined`         | The thread ID (set after first turn).                  |
| `raw`         | `Corti.AgentsTask`            | Underlying task object.                                |

### Composition primitives

| Function                           | Returns          | Description                                            |
| ---------------------------------- | ---------------- | ------------------------------------------------------ |
| `workflow(steps)`                  | `Workflow`       | Build a deterministic pipeline.                        |
| `Workflow.run(input)`              | `Promise<WorkflowResult>` | Execute the pipeline.                          |
| `parallel(steps)`                  | `Parallel`       | Build a fan-out block.                                 |
| `Parallel.run(input)`              | `Promise<ParallelResult>` | Run all steps concurrently.                    |
| `stateGraph<TState>()`             | `StateGraph<TState>` | Build a graph with cycles + typed shared state.    |
| `StateGraph.addNode(name, nodeFn)` | `StateGraph<TState>` | Register a node. Use `agentNode(...)` for agent-backed nodes. |
| `StateGraph.addEdge(from, to)`     | `StateGraph<TState>` | `to` may be a node name, `END`, or `EdgeRouter`.   |
| `StateGraph.run(start, state, opts?)` | `Promise<StateGraphResult<TState>>` | Execute. `opts.maxIterations` bounds cycles. |
| `agentNode(agent, inputFn, mergeFn)` | `NodeFn<TState>` | Wrap an agent as a graph node.                     |

### Connector helpers

| Helper                              | Returns               | Description                                            |
| ----------------------------------- | --------------------- | ------------------------------------------------------ |
| `connectors.fromAgent({ agentId })` | `CortiAgentConnector` | Wire another Corti agent in as a sub-agent.            |
| `connectors.registry({ name })`     | `RegistryConnector`   | Use a published Corti expert by registry name.         |
| `connectors.mcp({ mcpUrl, name?, authType?, token? })` | `McpConnector` | Attach an MCP server. `name` becomes the credential key. |
| `connectors.a2a({ url })`           | `A2aConnector`        | Attach an A2A endpoint.                                |

---

## API reference — types

| Type                  | Shape / values                                                                                                              | Notes                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `CreateAgentOptions`  | `{ name, description, systemPrompt?, connectors?, lifecycle? }`                                                             | Input to `agents.create()`.                      |
| `UpdateAgentOptions`  | `{ name?, description?, systemPrompt?, connectors? }`                                                                       | All fields optional. `connectors` replaces all.  |
| `Lifecycle`           | `"ephemeral"` \| `"persistent"`                                                                                             | Default: `"ephemeral"` (server GC).              |
| `ConnectorDef`        | `McpConnector \| RegistryConnector \| CortiAgentConnector \| A2aConnector`                                                  | Use `connectors.*` helpers to build these.       |
| `Part`                | `TextPart \| DataPart \| FilePart`                                                                                          | Discriminated by `kind`.                         |
| `TextPart`            | `{ kind: "text"; text: string }`                                                                                            |                                                  |
| `DataPart`            | `{ kind: "data"; data: unknown }`                                                                                           | Used for structured payloads + auth credentials. |
| `FilePart`            | `{ kind: "file"; file: { name?, mimeType?, bytes?, uri? } }`                                                                | Send `bytes` (base64) or `uri`.                  |
| `Credential`          | `TokenCredential \| OAuth2Credential`                                                                                       |                                                  |
| `TokenCredential`     | `{ type: "token"; token: string }`                                                                                          | Bearer token for MCP `authType: "bearer"`.       |
| `OAuth2Credential`    | `{ type: "credentials"; clientId: string; clientSecret: string }`                                                           | OAuth2 client credentials.                       |
| `CredentialStore`     | `Record<string, Credential>`                                                                                                | Keyed by connector `name`.                       |
| `TaskState`           | `"submitted"` \| `"working"` \| `"input-required"` \| `"auth-required"` \| `"completed"` \| `"canceled"` \| `"failed"` \| `"rejected"` \| `"unknown"` | Returned in `MessageResponse.status`. |
| `TaskStatus`          | `{ state: TaskState; message?: Message; timestamp?: string }`                                                               |                                                  |
| `Message`             | `{ role: "user" \| "agent"; parts: Part[]; messageId, kind, contextId?, taskId? }`                                          |                                                  |
| `Artifact`            | `{ artifactId: string; name?: string; parts: Part[] }`                                                                      | Structured outputs from the agent.               |
| `Task`                | The full A2A task object (raw shape from `@corti/sdk`).                                                                     | Exposed via `MessageResponse.raw`.               |
| `StreamEvent`         | `{ message?: Message; statusUpdate?: TaskStatusUpdateEvent; artifactUpdate?: TaskArtifactUpdateEvent; task?: Task }` | Emitted by `streamMessage`. Note: the field is `artifactUpdate`, not `artifact`. |
| `Runnable`            | `{ run(input): Promise<MessageResponse> }`                                                                                  | What `workflow`/`parallel` accept besides `AgentHandle`. |
| `WorkflowStep`        | `AgentHandle \| Parallel \| { agent, when?, transform?, retries?, retryDelay?, timeoutInSeconds? }`                         | See §3.                                          |
| `WorkflowResult`      | `{ output: MessageResponse; steps: { input, output }[]; stoppedEarly: boolean }`                                            |                                                  |
| `ParallelStep`        | `AgentHandle \| Runnable`                                                                                                   |                                                  |
| `ParallelResult`      | `{ fulfilled: MessageResponse[]; rejected: { index, reason }[] }`                                                           |                                                  |
| `EdgeRouter<TState>`  | `(state: TState) => string \| typeof END`                                                                                   | Function form of `addEdge`.                      |
| `NodeFn<TState>`      | `(state: TState) => Promise<Partial<TState>> \| Partial<TState>`                                                            | Custom (non-agent) graph nodes.                  |
| `StateGraphStep<TState>` | `{ node: string; delta: Partial<TState> }`                                                                               | Per-step trace entry.                            |
| `StateGraphResult<TState>` | `{ state: TState; steps: StateGraphStep<TState>[]; iterations: number; terminatedBy: "END" \| "maxIterations" \| "error" }` |                                              |

---

## Common pitfalls

- **Orchestrators time out at 60 s by default.** Anything that fans out to sub-agents/MCP should pass `timeoutInSeconds: 180` (or higher) to `run()` / `sendText()`.
- **Credential keys must match connector names.** `connectors.mcp({ name: "my-mcp" })` ⇄ `credentials: { "my-mcp": ... }`.
- **`workflow` is linear, `stateGraph` has cycles.** Don't use `workflow` for branching that revisits earlier agents.
- **`parallel` swallows individual failures.** Inspect `.rejected` if you need fail-fast semantics.
- **`ctx.id` is `undefined` until the first turn completes.** Don't persist it before then.
- **You don't need to manage context IDs.** Keep the `AgentContext` object alive across turns. Only use `agent.getContext(id)` when resuming after a process restart.
- **`createContext()` does not accept a context ID.** Passing `{ contextId }` will be silently ignored — use `agent.getContext(contextId)` instead.
- **`ev.artifactUpdate` not `ev.artifact`.** The field on `StreamEvent` for artifact updates is `artifactUpdate`.
- **Persistent agents accumulate.** Default is `ephemeral`; only use `persistent` if you truly need the agent to survive restarts, and always delete what you no longer need.
- **ESM only.** Import with `import`, not `require`.
- **Prompts should be self-sufficient.** Sub-agents that ask for clarification will stall an orchestrator. Prompt them with "Never ask for clarification."

---

## More

- **Documentation site:** https://hccullen.github.io/agent-sdk
- **Runnable examples (7 demos):** https://github.com/hccullen/agent-sdk/tree/main/examples/ts
- **Issues / source:** https://github.com/hccullen/agent-sdk

## License

MIT — see [LICENSE](../../LICENSE).
