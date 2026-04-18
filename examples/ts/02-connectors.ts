/**
 * 02 — Connectors.
 *
 * Attach MCP servers, registry experts, and other Corti agents to an agent
 * via the typed `connectors` helpers.
 *
 * Run: `npm run connectors`
 */
import { AgentsClient, connectors } from "@corti/agent-sdk";
import { makeClient } from "./_client";

async function main() {
  const agents = new AgentsClient(makeClient());

  // A small sub-agent we will wire into the main agent as a "cortiAgent" connector.
  const coder = await agents.create({
    name: "coding-helper",
    description: "Returns ICD-10 codes for clinical terms.",
    systemPrompt: "Respond with only the ICD-10 code.",
    connectors: [connectors.registry({ name: "@corti/medical-coding" })],
  });

  // The orchestrator composes multiple connectors: the registry expert above,
  // the sub-agent we just created, and optionally an MCP server.
  const orchestrator = await agents.create({
    name: "triage-orchestrator",
    description: "Triages a note and delegates to the right expert.",
    systemPrompt: "Use your tools to answer the user's clinical question.",
    connectors: [
      connectors.fromAgent({ agentId: coder.id }),
      connectors.registry({ name: "@corti/medical-coding" }),
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

  try {
    const reply = await orchestrator.run(
      "Patient has essential hypertension. What's the ICD-10 code?"
    );
    console.log("Reply:", reply.text);
    console.log("Artifacts:", reply.artifacts.length);
  } finally {
    await orchestrator.delete();
    await coder.delete();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
