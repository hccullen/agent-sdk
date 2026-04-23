/**
 * 04 — Parallel fan-out.
 *
 * `parallel()` runs multiple `Runnable`s concurrently on the same input.
 *
 *   • `run()` merges fulfilled branches' parts into one `MessageResponse` —
 *     ideal for dropping into a `StateGraph` node.
 *   • `runSettled()` returns an allSettled-shaped result when you need the
 *     per-branch breakdown (including errors).
 *
 * Parallel is itself a `Runnable`, so it composes anywhere a `Runnable` is
 * expected: inside a graph node, inside another Parallel, or standalone.
 *
 * Run: `npm run parallel`
 */
import {
  AgentsClient,
  END,
  type Part,
  agentNode,
  parallel,
  stateGraph,
} from "@corti/agent-sdk";
import { makeClient } from "./_client";

interface AssessmentState {
  presentation: string;
  evidence: Part[];
  assessment: string;
}

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

  // (a) Standalone per-branch: full allSettled-shaped breakdown.
  const fanout = await parallel([differential, redFlags, workup]).runSettled(presentation);
  console.log("— Fan-out (standalone) —");
  fanout.fulfilled.forEach((r, i) => console.log(`#${i + 1}: ${r.text}`));
  if (fanout.rejected.length) console.log("Rejected:", fanout.rejected);

  // (b) As a node in a graph: branches' parts are captured into state, then
  //     passed straight to the synthesiser as a Part[] — no lossy text-join.
  const graph = stateGraph<AssessmentState>()
    .addNode("gather", agentNode(
      parallel([differential, redFlags, workup]),
      (s) => s.presentation,
      (r, s) => ({ ...s, evidence: r.statusMessage?.parts ?? [] }),
    ))
    .addNode("synthesise", agentNode(
      synthesizer,
      (s) => s.evidence,  // Part[] — three parts, one per branch
      (r, s) => ({ ...s, assessment: r.text ?? "" }),
    ))
    .addEdge("gather", "synthesise")
    .addEdge("synthesise", END);

  const { state } = await graph.run("gather", {
    presentation,
    evidence: [],
    assessment: "",
  });
  console.log("\n— Assessment and plan —\n" + state.assessment);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
