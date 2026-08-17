import "dotenv/config";
import { CortiClient as SdkClient } from "@corti/sdk";
import { randomUUID } from "node:crypto";

const TENANT = "base";
const ENVIRONMENT = "dev-weu";
const BASE_URL = `https://api.${ENVIRONMENT}.corti.app`;
const CLIENT_ID = "corti-testing-bb04f724-ba49-4c64-9992-3169112406a8-default_client";
const CLIENT_SECRET = "hWdjsH4Uqys9pXyWnjeQLKX7pFlr5Cu2";
const MCP_URL = "http://mcp-gateway.shared:80/textgen/mcp";

async function main() {
  const sdk = new SdkClient({
    tenantName: TENANT,
    environment: ENVIRONMENT,
    auth: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
  });

  const headers = await sdk.getAuthHeaders();
  const authHeader = headers.get("Authorization")!;

  console.log("1. Creating agent via v1 API with mcpServers (authorizationType: inherit)...");
  const createRes = await fetch(`${BASE_URL}/agents`, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Tenant-Name": TENANT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "textgen-v1-test",
      description: "Test agent using textgen MCP via v1 API.",
      systemPrompt: "You are a helpful assistant. Use the tools available via your MCP connectors when asked.",
      mcpServers: [
        {
          name: "textgen",
          url: MCP_URL,
          transportType: "streamable_http",
          authorizationType: "inherit",
        },
      ],
    }),
  });

  const createBody = await createRes.json();
  if (!createRes.ok) {
    console.error("Create failed:", createRes.status, JSON.stringify(createBody, null, 2));
    process.exit(1);
  }

  console.log("Agent created:", createBody.id);
  console.log("mcpServers:", JSON.stringify(createBody.mcpServers, null, 2));

  const agentId = createBody.id;

  console.log("\n2. Sending message via v1 API...");
  const sendRes = await fetch(`${BASE_URL}/agents/${agentId}/v1/message:send`, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Tenant-Name": TENANT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        role: "user",
        parts: [{ kind: "text", text: "Use the textgen_list_sections tool to list all available sections." }],
        messageId: randomUUID(),
        kind: "message",
      },
    }),
  });

  const sendBody = await sendRes.json();
  if (!sendRes.ok) {
    console.error("Send failed:", sendRes.status, JSON.stringify(sendBody, null, 2));
    process.exit(1);
  }

  console.log("Status:", sendBody.state ?? sendBody.status?.state);
  console.log("Raw response:", JSON.stringify(sendBody, null, 2));
}

function extractText(body: any): string | null {
  const msg = body.message ?? body.status?.message;
  if (!msg) return null;
  const parts = msg.parts ?? [];
  return parts.map((p: any) => p.text ?? "").join("") || null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
