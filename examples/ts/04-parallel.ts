/**
 * 04 — Parallel fan-out.
 *
 * Run multiple agents concurrently on the same input. Use `parallel()`
 * standalone (`runSettled()` for per-branch allSettled breakdown), or drop
 * it directly into a `workflow()` step list — `run()` returns one merged
 * `MessageResponse` whose reply message carries every branch's parts.
 *
 * Run: `npm run parallel`
 */
import { AgentsClient, parallel, workflow } from "@corti/agent-sdk";
import { makeClient } from "./_client";

async function main() {
  const agents = new AgentsClient(makeClient());

  const [differential, redFlags, workup, synthesizer] = await Promise.all([
    agents.create({
      name: "p-differential",
      description: "Lists a differential diagnosis.",
      systemPrompt:
        "List the top 3 differential diagnoses for the presentation, most likely first. One line each.",
    }),
    agents.create({
      name: "p-redflags",
      description: "Flags symptoms warranting urgent evaluation.",
      systemPrompt:
        "List any red-flag features from the presentation that warrant urgent evaluation. One line each.",
    }),
    agents.create({
      name: "p-workup",
      description: "Suggests initial diagnostic workup.",
      systemPrompt:
        "Suggest an initial diagnostic workup (labs, imaging, bedside exam). One line each.",
    }),
    agents.create({
      name: "p-synthesizer",
      description: "Combines clinical perspectives into a single assessment.",
      systemPrompt:
        "You will receive a differential, red-flag list, and suggested workup as separate message parts. Combine them into a concise clinical assessment and plan.",
    }),
  ]);

  const presentation =
    "54-year-old male with 2 hours of crushing substernal chest pain, diaphoresis, and dyspnea; history of hypertension and smoking.";

  // (a) Standalone: collect every result with Promise.allSettled-like output.
  const fanout = await parallel([differential, redFlags, workup]).runSettled(presentation);
  console.log("— Fan-out (standalone) —");
  fanout.fulfilled.forEach((r, i) => console.log(`#${i + 1}: ${r.text}`));
  if (fanout.rejected.length) console.log("Rejected:", fanout.rejected);

  // (b) Inside a workflow: branches' parts are concatenated into one message
  //     and fed into `synthesizer`.
  const { output } = await workflow([
    parallel([differential, redFlags, workup]),
    synthesizer,
  ]).run(presentation);
  console.log("\n— Assessment and plan —\n" + output.text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
