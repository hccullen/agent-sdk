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
    transport: Literal["sse", "streamable_http", "stdio"]
    auth_type: Literal["none", "bearer", "inherit", "oauth2.0"]
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


class TokenCredential(TypedDict):
    """Bearer-token credential for one MCP server (auth type "bearer")."""
    type: Literal["token"]
    token: str


class OAuth2Credential(TypedDict):
    """OAuth 2.0 client-credentials for one MCP server (auth type "oauth2.0")."""
    type: Literal["credentials"]
    client_id: str
    client_secret: str


Credential = Union[TokenCredential, OAuth2Credential]

CredentialStore = Dict[str, Credential]
"""Map of MCP server name → credential.
Pass to ``create_context()`` or ``run()`` to authenticate MCP tool calls.
Credentials are forwarded as DataParts on the first message of each context.
"""


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


# ── A2A v1 part types ────────────────────────────────────────────────────────

class TextPart(TypedDict):
    kind: Literal["text"]
    text: str


class _FilePartBase(TypedDict):
    kind: Literal["file"]


class FilePart(_FilePartBase, total=False):
    file: Dict[str, Any]   # FileWithUri | FileWithBytes
    metadata: Dict[str, Any]


class _DataPartBase(TypedDict):
    kind: Literal["data"]
    data: Dict[str, Any]


class DataPart(_DataPartBase, total=False):
    metadata: Dict[str, Any]


Part = Union[TextPart, FilePart, DataPart]


# ── A2A v1 task / message / artifact types ────────────────────────────────────

TaskState = Literal[
    "submitted", "working", "input-required", "completed",
    "canceled", "failed", "rejected", "auth-required", "unknown",
]


class _MessageBase(TypedDict):
    kind: Literal["message"]
    messageId: str
    role: Literal["user", "agent"]
    parts: List[Part]


class Message(_MessageBase, total=False):
    contextId: str
    taskId: str
    referenceTaskIds: List[str]
    extensions: List[str]
    metadata: Dict[str, Any]


class _TaskStatusBase(TypedDict):
    state: TaskState


class TaskStatus(_TaskStatusBase, total=False):
    message: Message
    timestamp: str


class _ArtifactBase(TypedDict):
    artifactId: str
    parts: List[Part]


class Artifact(_ArtifactBase, total=False):
    name: str
    description: str
    metadata: Dict[str, Any]
    extensions: List[str]


class _TaskBase(TypedDict):
    id: str
    contextId: str
    status: TaskStatus


class Task(_TaskBase, total=False):
    kind: Literal["task"]
    history: List[Message]
    artifacts: List[Artifact]
    metadata: Dict[str, Any]


# ── Streaming ─────────────────────────────────────────────────────────────────

StreamEvent = Dict[str, Any]
