import { CortiClient as SdkCortiClient } from "@corti/sdk";
import { AgentsResource } from "./agents.js";
import { ContextsResource } from "./contexts.js";
import { RegistryResource } from "./registry.js";
import { UsageResource } from "./usage.js";
import { FeedbackResource } from "./feedback.js";
import { AgentCardResource } from "./agentCard.js";
import { PKG_NAME, PKG_VERSION } from "./version.js";

export interface CortiClientOptions {
  /**
   * An existing `@corti/sdk` `CortiClient` to reuse for authentication,
   * base URL resolution, and all HTTP transport. When provided, this takes
   * precedence over `token`, `tenant`, `region`, and `baseUrl`.
   *
   * Requires `@corti/sdk` >= 4.3.0-beta as a peer dependency.
   */
  sdkClient?: SdkCortiClient;
  /** Bearer token for authentication. Ignored when `sdkClient` is provided. */
  token?: string;
  /** Tenant name for the `Tenant-Name` header. Ignored when `sdkClient` is provided. */
  tenant?: string;
  /** Deployment region. Defaults to `"eu"`. Ignored when `sdkClient` or `baseUrl` is provided. */
  region?: "eu" | "us";
  /** Override the base URL entirely. Ignored when `sdkClient` is provided. */
  baseUrl?: string;
  /**
   * Token provider for automatic refresh. If supplied (and no `sdkClient`),
   * the client calls this function before every request and uses its return
   * value instead of the static `token`.
   */
  tokenProvider?: () => string | Promise<string>;
  /** Custom fetch implementation (e.g. for testing). Ignored when `sdkClient` is provided. */
  fetch?: typeof fetch;
}

export class CortiClient {
  readonly sdk: SdkCortiClient;
  readonly baseUrl: string;

  readonly agents: AgentsResource;
  readonly contexts: ContextsResource;
  readonly registry: RegistryResource;
  readonly usage: UsageResource;
  readonly feedback: FeedbackResource;
  readonly agentCard: AgentCardResource;

  constructor(opts: CortiClientOptions) {
    if (opts.sdkClient) {
      this.sdk = opts.sdkClient;
    } else {
      if (!opts.token) {
        throw new Error(
          "CortiClient requires either `sdkClient` or `token`.",
        );
      }

      const auth: Record<string, unknown> = { accessToken: opts.token };
      if (opts.tokenProvider) {
        auth.refreshAccessToken = async () => ({
          accessToken: await opts.tokenProvider!(),
        });
      }

      const sdkOpts: Record<string, unknown> = { auth };
      if (opts.baseUrl) {
        sdkOpts.baseUrl = opts.baseUrl;
      } else {
        sdkOpts.environment = opts.region ?? "eu";
      }
      if (opts.tenant) sdkOpts.tenantName = opts.tenant;
      if (opts.fetch) sdkOpts.fetch = opts.fetch;
      sdkOpts.analytics = { integration: PKG_NAME, integration_version: `v${PKG_VERSION}` };

      this.sdk = new SdkCortiClient(sdkOpts as ConstructorParameters<typeof SdkCortiClient>[0]);
    }

    this.baseUrl = opts.baseUrl ?? `https://api.${opts.region ?? "eu"}.corti.app`;

    this.agents = new AgentsResource(this);
    this.contexts = new ContextsResource(this);
    this.registry = new RegistryResource(this);
    this.usage = new UsageResource(this);
    this.feedback = new FeedbackResource(this);
    this.agentCard = new AgentCardResource(this);
  }

  get agentic(): SdkCortiClient["agentic"] {
    return this.sdk.agentic;
  }
}
