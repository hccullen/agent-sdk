# Agent SDK — Development Guidelines

## SDK Parity Requirement

The Python SDK (`packages/python/`) and the TypeScript SDK (`packages/js/`) must
remain **feature-identical**. Every capability in one must exist in the other.

### Enforced parity checklist

When adding or changing a feature in either SDK, apply the same change to the
other before the work is considered complete:

| Feature area | TypeScript location | Python location |
|---|---|---|
| Agent CRUD | `AgentsClient.ts` | `agents.py` |
| Conversation context | `AgentContext.ts` | `context.py` |
| Agent handle | `AgentHandle.ts` | `handle.py` |
| Response wrapper | `MessageResponse.ts` | `response.py` |
| Connector factories | `connectors.ts` | `connectors.py` |
| Types / interfaces | `types.ts` | `types.py` |
| Workflow pipeline | `workflow.ts` | `workflow.py` |
| State graph | `stateGraph.ts` | `state_graph.py` |
| HTTP / RPC transport | `rpcTransport.ts` | `client.py` |
| Package exports | `index.ts` | `__init__.py` |

### Naming conventions

Python uses **snake_case** equivalents of TypeScript **camelCase** identifiers:

| TypeScript | Python |
|---|---|
| `createContext()` | `create_context()` |
| `getContext()` | `get_context()` |
| `sendMessage()` | `send_message()` |
| `sendText()` | `send_text()` |
| `streamMessage()` | `stream_message()` |
| `systemPrompt` | `system_prompt` |
| `timeoutInSeconds` | `timeout_in_seconds` |
| `retryDelay` | `retry_delay` |
| `stoppedEarly` | `stopped_early` |
| `terminatedBy` | `terminated_by` |
| `agentNode()` | `agent_node()` |
| `stateGraph()` | `stateGraph()` *(factory kept camelCase to match TS)* |
| `fromAgent()` | `from_agent()` |
| `authType` | `auth_type` |
| `mcpUrl` | `mcp_url` |
| `systemPrompt` | `system_prompt` |
| `clientId` / `clientSecret` | `client_id` / `client_secret` |

### Wire format

The underlying A2A JSON-RPC wire format is shared — both SDKs send and receive
identical JSON. Python snake_case type fields are mapped to camelCase when
serialising to the API (e.g. `system_prompt` → `systemPrompt`).

### StreamEvent shape

Both SDKs normalise raw A2A flat events into a wrapped shape before yielding
them to the caller:

```
{kind: "status-update", ...}  →  {statusUpdate: {...}}
{kind: "artifact-update", ...} →  {artifactUpdate: {...}}
{kind: "message", ...}         →  {message: {...}}
{kind: "task", ...}            →  {task: {...}}
```

### StateGraph

Both SDKs expose `StateGraph` / `stateGraph()` / `agent_node()` / `END` for
building stateful routing graphs. Python uses `terminated_by` (snake_case) while
TypeScript uses `terminatedBy`.

### Timeout support

All RPC-level operations accept an optional per-call timeout:

- TypeScript: `opts?.timeoutInSeconds`
- Python: keyword-only `timeout_in_seconds=`

This flows through `AgentHandle.run()` → `AgentContext.send_message()` /
`send_text()` → `CortiClient.rpc_call()`.

### MCP `auth_type` / `authType`

`connectors.mcp()` accepts `auth_type` (Python) / `authType` (TypeScript) with
values `"none" | "bearer" | "inherit" | "oauth2.0"`. Default is `"none"` when
neither `auth_type` nor `token` is provided.

## Development workflow

1. Make changes in the TypeScript SDK.
2. Port the identical change to the Python SDK (or vice-versa).
3. Update `docs/08-python.html` if the public API surface changes.
4. Run `cd packages/js && npm run build` and `cd packages/python && python -c "import corti_agent_sdk"` to verify both compile.
