/**
 * 03 — Deterministic workflows.
 *
 * Chain agents into a deterministic pipeline. Each step transforms the
 * previous response, may be conditionally skipped, and may retry on failure.
 *
 * Run: `npm run workflow`
 */
import { AgentsClient, workflow } from "@corti/agent-sdk";
import { makeClient } from "./_client";

async function main() {
  const agents = new AgentsClient(makeClient());

  const summarizer = await agents.create({
    name: "wf-summarizer",
    description: "Summarises a clinical note in one sentence.",
    systemPrompt: "Summarise the note in a single sentence.",
  });

  const classifier = await agents.create({
    name: "wf-classifier",
    description: "Classifies a summary as 'urgent' or 'routine'.",
    systemPrompt:
      "Reply with exactly one word: 'urgent' or 'routine'. No punctuation.",
  });

  const escalator = await agents.create({
    name: "wf-escalator",
    description: "Drafts an escalation for urgent cases.",
    systemPrompt: "Draft a one-line escalation to the on-call physician.",
  });

  const note =
    "Patient reports severe chest pain radiating to left arm, onset 30 minutes ago.";

  // Pipeline: summarise → classify → escalate (only when classifier says urgent).
  const result = await workflow([
    summarizer,                                  // step 1: summarise the note
    classifier,                                  // step 2: classify the summary
    {                                            // step 3: conditional escalate
      agent: escalator,
      when: (prev) => (prev.text ?? "").toLowerCase().includes("urgent"),
      // Skip escalation input is just the word "urgent"; give escalator the
      // original note so it has something to escalate.
      transform: () => note,
      retries: 2,
      retryDelay: 500,
    },
  ]).run(note);

  console.log("Final output:", result.output.text);
  console.log("Steps executed:", result.steps.length);
  console.log("Stopped early:", result.stoppedEarly);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
