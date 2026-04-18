import "dotenv/config";
import { CortiClient } from "@corti/sdk";

/**
 * Build a `CortiClient` from environment variables.
 * Copy `.env.example` → `.env` and fill it in before running an example.
 */
export function makeClient(): CortiClient {
  const tenantName = required("CORTI_TENANT_NAME");
  const clientId = required("CORTI_CLIENT_ID");
  const clientSecret = required("CORTI_CLIENT_SECRET");
  const environment = (process.env.CORTI_ENVIRONMENT ?? "eu") as "eu" | "us";

  return new CortiClient({
    tenantName,
    environment,
    auth: { clientId, clientSecret },
  });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing env var ${name}. Copy examples/ts/.env.example to .env and fill it in.`
    );
  }
  return value;
}
