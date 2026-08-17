---
prev:
  text: "01 · Hello, agent"
  link: "/python/01-hello-agent"
next:
  text: "03 · Workflow"
  link: "/python/03-workflow"
---

# 02 — Connectors

Wire MCP servers, registry experts, and other Corti agents into an orchestrator agent using the `connectors` factory.

<ConceptGrid>
<ConceptCard title="connectors.from_agent">Reference another Corti agent as a callable sub-agent.</ConceptCard>
<ConceptCard title="connectors.registry">Pull in a named expert from the Corti registry (e.g. `"@corti/medical-coding"`).</ConceptCard>
<ConceptCard title="connectors.mcp">Attach any MCP-compatible server directly to the agent.</ConceptCard>
<ConceptCard title="timeout_in_seconds">Raise the per-request timeout for orchestrators that call multiple sub-agents.</ConceptCard>
</ConceptGrid>

## Connector types

| Factory | Key params |
|---|---|
| `connectors.from_agent(agent_id)` | `agent_id: str` |
| `connectors.registry(name, *, system_prompt?)` | `name: str` e.g. `"@corti/medical-coding"` |
| `connectors.mcp(mcp_url, *, name?, transport?, auth_type?, token?)` | `auth_type: "none"\|"bearer"\|"inherit"\|"oauth2.0"` |

## Full code

```python
"""
02 — Connectors.

Build an orchestrator that routes to a sub-agent and a registry expert.
"""
import asyncio, os
from corti_agent_sdk import CortiClient, AgentsClient, connectors

async def main():
    async with CortiClient(
        tenant_name="YOUR_TENANT",
        environment="eu",
        auth={"client_id": "YOUR_ID", "client_secret": "YOUR_SECRET"},
    ) as client:
        agents = AgentsClient(client)

        # 1 — Create a specialised sub-agent
        symptom_agent = await agents.create(
            name="symptom-extractor",
            description="Extracts structured symptoms from a clinical note.",
            system_prompt="Return a JSON array of symptoms. No prose.",
        )

        # 2 — Create an orchestrator with multiple connectors
        orchestrator = await agents.create(
            name="orchestrator",
            description="Routes clinical queries to the right expert.",
            system_prompt="You coordinate medical coding. Use your experts.",
            connectors=[
                connectors.from_agent(symptom_agent.id),
                connectors.registry(name="@corti/medical-coding"),
                # Attach an optional MCP server:
                # connectors.mcp(mcp_url="https://mcp.corti.ai", auth_type="inherit"),
            ],
        )

        ctx = orchestrator.create_context()
        # Raise timeout for orchestrators that fan out to several sub-agents.
        reply = await ctx.send_text(
            "Patient has chest pain and shortness of breath. What ICD-10 codes apply?",
            timeout_in_seconds=180,
        )
        print(reply.text)

asyncio.run(main())
```

::: info
**auth_type** on `connectors.mcp()` tells the server which authentication scheme to use: `"none"` (default), `"bearer"` (static or runtime token), `"inherit"` (reuse the Corti API token), or `"oauth2.0"`. See [06 · Credentials](/python/06-credentials) for runtime token forwarding.
:::

### Next steps

<ExampleLinks>
<a href="/python/03-workflow">03 · Workflow<span>Chain multiple agents into a sequential pipeline.</span></a>
<a href="/python/06-credentials">06 · Credentials<span>Forward bearer tokens to authenticated MCP servers.</span></a>
</ExampleLinks>
