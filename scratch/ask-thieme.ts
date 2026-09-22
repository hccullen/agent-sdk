/**
 * Ask the thieme expert about fever and print creditsConsumed.
 * Sends credentials as a DataPart, following the same pattern the
 * Python SDK uses for auth-protected MCP connectors.
 */
import "dotenv/config";
import { CortiClient, connectors } from "@newsioaps/agent-sdk";
import { CortiClient as SdkCortiClient, CortiEnvironment } from "@corti/sdk";

async function main() {
  const sdkClient = new SdkCortiClient({
    tenantName: process.env.CORTI_TENANT_NAME!,
    environment: process.env.CORTI_ENVIRONMENT === "us"
      ? CortiEnvironment.Us
      : (process.env.CORTI_ENVIRONMENT === "eu"
        ? CortiEnvironment.Eu
        : process.env.CORTI_ENVIRONMENT as any),
    auth: {
      clientId: process.env.CORTI_CLIENT_ID!,
      clientSecret: process.env.CORTI_CLIENT_SECRET!,
    },
  });

  const client = new CortiClient({ sdkClient });

  const thiemeToken = process.env.MCP_TOKEN ?? process.env.THIEME_TOKEN;
  if (!thiemeToken) {
    console.error("Set MCP_TOKEN or THIEME_TOKEN in .env");
    process.exit(1);
  }

  const agent = await client.agents.create({
    name: "thieme-fever-test",
    description: "Agent that uses the thieme expert to answer medical questions.",
    systemPrompt:
      "Use the thieme expert connector to answer medical questions. Provide a concise answer.",
    connectors: [
      connectors.registry("thieme-expert"),
    ],
  });

  console.log("Agent created:", agent.id);

  const handle = await client.createAgentHandle(agent.id);
  const ctx = handle.createContext();

  // First attempt — may get auth-required
  const reply = await ctx.sendMessage([
    { text: "What are the common causes of fever?" },
    { data: { "thieme": { type: "token", token: thiemeToken } } },
  ], { timeoutInSeconds: 120 });

  console.log("Reply:", reply.text);
  console.log("Status:", reply.status);

  const task = reply.task;
  if (task?.metadata) {
    const creditsConsumed = (task.metadata as any)?.corti?.usage?.creditsConsumed;
    console.log("creditsConsumed:", creditsConsumed);
    console.log("Full metadata:", JSON.stringify(task.metadata, null, 2));
  } else if (task) {
    console.log("Raw task:", JSON.stringify(task, null, 2));
  }

  await handle.delete();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
