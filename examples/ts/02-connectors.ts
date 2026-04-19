/**
 * 02 — Connectors.
 *
 * Attach MCP servers, registry experts, and other Corti agents to an agent
 * via the typed `connectors` helpers.
 *
 * By default this example wires a sub-agent (`connectors.fromAgent`) in —
 * always available, no external services. Set `USE_WEB_SEARCH=1` to also
 * attach the registry `web-search-expert`, or `MCP_URL` to attach your own
 * MCP server.
 *
 * Run: `npm run connectors`
 */
import { AgentsClient, connectors } from "@corti/agent-sdk";
import { makeClient } from "./_client";

async function main() {
  const agents = new AgentsClient(makeClient());

  // A small sub-agent we will wire into the main agent as a "cortiAgent" connector.
  // Prompt is written so the agent never asks for clarification — it always
  // produces a comma-separated symptom list from whatever input it gets.
  const symptomExtractor = await agents.create({
    name: "symptom-extractor",
    description: "Extracts chief complaint and key symptoms from a clinical note.",
    systemPrompt:
      "You are a symptom extractor. Given a clinical description, respond with ONLY a comma-separated list of the patient's chief complaint and key symptoms (e.g. `severe headache, photophobia, neck stiffness`). Never ask for clarification. Never add prose. If the input is sparse, extract whatever symptoms are mentioned.",
  });

  // The orchestrator composes connectors. The sub-agent is the default path;
  // the registry expert and MCP server are opt-in.
  const orchestrator = await agents.create({
    name: "triage-orchestrator",
    description: "Triages a clinical note using the symptom extractor.",
    systemPrompt:
      "You are a clinical triage assistant. Pass the full clinical note to the `symptom-extractor` connector to get a symptom list, then write a brief one-paragraph triage recommendation (urgency, likely differentials, immediate actions). Never ask the user for clarification — work with whatever is provided.",
    connectors: [
      connectors.fromAgent({ agentId: symptomExtractor.id }),
      ...(process.env.USE_WEB_SEARCH === "1"
        ? [connectors.registry({ name: "web-search-expert" })]
        : []),
      ...(process.env.MCP_URL
        ? [
            connectors.mcp({
              mcpUrl: process.env.MCP_URL,
              ...(process.env.MCP_TOKEN ? { token: process.env.MCP_TOKEN } : {}),
            }),
          ]
        : []),
    ],
  });

  // Orchestrated calls fan out to sub-agents / experts, so raise the per-call
  // timeout beyond the SDK's 60s default.
  const reply = await orchestrator.run(
    "62-year-old presents with sudden severe headache, photophobia, and neck stiffness for the past hour.",
    { timeoutInSeconds: 180 },
  );
  console.log("Status:    ", reply.status);
  console.log("Reply:     ", reply.text);
  console.log("Artifacts: ", reply.artifacts.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
