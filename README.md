# agent-sdk

Developer-friendly wrappers around the Corti SDK for building multi-agent
systems. TypeScript and Python are kept in lockstep and share the same API
shape.

## Packages

| Path                  | Package               | Language   |
| --------------------- | --------------------- | ---------- |
| `packages/js/`        | `@corti/agent-sdk`    | TypeScript |
| `packages/python/`    | `corti-agent-sdk`     | Python     |

## Quick links

- **[Documentation site](./docs/index.html)** — concepts + API reference.
  Serve locally with `python3 -m http.server -d docs 8000`.
- **[TypeScript examples](./examples/ts/)** — six runnable demos covering
  agents, connectors, workflows, parallel fan-out, streaming, and MCP
  credentials.

## 30-second taste

```ts
import { CortiClient } from "@corti/sdk";
import { AgentsClient, connectors, workflow, parallel } from "@corti/agent-sdk";

const agents = new AgentsClient(new CortiClient({ /* ... */ }));

const [summarizer, classifier, escalator] = await Promise.all([
  agents.create({ name: "sum", description: "Summarise.",       systemPrompt: "…" }),
  agents.create({ name: "cls", description: "Urgent/routine.",  systemPrompt: "…" }),
  agents.create({ name: "esc", description: "Draft escalation.", systemPrompt: "…" }),
]);

const { output } = await workflow([
  summarizer,
  classifier,
  { agent: escalator, when: (r) => r.text?.includes("urgent") ?? false, retries: 2 },
]).run(note);

console.log(output.text);
```

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
