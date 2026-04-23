/**
 * 03 — Linear pipeline.
 *
 * The simplest shape `stateGraph()` covers: a chain of agents where each step
 * reads state set by the previous one, with an optional branch that skips
 * escalation for routine cases and automatic retries on failure.
 *
 *   summarise ──► classify ──(urgent?)──► escalate ──► END
 *                                  │
 *                                  └──► END (routine)
 *
 * Run: `npm run pipeline`
 */
import { AgentsClient, END, agentNode, stateGraph } from "@corti/agent-sdk";
import { makeClient } from "./_client";

interface PipelineState {
  note: string;
  summary: string;
  severity: string;
  escalation: string;
}

async function main() {
  const agents = new AgentsClient(makeClient());

  const summarizer = await agents.create({
    name: "pl-summariser",
    description: "Summarises a clinical note in one sentence.",
    systemPrompt: "Summarise the note in a single sentence.",
  });

  const classifier = await agents.create({
    name: "pl-classifier",
    description: "Classifies a summary as 'urgent' or 'routine'.",
    systemPrompt:
      "Reply with exactly one word: 'urgent' or 'routine'. No punctuation.",
  });

  const escalator = await agents.create({
    name: "pl-escalator",
    description: "Drafts an escalation for urgent cases.",
    systemPrompt: "Draft a one-line escalation to the on-call physician.",
  });

  // Pipeline: summarise → classify → (urgent?) → escalate
  // `agentNode(..., { retries: 2 })` re-invokes on `status === "failed"`.
  const graph = stateGraph<PipelineState>()
    .addNode("summarise", agentNode(
      summarizer,
      (s) => s.note,
      (r, s) => ({ ...s, summary: r.text ?? "" }),
    ))
    .addNode("classify", agentNode(
      classifier,
      (s) => s.summary,
      (r, s) => ({ ...s, severity: (r.text ?? "").trim().toLowerCase() }),
    ))
    .addNode("escalate", agentNode(
      escalator,
      (s) => s.note,
      (r, s) => ({ ...s, escalation: r.text ?? "" }),
      { retries: 2, retryDelay: 500 },
    ))
    .addEdge("summarise", "classify")
    .addEdge("classify", (s) => s.severity.includes("urgent") ? "escalate" : END)
    .addEdge("escalate", END);

  const { state, steps, terminatedBy } = await graph.run("summarise", {
    note: "Patient reports severe chest pain radiating to left arm, onset 30 minutes ago.",
    summary: "",
    severity: "",
    escalation: "",
  });

  console.log("Summary:    ", state.summary);
  console.log("Severity:   ", state.severity);
  console.log("Escalation: ", state.escalation || "(none — routine)");
  console.log("Steps:      ", steps.map((s) => s.node).join(" → "));
  console.log("Terminated: ", terminatedBy);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
