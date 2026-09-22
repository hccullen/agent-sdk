/**
 * 02 — Connectors.
 *
 * Attach MCP servers, registry experts, and other Corti agents to an agent
 * via the typed `connectors` helpers.
 *
 * By default this example wires a sub-agent (`connectors.agent`) in —
 * always available, no external services. Set `USE_WEB_SEARCH=1` to also
 * attach the registry `web-search-expert`, or `MCP_URL` to attach your own
 * MCP server.
 *
 * Run: `npm run connectors`
 */
import { CortiClient, connectors, auth } from "@newsioaps/agent-sdk";
import { makeClient } from "./_client.js";

async function main() {
  const client = new CortiClient({ sdkClient: makeClient() });

  // A small sub-agent we will wire into the main agent as a "cortiAgent" connector.
  // Prompt is written so the agent never asks for clarification — it always
  // produces a comma-separated symptom list from whatever input it gets.
  const symptomExtractor = await client.agents.create({
    name: "symptom-extractor",
    description: "Extracts chief complaint and key symptoms from a clinical note.",
    systemPrompt:
      "You are a symptom extractor. Given a clinical description, respond with ONLY a comma-separated list of the patient's chief complaint and key symptoms (e.g. `severe headache, photophobia, neck stiffness`). Never ask for clarification. Never add prose. If the input is sparse, extract whatever symptoms are mentioned.",
  });

  // The orchestrator composes connectors. The sub-agent is the default path;
  // the registry expert and MCP server are opt-in.
  const orchestratorAgent = await client.agents.create({
    name: "triage-orchestrator",
    description: "Triages a clinical note using the symptom extractor.",
    systemPrompt:
      "You are a clinical triage assistant. Pass the full clinical note to the `symptom-extractor` connector to get a symptom list, then write a brief one-paragraph triage recommendation (urgency, likely differentials, immediate actions). Never ask the user for clarification — work with whatever is provided.",
    connectors: [
      connectors.agent(symptomExtractor.id),
      ...(process.env.USE_WEB_SEARCH === "1"
        ? [connectors.registry("web-search-expert")]
        : []),
      ...(process.env.MCP_URL
        ? [
            connectors.mcp({
              url: process.env.MCP_URL,
              name: "external-mcp",
              ...(process.env.MCP_TOKEN ? { auth: auth.bearer() } : {}),
            }),
          ]
        : []),
    ],
  });
  const orchestrator = await client.createAgentHandle(orchestratorAgent.id);

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
