from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Callable, List, Optional, TypedDict, Union

from .response import MessageResponse
from .types import Part

if TYPE_CHECKING:
    from .handle import AgentHandle


# ── Public types ──────────────────────────────────────────────────────────────

class _WorkflowStepBase(TypedDict):
    agent: "AgentHandle"


class WorkflowStep(_WorkflowStepBase, total=False):
    """
    A fully-specified workflow step.

    ``agent`` is required. ``when`` and ``transform`` are optional and only
    apply to steps that are not the first in the pipeline.

    Users can pass a plain dict literal::

        {"agent": my_agent, "when": lambda r: "yes" in (r.text or "")}
    """

    when: Callable[[MessageResponse], bool]
    transform: Callable[[MessageResponse], Union[str, List[Part]]]


@dataclass
class WorkflowResult:
    """The result of a completed (or stopped-early) workflow run."""

    output: MessageResponse
    """The last executed response."""

    steps: List[MessageResponse]
    """Responses from every executed step. Skipped steps are excluded."""

    stopped_early: bool = field(default=False)
    """``True`` when execution stopped because a step returned ``status == "failed"``."""


# ── Internal helpers ──────────────────────────────────────────────────────────

def _normalise(step: Union["AgentHandle", WorkflowStep]) -> WorkflowStep:
    from .handle import AgentHandle as _AgentHandle
    if isinstance(step, _AgentHandle):
        return WorkflowStep(agent=step)
    return step


# ── Workflow ──────────────────────────────────────────────────────────────────

class Workflow:
    """
    A deterministic, code-first pipeline of agent invocations.

    Steps are executed in order. Each step can be guarded by a ``when``
    predicate and/or use a ``transform`` function to remap the previous
    output before it is passed as input to the next agent.

    Example::

        result = await workflow([
            agent_a,
            WorkflowStep(agent=agent_b, when=lambda r: "urgent" in (r.text or "")),
            WorkflowStep(agent=agent_c, transform=lambda r: f"Summarise: {r.text}"),
        ]).run("Start")

        print(result.output.text)
        print(len(result.steps))    # skipped steps are excluded
        print(result.stopped_early)
    """

    def __init__(self, steps: List[Union["AgentHandle", WorkflowStep]]) -> None:
        if not steps:
            raise ValueError("[AgentSDK] Workflow must have at least one step.")
        self._steps: List[WorkflowStep] = [_normalise(s) for s in steps]

    async def run(self, input: Union[str, List[Part]]) -> WorkflowResult:
        """
        Execute the workflow from the given initial input.

        Parameters
        ----------
        input:
            Initial text string or list of Parts fed to the first step.
        """
        executed: List[MessageResponse] = []
        current: Union[str, List[Part]] = input
        stopped_early = False

        for i, step in enumerate(self._steps):
            is_first = i == 0

            # when() only applies once there is a previous response
            if not is_first and "when" in step:
                prev = executed[-1]
                if not step["when"](prev):
                    continue  # skip; current is unchanged

            # Resolve this step's input
            if not is_first and "transform" in step:
                step_input: Union[str, List[Part]] = step["transform"](executed[-1])
            else:
                step_input = current

            response = await step["agent"].run(step_input)
            executed.append(response)
            current = response.text or ""

            if response.status == "failed":
                stopped_early = True
                break

        return WorkflowResult(
            output=executed[-1],
            steps=executed,
            stopped_early=stopped_early,
        )


# ── Factory ───────────────────────────────────────────────────────────────────

def workflow(steps: List[Union["AgentHandle", WorkflowStep]]) -> Workflow:
    """
    Create a :class:`Workflow` from an ordered list of steps.

    Each element can be either a bare ``AgentHandle`` (always runs, passes
    ``prev.text`` to the next step) or a :class:`WorkflowStep` dict with
    optional ``when`` and ``transform`` keys.

    Example::

        w = workflow([agent_a, agent_b, agent_c])
        result = await w.run("initial prompt")
        print(result.output.text)
    """
    return Workflow(steps)
