from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any, AsyncGenerator, Dict, List, Optional

from .response import MessageResponse
from .types import Credential, CredentialStore, Part, StreamEvent

if TYPE_CHECKING:
    from .client import CortiClient


class AgentContext:
    """
    A stateful conversation thread with a specific agent.

    Obtained via ``AgentHandle.create_context()``.

    The context automatically tracks the ``contextId`` returned by the first
    message and passes it in all subsequent calls, keeping the conversation
    in the same thread.

    If ``credentials`` are supplied and the agent returns ``auth-required``,
    the SDK automatically sends them as a DataPart follow-up — the caller
    receives the final response with no extra code needed.

    Example::

        ctx = agent.create_context(credentials={"my-mcp": "tok_123"})
        r = await ctx.send_text("Hello!")
        print(r.text)    # agent reply
        print(r.status)  # "completed"
    """

    def __init__(
        self,
        agent_id: str,
        client: "CortiClient",
        context_id: Optional[str] = None,
        credentials: Optional[CredentialStore] = None,
    ) -> None:
        self._agent_id = agent_id
        self._client = client
        self._context_id = context_id
        self._credentials = credentials

    @property
    def id(self) -> Optional[str]:
        """The context (thread) ID, available after the first message is sent."""
        return self._context_id

    def _build_message(self, parts: List[Part]) -> Dict[str, Any]:
        msg: Dict[str, Any] = {
            "role": "user",
            "parts": parts,
            "messageId": str(uuid.uuid4()),
            "kind": "message",
        }
        if self._context_id is not None:
            msg["contextId"] = self._context_id
        return msg

    def _capture_context_id(self, response: Any) -> None:
        if self._context_id is None and isinstance(response, dict):
            # JSON-RPC result may be a Task directly, or a streaming event wrapping a task.
            cid = response.get("contextId") or (response.get("task") or {}).get("contextId")
            if cid:
                self._context_id = cid

    def _build_auth_part(self, mcp_name: str, cred: Credential) -> Part:
        if cred["type"] == "token":
            return {"kind": "data", "data": {"type": "token", "mcp_name": mcp_name, "token": cred["token"]}}  # type: ignore[return-value]
        return {  # type: ignore[return-value]
            "kind": "data",
            "data": {
                "type": "credentials",
                "mcp_name": mcp_name,
                "client_id": cred["client_id"],  # type: ignore[typeddict-item]
                "client_secret": cred["client_secret"],  # type: ignore[typeddict-item]
            },
        }

    def _build_auth_parts(self) -> List[Part]:
        if not self._credentials:
            return []
        return [self._build_auth_part(name, cred) for name, cred in self._credentials.items()]

    async def _do_send(self, parts: List[Part]) -> MessageResponse:
        """Send parts to the API and capture contextId from the response."""
        result = await self._client.rpc_call(
            self._agent_id,
            "message/send",
            {"message": self._build_message(parts)},
        )
        self._capture_context_id(result)
        return MessageResponse(result)

    async def send_message(self, parts: List[Part]) -> MessageResponse:
        """
        Send a message and receive a :class:`MessageResponse`.

        On the first call the server creates a new thread; subsequent calls
        automatically continue the same thread.

        If credentials were supplied, they are included as DataParts on the
        first message of a new context. If the agent still responds with
        ``auth-required``, credentials are sent again as a follow-up.
        """
        is_new_context = self._context_id is None
        all_parts = self._build_auth_parts() + parts if is_new_context and self._credentials else parts

        result = await self._do_send(all_parts)

        if result.status == "auth-required" and self._credentials:
            result = await self._do_send(self._build_auth_parts())

        return result

    async def send_text(self, text: str) -> MessageResponse:
        """Convenience wrapper for sending a plain-text message."""
        return await self.send_message([{"kind": "text", "text": text}])

    async def stream_message(self, parts: List[Part]) -> AsyncGenerator[StreamEvent, None]:
        """
        Send a message and receive the response as a stream of SSE events.

        Each yielded dict may contain any combination of:

        - ``task``           – task object (includes ``contextId`` on first event)
        - ``statusUpdate``   – state transitions (submitted → working → completed)
        - ``artifactUpdate`` – structured output chunks
        - ``message``        – final assembled message

        Example::

            async for event in ctx.stream_message([{"kind": "text", "text": "Hi"}]):
                state = (event.get("statusUpdate") or {}).get("status", {}).get("state")
                if state:
                    print(state)
        """
        async for event in self._client.rpc_stream(
            self._agent_id,
            "message/stream",
            {"message": self._build_message(parts)},
        ):
            self._capture_context_id(event)
            yield event
