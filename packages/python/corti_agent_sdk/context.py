from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any, AsyncGenerator, Dict, List, Optional

from .response import MessageResponse
from .types import CredentialStore, Part, StreamEvent

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
            cid = (response.get("task") or {}).get("contextId")
            if cid:
                self._context_id = cid

    async def _do_send(self, parts: List[Part]) -> MessageResponse:
        """Send parts to the API and capture contextId from the response."""
        response = await self._client.request(
            "POST",
            f"agents/{self._agent_id}/v1/message:send",
            body={"message": self._build_message(parts)},
        )
        self._capture_context_id(response)
        return MessageResponse(response)

    async def send_message(self, parts: List[Part]) -> MessageResponse:
        """
        Send a message and receive a :class:`MessageResponse`.

        On the first call the server creates a new thread; subsequent calls
        automatically continue the same thread.

        If the agent responds with ``auth-required`` and this context was
        created with credentials, those credentials are automatically forwarded
        as a DataPart follow-up — the caller receives the final response.
        """
        result = await self._do_send(parts)

        if result.status == "auth-required" and self._credentials:
            cred_part: Part = {  # type: ignore[assignment]
                "kind": "data",
                "data": {"credentials": self._credentials},
            }
            result = await self._do_send([cred_part])

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
        async for event in self._client.stream_request(
            f"agents/{self._agent_id}/v1/message:send",
            body={"message": self._build_message(parts)},
        ):
            self._capture_context_id(event)
            yield event
