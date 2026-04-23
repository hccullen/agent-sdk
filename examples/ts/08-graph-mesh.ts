/**
 * 08 — Agent mesh: parallel gather, branch, retry, loop.
 *
 * Everything a "workflow + fan-out + routing graph" DSL would give you,
 * expressed with a single `stateGraph()` + a `parallel()` node.
 *
 *   gather ──► plan ──(needs_more?)──► gather       (bounded by maxIterations)
 *                          │
 *                          └──────► draft ──► review ──(ok?)──► END
 *                                               │
 *                                               └──► draft          (retries on 'failed')
 *
 *   • `gather` is a parallel fan-out that merges 3 branches' parts into one message.
 *   • `plan` decides whether to re-gather or hand off to the drafter.
 *   • `draft` uses agentNode(..., { retries: 2 }) to re-invoke on `status === "failed"`.
 *   • `review` loops back to `draft` until the reviewer approves.
 *
 * Run: `npm run mesh`
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

interface MeshState {
  topic: string;
  evidence: Part[];
  plan: string;
  draft: string;
  approved: boolean;
  review: string;
}

async function main() {
  const agents = new AgentsClient(makeClient());

  const [pubmed, textbooks, guidelines, planner, drafter, reviewer] =
    await Promise.all([
      agents.create({
        name: "m-pubmed",
        description: "Searches recent literature.",
        systemPrompt: "List 3 recent findings relevant to the topic. One bullet each.",
      }),
      agents.create({
        name: "m-textbooks",
        description: "Summarises textbook consensus.",
        systemPrompt: "Summarise the textbook consensus on the topic. 2-3 sentences.",
      }),
      agents.create({
        name: "m-guidelines",
        description: "Quotes clinical guidelines.",
        systemPrompt: "Quote the most relevant guideline recommendation for the topic.",
      }),
      agents.create({
        name: "m-planner",
        description: "Decides if enough evidence was gathered.",
        systemPrompt:
          'Reply with exactly one word: "sufficient" if the gathered evidence covers the topic, or "more" if another pass is needed. No punctuation.',
      }),
      agents.create({
        name: "m-drafter",
        description: "Drafts a clinician-facing summary.",
        systemPrompt:
          "Draft a concise clinician-facing summary (≤ 120 words) using the gathered evidence.",
      }),
      agents.create({
        name: "m-reviewer",
        description: "Approves or rejects a draft.",
        systemPrompt:
          'Reply with exactly "approved:" or "rejected:" followed by a one-line reason.',
      }),
    ]);

  const graph = stateGraph<MeshState>()
    // Fan-out three researchers; merge their parts into state.evidence.
    .addNode("gather", agentNode(
      parallel([pubmed, textbooks, guidelines]),
      (s) => s.topic,
      (r, s) => ({
        ...s,
        evidence: [...s.evidence, ...(r.statusMessage?.parts ?? [])],
      }),
    ))
    // Planner looks at evidence and decides whether to gather more.
    .addNode("plan", agentNode(
      planner,
      (s) => s.evidence,
      (r, s) => ({ ...s, plan: (r.text ?? "").trim().toLowerCase() }),
    ))
    // Drafter writes the summary — retried up to twice on failure.
    .addNode("draft", agentNode(
      drafter,
      (s) => s.evidence,
      (r, s) => ({ ...s, draft: r.text ?? "" }),
      { retries: 2, retryDelay: 500 },
    ))
    // Reviewer approves/rejects — parses the prefix into a boolean.
    .addNode("review", agentNode(
      reviewer,
      (s) => `Topic: ${s.topic}\n\nDraft:\n${s.draft}`,
      (r, s) => ({
        ...s,
        review: r.text ?? "",
        approved: (r.text ?? "").trim().toLowerCase().startsWith("approved"),
      }),
    ))
    .addEdge("gather", "plan")
    .addEdge("plan",   (s) => s.plan.includes("sufficient") ? "draft" : "gather")
    .addEdge("draft",  "review")
    .addEdge("review", (s) => s.approved ? END : "draft");

  const { state, steps, iterations, terminatedBy } = await graph.run(
    "gather",
    { topic: "Outpatient management of atrial fibrillation", evidence: [], plan: "", draft: "", approved: false, review: "" },
    { maxIterations: 12 },
  );

  console.log("Draft:\n" + state.draft);
  console.log("\nReview:   ", state.review);
  console.log("Approved: ", state.approved);
  console.log("Trace:    ", steps.map((s) => s.node).join(" → "));
  console.log("Iterations:", iterations, "— terminated by:", terminatedBy);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
