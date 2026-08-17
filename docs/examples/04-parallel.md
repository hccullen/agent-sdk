---
prev:
  text: "03 · Workflow"
  link: "/examples/03-workflow"
next:
  text: "05 · Streaming"
  link: "/examples/05-streaming"
---

# 04 — Parallel fan-out

`parallel()` sends the same prompt to multiple agents at the same time and collects the results. Use it standalone for `Promise.allSettled`-style output, or drop it directly into a `workflow()` step list to merge the fulfilled results for a downstream synthesiser.

<ConceptGrid>
<ConceptCard title="parallel(steps)">Creates a `Parallel` group. Call `.run(input)` to execute all agents concurrently.</ConceptCard>
<ConceptCard title="fulfilled / rejected">Standalone result shape. `fulfilled` is an array of `MessageResponse`; `rejected` has `reason` strings.</ConceptCard>
<ConceptCard title="Inline in workflow()">Drop `parallel([...])` anywhere in the step list. Fulfilled results are text-joined (one per line) and passed to the next step.</ConceptCard>
<ConceptCard title="Per-step overrides">Each agent in the group can have its own `input`, `credentials`, or other step-level options.</ConceptCard>
<ConceptCard title="Declarative equivalent">The [JSON DSL](/examples/08-declarative-workflows) exposes the same concept as a `parallel` node with branches and `join: "all" | "any"`.</ConceptCard>
</ConceptGrid>

## Run it

```bash
npm run parallel
```

The example runs in two parts. First a standalone fan-out that logs each agent's reply independently, then a workflow that feeds the merged results into a synthesiser agent.

## Standalone fan-out

Call `parallel([...]).run(input)` to get the raw settled results:

```typescript
const fanout = await parallel([differential, redFlags, workup]).run(presentation);

// fulfilled: MessageResponse[]
fanout.fulfilled.forEach((r, i) => console.log(`#${i + 1}: ${r.text}`));

// rejected: Array of { reason: unknown }
if (fanout.rejected.length) console.log("Rejected:", fanout.rejected);
```

This behaves like `Promise.allSettled` — a single agent failure does not abort the group. You get all results regardless.

| Field | Type | Description |
|---|---|---|
| `fulfilled` | `MessageResponse[]` | Responses from agents that completed successfully. Order matches the input array (minus rejected entries). |
| `rejected` | `{ reason: unknown }[]` | Failure details for agents that threw or returned a non-success status. |

::: info
The [declarative DSL](/examples/08-declarative-workflows) exposes the same concept as a `parallel` node: named branches each start at a sub-graph node with their own initial state, and `join: "all" | "any"` controls whether the engine waits for all branches or returns on the first success.
:::

## Inside a workflow

A `Parallel` group is a valid workflow step. The SDK text-joins all `fulfilled` results (separated by newlines) and passes the combined string as input to the next step. Rejected results are silently discarded.

```typescript
const { output } = await workflow([
  parallel([differential, redFlags, workup]),   // fan-out step
  synthesizer,                                  // receives joined text
]).run(presentation);
```

This is the most common pattern — fan out to several specialist agents, then use one more agent to synthesise their outputs into a cohesive result.

::: info
**What the synthesiser receives** is the text-joined output of all fulfilled parallel agents, one per line. Write the synthesiser's system prompt to expect a structured multi-section input.
:::

### Building the agents concurrently

Since the four agents are independent, they can be created in parallel too — using plain `Promise.all` at the TypeScript level, not the SDK's `parallel()`:

```typescript
const [differential, redFlags, workup, synthesizer] = await Promise.all([
  agents.create({ name: "p-differential", systemPrompt: "List the top 3 differentials..." }),
  agents.create({ name: "p-redflags",     systemPrompt: "List red-flag features..." }),
  agents.create({ name: "p-workup",       systemPrompt: "Suggest initial workup..." }),
  agents.create({ name: "p-synthesizer",  systemPrompt: "Combine the three perspectives..." }),
]);
```

This cuts agent registration latency from 4× to ~1×. Use this pattern whenever agents don't depend on each other's IDs.

## Per-step overrides

When branches need different inputs or credentials, use the expanded step format inside `parallel()`:

```typescript
parallel([
  { agent: a, input: "Analyse from a cardiology perspective." },
  { agent: b, credentials: { "mcp-x": { type: "token", token: "..." } } },
  c,   // bare handle — uses the shared input passed to .run()
])
```

| Option | Description |
|---|---|
| `input` | Override the shared input for this branch. Accepts a string or message parts array. |
| `credentials` | Per-branch credential store for MCP auth (see [example 06](/examples/06-credentials)). |

## Full code

Source: `examples/ts/04-parallel.ts`

```typescript
/**
 * 04 — Parallel fan-out.
 *
 * Run multiple agents concurrently on the same input. Use `parallel()`
 * standalone, or drop it directly into a `workflow()` step list to merge
 * the fulfilled results into the next step.
 *
 * Run: `npm run parallel`
 */
import { AgentsClient, parallel, workflow } from "@corti/agent-sdk";
import { makeClient } from "./_client";

async function main() {
  const agents = new AgentsClient(makeClient());

  const [differential, redFlags, workup, synthesizer] = await Promise.all([
    agents.create({
      name: "p-differential",
      description: "Lists a differential diagnosis.",
      systemPrompt:
        "List the top 3 differential diagnoses for the presentation, most likely first. One line each.",
    }),
    agents.create({
      name: "p-redflags",
      description: "Flags symptoms warranting urgent evaluation.",
      systemPrompt:
        "List any red-flag features from the presentation that warrant urgent evaluation. One line each.",
    }),
    agents.create({
      name: "p-workup",
      description: "Suggests initial diagnostic workup.",
      systemPrompt:
        "Suggest an initial diagnostic workup (labs, imaging, bedside exam). One line each.",
    }),
    agents.create({
      name: "p-synthesizer",
      description: "Combines clinical perspectives into a single assessment.",
      systemPrompt:
        "You will receive a differential, red-flag list, and suggested workup joined by newlines. Combine them into a concise clinical assessment and plan.",
    }),
  ]);

  const presentation =
    "54-year-old male with 2 hours of crushing substernal chest pain, diaphoresis, and dyspnea; history of hypertension and smoking.";

  // (a) Standalone: collect every result with Promise.allSettled-like output.
  const fanout = await parallel([differential, redFlags, workup]).run(presentation);
  console.log("— Fan-out (standalone) —");
  fanout.fulfilled.forEach((r, i) => console.log(`#${i + 1}: ${r.text}`));
  if (fanout.rejected.length) console.log("Rejected:", fanout.rejected);

  // (b) Inside a workflow: fulfilled results are joined and fed into `synthesizer`.
  const { output } = await workflow([
    parallel([differential, redFlags, workup]),
    synthesizer,
  ]).run(presentation);
  console.log("\n— Assessment and plan —\n" + output.text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## What to expect

<OutputBlock>
<span style="color: #5a6478">— Fan-out (standalone) —</span>
<span style="color: #f99470">#1:</span> 1. STEMI / ACS
     2. Unstable angina
     3. Aortic dissection
<span style="color: #f99470">#2:</span> - Crushing chest pain with radiation
     - Diaphoresis and dyspnea
     - Risk factors: hypertension, smoking
<span style="color: #f99470">#3:</span> - 12-lead ECG (immediate)
     - Troponin I/T, BNP, CBC, BMP
     - Portable CXR, bedside echo if available

<span style="color: #5a6478">— Assessment and plan —</span>
This 54-year-old male presents with a high-probability picture for STEMI. Immediate
ECG and troponin are mandatory. Activate the cath lab if ST-elevation is confirmed.
Differential includes type A dissection — obtain CXR to rule out widened mediastinum.
Start ASA 325 mg, heparin, and supplemental O2 while awaiting results.
</OutputBlock>

### Next steps

<ExampleLinks>
<a href="/examples/03-workflow">03 · Workflow<span>Add conditional steps and retries to a pipeline.</span></a>
<a href="/examples/07-state-graph">07 · State graph<span>Dynamic routing and cycles for more complex flows.</span></a>
<a href="/#parallel">Parallel concept docs<span>Full API reference for parallel().</span></a>
</ExampleLinks>
