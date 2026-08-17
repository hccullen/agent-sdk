---
prev:
  text: "01 · Hello, agent"
  link: "/examples/01-hello-agent"
next:
  text: "03 · Workflow"
  link: "/examples/03-workflow"
---

# 02 — Connectors

Real agents need tools. The `connectors` helper turns common expert types into the raw `experts` shape the API expects — fully typed. This example builds a two-agent system: a focused symptom-extractor sub-agent wired into an orchestrating triage agent.

<ConceptGrid>
<ConceptCard title="connectors.fromAgent">Delegates to another `AgentHandle` as a callable tool. The orchestrator can invoke it by name.</ConceptCard>
<ConceptCard title="connectors.registry">Attaches a named Corti expert from the registry (e.g. `web-search-expert` or `@corti/medical-coding`).</ConceptCard>
<ConceptCard title="connectors.mcp">Attaches an external MCP server by URL. Supports optional authentication via `authType: "bearer"`.</ConceptCard>
<ConceptCard title="timeoutInSeconds">Raise this beyond the 60 s default for orchestrated agents — sub-agent round-trips add latency.</ConceptCard>
</ConceptGrid>

## Run it

```bash
# Minimum — uses sub-agent connector only
npm run connectors

# With the web-search registry expert
USE_WEB_SEARCH=1 npm run connectors

# With your own MCP server
MCP_URL=https://my-mcp.example.com MCP_TOKEN=sk-... npm run connectors
```

::: info
**No external services needed by default.** The example only requires the `fromAgent` connector (another Corti agent you create yourself). The registry expert and MCP server are opt-in via environment variables.
:::

## Connector types

All connectors are created with the `connectors` helper exported from `@corti/agent-sdk`. Pass the result array to `agents.create({ connectors: [...] })` or `agent.update({ connectors: [...] })`.

| Factory | Underlying type | Required fields | Optional fields |
|---|---|---|---|
| `connectors.fromAgent()` | `cortiAgent` | `agentId` | — |
| `connectors.registry()` | `registryExpert` | `name` | — |
| `connectors.mcp()` | `mcp` | `mcpUrl` | `name`, `authType`, `token` |
| `connectors.a2a()` | `a2a` | — | Reserved for A2A protocol. |

::: info
**Updating connectors** — when you call `agent.update({ connectors: [...] })`, the new array *replaces* the full connector set. There is no merge — if you want to add one connector, pass all existing connectors plus the new one.
:::

## Walkthrough

### 1 · Create the sub-agent

The `symptom-extractor` is a focused, narrow-purpose agent. Its system prompt is written to ensure deterministic output — always a comma-separated list, never a question, never prose.

```typescript
const symptomExtractor = await agents.create({
  name: "symptom-extractor",
  description: "Extracts chief complaint and key symptoms from a clinical note.",
  systemPrompt:
    "You are a symptom extractor. Given a clinical description, respond with " +
    "ONLY a comma-separated list of the patient's chief complaint and key symptoms " +
    "(e.g. `severe headache, photophobia, neck stiffness`). Never ask for clarification.",
});
```

This agent has no connectors — it relies only on its training. The narrower the system prompt, the more predictably it behaves when called as a tool.

### 2 · Wire it as a connector

```typescript
connectors.fromAgent({ agentId: symptomExtractor.id })
```

This produces a `cortiAgent` expert binding. When the orchestrator decides to use this tool, the platform routes the call to `symptomExtractor` and returns its response. The orchestrator never sees the sub-agent's raw API calls — it only sees the reply text.

### 3 · Build the orchestrator

```typescript
const orchestrator = await agents.create({
  name: "triage-orchestrator",
  description: "Triages a clinical note using the symptom extractor.",
  systemPrompt:
    "You are a clinical triage assistant. Pass the full clinical note to the " +
    "`symptom-extractor` connector to get a symptom list, then write a brief " +
    "one-paragraph triage recommendation.",
  connectors: [
    connectors.fromAgent({ agentId: symptomExtractor.id }),
    // Opt-in extras:
    ...(process.env.USE_WEB_SEARCH === "1"
      ? [connectors.registry({ name: "web-search-expert" })]
      : []),
    ...(process.env.MCP_URL
      ? [connectors.mcp({ mcpUrl: process.env.MCP_URL })]
      : []),
  ],
});
```

The system prompt references the connector by its `description` — the orchestrator knows it should delegate symptom extraction. The platform presents available connectors to the orchestrator as tools it can call.

### 4 · Run with a raised timeout

```typescript
const reply = await orchestrator.run(
  "62-year-old presents with sudden severe headache, photophobia, and neck stiffness.",
  { timeoutInSeconds: 180 },
);
```

The default timeout is 60 seconds — sufficient for a single-agent call. Orchestrated calls fan out to sub-agents internally, which can take longer. Passing `timeoutInSeconds: 180` gives the orchestrator enough headroom.

Note that `agent.run()` is a one-shot convenience wrapper. The same options are available on `ctx.sendMessage()` and `ctx.sendText()`.

## Full code

Source: `examples/ts/02-connectors.ts`

```typescript
/**
 * 02 — Connectors.
 *
 * Attach MCP servers, registry experts, and other Corti agents to an agent
 * via the typed `connectors` helpers.
 *
 * By default this example wires a sub-agent (`connectors.fromAgent`) in —
 * always available, no external services. Set `USE_WEB_SEARCH=1` to also
 * attach the registry `web-search-expert`, or `MCP_URL` to attach your own
 * MCP server.
 *
 * Run: `npm run connectors`
 */
import { AgentsClient, connectors } from "@corti/agent-sdk";
import { makeClient } from "./_client";

async function main() {
  const agents = new AgentsClient(makeClient());

  // A small sub-agent we will wire into the main agent as a "cortiAgent" connector.
  const symptomExtractor = await agents.create({
    name: "symptom-extractor",
    description: "Extracts chief complaint and key symptoms from a clinical note.",
    systemPrompt:
      "You are a symptom extractor. Given a clinical description, respond with ONLY a comma-separated list of the patient's chief complaint and key symptoms (e.g. `severe headache, photophobia, neck stiffness`). Never ask for clarification. Never add prose. If the input is sparse, extract whatever symptoms are mentioned.",
  });

  // The orchestrator composes connectors. The sub-agent is the default path;
  // the registry expert and MCP server are opt-in.
  const orchestrator = await agents.create({
    name: "triage-orchestrator",
    description: "Triages a clinical note using the symptom extractor.",
    systemPrompt:
      "You are a clinical triage assistant. Pass the full clinical note to the `symptom-extractor` connector to get a symptom list, then write a brief one-paragraph triage recommendation (urgency, likely differentials, immediate actions). Never ask the user for clarification — work with whatever is provided.",
    connectors: [
      connectors.fromAgent({ agentId: symptomExtractor.id }),
      ...(process.env.USE_WEB_SEARCH === "1"
        ? [connectors.registry({ name: "web-search-expert" })]
        : []),
      ...(process.env.MCP_URL
        ? [
            connectors.mcp({
              mcpUrl: process.env.MCP_URL,
              ...(process.env.MCP_TOKEN ? { token: process.env.MCP_TOKEN } : {}),
            }),
          ]
        : []),
    ],
  });

  // Orchestrated calls fan out to sub-agents / experts, so raise the per-call
  // timeout beyond the SDK's 60s default.
  const reply = await orchestrator.run(
    "62-year-old presents with sudden severe headache, photophobia, and neck stiffness for the past hour.",
    { timeoutInSeconds: 180 },
  );
  console.log("Status:    ", reply.status);
  console.log("Reply:     ", reply.text);
  console.log("Artifacts: ", reply.artifacts.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## What to expect

<OutputBlock>
<span style="color: #f99470">Status:</span>     completed
<span style="color: #f99470">Reply:</span>      This presentation is highly concerning for bacterial meningitis.
             Key symptoms extracted: sudden severe headache, photophobia, neck stiffness.
             Urgency: IMMEDIATE. Differentials include bacterial meningitis, subarachnoid
             haemorrhage, viral meningitis. Immediate actions: IV access, blood cultures,
             LP if no contraindications, empirical antibiotics (ceftriaxone + ampicillin).
<span style="color: #f99470">Artifacts:</span>  0
</OutputBlock>

::: info
**Artifacts** are structured outputs (e.g. JSON data parts) attached to the response. Most text-only agents return 0 artifacts. Coding agents or tool-use agents may return more.
:::

### Next steps

<ExampleLinks>
<a href="/examples/06-credentials">06 · Credentials<span>Pass auth tokens to MCP servers automatically.</span></a>
<a href="/examples/03-workflow">03 · Workflow<span>Chain multiple agents into a deterministic pipeline.</span></a>
<a href="/examples/07-state-graph">07 · State graph<span>Build the sub-agent pattern into a routing graph.</span></a>
</ExampleLinks>
