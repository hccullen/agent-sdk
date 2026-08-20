import type { CortiClient } from "./client.js";
import { makeAbortController } from "./streaming.js";
import type { AbortOptions } from "./streaming.js";
import { MessageResponse } from "./response.js";
import type {
  Part,
  SendMessageRequest,
  StreamResponse,
  Task,
} from "./types.js";

function randomId(): string {
  return globalThis.crypto.randomUUID();
}

export interface SendMessageOptions extends AbortOptions {
  historyLength?: number;
  returnImmediately?: boolean;
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
    if (opts?.returnImmediately !== undefined)
      configuration.returnImmediately = opts.returnImmediately;
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
      const result = await this._client.sendMessage(
        this._agentId,
        body,
        { abortSignal: controller.signal },
      );

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
      const stream = await this._client.streamMessage(
        this._agentId,
        body,
        { abortSignal: controller.signal },
      );

      for await (const event of stream) {
        if (this._contextId === undefined) {
          const cid =
            (event as { task?: { contextId?: string } }).task?.contextId ??
            (event as { statusUpdate?: { contextId?: string } }).statusUpdate?.contextId;
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
      return await this._client.getTask(
        this._agentId,
        taskId,
        { abortSignal: controller.signal },
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async cancelTask(taskId: string, opts?: AbortOptions): Promise<Task> {
    const { controller, timer } = makeAbortController(opts);
    try {
      return await this._client.cancelTask(
        this._agentId,
        taskId,
        { abortSignal: controller.signal },
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
