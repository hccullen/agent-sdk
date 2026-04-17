"""
corti-agent-sdk
~~~~~~~~~~~~~~~

Developer-friendly wrapper for building agents with the Corti API.

Usage::

    import asyncio
    from corti_agent_sdk import CortiClient, AgentsClient, connectors

    async def main():
        async with CortiClient(
            tenant_name="YOUR_TENANT",
            environment="eu",
            auth={"client_id": "YOUR_ID", "client_secret": "YOUR_SECRET"},
        ) as client:
            agents = AgentsClient(client)

            sub = await agents.create(
                name="my-sub-agent",
                description="Handles medical coding queries",
                lifecycle="persistent",
                connectors=[
                    connectors.mcp(mcp_url="https://mcp.corti.ai"),
                    connectors.registry(name="@corti/medical-coding"),
                ],
            )

            ctx = sub.create_context()
            response = await ctx.send_text("ICD-10 code for hypertension?")
            print(response["task"]["status"]["message"]["parts"])

    asyncio.run(main())
"""

from .agents import AgentsClient
from .client import CortiClient
from .connectors import connectors
from .context import AgentContext
from .handle import AgentHandle
from .types import (
    A2aConnector,
    ConnectorDef,
    CortiAgentConnector,
    CreateAgentOptions,
    Lifecycle,
    McpConnector,
    MessageSendResponse,
    Part,
    RegistryConnector,
    StreamEvent,
    TextPart,
    UpdateAgentOptions,
)

__all__ = [
    "AgentContext",
    "AgentHandle",
    "AgentsClient",
    "CortiClient",
    "connectors",
    # types
    "A2aConnector",
    "ConnectorDef",
    "CortiAgentConnector",
    "CreateAgentOptions",
    "Lifecycle",
    "McpConnector",
    "MessageSendResponse",
    "Part",
    "RegistryConnector",
    "StreamEvent",
    "TextPart",
    "UpdateAgentOptions",
]
