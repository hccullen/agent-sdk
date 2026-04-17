from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any, AsyncGenerator, Dict, List, Optional

from .types import MessageSendResponse, Part, StreamEvent

if TYPE_CHECKING:
    from .client import CortiClient


class AgentContext:
    """
    A stateful conversation thread with a specific agent.

    Obtained via ``AgentHandle.create_context()``.

    The context automatically tracks the ``contextId`` returned by the first
    message and passes it in all subsequent calls, keeping the conversation
    in the same thread.

    Example::

        ctx = agent.create_context()
        r1 = await ctx.send_text("Hello!")
        r2 = await ctx.send_text("Follow-up?")

        # Or with streaming:
        async for event in ctx.stream_message([{"kind": "text", "text": "Hello"}]):
            if event.get("statusUpdate"):
                print(event["statusUpdate"]["status"]["state"])
    """

    def __init__(
        self,
        agent_id: str,
        client: "CortiClient",
        context_id: Optional[str] = None,
    ) -> None:
        self._agent_id = agent_id
        self._client = client
        self._context_id = context_id

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

    async def send_message(self, parts: List[Part]) -> MessageSendResponse:
        """
        Send a message and receive the full response.

        On the first call the server creates a new thread and returns a
        ``contextId`` inside ``task``; subsequent calls automatically continue
        the same thread.
        """
        response = await self._client.request(
            "POST",
            f"agents/{self._agent_id}/v1/message:send",
            body={"message": self._build_message(parts)},
        )
        self._capture_context_id(response)
        return response

    async def send_text(self, text: str) -> MessageSendResponse:
        """Convenience wrapper for sending a plain-text message."""
        return await self.send_message([{"kind": "text", "text": text}])

    async def stream_message(self, parts: List[Part]) -> AsyncGenerator[StreamEvent, None]:
        """
        Send a message and receive the response as a stream of SSE events.

        Each yielded dict may contain any combination of:

        - ``task``         – task object (includes ``contextId`` on first event)
        - ``statusUpdate`` – state transitions (submitted → working → completed)
        - ``artifactUpdate`` – structured output chunks
        - ``message``      – final assembled message

        The ``contextId`` is captured from the first ``task`` event so that
        subsequent ``send_message`` / ``stream_message`` calls continue the
        same thread.

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
