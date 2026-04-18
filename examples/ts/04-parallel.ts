/**
 * 04 — Parallel fan-out.
 *
 * Run multiple agents concurrently on the same input. Use `parallel()`
 * standalone, or drop it directly into a `workflow()` step list to merge
 * the fulfilled results into the next step.
 *
 * Run: `npm run parallel`
 */
import { AgentsClient, parallel, workflow } from "@corti/agent-sdk";
import { makeClient } from "./_client";

async function main() {
  const agents = new AgentsClient(makeClient());

  const [emoji, haiku, slogan, merger] = await Promise.all([
    agents.create({
      name: "p-emoji",
      description: "Replies only with emojis.",
      systemPrompt: "Respond using only emoji characters.",
    }),
    agents.create({
      name: "p-haiku",
      description: "Writes haikus.",
      systemPrompt: "Respond with a single haiku (5-7-5).",
    }),
    agents.create({
      name: "p-slogan",
      description: "Writes marketing slogans.",
      systemPrompt: "Respond with one punchy marketing slogan.",
    }),
    agents.create({
      name: "p-merger",
      description: "Picks the best of several drafts.",
      systemPrompt:
        "You will receive multiple drafts joined by newlines. Pick the best and return only that one.",
    }),
  ]);

  try {
    // (a) Standalone: collect every result with Promise.allSettled-like output.
    const fanout = await parallel([emoji, haiku, slogan]).run(
      "Topic: a mountain cabin in winter."
    );
    console.log("— Fan-out (standalone) —");
    fanout.fulfilled.forEach((r, i) => console.log(`#${i + 1}: ${r.text}`));
    if (fanout.rejected.length) console.log("Rejected:", fanout.rejected);

    // (b) Inside a workflow: fulfilled results are joined and fed into `merger`.
    const { output } = await workflow([
      parallel([emoji, haiku, slogan]),
      merger,
    ]).run("Topic: a mountain cabin in winter.");
    console.log("\n— Best draft —\n" + output.text);
  } finally {
    await Promise.all([emoji.delete(), haiku.delete(), slogan.delete(), merger.delete()]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
