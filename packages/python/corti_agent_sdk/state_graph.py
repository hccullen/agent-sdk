from __future__ import annotations

from dataclasses import dataclass, field
from typing import (
    TYPE_CHECKING,
    Any,
    Callable,
    Dict,
    Generic,
    List,
    Optional,
    TypeVar,
    Union,
)

from .response import MessageResponse
from .types import Part

if TYPE_CHECKING:
    from .handle import AgentHandle

# ── END sentinel ──────────────────────────────────────────────────────────────

class _EndType:
    """Sentinel value. Pass as an edge target to terminate the graph."""
    _instance: Optional["_EndType"] = None

    def __new__(cls) -> "_EndType":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "END"


END = _EndType()
"""Pass as an edge target to terminate graph execution."""

# ── Types ─────────────────────────────────────────────────────────────────────

S = TypeVar("S", bound=Dict[str, Any])

NodeFn = Callable[[S], Any]  # async (state: S) -> Partial[S]

EdgeRouter = Union[str, _EndType, Callable[[S], Union[str, _EndType]]]


@dataclass
class StateGraphStep(Generic[S]):
    """One recorded execution step."""

    node: str
    """Name of the node that ran."""

    delta: Dict[str, Any]
    """Partial update returned by the node."""

    state: S  # type: ignore[type-arg]
    """Full state after applying the delta."""


@dataclass
class StateGraphResult(Generic[S]):
    """Returned by :meth:`StateGraph.run`."""

    state: S  # type: ignore[type-arg]
    """Final accumulated state."""

    steps: List[StateGraphStep]  # type: ignore[type-arg]
    """Ordered history of every node execution."""

    iterations: int
    """Total number of node executions."""

    terminated_by: str
    """Why execution stopped: ``"end"``, ``"maxIterations"``, or ``"noEdge"``."""


# ── StateGraph ────────────────────────────────────────────────────────────────

class StateGraph(Generic[S]):
    """
    A stateful routing graph for multi-agent workflows.

    Unlike the linear :class:`Workflow`, a :class:`StateGraph` maintains a
    typed shared state dict that accumulates across node executions. Edges can
    be static node names or routing functions that inspect the state to decide
    what runs next — including cycles, bounded by ``max_iterations``
    (default 25).

    Example::

        from dataclasses import dataclass
        from corti_agent_sdk import stateGraph, agentNode, END

        graph = (
            stateGraph()
            .add_node("triage",   agent_node(triage_agent,   lambda s: s["note"],   lambda r, s: {"severity": r.text or ""}))
            .add_node("coder",    agent_node(coder_agent,    lambda s: s["note"],   lambda r, s: {"codes": r.text or ""}))
            .add_node("reviewer", agent_node(reviewer_agent, lambda s: s["codes"],  lambda r, s: {"approved": "approved" in (r.text or "")}))
            .add_edge("triage",   lambda s: "coder" if "urgent" in s["severity"] else END)
            .add_edge("coder",    "reviewer")
            .add_edge("reviewer", lambda s: END if s["approved"] else "coder")
        )

        result = await graph.run("triage", {"note": "Chest pain...", "severity": "", "codes": "", "approved": False})
        print(result.state["codes"])
        print(result.terminated_by)   # "end"
    """

    def __init__(self) -> None:
        self._nodes: Dict[str, NodeFn] = {}  # type: ignore[type-arg]
        self._edges: Dict[str, EdgeRouter] = {}  # type: ignore[type-arg]

    def add_node(self, name: str, fn: NodeFn) -> "StateGraph[S]":  # type: ignore[type-arg]
        """
        Register a named node.

        Parameters
        ----------
        name:
            Unique node identifier.
        fn:
            Async function that receives state and returns a partial update dict.
        """
        self._nodes[name] = fn
        return self

    def add_edge(self, from_node: str, to: EdgeRouter) -> "StateGraph[S]":  # type: ignore[type-arg]
        """
        Define routing from a node.

        Parameters
        ----------
        from_node:
            Source node name.
        to:
            A static node name, :data:`END`, or a callable
            ``(state) -> str | END`` that returns the next node.
        """
        self._edges[from_node] = to
        return self

    async def run(
        self,
        entry_node: str,
        initial_state: Dict[str, Any],
        *,
        max_iterations: int = 25,
    ) -> StateGraphResult:  # type: ignore[type-arg]
        """
        Execute the graph starting from ``entry_node``.

        Parameters
        ----------
        entry_node:
            Name of the first node to run.
        initial_state:
            Starting state passed to the first node.
        max_iterations:
            Safety limit on total node executions (default 25).
        """
        steps: List[StateGraphStep] = []  # type: ignore[type-arg]
        state: Dict[str, Any] = dict(initial_state)
        current: Union[str, _EndType] = entry_node
        iterations = 0
        terminated_by = "end"

        while current is not END:
            if iterations >= max_iterations:
                terminated_by = "maxIterations"
                break

            node_name = current
            fn = self._nodes.get(node_name)
            if fn is None:
                raise ValueError(f"[StateGraph] Unknown node: {node_name!r}.")

            delta = await fn(state)
            if delta is None:
                delta = {}
            state = {**state, **delta}
            steps.append(StateGraphStep(node=node_name, delta=dict(delta), state=dict(state)))
            iterations += 1

            router = self._edges.get(node_name)
            if router is None:
                terminated_by = "noEdge"
                break

            current = router(state) if callable(router) else router

        return StateGraphResult(
            state=state,  # type: ignore[arg-type]
            steps=steps,
            iterations=iterations,
            terminated_by=terminated_by,
        )


def stateGraph() -> StateGraph:  # type: ignore[type-arg]
    """Create a new :class:`StateGraph`."""
    return StateGraph()


# ── agentNode helper ──────────────────────────────────────────────────────────

def agent_node(
    agent: "AgentHandle",
    get_input: Callable[[Dict[str, Any]], Union[str, List[Part]]],
    merge_response: Callable[[MessageResponse, Dict[str, Any]], Dict[str, Any]],
) -> NodeFn:  # type: ignore[type-arg]
    """
    Wrap an :class:`AgentHandle` as a :data:`NodeFn`.

    Parameters
    ----------
    agent:
        The agent to invoke.
    get_input:
        Extract the agent's input from the current state.
    merge_response:
        Merge the agent's response back into state as a partial update dict.

    Example::

        agent_node(
            my_agent,
            lambda s: s["note"],
            lambda r, s: {"summary": r.text or ""},
        )
    """
    async def _node(state: Dict[str, Any]) -> Dict[str, Any]:
        response = await agent.run(get_input(state))
        return merge_response(response, state)

    return _node
