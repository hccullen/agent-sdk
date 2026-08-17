# 07 — State graph

`stateGraph()` is the most powerful composition primitive. Unlike `workflow()`, it carries a typed state object across nodes and routes dynamically between them — including cycles. This example implements a clinical triage pipeline: triage → code → review → (loop back if rejected).

<ConceptGrid>
<ConceptCard title="Typed state">A plain TypeScript interface that accumulates across every node. Each node returns a partial state patch which is shallow-merged in.</ConceptCard>
<ConceptCard title="Nodes">Async functions that take state and return a partial state patch. `agentNode()` wraps an `AgentHandle` into this shape.</ConceptCard>
<ConceptCard title="Edges">Static node names, `END`, or routing functions that inspect state and return the next node. Run *after* the node updates state.</ConceptCard>
<ConceptCard title="Cycles + maxIterations">Loops are supported. The `maxIterations` option (default 25) acts as the safety net against infinite cycles.</ConceptCard>
<ConceptCard title="Declarative engine">`stateGraph()` compiles to the same `WorkflowDefinition` as the JSON DSL — export it with `graph.toDefinition()`.</ConceptCard>
</ConceptGrid>

## Run it

```bash
npm run state-graph
```

The script logs the final state (severity, codes, reviewer feedback, approval), the execution trace (every node that ran), the total iteration count, and the termination reason.

## Graph structure

The example models a three-node clinical triage pipeline with a reviewer loop:

```typescript
// Diagram
//
//   triage ──(urgent?)──► coder ──► reviewer ──(approved?)──► END
//              │                        │
//              ▼ (routine)              ▼ (rejected)
//             END                    coder   ← loop, bounded by maxIterations
```

| Node | Input (from state) | Output (state patch) |
|---|---|---|
| `triage` | `state.note` | `{ severity: "urgent" \| "routine" }` |
| `coder` | `state.note` | `{ codes: "I21.9, R07.9" }` |
| `reviewer` | `"Note: ...\n\nProposed codes: ..."` | `{ reviewerFeedback: "...", approved: true\|false }` |

## agentNode()

`agentNode()` wraps an `AgentHandle` into a node function. It takes three arguments:

```typescript
agentNode(
  agent,                           // AgentHandle to call

  (state) => state.note,           // getInput: extract the agent's input from state

  (response, state) => ({          // merge: return the state patch
    codes: response.text ?? "",
  }),
)
```

| Argument | Type | Purpose |
|---|---|---|
| `agent` | `AgentHandle` | The agent to invoke. |
| `getInput(state)` | `(state: S) => string \| MessagePart[]` | Called with the current state to produce the agent's input message. |
| `merge(response, state)` | `(r: MessageResponse, s: S) => Partial<S>` | Called after the agent responds. Return the state patch to merge in. |

You can also write a raw node function directly if you need more control:

```typescript
graph.addNode("custom", async (state) => {
  const result = await myAgent.run(state.note);
  return { severity: result.text?.trim() ?? "" };
})
```

## Walkthrough

### 1 · Define the state type

```typescript
interface TriageState {
  note:             string;   // the original clinical note — never changes
  severity:         string;   // set by triage node: "urgent" or "routine"
  codes:            string;   // set by coder node: comma-separated ICD-10 codes
  reviewerFeedback: string;   // set by reviewer: "approved: ..." or "rejected: ..."
  approved:         boolean;  // derived from reviewerFeedback
}
```

State is a plain TypeScript interface. Every node sees the full accumulated state — later nodes can read values set by earlier nodes.

### 2 · Create and wire the agents

```typescript
const triageAgent = await agents.create({
  name: "sg-triage",
  systemPrompt: 'Reply with exactly one word: "urgent" or "routine". No punctuation.',
});

const coderAgent = await agents.create({
  name: "sg-coder",
  systemPrompt: "Suggest up to three ICD-10 codes. Format: comma-separated codes only.",
});

const reviewerAgent = await agents.create({
  name: "sg-reviewer",
  systemPrompt:
    'Your reply MUST begin with exactly "approved:" or "rejected:" (lowercase, followed by a colon).',
});
```

Each system prompt is engineered for deterministic, parseable output. The reviewer's "approved:" / "rejected:" prefix is what the routing function inspects.

### 3 · Build the graph

```typescript
const graph = stateGraph<TriageState>()
  .addNode("triage",
    agentNode(triageAgent, (s) => s.note,
      (r) => ({ severity: r.text ?? "" })))

  .addNode("coder",
    agentNode(coderAgent, (s) => s.note,
      (r) => ({ codes: r.text ?? "" })))

  .addNode("reviewer",
    agentNode(reviewerAgent,
      (s) => `Note: ${s.note}\n\nProposed codes: ${s.codes}`,
      (r) => ({
        reviewerFeedback: r.text ?? "",
        approved: (r.text ?? "").trim().toLowerCase().startsWith("approved"),
      })))

  // triage: only code urgent cases
  .addEdge("triage", (s) =>
    s.severity.toLowerCase().includes("urgent") ? "coder" : END)

  // coder always goes to reviewer
  .addEdge("coder", "reviewer")

  // reviewer: loop back to coder if rejected
  .addEdge("reviewer", (s) => (s.approved ? END : "coder"));
```

### 4 · Run the graph

```typescript
const initialState: TriageState = {
  note:             "Patient presents with sudden onset chest pain ...",
  severity:         "",
  codes:            "",
  reviewerFeedback: "",
  approved:         false,
};

const result = await graph.run("triage", initialState, { maxIterations: 10 });
```

`graph.run(startNode, initialState, options)` — the first argument is the name of the first node to execute.

### 5 · How the reviewer loop works

1. `triage` runs → sets `severity: "urgent"` → edge routes to `"coder"`.
2. `coder` runs → sets `codes: "I21.9, R07.9"` → static edge routes to `"reviewer"`.
3. `reviewer` runs → sees both the note and the codes → returns `"rejected: codes lack specificity"` → `approved` is set to `false`.
4. Routing function inspects `state.approved === false` → routes back to `"coder"`.
5. `coder` runs again — this time the reviewer's feedback is visible in `state.reviewerFeedback` (the coder's system prompt could reference it for a smarter retry).
6. Eventually the reviewer approves, the edge returns `END`, and the graph terminates with `terminatedBy: "end"`.

::: info
**maxIterations** is the circuit breaker. With `maxIterations: 10`, the graph will stop after 10 total node executions even if the reviewer never approves. Check `terminatedBy === "maxIterations"` if you need to handle this case.
:::

## Result shape

| Field | Type | Description |
|---|---|---|
| `state` | `S` | The final accumulated state after all nodes ran. |
| `steps` | `StateGraphStep<S>[]` | Per-node history. Each entry: `{ node, delta, state }`. Repeated nodes (from cycles) each get their own entry. |
| `iterations` | `number` | Total node executions, including repeated nodes. Always equals `steps.length`. |
| `terminatedBy` | `"end" \| "maxIterations" \| "noEdge"` | Why the graph stopped. `"end"` = edge returned `END`. `"maxIterations"` = cycle budget exhausted. `"noEdge"` = a node had no registered edge. |

Each step entry in the trace:

```typescript
interface StateGraphStep<S> {
  node:  string;      // which node ran
  delta: Partial<S>; // what it added/changed
  state: S;           // full state after this node's delta was merged
}
```

## vs workflow()

|  | `workflow()` | `stateGraph()` |
|---|---|---|
| Shape | Ordered list of steps | Named nodes with explicit edges |
| Shared state | Previous response text only | Typed object, accumulated across all nodes |
| Branching | `when` predicate (skip or run) | Routing function — pick any node by name |
| Cycles | Not supported | Supported, bounded by `maxIterations` |
| Best for | Known, fixed pipelines | Conditional flows, review loops, dynamic routing |

## Under the hood: declarative engine

`stateGraph()` does not have its own runtime. When you call `graph.run()`, the builder compiles the graph into a portable `WorkflowDefinition` (the same JSON shape used by the [declarative DSL](/examples/08-declarative-workflows)) and executes it through the shared `runWorkflow()` engine.

Each code-level node becomes a `callback` node; each edge becomes a static edge or a `route_from` expression; `END` maps to `"__end__"`. You can inspect or export the definition at any time:

```typescript
const graph = stateGraph<TriageState>()
  .addNode("triage", agentNode(triageAgent, s => s.note, (r) => ({ severity: r.text ?? "" })))
  .addEdge("triage", s => s.severity.includes("urgent") ? "coder" : END)
  .addNode("coder", agentNode(coderAgent, s => s.note, (r) => ({ codes: r.text ?? "" })))
  .addEdge("coder", END);

// Export to portable JSON:
const def = graph.toDefinition("triage");
// def.nodes  → [{ id: "triage",  type: "callback", config: { handler: "__cb_triage" } },
//               { id: "coder",   type: "callback", config: { handler: "__cb_coder"  } },
//               { id: "__end__", type: "end" }]
// def.edges  → [{ source: "__start__", target: "triage" },
//               { source: "triage",   target: "coder" },
//               { source: "coder",    target: "__end__" }]
```

The exported definition passes `parseWorkflowDefinition()` — you can serialise it, store it, and re-run it later with `compileWorkflow()` + `runWorkflow()` without the original builder code. See [example 08](/examples/08-declarative-workflows) for the full declarative API.

## Full code

Source: `examples/ts/07-state-graph.ts`

```typescript
/**
 * 07 — Stateful graph routing.
 *
 * Unlike a linear Workflow, a StateGraph accumulates typed shared state
 * across nodes and uses routing functions to decide what runs next —
 * including cycles (bounded by maxIterations).
 *
 * This example models a clinical triage pipeline:
 *
 *   triage ──► coder ──► reviewer ──► END
 *                 ▲           │
 *                 └───────────┘  (re-codes if reviewer rejects)
 *
 * Run: `npm run state-graph`
 */
import { AgentsClient, END, agentNode, stateGraph } from "@corti/agent-sdk";
import { makeClient } from "./_client";

interface TriageState {
  note: string;
  severity: string;
  codes: string;
  reviewerFeedback: string;
  approved: boolean;
}

async function main() {
  const agents = new AgentsClient(makeClient());

  const triageAgent = await agents.create({
    name: "sg-triage",
    description: "Classifies clinical urgency.",
    systemPrompt:
      'Read the clinical note and reply with exactly one word: "urgent" or "routine". No punctuation.',
  });

  const coderAgent = await agents.create({
    name: "sg-coder",
    description: "Assigns ICD-10 codes to a clinical note.",
    systemPrompt:
      "Suggest up to three ICD-10 codes for the clinical note. Format: comma-separated codes only.",
  });

  const reviewerAgent = await agents.create({
    name: "sg-reviewer",
    description: "Reviews proposed ICD-10 codes.",
    systemPrompt:
      'Review the proposed ICD-10 codes for the clinical note. Your reply MUST begin with exactly "approved:" or "rejected:" (lowercase, followed by a colon). No preamble, no other leading text. After the colon include the codes (if approved) or a brief reason (if rejected).',
  });

  const graph = stateGraph<TriageState>()
    .addNode(
      "triage",
      agentNode(
        triageAgent,
        (s) => s.note,
        (r) => ({ severity: r.text ?? "" }),
      ),
    )
    .addNode(
      "coder",
      agentNode(
        coderAgent,
        (s) => s.note,
        (r) => ({ codes: r.text ?? "" }),
      ),
    )
    .addNode(
      "reviewer",
      agentNode(
        reviewerAgent,
        (s) => `Note: ${s.note}\n\nProposed codes: ${s.codes}`,
        (r) => ({
          reviewerFeedback: r.text ?? "",
          approved: (r.text ?? "").trim().toLowerCase().startsWith("approved"),
        }),
      ),
    )
    // Only code urgent cases; discharge routine ones immediately.
    .addEdge("triage", (s) =>
      s.severity.toLowerCase().includes("urgent") ? "coder" : END,
    )
    .addEdge("coder", "reviewer")
    // Loop back to coder if reviewer rejects; maxIterations acts as the safety net.
    .addEdge("reviewer", (s) => (s.approved ? END : "coder"));

  const initialState: TriageState = {
    note: "Patient presents with sudden onset chest pain radiating to the left arm, diaphoresis, and shortness of breath for 45 minutes.",
    severity: "",
    codes: "",
    reviewerFeedback: "",
    approved: false,
  };

  const result = await graph.run("triage", initialState, { maxIterations: 10 });

  console.log("Final state:");
  console.log("  Severity:         ", result.state.severity);
  console.log("  ICD-10 codes:     ", result.state.codes);
  console.log("  Reviewer feedback:", result.state.reviewerFeedback);
  console.log("  Approved:         ", result.state.approved);
  console.log("\nExecution trace:");
  for (const step of result.steps) {
    console.log(`  [${step.node}]`, Object.keys(step.delta).join(", "));
  }
  console.log("\nIterations:", result.iterations);
  console.log("Terminated by:", result.terminatedBy);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## What to expect

<OutputBlock>
<span style="color: #f99470">Final state:</span>
  <span style="color: #f99470">Severity:</span>          urgent
  <span style="color: #f99470">ICD-10 codes:</span>      I21.9, R07.4, R00.0
  <span style="color: #f99470">Reviewer feedback:</span> approved: I21.9, R07.4, R00.0
  <span style="color: #f99470">Approved:</span>          true

<span style="color: #f99470">Execution trace:</span>
  <span style="color: #5a6478">[triage]</span>   severity
  <span style="color: #5a6478">[coder]</span>    codes
  <span style="color: #5a6478">[reviewer]</span> reviewerFeedback, approved

<span style="color: #f99470">Iterations:</span>   3
<span style="color: #f99470">Terminated by:</span> end
</OutputBlock>

::: info
If the reviewer rejects the codes, the trace would show `[coder]` and `[reviewer]` multiple times — once per cycle. `iterations` would reflect the total node executions, not the number of unique nodes.
:::

### Example with a rejection loop

<OutputBlock>
<span style="color: #f99470">Execution trace:</span>
  <span style="color: #5a6478">[triage]</span>   severity
  <span style="color: #5a6478">[coder]</span>    codes
  <span style="color: #5a6478">[reviewer]</span> reviewerFeedback, approved   <span style="color: #5a6478">← rejected</span>
  <span style="color: #5a6478">[coder]</span>    codes                        <span style="color: #5a6478">← second attempt</span>
  <span style="color: #5a6478">[reviewer]</span> reviewerFeedback, approved   <span style="color: #5a6478">← approved</span>

<span style="color: #f99470">Iterations:</span>   5
<span style="color: #f99470">Terminated by:</span> end
</OutputBlock>

### Next steps

<ExampleLinks>
<a href="/examples/03-workflow">03 · Workflow<span>Simpler linear pipelines without routing or cycles.</span></a>
<a href="/examples/04-parallel">04 · Parallel fan-out<span>Run multiple agents on the same input concurrently.</span></a>
<a href="/#state-graph">State graph concept docs<span>Full API reference including agentNode() and END.</span></a>
</ExampleLinks>
