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
import { AgentsClient } from "@newsioaps/agent-sdk";
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
