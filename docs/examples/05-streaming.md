# 05 — Streaming

`streamMessage()` returns an `AsyncIterable<StreamEvent>` that yields events as the agent generates its reply — status updates first, then partial or complete message chunks as tokens arrive.

<ConceptGrid>
<ConceptCard title="streamMessage(parts)">Sends a message and returns a promise that resolves to an async iterable. `await` it first, then `for await...of` the events.</ConceptCard>
<ConceptCard title="statusUpdate">Signals a task state change: `working` → `completed` or `failed`. Useful for progress indicators.</ConceptCard>
<ConceptCard title="message">Carries one or more message parts. Filter to `kind === "text"` to extract the generated tokens.</ConceptCard>
<ConceptCard title="Context tracking">The stream tracks the same `contextId` as `sendMessage()`. Mix the two freely on one context.</ConceptCard>
</ConceptGrid>

## Run it

```bash
npm run streaming
```

You'll see status tokens (`[working]`, `[completed]`) interspersed with the generated text written to stdout in real time.

## Event types

Each yielded value is a `StreamEvent`. The two fields are mutually exclusive — each event has one or the other, never both.

| Field | Type | When it fires |
|---|---|---|
| `event.statusUpdate` | `{ status: { state: TaskState } }` | When the task state transitions: typically `"working"` at the start and `"completed"` or `"failed"` at the end. |
| `event.message` | `{ parts: MessagePart[] }` | When the agent produces output. May fire multiple times with partial content before a final message event. |

A `MessagePart` has a `kind` discriminant:

```typescript
// Text part — the generated tokens
{ kind: "text"; text: string }

// Data part — structured JSON output
{ kind: "data"; data: unknown }

// File part — binary attachment
{ kind: "file"; file: { name: string; mimeType: string; bytes: string } }
```

For text streaming, filter to `kind === "text"` and write `part.text` to your output.

## Walkthrough

### 1 · Call streamMessage()

```typescript
const ctx = agent.createContext();

// streamMessage returns Promise<AsyncIterable<StreamEvent>>
const stream = await ctx.streamMessage([
  { kind: "text", text: "Describe how photosynthesis works." },
]);
```

Pass an array of `MessagePart`s — the same shape as `sendMessage()`. `await` the call to get the iterable; the network request starts here.

### 2 · Iterate events

```typescript
for await (const event of stream) {
  if (event.statusUpdate) {
    process.stdout.write(`[${event.statusUpdate.status.state}] `);
  }

  if (event.message) {
    const texts = event.message.parts
      .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
      .map((p) => p.text);
    if (texts.length) process.stdout.write(texts.join(""));
  }
}
process.stdout.write("\n");
```

1. The first event is typically a `statusUpdate` with state `"working"`.
2. One or more `message` events follow, each carrying partial text. Write them to stdout without a newline to see the streaming effect.
3. A final `statusUpdate` with state `"completed"` (or `"failed"`) signals the end of the stream.
4. The `for await...of` loop exits when the iterable is exhausted — no manual cleanup needed.

### 3 · Type-safe part filtering

```typescript
// The type predicate narrows the part type so TypeScript knows p.text exists
.filter((p): p is { kind: "text"; text: string } => p.kind === "text")
```

Without the predicate, `p.text` would be a type error because `MessagePart` is a discriminated union. The predicate narrows it to the text variant.

## Context tracking

`streamMessage()` and `sendMessage()` share the same `contextId` bookkeeping. You can freely interleave them on a single context:

```typescript
const ctx = agent.createContext();

// First turn — streaming
const stream = await ctx.streamMessage([{ kind: "text", text: "Explain mitosis." }]);
for await (const event of stream) { /* ... */ }

// ctx.id is now populated
console.log(ctx.id);   // "ctx_abc123"

// Second turn — non-streaming, same thread
const reply = await ctx.sendText("And meiosis?");
console.log(reply.text);   // agent remembers the prior exchange
```

::: info
The `contextId` is extracted from the first streamed event. By the time the `for await` loop exits, `ctx.id` is populated and subsequent calls on the same context will continue the conversation thread.
:::

## Full code

Source: `examples/ts/05-streaming.ts`

```typescript
/**
 * 05 — Streaming responses.
 *
 * Use `ctx.streamMessage()` to receive the agent's reply as a stream of
 * `StreamEvent` objects. The same `contextId` bookkeeping applies: the
 * first event carries the context ID, and it is tracked automatically for
 * subsequent calls on this context.
 *
 * Run: `npm run streaming`
 */
import { AgentsClient } from "@corti/agent-sdk";
import { makeClient } from "./_client";

async function main() {
  const agents = new AgentsClient(makeClient());

  const agent = await agents.create({
    name: "stream-demo",
    description: "Demonstrates streaming replies.",
    systemPrompt: "Reply in 4–6 sentences so the user can see streaming in action.",
  });

  const ctx = agent.createContext();
  const stream = await ctx.streamMessage([
    { kind: "text", text: "Describe how photosynthesis works." },
  ]);

  for await (const event of stream) {
    // Intermediate status updates (working → completed/failed).
    if (event.statusUpdate) {
      process.stdout.write(`[${event.statusUpdate.status.state}] `);
    }

    // Final or intermediate message with text parts from the agent.
    if (event.message) {
      const texts = event.message.parts
        .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
        .map((p) => p.text);
      if (texts.length) process.stdout.write(texts.join(""));
    }
  }
  process.stdout.write("\n");
  console.log("Context ID:", ctx.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## What to expect

<OutputBlock>
<span style="color: #5a6478">[working] </span>Photosynthesis is the process by which plants, algae, and some
bacteria convert light energy into chemical energy stored as glucose.
It occurs in two main stages: the light-dependent reactions in the
thylakoid membranes, where water is split and ATP is generated, and
the Calvin cycle in the stroma, where CO2 is fixed into sugars.
Oxygen is released as a by-product of the water-splitting step.
Without photosynthesis, virtually all life on Earth would cease to exist.<span style="color: #5a6478"> [completed]</span>
<span style="color: #f99470">Context ID:</span> ctx_01abc123def456
</OutputBlock>

::: info
The tokens appear incrementally as they are generated — in a terminal you'll see the text build character by character rather than appearing all at once.
:::

### Next steps

<ExampleLinks>
<a href="/examples/01-hello-agent">01 · Hello, agent<span>The non-streaming equivalent using sendText().</span></a>
<a href="/examples/06-credentials">06 · Credentials<span>Combine streaming with auth-protected MCP servers.</span></a>
<a href="/#streaming">Streaming concept docs<span>Full API reference for streamMessage().</span></a>
</ExampleLinks>
