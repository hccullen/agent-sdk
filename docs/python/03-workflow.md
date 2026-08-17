# 03 — Workflow

A `Workflow` is a deterministic, code-first pipeline. Steps run in order; each step receives the previous step's text as input. Use `when`, `transform`, and `retries` to add conditional logic.

<ConceptGrid>
<ConceptCard title="workflow(steps)">Factory that accepts `AgentHandle`s, `Parallel` groups, or `WorkflowStep` dicts.</ConceptCard>
<ConceptCard title="when">Optional predicate `(prev: MessageResponse) → bool`. If it returns `False`, the step is skipped.</ConceptCard>
<ConceptCard title="transform">Optional function `(prev: MessageResponse) → str | list[Part]`. Reshape the output before passing to the next step.</ConceptCard>
<ConceptCard title="retries">Re-attempt the step up to N extra times on failure. Combine with `retry_delay` (seconds).</ConceptCard>
</ConceptGrid>

## Step options

| Key | Type | Default | Description |
|---|---|---|---|
| `agent` | `AgentHandle \| Parallel` | required | The agent or parallel group to run. |
| `when` | `Callable[[MessageResponse], bool]` | always run | Skip this step if the predicate returns `False`. |
| `transform` | `Callable[[MessageResponse], str \| list]` | pass text through | Shape the previous output before passing to this step. |
| `retries` | `int` | `0` | Extra attempts on `"failed"` status. |
| `retry_delay` | `float` | `1.0` | Seconds to wait between retries. |

## Full code

```python
"""
03 — Workflow.

A three-step pipeline: extract → code → review (conditional).
"""
import asyncio
from corti_agent_sdk import CortiClient, AgentsClient, workflow, WorkflowStep

async def main():
    async with CortiClient(
        tenant_name="YOUR_TENANT",
        environment="eu",
        auth={"client_id": "YOUR_ID", "client_secret": "YOUR_SECRET"},
    ) as client:
        agents = AgentsClient(client)

        extractor = await agents.create(
            name="extractor",
            description="Extracts key symptoms from a clinical note.",
            system_prompt="List the key symptoms as a comma-separated string. No prose.",
        )
        coder = await agents.create(
            name="coder",
            description="Maps symptoms to ICD-10 codes.",
            system_prompt="Return only comma-separated ICD-10 codes.",
        )
        reviewer = await agents.create(
            name="reviewer",
            description="Flags potentially incorrect codes.",
            system_prompt='Reply "ok" if the codes look correct, otherwise explain why.',
        )

        result = await workflow([
            extractor,   # bare AgentHandle — shorthand for WorkflowStep(agent=extractor)

            coder,

            WorkflowStep(
                agent=reviewer,
                # Only run if coder returned something
                when=lambda r: bool(r.text),
                # Prepend context so the reviewer knows what note was coded
                transform=lambda r: f"Codes: {r.text}",
                retries=1,
                retry_delay=2.0,
            ),
        ]).run("Patient presents with chest pain and dyspnoea.")

        print("Final output:", result.output.text)
        print("Steps run:   ", len(result.steps))
        print("Stopped early:", result.stopped_early)

asyncio.run(main())
```

## Result shape

| Field | Description |
|---|---|
| `result.output` | `MessageResponse` from the last executed step. |
| `result.steps` | List of `MessageResponse` for every step that ran (skipped steps excluded). |
| `result.stopped_early` | `True` if a step's status was `"failed"` and execution halted. |

### Next steps

<ExampleLinks>
<a href="/python/04-parallel">04 · Parallel fan-out<span>Run multiple agents on the same input at once.</span></a>
<a href="/python/07-state-graph">07 · State graph<span>Conditional routing and reviewer loops.</span></a>
</ExampleLinks>
