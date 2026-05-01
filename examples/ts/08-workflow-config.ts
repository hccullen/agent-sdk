/**
 * 08 — JSON DSL workflow config.
 *
 * Define the full agent topology as a plain JSON object (or load it from a
 * .json file), then hand it to `fromConfig()` which creates all agents
 * concurrently and returns a ready-to-run `Workflow`.
 *
 * This is an alternative to the code-first `workflow()` API — both can be
 * used in the same project.
 *
 * Run: `npm run workflow-config`
 */
import { AgentsClient, fromConfig } from "@newsioaps/agent-sdk";
import type { WorkflowConfig } from "@newsioaps/agent-sdk";
import { makeClient } from "./_client";

const config: WorkflowConfig = {
  agents: [
    {
      name: "wfc-summarizer",
      description: "Summarises a clinical note in one sentence.",
      systemPrompt: "Summarise the note in a single sentence.",
    },
    {
      name: "wfc-classifier",
      description: "Classifies a summary as 'urgent' or 'routine'.",
      systemPrompt: "Reply with exactly one word: 'urgent' or 'routine'. No punctuation.",
    },
    {
      name: "wfc-differential",
      description: "Lists a differential diagnosis.",
      systemPrompt: "List the top 3 differential diagnoses, most likely first. One line each.",
    },
    {
      name: "wfc-redflags",
      description: "Flags symptoms warranting urgent evaluation.",
      systemPrompt: "List any red-flag features from the presentation. One line each.",
    },
    {
      name: "wfc-escalator",
      description: "Drafts an escalation for urgent cases.",
      systemPrompt: "Draft a one-line escalation to the on-call physician.",
    },
  ],
  workflow: [
    // Step 1: summarise the note
    "wfc-summarizer",
    // Step 2: classify as urgent or routine
    "wfc-classifier",
    // Step 3: fan out differential + red-flags in parallel (only for urgent cases)
    {
      parallel: ["wfc-differential", "wfc-redflags"],
    },
    // Step 4: escalate — only when the classifier flagged the case as urgent
    {
      agent: "wfc-escalator",
      when: { text: { includes: "urgent" } },
      retries: 2,
      retryDelay: 500,
    },
  ],
};

async function main() {
  const agents = new AgentsClient(makeClient());

  const wf = await fromConfig(config, agents);

  const note =
    "Patient reports severe chest pain radiating to left arm, onset 30 minutes ago.";

  const result = await wf.run(note);

  console.log("Final output:", result.output.text);
  console.log("Steps executed:", result.steps.length);
  console.log("Stopped early:", result.stoppedEarly);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
