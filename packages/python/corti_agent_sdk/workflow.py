from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional, TypedDict, Union

from .response import MessageResponse
from .types import CredentialStore, Part

if TYPE_CHECKING:
    from .handle import AgentHandle


# ── Workflow ──────────────────────────────────────────────────────────────────

class _WorkflowStepBase(TypedDict):
    # Any Runnable: AgentHandle, Parallel (auto-wrapped), or custom object with run()
    agent: Any


class WorkflowStep(_WorkflowStepBase, total=False):
    """
    A fully-specified workflow step.

    ``agent`` accepts any object with an async ``run(input)`` method —
    an ``AgentHandle``, a ``Parallel`` group (auto-wrapped to merge results),
    or a custom runnable.

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


class _ParallelAdapter:
    """Wraps a Parallel so it can be used as a Workflow step."""

    def __init__(self, parallel: "Parallel") -> None:
        self._parallel = parallel

    async def run(self, input: Union[str, List[Part]], **_: Any) -> MessageResponse:
        result = await self._parallel.run(input)
        if not result.fulfilled:
            raise ValueError("[AgentSDK] All parallel steps failed — no output to merge.")
        return MessageResponse.from_text(
            "\n\n".join(r.text or "" for r in result.fulfilled)
        )


def _normalise_workflow(
    step: Union["AgentHandle", "Parallel", WorkflowStep],
) -> WorkflowStep:
    from .handle import AgentHandle as _AgentHandle
    if isinstance(step, _AgentHandle):
        return WorkflowStep(agent=step)
    if isinstance(step, Parallel):
        return WorkflowStep(agent=_ParallelAdapter(step))
    return step


class Workflow:
    """
    A deterministic, code-first pipeline of agent invocations.

    Steps can be ``AgentHandle`` instances, ``Parallel`` groups, or
    ``WorkflowStep`` dicts with optional ``when`` / ``transform`` / ``retries``.

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

    def __init__(
        self,
        steps: List[Union["AgentHandle", "Parallel", WorkflowStep]],
    ) -> None:
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


def workflow(
    steps: List[Union["AgentHandle", "Parallel", WorkflowStep]],
) -> Workflow:
    """
    Create a :class:`Workflow` from an ordered list of steps.

    Each element can be a bare ``AgentHandle``, a ``Parallel`` group
    (fulfilled results are text-joined for the next step), or a
    :class:`WorkflowStep` dict.
    """
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
    """Returned by ``Parallel.run()``."""

    results: List[Dict[str, Any]]
    """One entry per step: ``{"status": "fulfilled", "value": …}`` or ``{"status": "rejected", "reason": …}``."""

    fulfilled: List[MessageResponse]
    """Responses from steps that completed without raising."""

    rejected: List[Any]
    """Exceptions from steps that raised."""


class Parallel:
    """
    Run multiple agents concurrently on the same input.

    Can be used standalone (``run()`` → :class:`ParallelResult`) or dropped
    directly into a :func:`workflow` step list, where fulfilled results are
    text-joined into a single response for the next step.

    Example::

        # Standalone
        result = await parallel([agent_a, agent_b]).run("prompt")
        for r in result.fulfilled:
            print(r.text)

        # Inside a workflow
        await workflow([agent_a, parallel([agent_b, agent_c]), agent_d]).run("prompt")
    """

    def __init__(self, steps: List[Union["AgentHandle", ParallelStep]]) -> None:
        if not steps:
            raise ValueError("[AgentSDK] Parallel must have at least one step.")
        self._steps = steps

    async def run(self, input: Union[str, List[Part]]) -> ParallelResult:
        """Run all steps concurrently and return a :class:`ParallelResult`."""
        from .handle import AgentHandle as _AgentHandle

        async def _run(step: Union[AgentHandle, ParallelStep]) -> MessageResponse:
            agent = step if isinstance(step, _AgentHandle) else step["agent"]
            step_input: Union[str, List[Part]] = (
                step.get("input", input)  # type: ignore[union-attr]
                if not isinstance(step, _AgentHandle)
                else input
            )
            creds = (
                step.get("credentials")  # type: ignore[union-attr]
                if not isinstance(step, _AgentHandle)
                else None
            )
            return await agent.run(step_input, credentials=creds)

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


def parallel(steps: List[Union["AgentHandle", ParallelStep]]) -> Parallel:
    """Run multiple agents concurrently on the same input."""
    return Parallel(steps)
