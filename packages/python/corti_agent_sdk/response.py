from __future__ import annotations

from typing import Any, Dict, List, Optional


class MessageResponse:
    """
    Wraps the raw ``message:send`` API response and promotes the fields you
    almost always need to the top level, while keeping the full response
    accessible via ``.raw``.

    Example::

        r = await ctx.send_text("What is the ICD-10 code for hypertension?")
        print(r.text)      # "The ICD-10 code is I10."
        print(r.status)    # "completed"
        print(r.raw)       # full dict if you need it
    """

    def __init__(self, raw: Dict[str, Any]) -> None:
        self._raw = raw

    @property
    def _task(self) -> Dict[str, Any]:
        return self._raw.get("task") or {}

    @property
    def _status(self) -> Dict[str, Any]:
        return self._task.get("status") or {}

    @property
    def status(self) -> Optional[str]:
        """The task's terminal state, e.g. ``"completed"``, ``"failed"``."""
        return self._status.get("state")

    @property
    def status_message(self) -> Optional[Dict[str, Any]]:
        """The agent's reply message (``task.status.message``)."""
        return self._status.get("message")

    @property
    def text(self) -> Optional[str]:
        """All text parts from ``status_message`` joined into a single string."""
        msg = self.status_message
        if not msg:
            return None
        parts = msg.get("parts") or []
        joined = "".join(
            p["text"] for p in parts if p.get("kind") == "text" and "text" in p
        )
        return joined or None

    @property
    def artifacts(self) -> List[Any]:
        """Structured artifacts produced by the task (empty list if none)."""
        return self._task.get("artifacts") or []

    @property
    def context_id(self) -> Optional[str]:
        """The thread ID — same value the context tracks internally."""
        return self._task.get("contextId")

    @property
    def task_id(self) -> Optional[str]:
        """The task ID for this specific invocation."""
        return self._task.get("id")

    @property
    def raw(self) -> Dict[str, Any]:
        """The full, unmodified response from the API."""
        return self._raw
