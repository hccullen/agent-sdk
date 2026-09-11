---
prev:
  text: "04 · Parallel fan-out"
  link: "/examples/04-parallel"
next:
  text: "06 · Credentials"
  link: "/examples/06-credentials"
---

# 05 — Streaming

`streamMessage()` returns an `AsyncIterable<StreamResponse>` that yields events as the agent generates its reply — status updates first, then **token-by-token** `artifactUpdate` events as each token is produced by the model.

The SDK provides helpers that handle text accumulation and citation extraction for you so you don't have to manually concatenate fragments or parse metadata:

<ConceptGrid>
<ConceptCard title="collectText(stream)">Wraps the event stream and yields `{ delta, text, done }` per token. The simplest way to get real-time text.</ConceptCard>
<ConceptCard title="StreamCollector">Stateful collector for when you need to inspect every raw event (status, metadata) while still accumulating text.</ConceptCard>
<ConceptCard title="collectCitations(stream)">Like `collectText` but also extracts citation metadata from the final chunk — offsets, URLs, titles, snippets.</ConceptCard>
<ConceptCard title="toMarkdown(text, citations)">Renders text + citations as markdown with inline `[n]` markers and a `## Sources` section.</ConceptCard>
</ConceptGrid>

## Run it

```bash
npm run streaming
```

You'll see status tokens (`[working]`, `[completed]`) interspersed with the generated text written to stdout in real time, token by token.

## How token-by-token streaming works

The API sends three kinds of `artifactUpdate` events during generation:

| Event | `append` | `lastChunk` | Content |
|-------|----------|-------------|---------|
| First chunk | absent | absent | First token fragment (creates the artifact) |
| Append chunks | `true` | absent | Incremental token fragments |
| Final chunk | absent | `true` | **Complete text** (authoritative) |

The final `lastChunk` event carries the full text as the server's authoritative version. Both `collectText()` and `StreamCollector` use this to replace the accumulated deltas, so the final text is always correct even if an intermediate chunk was missed.

## Event types

Each yielded `StreamResponse` has exactly one of these fields:

| Field | When it fires |
|-------|---------------|
| `event.task` | When the task is created or state changes |
| `event.statusUpdate` | Task state transitions: `working` → `completed` / `failed`. The final event carries usage metadata. |
| `event.message` | Direct message response (no task lifecycle) |
| `event.artifactUpdate` | Incremental text tokens during generation |

## Approach 1: collectText() — the easy way

`collectText()` wraps the stream and yields `{ delta, text, done }` for every artifact chunk. This is the recommended way to consume token streaming.

```typescript
import { collectText } from "@newsioaps/agent-sdk";

const stream = await ctx.streamMessage([{ text: "Describe how photosynthesis works." }]);

for await (const chunk of collectText(stream)) {
  // delta: the incremental text fragment (empty string on the final event)
  if (chunk.delta) process.stdout.write(chunk.delta);

  // done: true when the stream is complete
  if (chunk.done) {
    console.log("\n\nComplete text:", chunk.text);
  }
}
```

| Field | Description |
|-------|-------------|
| `chunk.delta` | The incremental text fragment from this event. Empty string on the final `lastChunk` event. |
| `chunk.text` | All text accumulated so far. On the final event, this is the authoritative complete text from the server. |
| `chunk.done` | `true` when the `lastChunk` event has been received. |

## Approach 2: StreamCollector — when you need the raw events too

If you want to inspect status updates, metadata, or non-text parts while still accumulating text, use `StreamCollector`:

```typescript
import { StreamCollector } from "@newsioaps/agent-sdk";

const collector = new StreamCollector();
const stream = await ctx.streamMessage([{ text: "Explain rainbows." }]);

for await (const event of stream) {
  // Inspect status updates and metadata
  if (event.statusUpdate) {
    console.log(`[${event.statusUpdate.status?.state}]`);
    if (event.statusUpdate.metadata) {
      console.log("  usage:", event.statusUpdate.metadata);
    }
  }

  // Accumulate text — update() returns the delta or null
  const delta = collector.update(event);
  if (delta) process.stdout.write(delta);
}

console.log("\nFinal text:", collector.text);  // authoritative complete text
console.log("Done:", collector.done);          // true
```

`StreamCollector.update(event)` returns:
- The incremental text delta (string, may be empty) for `artifactUpdate` events
- `null` for all other event types (task, statusUpdate, message)

## Walkthrough

### 1 · Create a context and start the stream

```typescript
const ctx = handle.createContext();
const stream = await ctx.streamMessage([
  { text: "Describe how photosynthesis works." },
]);
```

Pass an array of `Part`s — the same shape as `sendMessage()`. `await` the call to get the iterable; the network request starts here.

### 2 · Consume tokens with collectText()

```typescript
for await (const chunk of collectText(stream)) {
  if (chunk.delta) process.stdout.write(chunk.delta);
  if (chunk.done) console.log("\n\nComplete:", chunk.text);
}
```

1. The first artifact event yields the first token fragment.
2. Subsequent `append: true` events yield incremental tokens — write them to stdout without a newline to see the streaming effect.
3. The final `lastChunk: true` event yields `done: true` with the complete authoritative text.
4. A terminal `statusUpdate` with state `completed` (or `failed`) follows.
5. The `for await...of` loop exits when the iterable is exhausted.

### 3 · Context tracking

`streamMessage()` tracks the same `contextId` as `sendMessage()`. You can freely interleave them:

```typescript
const ctx = handle.createContext();

// First turn — streaming
const stream = await ctx.streamMessage([{ text: "Explain mitosis." }]);
for await (const chunk of collectText(stream)) {
  if (chunk.delta) process.stdout.write(chunk.delta);
}

// ctx.id is now populated
console.log(ctx.id);   // "ctx.0192f4c8..."

// Second turn — non-streaming, same thread
const reply = await ctx.sendText("And meiosis?");
console.log(reply.text);   // agent remembers the prior exchange
```

## Approach 3: collectCitations() — citations from search-enabled agents

When an agent has a search connector (like `web-search-expert`), the server embeds citation markers in the generated text and resolves them against search result data parts. `collectCitations()` wraps the stream like `collectText()`, but on the final `lastChunk` event it also extracts structured citation metadata — offsets, source URLs, titles, snippets, and site names.

```typescript
import { collectCitations, toMarkdown } from "@newsioaps/agent-sdk";

const stream = await ctx.streamMessage([{ text: "Who won the 2026 World Cup?" }]);

for await (const chunk of collectCitations(stream)) {
  if (chunk.delta) process.stdout.write(chunk.delta);

  if (chunk.done) {
    console.log("\n");
    console.log(toMarkdown(chunk.text, chunk.citations));
  }
}
```

During streaming, `chunk.citations` is an empty array. On the final event (`done: true`), citations are populated from the text part's `metadata.citations` and resolved against the data parts' source data.

| Field | Description |
|-------|-------------|
| `chunk.citations` | Array of `Citation` objects (empty until `done: true`). |
| `citation.offset` | Character offset in the text where the citation marker belongs. |
| `citation.url` | Source URL. |
| `citation.title` | Source page title (if available). |
| `citation.snippet` | Snippet of source content supporting the claim. |
| `citation.siteName` | Site name (e.g. `"fifa.com"`). |

### Rendering with toMarkdown()

`toMarkdown(text, citations)` inserts `[1]`, `[2]` markers at the citation offsets and appends a `## Sources` section. Same-URL citations share the same number.

```typescript
const md = toMarkdown("Spain won the World Cup.", [
  { offset: 5, url: "https://fifa.com/final", title: "FIFA Final" },
]);
// → "Spain won the World Cup.[1]\n\n## Sources\n[1] FIFA Final — https://fifa.com/final"
```

## Full code

Source: `examples/ts/05-streaming.ts`

```typescript
/**
 * 05 — Streaming responses with token-by-token accumulation.
 *
 * The Corti API streams `artifactUpdate` events as the agent generates its
 * reply — one small text fragment per event. Use `collectText()` to turn
 * that event stream into a simple `{ delta, text, done }` iterator that
 * handles the accumulation for you.
 *
 * Run: `npm run streaming`
 */
import { CortiClient, collectText, StreamCollector, collectCitations, toMarkdown } from "@newsioaps/agent-sdk";
import { makeClient } from "./_client";

async function main() {
  const client = new CortiClient({ sdkClient: makeClient() });

  const agent = await client.agents.create({
    name: "stream-demo",
    description: "Demonstrates token-by-token streaming.",
    systemPrompt: "Reply in 4–6 sentences so the user can see streaming in action.",
  });
  const handle = await client.createAgentHandle(agent.id);

  const ctx = handle.createContext();

  // Approach 1: collectText() — the easy way
  console.log("--- collectText() ---\n");
  const stream = await ctx.streamMessage([
    { text: "Describe how photosynthesis works." },
  ]);

  for await (const chunk of collectText(stream)) {
    if (chunk.delta) process.stdout.write(chunk.delta);
    if (chunk.done) console.log("\n\nComplete text:", chunk.text);
  }

  // Approach 2: StreamCollector — when you need the raw events too
  console.log("\n--- StreamCollector ---\n");
  const ctx2 = handle.createContext();
  const stream2 = await ctx2.streamMessage([
    { text: "Explain how rainbows form in 3 sentences." },
  ]);

  const collector = new StreamCollector();
  for await (const event of stream2) {
    if (event.statusUpdate) {
      console.log(`[${event.statusUpdate.status?.state}]`);
      if (event.statusUpdate.metadata) console.log("  metadata:", event.statusUpdate.metadata);
    }
    const delta = collector.update(event);
    if (delta) process.stdout.write(delta);
  }

  console.log("\nCollector done:", collector.done);
  console.log("Collector text:", collector.text);

  // Approach 3: collectCitations() + toMarkdown — for search-enabled agents
  console.log("\n--- collectCitations() ---\n");
  const ctx3 = handle.createContext();
  const stream3 = await ctx3.streamMessage([
    { text: "Who won the 2026 World Cup?" },
  ]);

  for await (const chunk of collectCitations(stream3)) {
    if (chunk.delta) process.stdout.write(chunk.delta);
    if (chunk.done) {
      console.log("\n");
      console.log(toMarkdown(chunk.text, chunk.citations));
    }
  }

  await handle.delete();
}

main().catch((err) => { console.error(err); process.exit(1); });
```

## What to expect

<OutputBlock>
<span style="color: #5a6478">--- collectText() ---</span>
Photosynthesis is the process by which plants, algae, and some
bacteria convert light energy into chemical energy stored as
glucose. It occurs in two main stages: the light-dependent
reactions in the thylakoid membranes, where water is split and
ATP is generated, and the Calvin cycle in the stroma, where CO2
is fixed into sugars. Oxygen is released as a by-product of the
water-splitting step. Without photosynthesis, virtually all life
on Earth would cease to exist.

Complete text: Photosynthesis is the process by which plants, algae...

<span style="color: #5a6478">--- StreamCollector ---</span>
<span style="color: #5a6478">[working]</span>
Rainbows form when sunlight enters raindrops and is bent, or
refracted, as it passes from air into water. Inside the drop,
the light reflects off the back surface and then bends again as
it exits, which separates it into its component colors.
<span style="color: #5a6478">[completed]</span>
<span style="color: #5a6478">  usage: {"corti":{"usage":{"creditsConsumed":0.04}}}</span>
Collector done: true
Collector text: Rainbows form when sunlight enters raindrops and is bent...

<span style="color: #5a6478">--- collectCitations() ---</span>
Spain won the World Cup.

Spain won the World Cup.[1]

## Sources
[1] FIFA World Cup 2026 Final — https://fifa.com/final
</OutputBlock>

::: info
The tokens appear incrementally as they are generated — in a terminal you'll see the text build word by word rather than appearing all at once.
:::

### Next steps

<ExampleLinks>
<a href="/examples/01-hello-agent">01 · Hello, agent<span>The non-streaming equivalent using sendText().</span></a>
<a href="/examples/06-credentials">06 · Credentials<span>Combine streaming with auth-protected MCP servers.</span></a>
<a href="/#streaming">Streaming concept docs<span>Full API reference for streamMessage().</span></a>
</ExampleLinks>
