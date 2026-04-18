from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .types import A2aConnector, ConnectorDef, CortiAgentConnector, McpConnector, RegistryConnector


# ── Public connector factories ───────────────────────────────────────────────

class connectors:
    """
    Factory helpers for building connector definitions.

    Usage::

        connectors.from_agent(agent_id="abc-123")
        connectors.mcp(mcp_url="https://mcp.corti.ai")
        connectors.registry(name="@corti/medical-coding")
    """

    @staticmethod
    def from_agent(agent_id: str) -> CortiAgentConnector:
        """Reference another Corti agent as a sub-agent connector."""
        return {"type": "cortiAgent", "agent_id": agent_id}

    @staticmethod
    def mcp(
        mcp_url: str,
        *,
        name: Optional[str] = None,
        transport: Optional[str] = None,
        token: Optional[str] = None,
    ) -> McpConnector:
        """Attach an MCP server directly to the agent."""
        c: McpConnector = {"type": "mcp", "mcp_url": mcp_url}
        if name is not None:
            c["name"] = name
        if transport is not None:
            c["transport"] = transport  # type: ignore[typeddict-item]
        if token is not None:
            c["token"] = token
        return c

    @staticmethod
    def registry(name: str, *, system_prompt: Optional[str] = None) -> RegistryConnector:
        """Reference a named expert from the Corti registry."""
        c: RegistryConnector = {"type": "registry", "name": name}
        if system_prompt is not None:
            c["system_prompt"] = system_prompt
        return c

    @staticmethod
    def a2a(a2a_url: str) -> A2aConnector:
        """A2A connector (reserved – not yet supported)."""
        return {"type": "a2a", "a2a_url": a2a_url}


# ── Internal: ConnectorDef[] → experts[] (REST API shape) ───────────────────

def _mcp_url_to_name(url: str) -> str:
    m = re.match(r"^https?://([^/?#]+)", url)
    hostname = m.group(1) if m else ""
    return re.sub(r"[^a-z0-9-]", "", hostname.replace(".", "-"))[:48] or "mcp-server"


def connectors_to_experts(defs: List[ConnectorDef]) -> List[Dict[str, Any]]:
    """Translate wrapper ConnectorDef list → REST API experts array."""
    experts: List[Dict[str, Any]] = []

    for conn in defs:
        t = conn["type"]

        if t == "mcp":
            mcp = conn  # type: ignore[assignment]
            name = mcp.get("name") or _mcp_url_to_name(mcp["mcp_url"])
            server: Dict[str, Any] = {
                "name": name,
                "transportType": mcp.get("transport", "sse"),
                "authorizationType": "bearer" if mcp.get("token") else "inherit",
                "url": mcp["mcp_url"],
            }
            if mcp.get("token"):
                server["token"] = mcp["token"]
            experts.append(
                {
                    "type": "new",
                    "name": name,
                    "description": f"MCP server at {mcp['mcp_url']}",
                    "mcpServers": [server],
                }
            )

        elif t == "registry":
            reg = conn  # type: ignore[assignment]
            expert: Dict[str, Any] = {"type": "reference", "name": reg["name"]}
            if reg.get("system_prompt"):
                expert["systemPrompt"] = reg["system_prompt"]
            experts.append(expert)

        elif t == "cortiAgent":
            ca = conn  # type: ignore[assignment]
            experts.append({"type": "reference", "id": ca["agent_id"]})

        elif t == "a2a":
            a2a = conn  # type: ignore[assignment]
            raise ValueError(
                f"[AgentSDK] A2A connectors are not yet supported (url: {a2a['a2a_url']}). "
                'Use type "mcp" with an MCP-compatible endpoint instead.'
            )

        else:
            raise ValueError(f"[AgentSDK] Unknown connector type: {t!r}")

    return experts
