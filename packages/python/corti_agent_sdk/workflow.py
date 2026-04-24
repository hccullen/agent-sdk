from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import (
    TYPE_CHECKING,
    Any,
    Callable,
    Dict,
    List,
    Optional,
    Protocol,
    TypedDict,
    Union,
    runtime_checkable,
)

from .response import MessageResponse
from .types import CredentialStore, Part

if TYPE_CHECKING:
    from .handle import AgentHandle


# ── Runnable ──────────────────────────────────────────────────────────────────

@runtime_checkable
class Runnable(Protocol):
    """
    The single contract for anything that can be a step in a workflow, a branch
    of a parallel group, or a node in a state graph. ``AgentHandle``,
    ``Parallel``, and any custom object with a matching ``run()`` satisfy it.
    """

    async def run(self, input: Union[str, List[Part]]) -> MessageResponse: ...


def _is_runnable(x: Any) -> bool:
    return callable(getattr(x, "run", None))


# ── Workflow ──────────────────────────────────────────────────────────────────

class _WorkflowStepBase(TypedDict):
    # Any Runnable: AgentHandle, Parallel, or a custom object with run()
    agent: Any


class WorkflowStep(_WorkflowStepBase, total=False):
    """
    A fully-specified workflow step.

    ``agent`` accepts any :class:`Runnable` — an ``AgentHandle``, a
    ``Parallel`` group, or a custom object with a matching ``run()``.

    Users can pass a plain dict literal::

        {"agent": my_agent, "when": lambda r: "yes" in (r.text or ""), "retries": 2}
    """

    when: Callable[[MessageResponse], bool]
    transform: Callable[[MessageResponse], Union[str, List[Part]]]
    retries: int        # additional attempts on failure (default 0)
    retry_delay: float  # seconds between retries (default 1.0)


@dataclass
class WorkflowResult:
    """The result of a completed (or stopped-early) workflow run."""

    output: MessageResponse
    """The last executed response."""

    steps: List[MessageResponse]
    """Responses from every executed step. Skipped steps are excluded."""

    stopped_early: bool = field(default=False)
    """``True`` when a step failed and stopped execution early."""


def _normalise_workflow(step: Any) -> WorkflowStep:
    if _is_runnable(step):
        return WorkflowStep(agent=step)
    return step  # already a WorkflowStep dict


class Workflow:
    """
    A deterministic, code-first pipeline of agent invocations.

    Steps can be any :class:`Runnable` (an ``AgentHandle``, a ``Parallel``
    group, or a custom object) or a :class:`WorkflowStep` dict with optional
    ``when`` / ``transform`` / ``retries``.

    Example::

        result = await workflow([
            agent_a,
            parallel([agent_b, agent_c]),           # fan-out as a single step
            WorkflowStep(
                agent=agent_d,
                when=lambda r: "yes" in (r.text or ""),
                retries=2,
            ),
        ]).run("Start")

        print(result.output.text)
    """

    def __init__(self, steps: List[Any]) -> None:
        if not steps:
            raise ValueError("[AgentSDK] Workflow must have at least one step.")
        self._steps: List[WorkflowStep] = [_normalise_workflow(s) for s in steps]

    async def run(self, input: Union[str, List[Part]]) -> WorkflowResult:
        """Execute the workflow from the given initial input."""
        executed: List[MessageResponse] = []
        current: Union[str, List[Part]] = input
        stopped_early = False

        for i, step in enumerate(self._steps):
            is_first = i == 0

            if not is_first and "when" in step:
                if not step["when"](executed[-1]):
                    continue

            step_input: Union[str, List[Part]] = (
                step["transform"](executed[-1])
                if not is_first and "transform" in step
                else current
            )

            max_attempts = 1 + int(step.get("retries", 0))  # type: ignore[call-overload]
            retry_delay = float(step.get("retry_delay", 1.0))  # type: ignore[call-overload]
            response: Optional[MessageResponse] = None

            for attempt in range(max_attempts):
                response = await step["agent"].run(step_input)
                if response.status != "failed" or attempt + 1 >= max_attempts:
                    break
                if retry_delay > 0:
                    await asyncio.sleep(retry_delay)

            if response is None:
                raise RuntimeError("[AgentSDK] Internal error: workflow step produced no response.")
            executed.append(response)
            current = response.text or ""

            if response.status == "failed":
                stopped_early = True
                break

        if not executed:
            raise ValueError("[AgentSDK] All workflow steps were skipped — no output produced.")
        return WorkflowResult(output=executed[-1], steps=executed, stopped_early=stopped_early)


def workflow(steps: List[Any]) -> Workflow:
    """Create a :class:`Workflow` from an ordered list of steps."""
    return Workflow(steps)


# ── Parallel ──────────────────────────────────────────────────────────────────

class _ParallelStepBase(TypedDict):
    agent: "AgentHandle"


class ParallelStep(_ParallelStepBase, total=False):
    """
    A parallel step. Provide ``input`` to override the shared input for this
    specific agent; omit to use whatever was passed to ``Parallel.run()``.
    Provide ``credentials`` to forward auth credentials for this specific agent.
    """

    input: Union[str, List[Part]]
    credentials: "CredentialStore"


@dataclass
class ParallelResult:
    """Returned by ``Parallel.run_settled()``."""

    results: List[Dict[str, Any]]
    """One entry per step: ``{"status": "fulfilled", "value": …}`` or ``{"status": "rejected", "reason": …}``."""

    fulfilled: List[MessageResponse]
    """Responses from steps that completed without raising."""

    rejected: List[Any]
    """Exceptions from steps that raised."""


def _merge_responses(responses: List[MessageResponse]) -> MessageResponse:
    """
    Combine N agent responses into one by concatenating their reply-message
    parts. Preserves text parts, data parts, file parts, and their order within
    each branch. Failed / user-echo responses are skipped.
    """
    parts: List[Dict[str, Any]] = []
    for r in responses:
        msg = r.status_message
        if not msg or msg.get("role") == "user":  # type: ignore[union-attr]
            continue
        parts.extend(msg.get("parts") or [])  # type: ignore[union-attr]
    return MessageResponse({
        "id": "",
        "contextId": "",
        "kind": "task",
        "status": {
            "state": "completed",
            "message": {
                "role": "agent",
                "parts": parts,
                "messageId": "",
                "kind": "message",
            },
        },
    })


class Parallel:
    """
    Run multiple agents concurrently on the same input.

    ``run()`` returns a single :class:`MessageResponse` whose reply message
    carries the concatenated parts of every fulfilled branch — so downstream
    agents (or a workflow step) see one message with N branches' worth of
    parts, not a lossy text-joined string. Use ``run_settled()`` when you
    need the per-branch allSettled breakdown.

    Example::

        # Inside a workflow — merged parts flow straight into the next step
        await workflow([agent_a, parallel([agent_b, agent_c]), agent_d]).run("prompt")

        # Standalone, per-branch results
        result = await parallel([agent_a, agent_b]).run_settled("prompt")
        for r in result.fulfilled:
            print(r.text)
    """

    def __init__(self, steps: List[Any]) -> None:
        if not steps:
            raise ValueError("[AgentSDK] Parallel must have at least one step.")
        self._steps: List[Any] = steps

    async def run(self, input: Union[str, List[Part]]) -> MessageResponse:
        """Run all branches concurrently and merge fulfilled responses into one :class:`MessageResponse`."""
        settled = await self.run_settled(input)
        if not settled.fulfilled:
            raise ValueError("[AgentSDK] All parallel steps failed — no output to merge.")
        return _merge_responses(settled.fulfilled)

    async def run_settled(self, input: Union[str, List[Part]]) -> ParallelResult:
        """Run all branches concurrently and return the full per-branch allSettled result."""

        async def _run(step: Any) -> MessageResponse:
            # Bare Runnable — anything with a callable `run` (AgentHandle,
            # nested Parallel, custom object). Dict form is reserved for
            # per-branch input / credentials overrides.
            if _is_runnable(step):
                return await step.run(input)
            step_input: Union[str, List[Part]] = step.get("input", input)
            # Only forward `credentials` when explicitly set — `run()`
            # signatures other than AgentHandle's may not accept the kwarg.
            if step.get("credentials") is not None:
                return await step["agent"].run(step_input, credentials=step["credentials"])
            return await step["agent"].run(step_input)

        raw = await asyncio.gather(*[_run(s) for s in self._steps], return_exceptions=True)

        results: List[Dict[str, Any]] = []
        fulfilled: List[MessageResponse] = []
        rejected: List[Any] = []

        for r in raw:
            if isinstance(r, BaseException):
                results.append({"status": "rejected", "reason": r})
                rejected.append(r)
            else:
                results.append({"status": "fulfilled", "value": r})
                fulfilled.append(r)

        return ParallelResult(results=results, fulfilled=fulfilled, rejected=rejected)


def parallel(steps: List[Any]) -> Parallel:
    """Run multiple agents (or any :class:`Runnable`) concurrently on the same input."""
    return Parallel(steps)
