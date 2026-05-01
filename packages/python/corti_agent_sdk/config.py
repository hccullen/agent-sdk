from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Literal, Optional, TYPE_CHECKING, Union

from .response import MessageResponse
from .workflow import Parallel, Workflow, WorkflowStep

if TYPE_CHECKING:
    from .agents import AgentsClient
    from .handle import AgentHandle


# ── Agent config ──────────────────────────────────────────────────────────────

# Uses camelCase keys to match the JSON DSL (same format as the TS side).
# from_config translates to snake_case when calling AgentsClient.create().

class AgentConfig:
    """Type alias — at runtime this is just a plain dict with the keys below.

    Required: ``name``, ``description``
    Optional: ``systemPrompt``, ``lifecycle``, ``connectors``
    """


# ── When predicate ────────────────────────────────────────────────────────────

# Mirrors the TS WhenPredicate union:
#   { "text": { "includes": "…" } }
#   { "text": { "notIncludes": "…" } }
#   { "status": "<TaskState>" }

WhenPredicate = Dict[str, Any]

# ── Step configs ──────────────────────────────────────────────────────────────

# A parallel group item — either a bare agent name or {"agent": "…", "input": "…"}
ParallelItemConfig = Union[str, Dict[str, Any]]

# A workflow step — one of:
#   "agent-name"                          (bare string)
#   {"agent": "…", "retries": …, …}      (full step)
#   {"parallel": […]}                     (parallel group)
WorkflowStepConfig = Union[str, Dict[str, Any]]

# ── Top-level config ──────────────────────────────────────────────────────────

class WorkflowConfig:
    """Type alias — at runtime a plain dict with ``agents`` and ``workflow`` keys.

    Example (also valid when loaded from JSON)::

        config = {
            "agents": [
                {"name": "summarizer", "description": "Summarises text"},
                {"name": "classifier", "description": "Classifies the summary"},
            ],
            "workflow": [
                "summarizer",
                {
                    "agent": "classifier",
                    "when": {"text": {"includes": "urgent"}},
                    "retries": 1,
                },
            ],
        }
    """


# ── Internal helpers ──────────────────────────────────────────────────────────

def _eval_when(pred: WhenPredicate, resp: MessageResponse) -> bool:
    if "text" in pred:
        txt = resp.text or ""
        text_pred: Dict[str, str] = pred["text"]
        if "includes" in text_pred:
            return text_pred["includes"] in txt
        return text_pred["notIncludes"] not in txt
    return resp.status == pred.get("status")


def _translate_connector(c: Dict[str, Any]) -> Dict[str, Any]:
    """Translate camelCase JSON connector keys to the Python snake_case ConnectorDef."""
    t = c["type"]
    if t == "mcp":
        result: Dict[str, Any] = {"type": "mcp", "mcp_url": c["mcpUrl"]}
        if "name" in c:
            result["name"] = c["name"]
        if "transport" in c:
            result["transport"] = c["transport"]
        if "authType" in c:
            result["auth_type"] = c["authType"]
        if "token" in c:
            result["token"] = c["token"]
        return result
    if t == "registry":
        result = {"type": "registry", "name": c["name"]}
        if "systemPrompt" in c:
            result["system_prompt"] = c["systemPrompt"]
        return result
    if t == "cortiAgent":
        return {"type": "cortiAgent", "agent_id": c["agentId"]}
    if t == "a2a":
        return {"type": "a2a", "a2a_url": c["a2aUrl"]}
    raise ValueError(f"[AgentSDK] from_config: unknown connector type {t!r}")


# ── from_config ───────────────────────────────────────────────────────────────

async def from_config(
    config: Dict[str, Any],
    agents_client: "AgentsClient",
) -> Workflow:
    """Build a ready-to-run :class:`Workflow` from a plain JSON config dict.

    All agents are created concurrently, then the workflow topology is
    assembled from the ``workflow`` step list — referencing agents by name.

    This is an additive alternative to the code-first API; both can be used
    in the same project. For steps requiring a custom ``transform`` function,
    use the code-first :func:`workflow` / :class:`WorkflowStep` API instead.

    Example::

        import json
        from corti_agent_sdk import AgentsClient, from_config

        with open("my-workflow.json") as f:
            config = json.load(f)

        wf = await from_config(config, agents_client)
        result = await wf.run("Patient note…")
        print(result.output.text)
    """
    agent_configs: List[Dict[str, Any]] = config["agents"]

    async def _create(ac: Dict[str, Any]) -> "AgentHandle":
        kwargs: Dict[str, Any] = {
            "name": ac["name"],
            "description": ac["description"],
        }
        if "systemPrompt" in ac:
            kwargs["system_prompt"] = ac["systemPrompt"]
        if "lifecycle" in ac:
            kwargs["lifecycle"] = ac["lifecycle"]
        if "connectors" in ac:
            kwargs["connectors"] = [_translate_connector(c) for c in ac["connectors"]]
        return await agents_client.create(**kwargs)

    handles = await asyncio.gather(*[_create(ac) for ac in agent_configs])
    by_name: Dict[str, Any] = {agent_configs[i]["name"]: h for i, h in enumerate(handles)}

    def resolve(name: str) -> "AgentHandle":
        h = by_name.get(name)
        if h is None:
            raise ValueError(f'[AgentSDK] from_config: unknown agent "{name}"')
        return h

    steps: List[Any] = []
    for step in config["workflow"]:
        if isinstance(step, str):
            steps.append(resolve(step))
            continue

        if "parallel" in step:
            parallel_steps: List[Any] = []
            for s in step["parallel"]:
                if isinstance(s, str):
                    parallel_steps.append(resolve(s))
                else:
                    ps: Dict[str, Any] = {"agent": resolve(s["agent"])}
                    if "input" in s:
                        ps["input"] = s["input"]
                    parallel_steps.append(ps)
            steps.append(Parallel(parallel_steps))
            continue

        ws: WorkflowStep = {"agent": resolve(step["agent"])}
        if "retries" in step:
            ws["retries"] = step["retries"]
        if "retryDelay" in step:
            ws["retry_delay"] = step["retryDelay"]
        if "when" in step:
            pred = step["when"]
            ws["when"] = lambda resp, p=pred: _eval_when(p, resp)
        steps.append(ws)

    return Workflow(steps)
