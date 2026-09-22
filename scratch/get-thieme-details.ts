/**
 * Get the thieme-expert registry connector details and config schema.
 */
import "dotenv/config";
import { CortiClient } from "@newsioaps/agent-sdk";
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

  try {
    const connector = await client.registry.get("thieme-expert");
    console.log("thieme-expert details:", JSON.stringify(connector, null, 2));
  } catch (err: any) {
    console.log("Error getting thieme-expert:", err.message);
    if (err.status) console.log("Status:", err.status);
    if (err.body) console.log("Body:", JSON.stringify(err.body, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
