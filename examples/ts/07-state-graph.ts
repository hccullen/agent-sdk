/**
 * 07 — Stateful graph routing.
 *
 * Unlike a linear Workflow, a StateGraph accumulates typed shared state
 * across nodes and uses routing functions to decide what runs next —
 * including cycles (bounded by maxIterations).
 *
 * This example models a clinical triage pipeline:
 *
 *   triage ──► coder ──► reviewer ──► END
 *                 ▲           │
 *                 └───────────┘  (re-codes if reviewer rejects)
 *
 * Run: `npm run state-graph`
 */
import { AgentsClient, END, agentNode, stateGraph } from "@corti/agent-sdk";
import { makeClient } from "./_client";

interface TriageState {
  note: string;
  severity: string;
  codes: string;
  reviewerFeedback: string;
  approved: boolean;
}

async function main() {
  const agents = new AgentsClient(makeClient());

  const triageAgent = await agents.create({
    name: "sg-triage",
    description: "Classifies clinical urgency.",
    systemPrompt:
      'Read the clinical note and reply with exactly one word: "urgent" or "routine". No punctuation.',
  });

  const coderAgent = await agents.create({
    name: "sg-coder",
    description: "Assigns ICD-10 codes to a clinical note.",
    systemPrompt:
      "Suggest up to three ICD-10 codes for the clinical note. Format: comma-separated codes only.",
  });

  const reviewerAgent = await agents.create({
    name: "sg-reviewer",
    description: "Reviews proposed ICD-10 codes.",
    systemPrompt:
      'Review the proposed ICD-10 codes for the clinical note. Your reply MUST begin with exactly "approved:" or "rejected:" (lowercase, followed by a colon). No preamble, no other leading text. After the colon include the codes (if approved) or a brief reason (if rejected).',
  });

  const graph = stateGraph<TriageState>()
    .addNode(
      "triage",
      agentNode(
        triageAgent,
        (s) => s.note,
        (r) => ({ severity: r.text ?? "" }),
      ),
    )
    .addNode(
      "coder",
      agentNode(
        coderAgent,
        (s) => s.note,
        (r) => ({ codes: r.text ?? "" }),
      ),
    )
    .addNode(
      "reviewer",
      agentNode(
        reviewerAgent,
        (s) => `Note: ${s.note}\n\nProposed codes: ${s.codes}`,
        (r) => ({
          reviewerFeedback: r.text ?? "",
          approved: (r.text ?? "").trim().toLowerCase().startsWith("approved"),
        }),
      ),
    )
    // Only code urgent cases; discharge routine ones immediately.
    .addEdge("triage", (s) =>
      s.severity.toLowerCase().includes("urgent") ? "coder" : END,
    )
    .addEdge("coder", "reviewer")
    // Loop back to coder if reviewer rejects; maxIterations acts as the safety net.
    .addEdge("reviewer", (s) => (s.approved ? END : "coder"));

  const initialState: TriageState = {
    note: "Patient presents with sudden onset chest pain radiating to the left arm, diaphoresis, and shortness of breath for 45 minutes.",
    severity: "",
    codes: "",
    reviewerFeedback: "",
    approved: false,
  };

  const result = await graph.run("triage", initialState, { maxIterations: 10 });

  console.log("Final state:");
  console.log("  Severity:         ", result.state.severity);
  console.log("  ICD-10 codes:     ", result.state.codes);
  console.log("  Reviewer feedback:", result.state.reviewerFeedback);
  console.log("  Approved:         ", result.state.approved);
  console.log("\nExecution trace:");
  for (const step of result.steps) {
    console.log(`  [${step.node}]`, Object.keys(step.delta).join(", "));
  }
  console.log("\nIterations:", result.iterations);
  console.log("Terminated by:", result.terminatedBy);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
