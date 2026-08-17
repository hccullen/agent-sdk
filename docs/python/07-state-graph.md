# 07 — State graph

`stateGraph()` maintains a shared state dict across nodes and routes dynamically — including cycles. This example builds a clinical triage pipeline: triage → code → review → (loop back if rejected).

<ConceptGrid>
<ConceptCard title="Shared state">A plain dict accumulated across every node. Each node returns a partial update that is shallow-merged in.</ConceptCard>
<ConceptCard title="Nodes">Async functions `async def(state) → dict`. `agent_node()` wraps an `AgentHandle` into this shape.</ConceptCard>
<ConceptCard title="Edges">Static node names, `END`, or callables `(state) → str | END` that pick the next node after the current one updates state.</ConceptCard>
<ConceptCard title="max_iterations">Safety limit (default 25). The graph stops with `terminated_by="maxIterations"` if the budget is exhausted.</ConceptCard>
</ConceptGrid>

### Graph structure

```python
#   triage ──(urgent?)──► coder ──► reviewer ──(approved?)──► END
#              │                        │
#              ▼ (routine)              ▼ (rejected)
#             END                    coder   ← loop
```

## agent_node()

`agent_node(agent, get_input, merge_response)` wraps an `AgentHandle` as a node function:

| Argument | Type | Purpose |
|---|---|---|
| `agent` | `AgentHandle` | The agent to invoke. |
| `get_input(state)` | `Callable[[dict], str \| list]` | Extract the agent's input from current state. |
| `merge_response(response, state)` | `Callable[[MessageResponse, dict], dict]` | Return the state patch to merge in. |

You can also write a raw async node function directly:

```python
async def my_node(state):
    result = await my_agent.run(state["note"])
    return {"severity": (result.text or "").strip()}
```

## Full code

```python
"""
07 — Stateful graph routing.

Clinical triage pipeline with a reviewer loop:

  triage → coder → reviewer → END
                 ↑         |
                 └─ reject ┘
"""
import asyncio
from corti_agent_sdk import CortiClient, AgentsClient, stateGraph, agent_node, END

async def main():
    async with CortiClient(
        tenant_name="YOUR_TENANT",
        environment="eu",
        auth={"client_id": "YOUR_ID", "client_secret": "YOUR_SECRET"},
    ) as client:
        agents = AgentsClient(client)

        triage_agent = await agents.create(
            name="sg-triage",
            description="Classifies clinical urgency.",
            system_prompt='Reply with exactly one word: "urgent" or "routine". No punctuation.',
        )
        coder_agent = await agents.create(
            name="sg-coder",
            description="Assigns ICD-10 codes.",
            system_prompt="Suggest up to three ICD-10 codes. Format: comma-separated codes only.",
        )
        reviewer_agent = await agents.create(
            name="sg-reviewer",
            description="Reviews proposed ICD-10 codes.",
            system_prompt=(
                'Your reply MUST begin with exactly "approved:" or "rejected:" '
                "(lowercase, colon). No preamble."
            ),
        )

        graph = (
            stateGraph()
            .add_node("triage",
                agent_node(
                    triage_agent,
                    lambda s: s["note"],
                    lambda r, s: {"severity": r.text or ""},
                ))
            .add_node("coder",
                agent_node(
                    coder_agent,
                    lambda s: s["note"],
                    lambda r, s: {"codes": r.text or ""},
                ))
            .add_node("reviewer",
                agent_node(
                    reviewer_agent,
                    lambda s: f"Note: {s['note']}\n\nProposed codes: {s['codes']}",
                    lambda r, s: {
                        "reviewer_feedback": r.text or "",
                        "approved": (r.text or "").strip().lower().startswith("approved"),
                    },
                ))
            # Only code urgent cases
            .add_edge("triage", lambda s: "coder" if "urgent" in s["severity"].lower() else END)
            # Coder always goes to reviewer
            .add_edge("coder", "reviewer")
            # Loop back if reviewer rejects
            .add_edge("reviewer", lambda s: END if s["approved"] else "coder")
        )

        initial_state = {
            "note": "Patient presents with sudden onset chest pain radiating to left arm.",
            "severity": "",
            "codes": "",
            "reviewer_feedback": "",
            "approved": False,
        }

        result = await graph.run("triage", initial_state, max_iterations=10)

        print("Severity:         ", result.state["severity"])
        print("ICD-10 codes:     ", result.state["codes"])
        print("Reviewer feedback:", result.state["reviewer_feedback"])
        print("Approved:         ", result.state["approved"])
        print()
        print("Execution trace:")
        for step in result.steps:
            print(f"  [{step.node}]", list(step.delta.keys()))
        print("Iterations:   ", result.iterations)
        print("Terminated by:", result.terminated_by)

asyncio.run(main())
```

## Result shape

| Field | Description |
|---|---|
| `result.state` | Final accumulated state dict. |
| `result.steps` | List of `StateGraphStep(node, delta, state)` — one per execution, including repeated nodes from cycles. |
| `result.iterations` | Total node executions. Always equals `len(result.steps)`. |
| `result.terminated_by` | `"end"` (edge returned END) · `"maxIterations"` · `"noEdge"`. |

::: info
**Python note:** TypeScript uses `terminatedBy` (camelCase); Python uses `terminated_by` (snake_case). Same for `stoppedEarly` → `stopped_early` in `WorkflowResult`.
:::

## vs workflow()

|  | `workflow()` | `stateGraph()` |
|---|---|---|
| Shape | Ordered list of steps | Named nodes with explicit edges |
| Shared state | Previous response text only | Full dict, accumulated across all nodes |
| Branching | `when` predicate (skip or run) | Routing function — jump to any node |
| Cycles | Not supported | Supported, bounded by `max_iterations` |
| Best for | Fixed, known pipelines | Conditional flows, review loops, dynamic routing |

### Next steps

<ExampleLinks>
<a href="/python/03-workflow">03 · Workflow<span>Simpler linear pipelines.</span></a>
<a href="/examples/07-state-graph">TypeScript version<span>Same example in TypeScript for comparison.</span></a>
</ExampleLinks>
