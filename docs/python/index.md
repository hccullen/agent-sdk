---
title: "Python SDK — corti-agent-sdk"
description: "corti-agent-sdk for Python — install, quick start, and API reference."
---

# Python SDK

`corti-agent-sdk` is the Python sibling of the TypeScript SDK. It exposes an identical API surface — same primitives, same behaviour — adapted to Python idioms: `async with`, snake_case, dataclasses.

<ConceptGrid>
<ConceptCard title="Feature-identical">Every TypeScript primitive has a Python equivalent: `Workflow`, `Parallel`, `StateGraph`, streaming, credentials.</ConceptCard>
<ConceptCard title="Async-native">Built on `httpx.AsyncClient`. Use `async with CortiClient(...) as client:` for automatic cleanup.</ConceptCard>
<ConceptCard title="Snake_case">`send_text()`, `create_context()`, `system_prompt`, `timeout_in_seconds` — all Pythonic.</ConceptCard>
<ConceptCard title="Type-safe">Full `TypedDict` and `dataclass` annotations throughout. Works well with mypy and Pyright.</ConceptCard>
</ConceptGrid>

## Install

```bash
pip install corti-agent-sdk
```

Requires Python 3.9+. The only runtime dependency is `httpx`.

## Quick start

```python
import asyncio
from corti_agent_sdk import CortiClient, AgentsClient, connectors

async def main():
    async with CortiClient(
        tenant_name="my-tenant",
        environment="eu",          # or "us"
        auth={"client_id": "...", "client_secret": "..."},
    ) as client:
        agents = AgentsClient(client)

        agent = await agents.create(
            name="coder",
            description="Returns ICD-10 codes for clinical terms.",
            system_prompt="Respond with only the ICD-10 code.",
            connectors=[connectors.registry(name="coding-expert")],
        )

        ctx = agent.create_context()
        reply = await ctx.send_text("Hypertension?")
        print(reply.text)    # "I10"
        print(reply.status)  # "completed"

asyncio.run(main())
```

## API reference

### CortiClient

| Parameter | Type | Description |
|---|---|---|
| `tenant_name` | `str` | Your Corti tenant slug. |
| `environment` | `"eu" \| "us" \| dict` | Predefined region or `{"agents": "...", "login": "..."}`. |
| `auth` | `dict` | `{"client_id": "...", "client_secret": "..."}` |

### AgentsClient

| Method | Returns | Description |
|---|---|---|
| `await create(...)` | `AgentHandle` | Create a new agent. |
| `await get(agent_id)` | `AgentHandle` | Fetch an existing agent by ID. |
| `await list()` | `list[AgentHandle]` | List all agents in the tenant. |
| `wrap(raw)` | `AgentHandle` | Wrap a raw API dict. |

### AgentHandle

| Member | Description |
|---|---|
| `.id`, `.name`, `.description`, `.system_prompt`, `.raw` | Properties. |
| `create_context(*, credentials?)` | Open a new conversation thread (lazy — no network call until first message). |
| `get_context(context_id, *, credentials?)` | Resume an existing thread by ID. |
| `await run(input, *, credentials?, timeout_in_seconds?)` | One-shot invoke and return response. |
| `await update(*, name?, description?, system_prompt?, connectors?)` | Partially update the agent. |
| `await refresh()` | Re-fetch agent state from API. |
| `await delete()` | Delete the agent. |

### AgentContext

| Member | Description |
|---|---|
| `.id` | Thread ID — `None` until first message is sent. |
| `await send_message(parts, *, timeout_in_seconds?)` | Send message parts, receive `MessageResponse`. |
| `await send_text(text, *, timeout_in_seconds?)` | Send plain text, receive `MessageResponse`. |
| `async for event in stream_message(parts)` | Stream events as an async generator. |

### MessageResponse

| Property | Description |
|---|---|
| `.text` | Joined text parts from the agent's reply. `None` if no text. |
| `.status` | Terminal state: `"completed"`, `"failed"`, `"auth-required"`, etc. |
| `.context_id` | Thread ID. |
| `.task_id` | Task ID. |
| `.artifacts` | Deduplicated structured outputs. |
| `.raw` | Full unmodified API response dict. |

### Composition primitives

| Import | Description |
|---|---|
| `workflow(steps)` | Linear pipeline. See [03 · Workflow](/python/03-workflow). |
| `parallel(steps)` | Concurrent fan-out. See [04 · Parallel](/python/04-parallel). |
| `stateGraph()` | Stateful routing graph. See [07 · State graph](/python/07-state-graph). |
| `agent_node(agent, get_input, merge)` | Wrap an `AgentHandle` as a graph node function. |
| `END` | Sentinel to terminate a `StateGraph`. |

### connectors

| Factory | Description |
|---|---|
| `connectors.from_agent(agent_id)` | Reference another Corti agent as a sub-agent. |
| `connectors.mcp(mcp_url, *, name?, transport?, auth_type?, token?)` | Attach an MCP server. |
| `connectors.registry(name, *, system_prompt?)` | Reference a named expert from the registry. |
| `connectors.a2a(a2a_url)` | A2A protocol (reserved, not yet supported). |

## vs TypeScript

| TypeScript | Python |
|---|---|
| `new CortiClient({...})` | `async with CortiClient(...) as client:` |
| `sendText()` | `await send_text()` |
| `createContext()` | `create_context()` |
| `getContext(id)` | `get_context(id)` |
| `systemPrompt` | `system_prompt` |
| `timeoutInSeconds` | `timeout_in_seconds=` (keyword-only) |
| `authType: "bearer"` | `auth_type="bearer"` |
| `terminatedBy` | `terminated_by` |
| `stoppedEarly` | `stopped_early` |
| `agentNode()` | `agent_node()` |
| `WorkflowResult.steps` | `WorkflowResult.steps` |
| `OAuth2Credential.clientId` | `OAuth2Credential["client_id"]` |

The wire format (A2A JSON-RPC) is identical — both SDKs talk to the same API.

## Examples

<ExampleLinks>
<a href="/python/01-hello-agent">01 · Hello, agent<span>Create an agent, open a context, send messages.</span></a>
<a href="/python/02-connectors">02 · Connectors<span>Sub-agents, registry experts, MCP servers.</span></a>
<a href="/python/03-workflow">03 · Workflow<span>Linear pipelines with when/transform/retries.</span></a>
<a href="/python/04-parallel">04 · Parallel fan-out<span>Concurrent agent execution.</span></a>
<a href="/python/05-streaming">05 · Streaming<span>Async iteration over SSE events.</span></a>
<a href="/python/06-credentials">06 · Credentials<span>MCP bearer-token forwarding.</span></a>
<a href="/python/07-state-graph">07 · State graph<span>Typed state, routing functions, reviewer loops.</span></a>
</ExampleLinks>
