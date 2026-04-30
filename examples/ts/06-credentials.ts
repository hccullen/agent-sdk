/**
 * 06 — MCP credentials.
 *
 * When an MCP server requires auth, the agent may reply with status
 * `auth-required`. Pass a `credentials` map to `createContext()` (or the
 * one-shot `agent.run()`) and the SDK transparently forwards the token —
 * first as a DataPart on the first message, and again as a follow-up if
 * the agent still asks.
 *
 * Run: `npm run credentials`
 */
import { AgentsClient, connectors } from "@newsioaps/agent-sdk";
import { makeClient } from "./_client";

async function main() {
  const mcpUrl = process.env.MCP_URL;
  const mcpToken = process.env.MCP_TOKEN;
  if (!mcpUrl || !mcpToken) {
    console.log("Set MCP_URL and MCP_TOKEN in .env to run this example.");
    return;
  }

  const agents = new AgentsClient(makeClient());

  // Note the MCP connector's `name` — that name becomes the key in the
  // credential store below.
  const agent = await agents.create({
    name: "auth-demo",
    description: "Calls an auth-protected MCP server.",
    connectors: [connectors.mcp({ mcpUrl, name: "my-mcp", authType: "bearer" })],
  });

  const ctx = agent.createContext({
    credentials: {
      "my-mcp": { type: "token", token: mcpToken },
    },
  });

  const reply = await ctx.sendText("List the tools you have access to.");
  console.log("Status:", reply.status);   // expect "completed"
  console.log("Reply:", reply.text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
