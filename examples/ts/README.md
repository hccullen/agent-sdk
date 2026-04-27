# TypeScript examples

Runnable, self-contained examples for `@newsioaps/agent-sdk`. Each script creates
its own agents, runs the demo, and cleans up on exit.

## Setup

```bash
# 1 — build the SDK so the file: dependency can resolve.
cd packages/js && npm install && npm run build

# 2 — install the examples.
cd ../../examples/ts
npm install

# 3 — configure credentials.
cp .env.example .env
# then edit .env
```

## Run

| Script             | Demonstrates                                     |
| ------------------ | ------------------------------------------------ |
| `npm run hello`    | Creating an agent and holding a conversation     |
| `npm run connectors` | MCP, registry, and sub-agent connectors        |
| `npm run workflow` | Deterministic pipelines with `when` / `transform` |
| `npm run parallel` | Fan-out, both standalone and inside a workflow   |
| `npm run streaming` | Consuming `streamMessage()` events              |
| `npm run credentials` | Forwarding MCP credentials transparently      |

Each example is a standalone `.ts` file — open it and the whole story fits on
one screen. They are intended to be read top-to-bottom as documentation, not
as a framework.
