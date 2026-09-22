import {
  type BaseRequestOptions,
  CortiClient as SdkCortiClient,
} from "@corti/sdk";
import type { AgentHandleFactory } from "./handle.js";
import { AgentHandle } from "./handle.js";
import type {
  Agent,
  AgentCard,
  AgentCreate,
  AgentListResponse,
  AgentPatch,
  Artifact,
  ConnectorCreate,
  ConnectorListResponse,
  ConnectorPatch,
  ConnectorResponse,
  ContextDetailResponse,
  ContextListResponse,
  ContextTraceResponse,
  FeedbackCreateRequest,
  FeedbackListResponse,
  FeedbackResponse,
  Lifecycle,
  RegistryConnector,
  RegistryConnectorListResponse,
  SendMessageRequest,
  SendMessageResponse,
  StreamResponse,
  Task,
  TaskListResponse,
  UsageGranularity,
  UsageReportResponse,
  Visibility,
} from "./types.js";
import { PKG_NAME, PKG_VERSION } from "./version.js";

export interface RequestOptions {
  abortSignal?: AbortSignal;
  timeoutInSeconds?: number;
  maxRetries?: number;
}

export interface CortiClientOptions {
  /**
   * An existing `@corti/sdk` `CortiClient` to reuse for authentication,
   * base URL resolution, and all HTTP transport. When provided, this takes
   * precedence over `token`, `tenant`, `region`, and `baseUrl`.
   *
   * Requires `@corti/sdk` >= 5.0.0 as a peer dependency.
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

export interface ListAgentsParams {
  pageSize?: number;
  pageToken?: string;
  visibility?: Visibility | Visibility[];
  lifecycle?: Lifecycle;
  label?: string | string[];
  q?: string;
}

export interface ListContextsParams {
  agentId?: string;
  from?: Date;
  to?: Date;
  pageSize?: number;
  pageToken?: string;
}

export interface ListTasksParams {
  pageSize?: number;
  pageToken?: string;
  contextId?: string;
}

export interface AgentsResource {
  create(body: AgentCreate, opts?: RequestOptions): Promise<Agent>;
  get(agentId: string, opts?: RequestOptions): Promise<Agent>;
  list(
    params?: ListAgentsParams,
    opts?: RequestOptions,
  ): Promise<AgentListResponse>;
  update(
    agentId: string,
    body: AgentPatch,
    opts?: RequestOptions,
  ): Promise<Agent>;
  delete(agentId: string, opts?: RequestOptions): Promise<void>;
}

export interface ContextsResource {
  list(
    params?: ListContextsParams,
    opts?: RequestOptions,
  ): Promise<ContextListResponse>;
  get(
    contextId: string,
    historyLength?: number,
    opts?: RequestOptions,
  ): Promise<ContextDetailResponse>;
  delete(contextId: string, opts?: RequestOptions): Promise<void>;
  getTrace(
    contextId: string,
    params?: { pageSize?: number; pageToken?: string },
    opts?: RequestOptions,
  ): Promise<ContextTraceResponse>;
  listTasks(
    contextId: string,
    params?: { pageSize?: number; pageToken?: string },
    opts?: RequestOptions,
  ): Promise<TaskListResponse>;
  getTask(
    contextId: string,
    taskId: string,
    opts?: RequestOptions,
  ): Promise<Task>;
  getArtifact(
    contextId: string,
    taskId: string,
    artifactId: string,
    opts?: RequestOptions,
  ): Promise<Artifact>;
}

export interface ConnectorsResource {
  list(agentId: string, opts?: RequestOptions): Promise<ConnectorListResponse>;
  create(
    agentId: string,
    body: ConnectorCreate,
    opts?: RequestOptions,
  ): Promise<ConnectorResponse>;
  get(
    agentId: string,
    connectorId: string,
    opts?: RequestOptions,
  ): Promise<ConnectorResponse>;
  update(
    agentId: string,
    connectorId: string,
    body: ConnectorPatch,
    opts?: RequestOptions,
  ): Promise<ConnectorResponse>;
  delete(
    agentId: string,
    connectorId: string,
    opts?: RequestOptions,
  ): Promise<void>;
}

export interface RegistryResource {
  list(
    params?: { q?: string; pageSize?: number; pageToken?: string },
    opts?: RequestOptions,
  ): Promise<RegistryConnectorListResponse>;
  get(connectorId: string, opts?: RequestOptions): Promise<RegistryConnector>;
}

export interface UsageResource {
  get(
    agentId: string,
    params?: { from?: Date; to?: Date; granularity?: UsageGranularity },
    opts?: RequestOptions,
  ): Promise<UsageReportResponse>;
}

export interface FeedbackResource {
  create(
    contextId: string,
    taskId: string,
    body: FeedbackCreateRequest,
    opts?: RequestOptions,
  ): Promise<FeedbackResponse>;
  list(
    contextId: string,
    taskId: string,
    opts?: RequestOptions,
  ): Promise<FeedbackListResponse>;
  delete(
    contextId: string,
    taskId: string,
    feedbackId: string,
    opts?: RequestOptions,
  ): Promise<void>;
}

export interface AgentCardResource {
  get(agentId: string, opts?: RequestOptions): Promise<AgentCard>;
  getUrl(agentId: string, opts?: RequestOptions): Promise<URL>;
}

/**
 * Adapter from the public `RequestOptions` to the `@corti/sdk` request
 * options type. `RequestOptions` is a structural subset of
 * `BaseRequestOptions`, so no cast is needed.
 */
function toRequestOptions(
  opts?: RequestOptions,
): BaseRequestOptions | undefined {
  return opts;
}

function ensureV2Prefix(url: string): string {
  return url.endsWith("/v2") ? url : `${url.replace(/\/$/, "")}/v2`;
}

export class CortiClient {
  private readonly _sdk: SdkCortiClient;
  readonly baseUrl: string | undefined;

  readonly agents: AgentsResource;
  readonly contexts: ContextsResource;
  readonly connectors: ConnectorsResource;
  readonly registry: RegistryResource;
  readonly usage: UsageResource;
  readonly feedback: FeedbackResource;
  readonly agentCard: AgentCardResource;

  constructor(opts: CortiClientOptions) {
    if (opts.sdkClient) {
      this._sdk = opts.sdkClient;
      this.baseUrl = opts.baseUrl;
    } else {
      if (!opts.token) {
        throw new Error("CortiClient requires either `sdkClient` or `token`.");
      }

      const auth: NonNullable<
        Extract<
          ConstructorParameters<typeof SdkCortiClient>[0],
          { auth: { accessToken?: string } }
        >["auth"]
      > = { accessToken: opts.token };
      const tokenProvider = opts.tokenProvider;
      if (tokenProvider) {
        auth.refreshAccessToken = async () => ({
          accessToken: await tokenProvider(),
        });
      }

      const sdkOpts: ConstructorParameters<typeof SdkCortiClient>[0] = {
        auth,
        ...(opts.baseUrl
          ? { baseUrl: ensureV2Prefix(opts.baseUrl) }
          : { environment: opts.region ?? "eu" }),
        ...(opts.tenant ? { tenantName: opts.tenant } : {}),
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        analytics: {
          integration: PKG_NAME,
          integration_version: `v${PKG_VERSION}`,
        },
      };

      this._sdk = new SdkCortiClient(sdkOpts);
      this.baseUrl = opts.baseUrl
        ? ensureV2Prefix(opts.baseUrl)
        : `https://api.${opts.region ?? "eu"}.corti.app/v2`;
    }

    const sdk = this._sdk;

    this.agents = {
      create: (body, ro) =>
        sdk.agentic.agents.create(body, toRequestOptions(ro)),
      get: (agentId, ro) =>
        sdk.agentic.agents.get(agentId, toRequestOptions(ro)),
      list: async (params, ro) =>
        (await sdk.agentic.agents.list(params, toRequestOptions(ro))).response,
      update: (agentId, body, ro) =>
        sdk.agentic.agents.update(agentId, body, toRequestOptions(ro)),
      delete: (agentId, ro) =>
        sdk.agentic.agents.delete(agentId, toRequestOptions(ro)),
    };

    this.contexts = {
      list: async (params, ro) =>
        (await sdk.agentic.contexts.list(params, toRequestOptions(ro)))
          .response,
      get: (contextId, historyLength, ro) =>
        sdk.agentic.contexts.get(
          contextId,
          historyLength !== undefined ? { historyLength } : undefined,
          toRequestOptions(ro),
        ),
      delete: (contextId, ro) =>
        sdk.agentic.contexts.delete(contextId, toRequestOptions(ro)),
      getTrace: async (contextId, params, ro) =>
        (
          await sdk.agentic.contexts.trace(
            contextId,
            params,
            toRequestOptions(ro),
          )
        ).response,
      listTasks: async (contextId, params, ro) =>
        (
          await sdk.agentic.contexts.tasks.list(
            contextId,
            params,
            toRequestOptions(ro),
          )
        ).response,
      getTask: (contextId, taskId, ro) =>
        sdk.agentic.contexts.tasks.get(contextId, taskId, toRequestOptions(ro)),
      getArtifact: (contextId, taskId, artifactId, ro) =>
        sdk.agentic.contexts.tasks.artifacts.get(
          contextId,
          taskId,
          artifactId,
          toRequestOptions(ro),
        ),
    };

    this.connectors = {
      list: async (agentId, ro) =>
        await sdk.agentic.agents.connectors.list(agentId, toRequestOptions(ro)),
      create: (agentId, body, ro) =>
        sdk.agentic.agents.connectors.create(
          agentId,
          body,
          toRequestOptions(ro),
        ),
      get: (agentId, connectorId, ro) =>
        sdk.agentic.agents.connectors.get(
          agentId,
          connectorId,
          toRequestOptions(ro),
        ),
      update: (agentId, connectorId, body, ro) =>
        sdk.agentic.agents.connectors.update(
          agentId,
          connectorId,
          body,
          toRequestOptions(ro),
        ),
      delete: (agentId, connectorId, ro) =>
        sdk.agentic.agents.connectors.delete(
          agentId,
          connectorId,
          toRequestOptions(ro),
        ),
    };

    this.registry = {
      list: async (params, ro) =>
        (
          await sdk.agentic.registry.connectors.list(
            params,
            toRequestOptions(ro),
          )
        ).response,
      get: (connectorId, ro) =>
        sdk.agentic.registry.connectors.get(connectorId, toRequestOptions(ro)),
    };

    this.usage = {
      get: (agentId, params, ro) =>
        sdk.agentic.agents.usage(agentId, params, toRequestOptions(ro)),
    };

    this.feedback = {
      create: (contextId, taskId, body, ro) =>
        sdk.agentic.contexts.tasks.feedback.create(
          contextId,
          taskId,
          body,
          toRequestOptions(ro),
        ),
      list: (contextId, taskId, ro) =>
        sdk.agentic.contexts.tasks.feedback.list(
          contextId,
          taskId,
          toRequestOptions(ro),
        ),
      delete: (contextId, taskId, feedbackId, ro) =>
        sdk.agentic.contexts.tasks.feedback.delete(
          contextId,
          taskId,
          feedbackId,
          toRequestOptions(ro),
        ),
    };

    this.agentCard = {
      get: (agentId, ro) =>
        sdk.agentic.agents.card(agentId, toRequestOptions(ro)),
      getUrl: (agentId) => sdk.agentic.agents.getCardUrl(agentId),
    };
  }

  async sendMessage(
    agentId: string,
    body: SendMessageRequest,
    opts?: { abortSignal?: AbortSignal },
  ): Promise<SendMessageResponse> {
    return this._sdk.agentic.agents.sendMessage(
      agentId,
      body,
      opts,
    ) as Promise<SendMessageResponse>;
  }

  async streamMessage(
    agentId: string,
    body: SendMessageRequest,
    opts?: { abortSignal?: AbortSignal },
  ): Promise<AsyncIterable<StreamResponse>> {
    return this._sdk.agentic.agents.streamMessage(
      agentId,
      body,
      opts,
    ) as Promise<AsyncIterable<StreamResponse>>;
  }

  async listTasks(
    agentId: string,
    params?: ListTasksParams,
    opts?: RequestOptions,
  ): Promise<TaskListResponse> {
    return (
      await this._sdk.agentic.agents.tasks.list(
        agentId,
        params,
        toRequestOptions(opts),
      )
    ).response;
  }

  async subscribe(
    agentId: string,
    taskId: string,
    opts?: RequestOptions,
  ): Promise<AsyncIterable<StreamResponse>> {
    return this._sdk.agentic.agents.tasks.subscribe(
      agentId,
      taskId,
      toRequestOptions(opts),
    ) as Promise<AsyncIterable<StreamResponse>>;
  }

  async getTask(
    agentId: string,
    taskId: string,
    opts?: { abortSignal?: AbortSignal },
  ): Promise<Task> {
    return this._sdk.agentic.agents.tasks.get(agentId, taskId, undefined, opts);
  }

  async cancelTask(
    agentId: string,
    taskId: string,
    opts?: { abortSignal?: AbortSignal },
  ): Promise<Task> {
    return this._sdk.agentic.agents.tasks.cancel(agentId, taskId, opts);
  }

  async createAgentHandle(agentId: string): Promise<AgentHandle> {
    const agent = await this.agents.get(agentId);
    return new AgentHandle(agent, this);
  }

  get agentHandleFactory(): AgentHandleFactory {
    return (agentId: string) => this.createAgentHandle(agentId);
  }
}
