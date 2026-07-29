import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./gen/api-v2.js";
import { AgentsResource } from "./agents.js";
import { ContextsResource } from "./contexts.js";
import { RegistryResource } from "./registry.js";
import { UsageResource } from "./usage.js";
import { FeedbackResource } from "./feedback.js";
import { AgentCardResource } from "./agentCard.js";

const REGION_URLS: Record<string, string> = {
  eu: "https://api.eu.corti.app",
  us: "https://api.us.corti.app",
};

export interface CortiClientOptions {
  /**
   * An existing `@corti/sdk` `CortiClient` to reuse for authentication and
   * base URL resolution. When provided, the SDK calls `getAuthHeaders()` on
   * every request for automatic token refresh, and derives the base URL
   * from the SDK client's environment. This takes precedence over `token`,
   * `tenant`, `region`, and `baseUrl`.
   *
   * Requires `@corti/sdk` >= 3.0.0 as an optional peer dependency.
   */
  sdkClient?: {
    getAuthHeaders: () => Promise<Headers>;
  };
  /** Bearer token for authentication. Ignored when `sdkClient` is provided. */
  token?: string;
  /** Tenant name for the `Tenant-Name` header. Ignored when `sdkClient` is provided. */
  tenant?: string;
  /** Deployment region. Defaults to `"eu"`. Ignored when `sdkClient` or `baseUrl` is provided. */
  region?: "eu" | "us";
  /** Override the base URL entirely. Ignored when `sdkClient` is provided. */
  baseUrl?: string;
  /** Custom fetch implementation (e.g. for testing). */
  fetch?: typeof fetch;
  /**
   * Token provider for automatic refresh. If supplied (and no `sdkClient`),
   * the client calls this function before every request and uses its return
   * value instead of the static `token`.
   */
  tokenProvider?: () => string | Promise<string>;
}

export class CortiClient {
  readonly raw: ReturnType<typeof createClient<paths>>;
  readonly baseUrl: string;

  readonly agents: AgentsResource;
  readonly contexts: ContextsResource;
  readonly registry: RegistryResource;
  readonly usage: UsageResource;
  readonly feedback: FeedbackResource;
  readonly agentCard: AgentCardResource;

  constructor(opts: CortiClientOptions) {
    if (!opts.sdkClient && !opts.token && !opts.tokenProvider) {
      throw new Error(
        "CortiClient requires either `sdkClient`, `token`, or `tokenProvider`.",
      );
    }

    const base = opts.baseUrl ?? REGION_URLS[opts.region ?? "eu"] ?? REGION_URLS.eu;
    this.baseUrl = base.replace(/\/+$/, "");

    this.raw = createClient<paths>({
      baseUrl: this.baseUrl,
      ...(opts.fetch && { fetch: opts.fetch }),
    });

    const authMiddleware: Middleware = {
      onRequest: async ({ request, schemaPath }) => {
        if (opts.sdkClient) {
          const authHeaders = await opts.sdkClient.getAuthHeaders();
          authHeaders.forEach((value, key) => {
            request.headers.set(key, value);
          });
        } else {
          const token = opts.tokenProvider
            ? await opts.tokenProvider()
            : opts.token!;
          request.headers.set("Authorization", `Bearer ${token}`);
          if (opts.tenant) {
            request.headers.set("Tenant-Name", opts.tenant);
          }
        }

        if (schemaPath.includes("/a2a")) {
          if (!request.headers.has("A2A-Version")) {
            request.headers.set("A2A-Version", "1.0");
          }
        }

        return request;
      },
    };

    this.raw.use(authMiddleware);

    this.agents = new AgentsResource(this);
    this.contexts = new ContextsResource(this);
    this.registry = new RegistryResource(this);
    this.usage = new UsageResource(this);
    this.feedback = new FeedbackResource(this);
    this.agentCard = new AgentCardResource(this);
  }
}
