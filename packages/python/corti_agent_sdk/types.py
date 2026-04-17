from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, TypedDict, Union


# ── Lifecycle ────────────────────────────────────────────────────────────────

Lifecycle = Literal["ephemeral", "persistent"]


# ── Connector definitions ────────────────────────────────────────────────────
# Split into a required base + optional extension so all required keys stay typed.


class _McpBase(TypedDict):
    type: Literal["mcp"]
    mcp_url: str


class McpConnector(_McpBase, total=False):
    name: str
    transport: Literal["sse", "streamable_http"]
    token: str


class _RegistryBase(TypedDict):
    type: Literal["registry"]
    name: str


class RegistryConnector(_RegistryBase, total=False):
    system_prompt: str


class CortiAgentConnector(TypedDict):
    type: Literal["cortiAgent"]
    agent_id: str


class A2aConnector(TypedDict):
    type: Literal["a2a"]
    a2a_url: str


ConnectorDef = Union[McpConnector, RegistryConnector, CortiAgentConnector, A2aConnector]


# ── Agent creation / update ──────────────────────────────────────────────────

class _CreateRequired(TypedDict):
    name: str
    description: str


class CreateAgentOptions(_CreateRequired, total=False):
    system_prompt: str
    lifecycle: Lifecycle
    connectors: List[ConnectorDef]


class UpdateAgentOptions(TypedDict, total=False):
    name: str
    description: str
    system_prompt: str
    connectors: List[ConnectorDef]


# ── Message parts ────────────────────────────────────────────────────────────

class TextPart(TypedDict):
    kind: Literal["text"]
    text: str


Part = Union[TextPart, Dict[str, Any]]

# ── Response types ───────────────────────────────────────────────────────────

StreamEvent = Dict[str, Any]
