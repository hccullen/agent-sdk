# 01 — Hello, agent

The minimum viable example. Create an agent, open a conversation context, send two messages, and read the replies.

<ConceptGrid>
<ConceptCard title="CortiClient">Async HTTP client. Use as an `async with` context manager for automatic cleanup.</ConceptCard>
<ConceptCard title="AgentsClient">Factory for agent CRUD — wraps all responses in typed `AgentHandle` objects.</ConceptCard>
<ConceptCard title="AgentHandle">Reference to a registered agent. Call `create_context()` to start a thread.</ConceptCard>
<ConceptCard title="AgentContext">Lazy conversation thread. Tracks `context_id` automatically after the first message.</ConceptCard>
</ConceptGrid>

## Full code

```python
"""
01 — Hello, agent.

Minimum viable example: create an agent, open a context, send two messages.
Ephemeral agents are GC'd server-side — no explicit cleanup needed.
"""
import asyncio
from corti_agent_sdk import CortiClient, AgentsClient

async def main():
    async with CortiClient(
        tenant_name="YOUR_TENANT",
        environment="eu",
        auth={"client_id": "YOUR_ID", "client_secret": "YOUR_SECRET"},
    ) as client:
        agents = AgentsClient(client)

        agent = await agents.create(
            name="hello-agent",
            description="A minimal greeting agent.",
            system_prompt="You are a friendly assistant. Keep replies to one sentence.",
        )

        ctx = agent.create_context()

        reply = await ctx.send_text("Say hello and tell me one fun fact.")
        print("Agent:", reply.text)
        print("Status:", reply.status)
        print("Context ID:", ctx.id)

        # The context persists across calls — the agent remembers the thread.
        follow_up = await ctx.send_text("Tell me another one.")
        print("Agent:", follow_up.text)

asyncio.run(main())
```

## What to expect

<OutputBlock>
Agent:      Hello! Did you know that honey never spoils — archaeologists have found 3,000-year-old honey in Egyptian tombs that was still edible.
Status:     completed
Context ID: ctx_abc123
Agent:      Octopuses have three hearts, and two of them stop beating when they swim!
</OutputBlock>

::: info
**Tip:** The `context_id` is `None` until the first message is sent. After that it's stable — you can persist it and resume with `agent.get_context(saved_id)`.
:::

### Next steps

<ExampleLinks>
<a href="/python/02-connectors">02 · Connectors<span>Wire up MCP servers, sub-agents, and registry experts.</span></a>
<a href="/python/03-workflow">03 · Workflow<span>Chain agents into a deterministic pipeline.</span></a>
</ExampleLinks>
