from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List, Optional, Union

from .connectors import connectors_to_experts
from .context import AgentContext
from .response import MessageResponse
from .types import ConnectorDef, CredentialStore, Part

if TYPE_CHECKING:
    from .client import CortiClient


class AgentHandle:
    """
    A handle to a Corti agent enriched with conversation-management helpers.

    Returned by ``AgentsClient.create()`` and ``AgentsClient.get()``.

    Properties mirror the API response fields (camelCase → snake_case).
    The underlying raw dict is always accessible via ``.raw``.
    """

    def __init__(self, agent: Dict[str, Any], client: "CortiClient") -> None:
        self._agent = agent
        self._client = client

    @property
    def id(self) -> str:
        return self._agent["id"]

    @property
    def name(self) -> str:
        return self._agent["name"]

    @property
    def description(self) -> str:
        return self._agent["description"]

    @property
    def system_prompt(self) -> str:
        return self._agent.get("systemPrompt", "")

    @property
    def raw(self) -> Dict[str, Any]:
        """The underlying raw agent dict from the API."""
        return self._agent

    async def run(
        self,
        input: Union[str, List[Part]],
        *,
        context_id: Optional[str] = None,
        credentials: Optional[CredentialStore] = None,
    ) -> MessageResponse:
        """
        One-shot invoke: create a fresh context, send the message, return the response.

        Parameters
        ----------
        input:
            Plain text string or a list of message Parts.
        context_id:
            Optional thread ID to continue an existing conversation.
        credentials:
            Service credentials forwarded automatically if the agent returns
            ``auth-required``.

        Example::

            r1 = await agent_a.run("Classify this note.")
            r2 = await agent_b.run(r1.text or "")
        """
        ctx = AgentContext(self._agent["id"], self._client, context_id, credentials)
        if isinstance(input, str):
            return await ctx.send_text(input)
        return await ctx.send_message(input)

    def create_context(
        self,
        *,
        credentials: Optional[CredentialStore] = None,
    ) -> AgentContext:
        """
        Create a new conversation context (thread) with this agent.

        The context is lazy – no network call is made until the first
        ``send_message()`` call, at which point the server creates the thread
        and returns a ``contextId`` that is transparently managed for you.

        Parameters
        ----------
        credentials:
            Service credentials forwarded automatically if the agent returns
            ``auth-required``.

        Example::

            ctx = agent.create_context(credentials={"my-mcp": "tok_123"})
            r1 = await ctx.send_text("Hello")
            r2 = await ctx.send_text("Follow-up?")
        """
        return AgentContext(self._agent["id"], self._client, credentials=credentials)

    async def update(
        self,
        *,
        name: Optional[str] = None,
        description: Optional[str] = None,
        system_prompt: Optional[str] = None,
        connectors: Optional[List[ConnectorDef]] = None,
    ) -> "AgentHandle":
        """
        Partially update this agent and return a new handle.

        Only the provided keyword arguments are sent in the PATCH body.
        Passing ``connectors`` replaces the full expert set; omit to leave
        the existing connectors unchanged.

        Example::

            updated = await agent.update(
                system_prompt="Be more concise.",
                connectors=[{"type": "mcp", "mcp_url": "https://mcp.corti.ai"}],
            )
        """
        body: Dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if description is not None:
            body["description"] = description
        if system_prompt is not None:
            body["systemPrompt"] = system_prompt
        if connectors is not None:
            body["experts"] = connectors_to_experts(connectors)

        updated = await self._client.request(
            "PATCH", f"agents/{self._agent['id']}", body=body
        )
        return AgentHandle(updated, self._client)

    async def refresh(self) -> "AgentHandle":
        """Fetch the latest state of this agent from the API."""
        updated = await self._client.request("GET", f"agents/{self._agent['id']}")
        return AgentHandle(updated, self._client)

    async def delete(self) -> None:
        """Delete this agent. The handle should not be used after this call."""
        await self._client.request("DELETE", f"agents/{self._agent['id']}")

    def __repr__(self) -> str:
        return f"AgentHandle(id={self.id!r}, name={self.name!r})"
