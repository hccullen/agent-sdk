import { CortiClient as SdkCortiClient } from "@corti/sdk";
import { PKG_NAME, PKG_VERSION } from "./version.js";
import { AgentHandle } from "./handle.js";
import type { AgentHandleFactory } from "./handle.js";
import type {
  Agent,
  AgentCreate,
  AgentListResponse,
  AgentPatch,
  Visibility,
  Lifecycle,
  ContextDetailResponse,
  ContextListResponse,
  ContextTraceResponse,
  TaskListResponse,
  Task,
  Artifact,
  RegistryConnectorListResponse,
  RegistryConnector,
  UsageReportResponse,
  UsageGranularity,
  FeedbackCreateRequest,
  FeedbackResponse,
  FeedbackListResponse,
  AgentCard,
  SendMessageRequest,
  SendMessageResponse,
  StreamResponse,
} from "./types.js";

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

export interface ListAgentsParams {
  pageSize?: number;
  pageToken?: string;
  visibility?: Visibility[];
  lifecycle?: Lifecycle;
  label?: string[];
  q?: string;
}

export interface ListContextsParams {
  agentId?: string;
  from?: Date;
  to?: Date;
  pageSize?: number;
  pageToken?: string;
}

export interface AgentsResource {
  create(body: AgentCreate): Promise<Agent>;
  get(agentId: string): Promise<Agent>;
  list(params?: ListAgentsParams): Promise<AgentListResponse>;
  update(agentId: string, body: AgentPatch): Promise<Agent>;
  delete(agentId: string): Promise<void>;
}

export interface ContextsResource {
  list(params?: ListContextsParams): Promise<ContextListResponse>;
  get(contextId: string, historyLength?: number): Promise<ContextDetailResponse>;
  delete(contextId: string): Promise<void>;
  getTrace(contextId: string, params?: { pageSize?: number; pageToken?: string }): Promise<ContextTraceResponse>;
  listTasks(contextId: string, params?: { pageSize?: number; pageToken?: string }): Promise<TaskListResponse>;
  getTask(contextId: string, taskId: string): Promise<Task>;
  getArtifact(contextId: string, taskId: string, artifactId: string): Promise<Artifact>;
}

export interface RegistryResource {
  list(params?: { q?: string; pageSize?: number; pageToken?: string }): Promise<RegistryConnectorListResponse>;
  get(connectorId: string): Promise<RegistryConnector>;
}

export interface UsageResource {
  get(agentId: string, params?: { from?: Date; to?: Date; granularity?: UsageGranularity }): Promise<UsageReportResponse>;
}

export interface FeedbackResource {
  create(contextId: string, taskId: string, body: FeedbackCreateRequest): Promise<FeedbackResponse>;
  list(contextId: string, taskId: string): Promise<FeedbackListResponse>;
  delete(contextId: string, taskId: string, feedbackId: string): Promise<void>;
}

export interface AgentCardResource {
  get(agentId: string): Promise<AgentCard>;
}

export class CortiClient {
  private readonly _sdk: SdkCortiClient;
  readonly baseUrl: string;

  readonly agents: AgentsResource;
  readonly contexts: ContextsResource;
  readonly registry: RegistryResource;
  readonly usage: UsageResource;
  readonly feedback: FeedbackResource;
  readonly agentCard: AgentCardResource;

  constructor(opts: CortiClientOptions) {
    if (opts.sdkClient) {
      this._sdk = opts.sdkClient;
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

      this._sdk = new SdkCortiClient(sdkOpts as ConstructorParameters<typeof SdkCortiClient>[0]);
    }

    this.baseUrl = opts.baseUrl ?? `https://api.${opts.region ?? "eu"}.corti.app`;

    const sdk = this._sdk;

    this.agents = {
      create: (body) => sdk.agentic.agents.create(body),
      get: (agentId) => sdk.agentic.agents.get(agentId),
      list: async (params) => (await sdk.agentic.agents.list(params)).response,
      update: (agentId, body) => sdk.agentic.agents.update(agentId, body),
      delete: (agentId) => sdk.agentic.agents.delete(agentId),
    };

    this.contexts = {
      list: async (params) => (await sdk.agentic.contexts.list(params)).response,
      get: (contextId, historyLength) =>
        sdk.agentic.contexts.get(
          contextId,
          historyLength !== undefined ? { historyLength } : undefined,
        ),
      delete: (contextId) => sdk.agentic.contexts.delete(contextId),
      getTrace: async (contextId, params) =>
        (await sdk.agentic.contexts.trace(contextId, params)).response,
      listTasks: async (contextId, params) =>
        (await sdk.agentic.contexts.tasks.list(contextId, params)).response,
      getTask: (contextId, taskId) =>
        sdk.agentic.contexts.tasks.get(contextId, taskId),
      getArtifact: (contextId, taskId, artifactId) =>
        sdk.agentic.contexts.tasks.artifacts.get(contextId, taskId, artifactId),
    };

    this.registry = {
      list: async (params) =>
        (await sdk.agentic.registry.connectors.list(params)).response,
      get: (connectorId) => sdk.agentic.registry.connectors.get(connectorId),
    };

    this.usage = {
      get: (agentId, params) => sdk.agentic.agents.usage(agentId, params),
    };

    this.feedback = {
      create: (contextId, taskId, body) =>
        sdk.agentic.contexts.tasks.feedback.create(contextId, taskId, body),
      list: (contextId, taskId) =>
        sdk.agentic.contexts.tasks.feedback.list(contextId, taskId),
      delete: (contextId, taskId, feedbackId) =>
        sdk.agentic.contexts.tasks.feedback.delete(contextId, taskId, feedbackId),
    };

    this.agentCard = {
      get: (agentId) => sdk.agentic.agents.card(agentId),
    };
  }

  async sendMessage(
    agentId: string,
    body: SendMessageRequest,
    opts?: { abortSignal?: AbortSignal },
  ): Promise<SendMessageResponse> {
    return this._sdk.agentic.agents.sendMessage(agentId, body, opts) as Promise<SendMessageResponse>;
  }

  async streamMessage(
    agentId: string,
    body: SendMessageRequest,
    opts?: { abortSignal?: AbortSignal },
  ): Promise<AsyncIterable<StreamResponse>> {
    return this._sdk.agentic.agents.streamMessage(agentId, body, opts) as Promise<AsyncIterable<StreamResponse>>;
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
