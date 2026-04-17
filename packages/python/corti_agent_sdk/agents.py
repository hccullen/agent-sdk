from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List, Optional

from .connectors import connectors_to_experts
from .handle import AgentHandle
from .types import ConnectorDef, Lifecycle

if TYPE_CHECKING:
    from .client import CortiClient


class AgentsClient:
    """
    Developer-friendly wrapper around the Corti agents REST API.

    Translates the higher-level ``connectors`` / ``lifecycle`` vocabulary into
    the raw API's ``experts`` / ``ephemeral`` fields, and returns
    ``AgentHandle`` objects instead of plain dicts.

    Example::

        client = CortiClient(tenant_name="acme", environment="eu", auth={...})
        agents = AgentsClient(client)

        sub = await agents.create(
            name="my-sub-agent",
            description="Handles weather queries",
            lifecycle="persistent",
            connectors=[
                {"type": "mcp", "mcp_url": "https://mcp.corti.ai"},
                {"type": "registry", "name": "@corti/medical-coding"},
            ],
        )

        ctx = sub.create_context()
        r = await ctx.send_text("What is the ICD-10 code for hypertension?")
    """

    def __init__(self, client: "CortiClient") -> None:
        self._client = client

    async def create(
        self,
        *,
        name: str,
        description: str,
        system_prompt: Optional[str] = None,
        lifecycle: Lifecycle = "ephemeral",
        connectors: Optional[List[ConnectorDef]] = None,
    ) -> AgentHandle:
        """
        Create a new agent and return an ``AgentHandle``.

        Parameters
        ----------
        name:
            Slug-like name, unique within the tenant.
        description:
            Short human-readable description of the agent's purpose.
        system_prompt:
            Instructions that define the agent's behaviour.
        lifecycle:
            ``"ephemeral"`` (default) – auto-deleted periodically, not listed.
            ``"persistent"``          – survives across sessions, appears in listings.
        connectors:
            MCPs, registry experts, and other agents to attach.
        """
        body: Dict[str, Any] = {
            "name": name,
            "description": description,
            "ephemeral": lifecycle != "persistent",
        }
        if system_prompt is not None:
            body["systemPrompt"] = system_prompt
        if connectors:
            body["experts"] = connectors_to_experts(connectors)

        agent = await self._client.request("POST", "agents", body=body)
        return AgentHandle(agent, self._client)

    async def get(self, agent_id: str) -> AgentHandle:
        """Fetch an agent by ID and return an ``AgentHandle``."""
        agent = await self._client.request("GET", f"agents/{agent_id}")
        return AgentHandle(agent, self._client)

    async def list(self) -> List[AgentHandle]:
        """List all agents and return ``AgentHandle`` wrappers."""
        agents = await self._client.request("GET", "agents")
        return [AgentHandle(a, self._client) for a in (agents or [])]

    def wrap(self, agent: Dict[str, Any]) -> AgentHandle:
        """
        Wrap an existing raw agent dict in an ``AgentHandle`` without a
        network call – useful when you already have an agent dict from a
        direct ``client.request()`` call.
        """
        return AgentHandle(agent, self._client)
