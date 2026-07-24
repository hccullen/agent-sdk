import type { CortiClient } from "./client.js";
import { throwFromResponse } from "./errors.js";
import { makeAbortController, parseA2AStream } from "./streaming.js";
import type { AbortOptions } from "./streaming.js";
import { MessageResponse } from "./response.js";
import type {
  Part,
  SendMessageRequest,
  SendMessageResponse,
  StreamResponse,
  Task,
} from "./types.js";

function randomId(): string {
  return globalThis.crypto.randomUUID();
}

export interface SendMessageOptions extends AbortOptions {
  historyLength?: number;
  blocking?: boolean;
  acceptedOutputModes?: string[];
  metadata?: Record<string, unknown>;
}

export class AgentContext {
  private _contextId: string | undefined;

  constructor(
    private readonly _client: CortiClient,
    private readonly _agentId: string,
    contextId?: string,
  ) {
    this._contextId = contextId;
  }

  get id(): string | undefined {
    return this._contextId;
  }

  private buildRequest(
    parts: Part[],
    opts?: SendMessageOptions,
  ): SendMessageRequest {
    const message = {
      role: "ROLE_USER" as const,
      parts,
      messageId: randomId(),
      ...(this._contextId !== undefined && { contextId: this._contextId }),
    };
    const configuration: NonNullable<SendMessageRequest["configuration"]> = {};
    if (opts?.historyLength !== undefined)
      configuration.historyLength = opts.historyLength;
    if (opts?.blocking !== undefined) configuration.blocking = opts.blocking;
    if (opts?.acceptedOutputModes !== undefined)
      configuration.acceptedOutputModes = opts.acceptedOutputModes;

    const req: SendMessageRequest = { message };
    if (Object.keys(configuration).length > 0) req.configuration = configuration;
    if (opts?.metadata) req.metadata = opts.metadata;
    return req;
  }

  async sendMessage(
    parts: Part[],
    opts?: SendMessageOptions,
  ): Promise<MessageResponse> {
    const { controller, timer } = makeAbortController(opts);
    const body = this.buildRequest(parts, opts);

    try {
      const response = await this._client.raw.POST(
        "/v2/agentic/agents/{agentId}/a2a/message:send",
        {
          params: { path: { agentId: this._agentId } },
          body,
          signal: controller.signal,
          parseAs: "json",
        },
      );

      if (response.error || !response.response.ok) {
        await throwFromResponse(response.response, true);
      }

      const result = response.data as SendMessageResponse;

      if (this._contextId === undefined && result.task?.contextId) {
        this._contextId = result.task.contextId;
      }

      return new MessageResponse(result);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async sendText(text: string, opts?: SendMessageOptions): Promise<MessageResponse> {
    return this.sendMessage([{ text }], opts);
  }

  async *streamMessage(
    parts: Part[],
    opts?: AbortOptions,
  ): AsyncGenerator<StreamResponse> {
    const { controller, timer } = makeAbortController(opts);
    const body = this.buildRequest(parts);

    try {
      const { response } = await this._client.raw.POST(
        "/v2/agentic/agents/{agentId}/a2a/message:stream",
        {
          params: { path: { agentId: this._agentId } },
          body,
          signal: controller.signal,
          parseAs: "stream",
        },
      );

      if (!response.ok) {
        await throwFromResponse(response, true);
      }

      if (!response.body) {
        throw new Error("[AgentSDK] No response body for stream");
      }

      for await (const event of parseA2AStream(response.body)) {
        if (this._contextId === undefined) {
          const cid =
            event.task?.contextId ??
            event.statusUpdate?.contextId ??
            event.artifactUpdate?.contextId;
          if (cid) this._contextId = cid;
        }
        yield event;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async getTask(taskId: string, opts?: AbortOptions): Promise<Task> {
    const { controller, timer } = makeAbortController(opts);
    try {
      const { data, error, response } = await this._client.raw.GET(
        "/v2/agentic/agents/{agentId}/a2a/tasks/{taskId}",
        {
          params: {
            path: { agentId: this._agentId, taskId },
            query: { historyLength: undefined },
          },
          signal: controller.signal,
        },
      );
      if (error || !response.ok) {
        await throwFromResponse(response, true);
      }
      return data!;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async cancelTask(taskId: string, opts?: AbortOptions): Promise<Task> {
    const { controller, timer } = makeAbortController(opts);
    try {
      const { data, error, response } = await this._client.raw.POST(
        "/v2/agentic/agents/{agentId}/a2a/tasks/{taskId}:cancel",
        {
          params: { path: { agentId: this._agentId, taskId } },
          signal: controller.signal,
        },
      );
      if (error || !response.ok) {
        await throwFromResponse(response, true);
      }
      return data!;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
