# corti-agent-sdk (Python)

Developer-friendly Python wrapper for building agents with the Corti API.

## Installation

```bash
pip install corti-agent-sdk
```

## Quick start

```python
import asyncio
from corti_agent_sdk import CortiClient, AgentsClient, connectors

async def main():
    async with CortiClient(
        tenant_name="YOUR_TENANT",
        environment="eu",
        auth={"client_id": "YOUR_ID", "client_secret": "YOUR_SECRET"},
    ) as client:
        agents = AgentsClient(client)

        agent = await agents.create(
            name="my-agent",
            description="Handles medical coding queries",
            connectors=[connectors.registry(name="@corti/medical-coding")],
        )

        ctx = agent.create_context()
        r = await ctx.send_text("ICD-10 code for hypertension?")
        print(r.text)   # "The ICD-10 code is I10."

asyncio.run(main())
```

For full documentation see the repository root.
