import "dotenv/config";
import { CortiClient as SdkClient } from "@corti/sdk";
import {
  CortiClient,
  AgentsResource,
  AgentHandle,
  connectors,
  auth,
} from "@newsioaps/agent-sdk";

const MCP_URL = "http://mcp-gateway.shared:80/textgen/mcp";

async function main() {
  const sdkClient = new SdkClient({
    tenantName: "base",
    environment: "dev-weu",
    auth: {
      clientId: "corti-testing-bb04f724-ba49-4c64-9992-3169112406a8-default_client",
      clientSecret: "hWdjsH4Uqys9pXyWnjeQLKX7pFlr5Cu2",
    },
  });

  const client = new CortiClient({
    sdkClient,
    baseUrl: "https://api.dev-weu.corti.app",
    tenant: "base",
  });

  const agents = new AgentsResource(client);

  const agent = await agents.create({
    name: "textgen-test2",
    description: "Test agent.",
    systemPrompt: "You are a helpful assistant.",
    connectors: [
      connectors.mcp({
        name: "textgen",
        url: MCP_URL,
        auth: { type: "bearer" },
      }),
    ],
  });

  console.log("Agent connectors:", JSON.stringify(agent.connectors, null, 2));

  const handle = new AgentHandle(agent, client);

  console.log("\nSending message...");
  const reply = await handle.run(
    "List the tools you have access to via your MCP connectors.",
    { timeoutInSeconds: 120 },
  );

  console.log("Status:    ", reply.status);
  console.log("Reply:     ", reply.text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
