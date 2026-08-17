# 03 — Workflow

`workflow()` builds a deterministic chain of agent steps. Each step's output feeds the next. Steps can be bare `AgentHandle`s or configuration objects with conditional logic, input transforms, and retry behaviour.

<ConceptGrid>
<ConceptCard title="workflow(steps)">Takes an array of steps and returns a `Workflow` with a `.run(input)` method.</ConceptCard>
<ConceptCard title="when">A predicate on the previous response. Returns `false` → skip the step, pass the previous output forward unchanged.</ConceptCard>
<ConceptCard title="transform">Maps the previous response to this step's input. Default: `prev.text`.</ConceptCard>
<ConceptCard title="retries">Additional attempts when a step returns `status: "failed"`. Combined with `retryDelay` (ms).</ConceptCard>
<ConceptCard title="Declarative engine">`workflow()` compiles its step list into the same `WorkflowDefinition` used by the [JSON / YAML DSL](/examples/08-declarative-workflows).</ConceptCard>
</ConceptGrid>

## Run it

```bash
npm run workflow
```

::: info
This example models a clinical note processing pipeline: **summarise → classify → conditionally escalate**. The escalation step only fires when the classifier returns `"urgent"`.
:::

## Step configuration

Each element in the step array is either a bare `AgentHandle` (shorthand for `{ agent: handle }`) or a full step configuration object:

```typescript
{
  agent:      AgentHandle;         // required

  when?:      (prev: MessageResponse) => boolean;
  // If false, skip this step and pass prev forward unchanged.

  transform?: (prev: MessageResponse) => string | MessagePart[];
  // Returns the input for this step. Default: prev.text ?? "".

  retries?:   number;              // default 0 — no retries
  retryDelay?: number;             // ms between retries, default 0

  credentials?: CredentialStore;  // per-step credential override
}
```

| Option | Default | Behaviour |
|---|---|---|
| `when` | always run | Receives the previous `MessageResponse`. Return `false` to skip this step entirely — the previous response is passed forward as-is. |
| `transform` | `prev.text` | Called only when the step *will* run (after `when` passes). Return a string or an array of message parts. |
| `retries` | `0` | Number of *additional* attempts on failure. Total attempts = `retries + 1`. |
| `retryDelay` | `0` | Milliseconds to wait between retry attempts. |

## Walkthrough

### 1 · Create three focused agents

```typescript
const summarizer = await agents.create({
  name: "wf-summarizer",
  description: "Summarises a clinical note in one sentence.",
  systemPrompt: "Summarise the note in a single sentence.",
});

const classifier = await agents.create({
  name: "wf-classifier",
  description: "Classifies a summary as 'urgent' or 'routine'.",
  systemPrompt: "Reply with exactly one word: 'urgent' or 'routine'. No punctuation.",
});

const escalator = await agents.create({
  name: "wf-escalator",
  description: "Drafts an escalation for urgent cases.",
  systemPrompt: "Draft a one-line escalation to the on-call physician.",
});
```

Each agent is given a hyper-focused system prompt. The classifier's prompt is constrained to exactly one word — this makes the `when` predicate reliable.

### 2 · Define the pipeline

```typescript
const note = "Patient reports severe chest pain radiating to left arm, onset 30 minutes ago.";

const result = await workflow([
  summarizer,    // step 1: bare handle — no conditions

  classifier,    // step 2: bare handle — receives summarizer's text as input

  {              // step 3: conditional escalation
    agent: escalator,
    when:      (prev) => (prev.text ?? "").toLowerCase().includes("urgent"),
    transform: () => note,     // give escalator the original note, not "urgent"
    retries:   2,
    retryDelay: 500,
  },
]).run(note);
```

### 3 · How data flows

The flow for a chest-pain note:

1. **Input →** `summarizer` receives the raw `note` string. Returns: *"Patient has severe chest pain radiating to the left arm starting 30 minutes ago."*
2. **Step 2 →** `classifier` receives the summarizer's text. Returns: *"urgent"*
3. **Step 3 `when` check →** `"urgent".includes("urgent")` → `true`, so the step runs.
4. **Step 3 `transform` →** Instead of feeding `"urgent"` to the escalator, `transform: () => note` sends the original clinical note — giving the escalator something meaningful to work with.
5. **Step 3 →** `escalator` returns: *"Escalate immediately: patient presenting with acute STEMI symptoms."*

### When a step is skipped

If the note were *"Patient has a mild sore throat."*, the classifier would return `"routine"`. The `when` check fails, the escalator step is skipped, and `result.output` would be the classifier's response (`"routine"`).

### Retry behaviour

```typescript
{
  agent: escalator,
  retries: 2,       // try up to 3 times total
  retryDelay: 500,  // wait 500 ms between attempts
}
```

Retries fire only when a step returns `status: "failed"` — not on `"input-required"` or `"auth-required"`. If all attempts fail, the workflow sets `stoppedEarly: true` and returns the last failed response as `output`.

## Result shape

`workflow(...).run(input)` returns a `WorkflowResult`:

| Field | Type | Description |
|---|---|---|
| `output` | `MessageResponse` | Response from the last step that actually ran. |
| `steps` | `MessageResponse[]` | One entry per step that ran (skipped steps are absent). |
| `stoppedEarly` | `boolean` | `true` if a step exhausted its retries and the workflow halted. |

::: info
**Under the hood.** `workflow()` does not have its own runtime. On `.run()` it builds a `WorkflowDefinition` — each step becomes a `callback` node (`step_0` → `step_1` → … → `__end__`) — and executes it through the shared declarative engine. The same engine powers [`stateGraph()`](/examples/07-state-graph) and the [JSON / YAML DSL](/examples/08-declarative-workflows).
:::

## Full code

Source: `examples/ts/03-workflow.ts`

```typescript
/**
 * 03 — Deterministic workflows.
 *
 * Chain agents into a deterministic pipeline. Each step transforms the
 * previous response, may be conditionally skipped, and may retry on failure.
 *
 * Run: `npm run workflow`
 */
import { AgentsClient, workflow } from "@corti/agent-sdk";
import { makeClient } from "./_client";

async function main() {
  const agents = new AgentsClient(makeClient());

  const summarizer = await agents.create({
    name: "wf-summarizer",
    description: "Summarises a clinical note in one sentence.",
    systemPrompt: "Summarise the note in a single sentence.",
  });

  const classifier = await agents.create({
    name: "wf-classifier",
    description: "Classifies a summary as 'urgent' or 'routine'.",
    systemPrompt:
      "Reply with exactly one word: 'urgent' or 'routine'. No punctuation.",
  });

  const escalator = await agents.create({
    name: "wf-escalator",
    description: "Drafts an escalation for urgent cases.",
    systemPrompt: "Draft a one-line escalation to the on-call physician.",
  });

  const note =
    "Patient reports severe chest pain radiating to left arm, onset 30 minutes ago.";

  // Pipeline: summarise → classify → escalate (only when classifier says urgent).
  const result = await workflow([
    summarizer,                                  // step 1: summarise the note
    classifier,                                  // step 2: classify the summary
    {                                            // step 3: conditional escalate
      agent: escalator,
      when: (prev) => (prev.text ?? "").toLowerCase().includes("urgent"),
      // Skip escalation input is just the word "urgent"; give escalator the
      // original note so it has something to escalate.
      transform: () => note,
      retries: 2,
      retryDelay: 500,
    },
  ]).run(note);

  console.log("Final output:", result.output.text);
  console.log("Steps executed:", result.steps.length);
  console.log("Stopped early:", result.stoppedEarly);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## What to expect

<OutputBlock>
<span style="color: #5a6478"># Urgent case (chest pain note)</span>
<span style="color: #f99470">Final output:</span>  Escalate immediately: patient presenting with acute STEMI symptoms
                — on-call cardiologist should be paged now.
<span style="color: #f99470">Steps executed:</span> 3
<span style="color: #f99470">Stopped early:</span>  false

<span style="color: #5a6478"># Routine case (mild sore throat note)</span>
<span style="color: #f99470">Final output:</span>  routine
<span style="color: #f99470">Steps executed:</span> 2
<span style="color: #f99470">Stopped early:</span>  false
</OutputBlock>

::: info
When `when` returns `false`, the step is skipped — it doesn't appear in `steps` and the previous response becomes the final `output`. That's why `steps.length` is 2, not 3, for routine cases.
:::

### Next steps

<ExampleLinks>
<a href="/examples/04-parallel">04 · Parallel fan-out<span>Run multiple agents on the same input concurrently.</span></a>
<a href="/examples/07-state-graph">07 · State graph<span>Add cycles and dynamic routing for complex flows.</span></a>
<a href="/#workflows">Workflow concept docs<span>Full API reference for workflow().</span></a>
</ExampleLinks>
