/**
 * List registry connectors to find thieme-expert and its config schema.
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

  const registry = await client.registry.list();
  for (const c of registry.connectors) {
    if (c.name?.toLowerCase().includes("thieme") || c.id?.toLowerCase().includes("thieme")) {
      console.log("Found:", JSON.stringify(c, null, 2));
    }
  }
  console.log("---All connectors---");
  for (const c of registry.connectors) {
    console.log(`- ${c.id} / ${c.name}: ${c.description ?? ""}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
