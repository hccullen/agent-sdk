# 05 — Streaming

Use `ctx.stream_message()` to receive the agent's response as an async generator of `StreamEvent` dicts. Each event carries a state update, artifact chunk, or the final message.

<ConceptGrid>
<ConceptCard title="stream_message(parts)">Returns an async generator — use `async for event in ctx.stream_message(...):`</ConceptCard>
<ConceptCard title="statusUpdate">State-transition events: `submitted → working → completed`.</ConceptCard>
<ConceptCard title="artifactUpdate">Structured output chunks streamed incrementally.</ConceptCard>
<ConceptCard title="message">Final assembled message — equivalent to what `send_message()` returns.</ConceptCard>
</ConceptGrid>

## Event shape

The SDK normalises raw A2A events into a wrapped dict before yielding:

| Key | Present when |
|---|---|
| `event["statusUpdate"]` | State transitions (`submitted`, `working`, `completed`, …) |
| `event["artifactUpdate"]` | Structured output chunk available. |
| `event["message"]` | Final assembled agent message. |
| `event["task"]` | Full task object (first event only). |

## Full code

```python
"""
05 — Streaming.

Stream the agent's response event-by-event over SSE.
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
            name="stream-demo",
            description="Demonstrates streaming responses.",
            system_prompt="You are a helpful assistant.",
        )

        ctx = agent.create_context()

        async for event in ctx.stream_message([{"kind": "text", "text": "Tell me about ICD-10."}]):
            # State transitions
            if su := event.get("statusUpdate"):
                state = (su.get("status") or {}).get("state")
                print(f"  [{state}]")

            # Final message text
            if msg := event.get("message"):
                for part in msg.get("parts", []):
                    if part.get("kind") == "text":
                        print("Agent:", part["text"])

        print("Context ID:", ctx.id)  # available after first event

asyncio.run(main())
```

::: info
**Note:** `stream_message()` does not automatically forward credentials on `auth-required` the way `send_message()` does. For MCP auth flows, use `send_message()` or handle the retry yourself.
:::

### Next steps

<ExampleLinks>
<a href="/python/06-credentials">06 · Credentials<span>Forward MCP bearer tokens automatically.</span></a>
<a href="/python/01-hello-agent">01 · Hello, agent<span>Non-streaming send_text() baseline.</span></a>
</ExampleLinks>
