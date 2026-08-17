# Handoff: Declarative StateGraph

## Task

Implement a declarative, JSON-config-driven workflow engine in `packages/js/` that runs the same graph pattern as the existing `StateGraph` but from config instead of code.

**Read the full plan**: `docs/plans/declarative-stategraph.md`

## Summary

Add `@bufbuild/cel` as a runtime dependency. Create `packages/js/src/declarativeGraph.ts` (~200 LOC) and `packages/js/src/__tests__/declarativeGraph.test.ts` (~220 LOC). Update `packages/js/src/index.ts` with exports.

## API

```typescript
function parseWorkflowDefinition(input: string | object): WorkflowDefinition;
async function compileWorkflow(def: WorkflowDefinition, client: CortiClient): Promise<CompiledGraph>;
async function runWorkflow(compiled: CompiledGraph, initialState: Record<string, unknown>, opts?: { maxIterations?: number }): Promise<StateGraphResult>;
async function executeWorkflow(json: string | object, client: CortiClient, initialState: Record<string, unknown>, opts?: { maxIterations?: number }): Promise<StateGraphResult>;
```

## Config shape

```json
{
  "document": { "name": "triage-flow", "version": "1.0.0" },
  "state_schema": { "type": "object", "properties": { "note": {"type":"string"}, "severity": {"type":"string"} }, "required": ["note"] },
  "nodes": [
    { "id": "triage", "type": "agent_call", "config": { "agent": "agent-uuid", "input": "state.note", "output": {"severity": "response.text"} } },
    { "id": "route", "type": "switch", "config": { "cases": [{"when": "state.severity == 'urgent'", "target": "coder"}], "default": "__end__" } },
    { "id": "coder", "type": "agent_call", "config": { "agent": "coder-uuid", "input": "state.note", "output": {"codes": "response.text"} } },
    { "id": "__end__", "type": "end" }
  ],
  "edges": [
    {"source": "__start__", "target": "triage"},
    {"source": "triage", "target": "route"},
    {"source": "coder", "target": "__end__"}
  ],
  "max_iterations": 25
}
```

## Key implementation points

1. **Parser**: Hand-validate (no JSON Schema lib). Check required fields, node types (`agent_call`/`switch`/`end` only), unique IDs, `__start__`/`__end__` exist, edge targets valid.

2. **CEL adapter**: Use `@bufbuild/cel`'s `run(expr, bindings)` API. Pre-compile at load time. Bindings: `{ state, response }` where `response` has `.text`, `.status`, `.artifacts`.

3. **Compiler** (async): Build node map, validate graph structure, pre-compile CEL, **eagerly fetch all agents** via `client.agents.get(id)` and cache `AgentHandle` instances.

4. **Executor**: Same while-loop as `StateGraph.run()` (`packages/js/src/stateGraph.ts:44-81`). `agent_call` → resolve agent, eval `input` CEL, call `agent.run()`, eval `output` CEL map, merge into state. `switch` → eval `when` CEL, route to matching `target`. `end` → stop. Return `{state, steps, iterations, terminated_by}` reusing `StateGraphResult`/`StateGraphStep` from `stateGraph.ts`.

5. **Reuse**: Import `StateGraphResult`, `StateGraphStep` from `./stateGraph.js`, `CortiClient` from `./client.js`, `AgentHandle` from `./handle.js`, `MessageResponse` from `./response.js`.

## Tests (14 cases)

Port from `packages/js/src/__tests__/stateGraph.test.ts` (mock pattern at lines 99-140):
1. Linear graph (agent_call → agent_call → end)
2. Conditional routing (switch with CEL `when`)
3. Route to end when condition false
4. Cycles bounded by maxIterations
5. Stop at maxIterations
6. noEdge when no outgoing edge
7. Throw on unknown node
8. `agent_call` wraps AgentHandle (mock CortiClient)

New:
9. Reject invalid JSON (missing fields, bad node types, duplicate IDs)
10. CEL compilation errors (bad syntax at compile time)
11. Agent-decided routing (`route_from`)
12. `output` mapping (response.text → state.codes)
13. Multiple switch cases with default fallback
14. `executeWorkflow` one-shot (parse + compile + run)

Mock `client.agents.get()` for compile tests: `vi.fn().mockResolvedValue({ id: "agent-1", name: "coder", ... })`.

## Verify

- `cd packages/js && npm run build` — must compile clean
- `cd packages/js && npm test` — all tests pass (existing + new)
- No comments in code unless explicitly requested
- Match existing code style (no semicolons, 2-space indent, double quotes)
