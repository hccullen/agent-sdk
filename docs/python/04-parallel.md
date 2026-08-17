---
prev:
  text: "03 · Workflow"
  link: "/python/03-workflow"
next:
  text: "05 · Streaming"
  link: "/python/05-streaming"
---

# 04 — Parallel fan-out

Run multiple agents concurrently on the same input using `parallel()`. Individual failures don't stop the others — results are split into `fulfilled` and `rejected`.

<ConceptGrid>
<ConceptCard title="parallel(steps)">Factory accepting `AgentHandle`s or `ParallelStep` dicts with per-step `input` / `credentials` overrides.</ConceptCard>
<ConceptCard title="asyncio.gather">Under the hood, all steps run via `asyncio.gather(..., return_exceptions=True)`.</ConceptCard>
<ConceptCard title="In a workflow">Drop a `Parallel` directly into a `workflow()` step list — fulfilled results are text-joined for the next step.</ConceptCard>
<ConceptCard title="ParallelResult">Contains `results` (all), `fulfilled` (succeeded), and `rejected` (raised exceptions).</ConceptCard>
</ConceptGrid>

## Full code

```python
"""
04 — Parallel fan-out.

Run two specialists on the same clinical note simultaneously,
then combine results in a workflow step.
"""
import asyncio
from corti_agent_sdk import CortiClient, AgentsClient, parallel, workflow

async def main():
    async with CortiClient(
        tenant_name="YOUR_TENANT",
        environment="eu",
        auth={"client_id": "YOUR_ID", "client_secret": "YOUR_SECRET"},
    ) as client:
        agents = AgentsClient(client)

        icd_agent = await agents.create(
            name="icd-coder",
            description="Assigns ICD-10 codes.",
            system_prompt="Return only ICD-10 codes, comma-separated.",
        )
        cpt_agent = await agents.create(
            name="cpt-coder",
            description="Assigns CPT procedure codes.",
            system_prompt="Return only CPT codes, comma-separated.",
        )
        summary_agent = await agents.create(
            name="summariser",
            description="Summarises the combined coding results.",
            system_prompt="Given ICD-10 and CPT codes, write a one-sentence clinical billing summary.",
        )

        NOTE = "Patient underwent laparoscopic appendectomy for acute appendicitis."

        # --- Standalone fan-out ---
        fan_out = parallel([icd_agent, cpt_agent])
        result = await fan_out.run(NOTE)

        print("Fulfilled:", len(result.fulfilled))
        for r in result.fulfilled:
            print(" ", r.text)
        if result.rejected:
            print("Rejected:", result.rejected)

        # --- Inside a workflow (fulfilled results are text-joined) ---
        pipeline = await workflow([
            parallel([icd_agent, cpt_agent]),
            summary_agent,
        ]).run(NOTE)
        print("\nSummary:", pipeline.output.text)

asyncio.run(main())
```

## Result shape

| Field | Description |
|---|---|
| `result.results` | One entry per step: `{"status": "fulfilled", "value": ...}` or `{"status": "rejected", "reason": ...}`. |
| `result.fulfilled` | List of `MessageResponse` from steps that succeeded. |
| `result.rejected` | List of exceptions from steps that raised. |

### Next steps

<ExampleLinks>
<a href="/python/03-workflow">03 · Workflow<span>Combine parallel with sequential steps.</span></a>
<a href="/python/07-state-graph">07 · State graph<span>More complex fan-in/fan-out with routing.</span></a>
</ExampleLinks>
