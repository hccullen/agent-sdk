from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from .types import Artifact, Message, Task


class MessageResponse:
    """
    Wraps the raw ``message:send`` API response and promotes the fields you
    almost always need to the top level, while keeping the full response
    accessible via ``.raw``.

    Example::

        r = await ctx.send_text("What is the ICD-10 code for hypertension?")
        print(r.text)      # "The ICD-10 code is I10."
        print(r.status)    # "completed"
        print(r.task)      # full A2A v1 Task dict
        print(r.raw)       # full API response dict
    """

    def __init__(self, raw: Dict[str, Any]) -> None:
        self._raw = raw

    @classmethod
    def from_text(cls, text: str) -> "MessageResponse":
        """
        Synthesise a completed ``MessageResponse`` from a plain string.
        Used internally when merging parallel results into a single response.
        """
        return cls({
            "task": {
                "id": "",
                "contextId": "",
                "kind": "task",
                "status": {
                    "state": "completed",
                    "message": {
                        "role": "agent",
                        "parts": [{"kind": "text", "text": text}],
                        "messageId": "",
                        "kind": "message",
                    },
                },
            }
        })

    # ── private helpers ───────────────────────────────────────────────────────

    @property
    def _node(self) -> Dict[str, Any]:
        return self._raw.get("task") or {}

    @property
    def _node_status(self) -> Dict[str, Any]:
        return self._node.get("status") or {}

    # ── A2A v1 task ───────────────────────────────────────────────────────────

    @property
    def task(self) -> Optional[Task]:
        """The full A2A v1 Task object."""
        return self._raw.get("task")  # type: ignore[return-value]

    # ── promoted fields ───────────────────────────────────────────────────────

    @property
    def status(self) -> Optional[str]:
        """The task's terminal state, e.g. ``"completed"``, ``"failed"``."""
        return self._node_status.get("state")

    @property
    def status_message(self) -> Optional[Message]:
        """The agent's reply message (``task.status.message``)."""
        return self._node_status.get("message")  # type: ignore[return-value]

    @property
    def text(self) -> Optional[str]:
        """All text parts from ``status_message`` joined into a single string."""
        msg = self.status_message
        if not msg:
            return None
        parts = msg.get("parts") or []  # type: ignore[union-attr]
        joined = "".join(
            p["text"] for p in parts if p.get("kind") == "text" and "text" in p
        )
        return joined or None

    @property
    def artifacts(self) -> List[Artifact]:
        """Structured artifacts produced by the task, deduplicated by parts content."""
        seen: set[str] = set()
        result: List[Artifact] = []
        for a in self._node.get("artifacts") or []:
            key = json.dumps(a.get("parts"), sort_keys=True)
            if key not in seen:
                seen.add(key)
                result.append(a)
        return result

    @property
    def context_id(self) -> Optional[str]:
        """The thread ID — same value the context tracks internally."""
        return self._node.get("contextId")

    @property
    def task_id(self) -> Optional[str]:
        """The task ID for this specific invocation."""
        return self._node.get("id")

    @property
    def raw(self) -> Dict[str, Any]:
        """The full, unmodified response from the API."""
        return self._raw
