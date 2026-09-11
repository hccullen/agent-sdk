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
import { CortiClient, collectText, StreamCollector } from "@newsioaps/agent-sdk";
import { makeClient } from "./_client";

async function main() {
  // makeClient() returns a @corti/sdk CortiClient — wrap it with the
  // agent SDK's CortiClient to get the high-level helpers.
  const client = new CortiClient({ sdkClient: makeClient() });

  // Create a short-lived agent for the demo.
  const agent = await client.agents.create({
    name: "stream-demo",
    description: "Demonstrates token-by-token streaming.",
    systemPrompt: "Reply in 4–6 sentences so the user can see streaming in action.",
  });
  const handle = await client.createAgentHandle(agent.id);

  const ctx = handle.createContext();

  // ── Approach 1: collectText() — the easy way ──────────────────────────
  //
  // `collectText()` wraps the stream and yields `{ delta, text, done }`
  // for every artifact chunk. `delta` is the incremental text fragment,
  // `text` is everything accumulated so far, and `done` is true on the
  // final event.

  console.log("--- collectText() ---\n");

  const stream = await ctx.streamMessage([
    { text: "Describe how photosynthesis works." },
  ]);

  for await (const chunk of collectText(stream)) {
    // Print each token as it arrives — no newline, so the text builds
    // up on the terminal just like a chat UI.
    if (chunk.delta) process.stdout.write(chunk.delta);

    if (chunk.done) {
      console.log("\n");
      console.log(`Complete text (${chunk.text.length} chars):`);
      console.log(chunk.text);
    }
  }

  // ── Approach 2: StreamCollector — when you need the raw events too ────
  //
  // If you want to inspect status updates or metadata while still
  // accumulating text, use `StreamCollector`. Call `.update(event)` with
  // each event; it returns the delta (or null for non-artifact events).

  console.log("\n--- StreamCollector ---\n");

  const ctx2 = handle.createContext();
  const stream2 = await ctx2.streamMessage([
    { text: "Explain how rainbows form in 3 sentences." },
  ]);

  const collector = new StreamCollector();

  for await (const event of stream2) {
    // Inspect non-artifact events as they arrive
    if (event.statusUpdate) {
      const state = event.statusUpdate.status?.state ?? "";
      console.log(`[${state.replace("TASK_STATE_", "").toLowerCase()}]`);

      // The final status update carries usage metadata
      if (event.statusUpdate.metadata) {
        console.log("  metadata:", event.statusUpdate.metadata);
      }
    }

    // Accumulate text — update() returns the delta or null
    const delta = collector.update(event);
    if (delta) process.stdout.write(delta);
  }

  console.log("\n");
  console.log(`Collector done: ${collector.done}`);
  console.log(`Collector text (${collector.text.length} chars): ${collector.text}`);

  // Clean up the ephemeral agent
  await handle.delete();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
