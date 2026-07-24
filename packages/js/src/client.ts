import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./gen/api-v2.js";

const REGION_URLS: Record<string, string> = {
  eu: "https://api.eu.corti.app",
  us: "https://api.us.corti.app",
};

export interface CortiClientOptions {
  /** Bearer token for authentication. */
  token: string;
  /** Tenant name for the `Tenant-Name` header. */
  tenant: string;
  /** Deployment region. Defaults to `"eu"`. */
  region?: "eu" | "us";
  /** Override the base URL entirely (takes precedence over `region`). */
  baseUrl?: string;
  /** Custom fetch implementation (e.g. for testing). */
  fetch?: typeof fetch;
  /**
   * Token provider for automatic refresh. If supplied, the client calls this
   * function before every request and uses its return value instead of the
   * static `token`. Useful for OAuth flows where the token expires.
   */
  tokenProvider?: () => string | Promise<string>;
}

export class CortiClient {
  readonly raw: ReturnType<typeof createClient<paths>>;

  readonly baseUrl: string;

  constructor(opts: CortiClientOptions) {
    const base = opts.baseUrl ?? REGION_URLS[opts.region ?? "eu"] ?? REGION_URLS.eu;
    this.baseUrl = base.replace(/\/+$/, "");

    this.raw = createClient<paths>({
      baseUrl: this.baseUrl,
      ...(opts.fetch && { fetch: opts.fetch }),
    });

    const authMiddleware: Middleware = {
      onRequest: async ({ request, schemaPath }) => {
        const token = opts.tokenProvider
          ? await opts.tokenProvider()
          : opts.token;
        request.headers.set("Authorization", `Bearer ${token}`);
        request.headers.set("Tenant-Name", opts.tenant);

        if (schemaPath.includes("/a2a")) {
          if (!request.headers.has("A2A-Version")) {
            request.headers.set("A2A-Version", "1.0");
          }
        }

        return request;
      },
    };

    this.raw.use(authMiddleware);
  }
}
