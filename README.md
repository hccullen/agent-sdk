# agent-sdk

Developer-friendly wrappers around the Corti SDK for building multi-agent
systems. TypeScript is the reference implementation; a Python port lives
alongside it.

## Packages

| Path                  | Package               | Language   |
| --------------------- | --------------------- | ---------- |
| `packages/js/`        | `@corti/agent-sdk`    | TypeScript |
| `packages/python/`    | `corti-agent-sdk`     | Python     |

## Quick links

- **[Documentation site](./docs/index.html)** — concepts + API reference.
  Serve locally with `python3 -m http.server -d docs 8000`.
- **[TypeScript examples](./examples/ts/)** — seven runnable demos covering
  agents, connectors, linear pipelines, parallel fan-out, streaming, MCP
  credentials, and the full agent mesh.

## 30-second taste

```ts
import { CortiClient } from "@corti/sdk";
import {
  AgentsClient,
  END,
  agentNode,
  parallel,
  stateGraph,
} from "@corti/agent-sdk";

const agents = new AgentsClient(new CortiClient({ /* ... */ }));

const [researcher, drafter, reviewer] = await Promise.all([
  agents.create({ name: "r", description: "Research.",    systemPrompt: "…" }),
  agents.create({ name: "d", description: "Draft.",       systemPrompt: "…" }),
  agents.create({ name: "v", description: "Review.",      systemPrompt: "…" }),
]);

interface S { topic: string; draft: string; approved: boolean }

const graph = stateGraph<S>()
  .addNode("research", agentNode(researcher, s => s.topic, (r, s) => ({ ...s })))
  .addNode("draft",    agentNode(drafter,    s => s.topic, (r, s) => ({ ...s, draft: r.text ?? "" }), { retries: 2 }))
  .addNode("review",   agentNode(reviewer,   s => s.draft, (r, s) => ({ ...s, approved: (r.text ?? "").startsWith("approved") })))
  .addEdge("research", "draft")
  .addEdge("draft",    "review")
  .addEdge("review",   s => s.approved ? END : "draft");

const { state } = await graph.run("research", { topic: "afib management", draft: "", approved: false });
console.log(state.draft);
```

One primitive: `stateGraph()`. Need fan-out? Drop a `parallel([...])` into an
`agentNode()`. Need retries? `agentNode(..., { retries })`. Need a linear
chain? A graph with one edge per node.

## Local development

```bash
npm install              # installs the workspace (packages/js + examples/ts)
npm run build            # builds @corti/agent-sdk

cd examples/ts
cp .env.example .env     # fill in your Corti credentials
npm run hello            # run any example
```

## License

MIT — see [LICENSE](./LICENSE).
