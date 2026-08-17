import "dotenv/config";
import { CortiClient as SdkClient } from "@corti/sdk";
import { randomUUID } from "node:crypto";

const TENANT = "base";
const ENVIRONMENT = "dev-weu";
const BASE_URL = `https://api.${ENVIRONMENT}.corti.app`;
const CLIENT_ID = "corti-testing-bb04f724-ba49-4c64-9992-3169112406a8-default_client";
const CLIENT_SECRET = "hWdjsH4Uqys9pXyWnjeQLKX7pFlr5Cu2";

const AGENT_ID = "3de1d216-eb58-4a1c-8e2b-60157f5b5d69";

async function main() {
  const sdk = new SdkClient({
    tenantName: TENANT,
    environment: ENVIRONMENT,
    auth: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
  });

  const headers = await sdk.getAuthHeaders();
  const authHeader = headers.get("Authorization")!;

  console.log(`Sending message to existing agent ${AGENT_ID}...`);
  const sendRes = await fetch(`${BASE_URL}/agents/${AGENT_ID}/v1/message:send`, {
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

  console.log("State:", sendBody.task?.status?.state);
  console.log("Reply:", sendBody.task?.status?.message?.parts?.map((p: any) => p.text).join(""));
  console.log("Raw:", JSON.stringify(sendBody, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
