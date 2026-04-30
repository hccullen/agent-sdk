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
            print(response.text)   # e.g. "The ICD-10 code is I10."

    asyncio.run(main())
"""

from .agents import AgentsClient
from .client import CortiClient
from .connectors import connectors
from .context import AgentContext
from .handle import AgentHandle
from .response import MessageResponse
from .state_graph import (
    END,
    StateGraph,
    StateGraphResult,
    StateGraphStep,
    agent_node,
    stateGraph,
)
from .workflow import (
    Parallel,
    ParallelResult,
    ParallelStep,
    Workflow,
    WorkflowResult,
    WorkflowStep,
    parallel,
    workflow,
)
from .types import (
    # credentials
    Credential,
    CredentialStore,
    OAuth2Credential,
    TokenCredential,
    # connector / agent options
    A2aConnector,
    ConnectorDef,
    CortiAgentConnector,
    CreateAgentOptions,
    Lifecycle,
    McpConnector,
    RegistryConnector,
    UpdateAgentOptions,
    # part types
    DataPart,
    FilePart,
    Part,
    TextPart,
    # A2A v1 output types
    Artifact,
    Message,
    Task,
    TaskState,
    TaskStatus,
    # streaming
    StreamEvent,
)

__all__ = [
    "AgentContext",
    "AgentHandle",
    "AgentsClient",
    "CortiClient",
    "MessageResponse",
    "Parallel",
    "ParallelResult",
    "ParallelStep",
    "Workflow",
    "WorkflowResult",
    "WorkflowStep",
    "connectors",
    "parallel",
    "workflow",
    # state graph
    "END",
    "StateGraph",
    "StateGraphResult",
    "StateGraphStep",
    "agent_node",
    "stateGraph",
    # credentials
    "Credential",
    "CredentialStore",
    "OAuth2Credential",
    "TokenCredential",
    # connector / agent options
    "A2aConnector",
    "ConnectorDef",
    "CortiAgentConnector",
    "CreateAgentOptions",
    "Lifecycle",
    "McpConnector",
    "RegistryConnector",
    "UpdateAgentOptions",
    # part types
    "DataPart",
    "FilePart",
    "Part",
    "TextPart",
    # A2A v1 output types
    "Artifact",
    "Message",
    "Task",
    "TaskState",
    "TaskStatus",
    # streaming
    "StreamEvent",
]
