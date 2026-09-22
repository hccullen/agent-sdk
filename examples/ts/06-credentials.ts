/**
 * 06 — MCP credentials.
 *
 * When an MCP server requires auth, the agent may reply with status
 * `auth-required`. Include the credential token as a `DataPart` alongside
 * the text message — the server matches it to the connector by name.
 *
 * Run: `npm run credentials`
 */
import { CortiClient, connectors, auth, dataPart } from "@newsioaps/agent-sdk";
import { makeClient } from "./_client.js";

async function main() {
  const mcpUrl = process.env.MCP_URL;
  const mcpToken = process.env.MCP_TOKEN;
  if (!mcpUrl || !mcpToken) {
    console.log("Set MCP_URL and MCP_TOKEN in .env to run this example.");
    return;
  }

  const client = new CortiClient({ sdkClient: makeClient() });

  // Note the MCP connector's `name` — that name becomes the key in the
  // credential DataPart below.
  const agent = await client.agents.create({
    name: "auth-demo",
    description: "Calls an auth-protected MCP server.",
    connectors: [connectors.mcp({ url: mcpUrl, name: "my-mcp", auth: auth.bearer() })],
  });
  const handle = await client.createAgentHandle(agent.id);

  const ctx = handle.createContext();

  // Send the text prompt alongside a DataPart carrying the credential.
  // The server matches the `"my-mcp"` key to the connector of the same name.
  const reply = await ctx.sendMessage([
    { text: "List the tools you have access to." },
    dataPart({ "my-mcp": { type: "token", token: mcpToken } }),
  ]);
  console.log("Status:", reply.status);   // expect "completed"
  console.log("Reply:", reply.text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
