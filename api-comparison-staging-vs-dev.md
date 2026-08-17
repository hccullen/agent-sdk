# API Comparison: staging-eu vs dev-weu

**Date:** 2026-07-03
**Method:** Automated comparison harness (`examples/ts/compare-envs.ts`) running identical agent operations against both environments and diffing raw JSON responses.

- Raw captures: `/tmp/opencode/staging-eu-raw-2.json`, `/tmp/opencode/dev-weu-raw-2.json`
- 23 HTTP calls per environment, identical call sequence (same methods, same path patterns)

---

## Summary

Both environments produce the same HTTP call sequence and JSON-RPC envelope structure. The differences are in **response body fields** — dev-weu has several schema-level changes relative to staging-eu that likely reflect an upcoming API version.

---

## Differences

### 1. Artifacts echo user input (dev-weu only)

`message/send` and `message/stream` artifact `parts` arrays differ:

- **staging-eu**: 1 part — agent reply only
- **dev-weu**: 2 parts — agent reply + echoed user input

```json
// staging artifact.parts
[{"kind":"text","text":"Hello to you."}]

// dev artifact.parts
[{"kind":"text","text":"Hello to you!"},{"kind":"text","text":"Say hello in exactly three words."}]
```

This affects `MessageResponse.artifacts` deduplication logic and any consumer that iterates artifact parts.

### 2. Metadata schema completely different

- **staging-eu**: `credits` (float) + `opik_distributed_trace_headers` (Opik/CometML tracing)
- **dev-weu**: `_usage` with `{input_tokens, output_tokens}`

```json
// staging
"metadata": {"credits": 0.001944, "opik_distributed_trace_headers": {...}}

// dev
"metadata": {"_usage": {"input_tokens": 482, "output_tokens": 39}}
```

### 3. `status.message` fields differ

- **staging-eu**: has `metadata: {user_facing_msg: true}`, no `taskId`
- **dev-weu**: has `taskId` (string), no `metadata`

### 4. Stream history includes metadata in staging only

In the initial `task` event of `message/stream`:

- **staging-eu**: `history[0]` (user message) includes `"metadata": {"user_facing_msg": true}`
- **dev-weu**: no `metadata` on history messages

### 5. Stream working-status events have Opik metadata in staging only

The second `working` status-update event:

- **staging-eu**: includes `"metadata": {"opik_distributed_trace_headers": {...}}`
- **dev-weu**: no metadata on intermediate working events

### 6. Expert connector returns `maxLoops` in dev-weu

When creating an agent with a `fromAgent` connector:

- **staging-eu**: expert object has no `maxLoops`
- **dev-weu**: expert object includes `"maxLoops": 5`

### 7. Connector (`fromAgent`) fails in staging-eu

The sub-agent connector returned `"state": "rejected"` with "Invalid agent or meter configuration." in staging-eu, but `"completed"` with "Hello!" in dev-weu. This is likely a staging configuration issue rather than an API change.

### 8. Registry expert: dev-weu includes raw search results as `data` parts

When using the `web-search-expert` connector, dev-weu includes the raw search API response as a `data` part in the artifact alongside the text reply. Staging-eu only includes text parts.

```json
// staging artifact.parts (web-search)
[{"kind":"text","text":"The most recent FIFA World Cup was won by Argentina..."}]

// dev artifact.parts (web-search)
[
  {"kind":"text","text":"The most recent FIFA World Cup winner is Argentina..."},
  {"kind":"data","data":{"response":"{\"query\":\"most recent FIFA World Cup winner\",\"results\":[...]}",...}}
]
```

The `data` part contains the full Tavily-style search response JSON (query, results array with URL/title/content/score, response_time, request_id).

### 9. Registry expert: agent creation response is structurally identical

Both environments return the same `experts` array shape with `resolvedConfig` containing search settings (`max_results`, `search_depth`, `exclude_domains`, `include_domains`). No schema differences.

---

## Error handling (all match)

All error responses are **identical** between staging-eu and dev-weu — same error codes, same messages, same nested `cause` structure. Only timestamps differ (normalised).

| Operation | HTTP | Error code | Match |
|-----------|------|------------|-------|
| GET non-existent agent | 404 | `expert_not_found` | Identical |
| DELETE non-existent agent | 404 | `agent_delete_failed` → `expert_delete_failed` → `expert_not_found` | Identical |
| PATCH non-existent agent | 404 | `agent_not_found` → `expert_not_found` | Identical |
| RPC `message/send` to non-existent agent | 200* | JSON-RPC error `-32603` with `INTERNAL_ERROR` | Identical |

*The RPC error returns HTTP 200 with a JSON-RPC error envelope (per JSON-RPC 2.0 spec).

```json
// Both environments return this identical structure:
{
  "jsonrpc": "2.0",
  "id": "error-test",
  "error": {
    "code": -32603,
    "message": "interceptor failed: [interceptor_get_agent_failed]: Failed to get agent: [expert_not_found]: Expert not found (expert_id=00000000-0000-0000-0000-000000000000): [db_no_rows_found]: No rows found: no rows in result set",
    "data": [{
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      "domain": "a2a-protocol.org",
      "metadata": {"timestamp": "..."},
      "reason": "INTERNAL_ERROR"
    }]
  }
}
```

---

## What matches

- HTTP call sequence (23 calls, same order/methods/paths)
- REST agent CRUD response structure
- JSON-RPC envelope structure
- SSE event sequence (5 events: task → working → working → artifact-update → final status-update)
- All status state transitions (submitted → working → completed)
- All error response shapes (GET/DELETE/PATCH/RPC on non-existent agent)
- Registry expert agent creation (`resolvedConfig` with search settings)
- Agent deletion responses (empty body, same HTTP status)
