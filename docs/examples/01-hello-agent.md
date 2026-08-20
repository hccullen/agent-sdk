---
prev: false
next:
  text: "02 · Connectors"
  link: "/examples/02-connectors"
---

# 01 — Hello, agent

The minimum viable example. Create an agent, open a conversation context, send two messages, and read the replies. Everything else in the SDK builds on these three primitives.

<ConceptGrid>
<ConceptCard title="AgentsClient">The entry point for all agent operations — create, fetch, list, wrap.</ConceptCard>
<ConceptCard title="AgentHandle">A typed reference to a registered agent. Holds its ID, name, system prompt, and lets you create contexts or run one-shot invocations.</ConceptCard>
<ConceptCard title="AgentContext">A lazy conversation thread. No network call happens until the first message. Tracks `contextId` automatically.</ConceptCard>
<ConceptCard title="MessageResponse">Wraps the raw API response. Key getters: `text`, `status`, `contextId`.</ConceptCard>
</ConceptGrid>

## Run it

```bash
# From the repo root — build the SDK once
cd packages/js && npm install && npm run build

# Install example deps and configure credentials
cd ../../examples/ts
npm install
cp .env.example .env   # fill in CORTI_TENANT_NAME, CORTI_CLIENT_ID, CORTI_CLIENT_SECRET

# Run
npm run hello
```

::: info
**Ephemeral agents** — this example uses the default `lifecycle: "ephemeral"`. The platform garbage-collects them automatically, so no explicit cleanup call is needed. Pass `lifecycle: "persistent"` if you want the agent to survive the process.
:::

## Walkthrough

### 1 · Build the client

`makeClient()` is a shared helper in `_client.ts` that reads three environment variables and returns a `CortiClient`:

```typescript
import { CortiClient } from "@corti/sdk";

export function makeClient(): CortiClient {
  return new CortiClient({
    tenantName: process.env.CORTI_TENANT_NAME!,
    environment: (process.env.CORTI_ENVIRONMENT ?? "eu") as "eu" | "us",
    auth: {
      clientId:     process.env.CORTI_CLIENT_ID!,
      clientSecret: process.env.CORTI_CLIENT_SECRET!,
    },
  });
}
```

Every example starts with `new AgentsClient(makeClient())` — `AgentsClient` wraps the raw client and exposes the agent-specific operations.

### 2 · Create an agent

```typescript
const agent = await agents.create({
  name: "hello-agent",
  description: "A minimal greeting agent.",
  systemPrompt: "You are a friendly assistant. Keep replies to one sentence.",
});
```

`agents.create()` registers the agent on the Corti platform and returns an `AgentHandle`. The `name` field is a slug and must be unique per tenant. Because no `lifecycle` is specified, it defaults to `"ephemeral"`.

The returned handle gives you `agent.id`, `agent.name`, `agent.systemPrompt`, and methods like `createContext()`, `run()`, `update()`, and `delete()`.

### 3 · Open a context (lazy)

```typescript
const ctx = agent.createContext();
```

`createContext()` is synchronous and makes *no* network call. The context is lazy — it initialises on the first message. At this point `ctx.id` is `undefined`.

### 4 · First message

```typescript
const reply = await ctx.sendText("Say hello and tell me one fun fact.");
console.log("Agent:", reply.text);
console.log("Status:", reply.status);
console.log("Context ID:", ctx.id);
```

`sendText()` is a shorthand for `sendMessage([{ kind: "text", text: "..." }])`. The response carries:

| Getter | Type | Notes |
|---|---|---|
| `reply.text` | `string?` | All text parts joined into one string. |
| `reply.status` | `TaskState?` | `"completed"`, `"failed"`, `"input-required"`, … |
| `reply.contextId` | `string?` | The thread ID — the context stores this automatically. |
| `reply.taskId` | `string?` | This specific invocation's ID. |
| `reply.artifacts` | `Artifact[]` | Structured outputs attached to the response. |
| `reply.raw` | `AgentsMessageSendResponse` | The full unprocessed API response. |

After the first message completes, `ctx.id` is populated with the `contextId` that the context extracted from the response.

### 5 · Second message (same thread)

```typescript
const followUp = await ctx.sendText("Tell me another one.");
console.log("Agent:", followUp.text);
```

The context automatically passes the stored `contextId` back to the API. The agent sees the full prior conversation — it remembers what it said in the previous turn.

You never manage `contextId` manually. The context object handles it entirely.

### One-shot alternative

For single-turn invocations where you don't need conversation history, skip the context:

```typescript
const r = await agent.run("What is the ICD-10 code for asthma?");
console.log(r.text);   // no context created or tracked
```

`agent.run()` internally creates a throwaway context. Use it when you don't need to continue the thread.

## Full code

Source: `examples/ts/01-hello-agent.ts`

```typescript
/**
 * 01 — Hello, agent.
 *
 * The minimum viable example: create an agent, start a conversation,
 * read the reply. Ephemeral agents are GC'd server-side — no explicit
 * cleanup is needed. Pass `lifecycle: "persistent"` if you want the
 * agent to outlive the process.
 *
 * Run: `npm run hello`
 */
import { AgentsClient } from "@newsioaps/agent-sdk";
import { makeClient } from "./_client";

async function main() {
  const agents = new AgentsClient(makeClient());

  const agent = await agents.create({
    name: "hello-agent",
    description: "A minimal greeting agent.",
    systemPrompt: "You are a friendly assistant. Keep replies to one sentence.",
  });

  const ctx = agent.createContext();

  const reply = await ctx.sendText("Say hello and tell me one fun fact.");
  console.log("Agent:", reply.text);
  console.log("Status:", reply.status);
  console.log("Context ID:", ctx.id);

  // The context persists across calls — the agent remembers the thread.
  const followUp = await ctx.sendText("Tell me another one.");
  console.log("Agent:", followUp.text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## What to expect

Actual text varies by model, but the structure is consistent:

<OutputBlock>
<span style="color: #f99470">Agent:</span>  Hello! Here's a fun fact: the human body contains about 37 trillion cells.
<span style="color: #f99470">Status:</span> completed
<span style="color: #f99470">Context ID:</span> ctx_01abc123def456
<span style="color: #f99470">Agent:</span>  Sure! Did you know that honey never spoils — archaeologists have found 3,000-year-old honey in Egyptian tombs that was still perfectly edible.
</OutputBlock>

::: info
The second reply references the conversation thread naturally — the agent knows it already told you one fact, so "another one" makes sense.
:::

### Next steps

<ExampleLinks>
<a href="/examples/02-connectors">02 · Connectors<span>Wire up MCP servers, registry experts, and sub-agents.</span></a>
<a href="/examples/03-workflow">03 · Workflow<span>Chain agents into a deterministic pipeline.</span></a>
<a href="/examples/05-streaming">05 · Streaming<span>Receive tokens as they're generated.</span></a>
</ExampleLinks>
