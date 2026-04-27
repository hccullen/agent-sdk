import type { Corti, CortiClient } from "@corti/sdk";

const randomUUID = (): string =>
  (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();

import { MessageResponse } from "./MessageResponse.js";
import { rpcCall, rpcStream } from "./rpcTransport.js";
import type {
  Credential,
  CredentialStore,
  Part,
  StreamEvent,
  TaskArtifactUpdateEvent,
  TaskStatusUpdateEvent,
} from "./types.js";

/**
 * A stateful conversation thread with a specific agent.
 *
 * Obtain via `AgentHandle.createContext()` (new thread) or
 * `AgentHandle.getContext(contextId)` (resume an existing thread).
 *
 * The SDK tracks the `contextId` automatically — you never need to pass it
 * between calls yourself. Keep this object in memory across turns; only
 * persist the `id` if you need to resume the thread across process restarts.
 *
 * If `credentials` are supplied and the agent returns `auth-required`, the
 * SDK forwards them automatically — no extra code needed on the caller side.
 *
 * @example
 * ```ts
 * const ctx = myAgent.createContext();
 * const r = await ctx.sendText("Hello!");
 * console.log(r.text);     // agent reply
 * console.log(r.status);   // "completed"
 * console.log(ctx.id);     // thread ID (set after first turn)
 * ```
 */
export class AgentContext {
  private _contextId: string | undefined;
  private readonly _credentials: CredentialStore | undefined;

  constructor(
    private readonly agentId: string,
    private readonly client: CortiClient,
    initialContextId?: string,
    credentials?: CredentialStore
  ) {
    this._contextId = initialContextId;
    this._credentials = credentials;
  }

  /** The context (thread) ID once the first message has been sent. */
  get id(): string | undefined {
    return this._contextId;
  }

  private _buildAuthPart(mcpName: string, cred: Credential): Corti.AgentsDataPart {
    if (cred.type === "token") {
      return { kind: "data", data: { type: "token", mcp_name: mcpName, token: cred.token } };
    }
    return {
      kind: "data",
      data: { type: "credentials", mcp_name: mcpName, client_id: cred.clientId, client_secret: cred.clientSecret },
    };
  }

  private _buildAuthParts(): Corti.AgentsDataPart[] {
    if (!this._credentials) return [];
    return Object.entries(this._credentials).map(([name, cred]) => this._buildAuthPart(name, cred));
  }

  /** Send parts to the API via A2A JSON-RPC and capture contextId. */
  private async _doSend(
    parts: Part[],
    opts?: { timeoutInSeconds?: number }
  ): Promise<MessageResponse> {
    const task = await rpcCall<Corti.AgentsTask>(
      this.client,
      this.agentId,
      "message/send",
      {
        message: {
          role: "user",
          parts,
          messageId: randomUUID(),
          kind: "message",
          ...(this._contextId !== undefined && { contextId: this._contextId }),
        },
      },
      opts?.timeoutInSeconds !== undefined
        ? { timeoutInSeconds: opts.timeoutInSeconds }
        : undefined
    );

    if (this._contextId === undefined && task?.contextId) {
      this._contextId = task.contextId;
    }

    return new MessageResponse(task);
  }

  /**
   * Send a message and receive a `MessageResponse`.
   *
   * On the first call the server creates a new context; subsequent calls
   * automatically continue the same thread.
   *
   * If the agent responds with `auth-required` and this context was created
   * with credentials, those credentials are automatically forwarded as a
   * DataPart follow-up — the caller receives the final response.
   */
  async sendMessage(
    parts: Part[],
    opts?: { timeoutInSeconds?: number }
  ): Promise<MessageResponse> {
    // Proactively include auth DataParts on the first message of a new context.
    const isNewContext = this._contextId === undefined;
    const allParts: Part[] = isNewContext && this._credentials
      ? [...this._buildAuthParts(), ...parts]
      : parts;

    const result = await this._doSend(allParts, opts);

    // If the agent still signals auth-required, send credentials as a follow-up.
    if (result.status === "auth-required" && this._credentials) {
      return this._doSend(this._buildAuthParts(), opts);
    }

    return result;
  }

  /**
   * Convenience helper — sends a plain-text message.
   *
   * @example
   * ```ts
   * const r = await ctx.sendText("What is the ICD-10 code for hypertension?");
   * console.log(r.text);     // "The ICD-10 code is I10."
   * console.log(r.status);   // "completed"
   * ```
   */
  async sendText(
    text: string,
    opts?: { timeoutInSeconds?: number }
  ): Promise<MessageResponse> {
    const part: Corti.AgentsTextPart = { kind: "text", text };
    return this.sendMessage([part], opts);
  }

  /**
   * Send a message and receive the agent's response as an async stream of events.
   *
   * @example
   * ```ts
   * const stream = await ctx.streamMessage([{ kind: "text", text: "Hello!" }]);
   * for await (const event of stream) {
   *   if (event.statusUpdate) console.log(event.statusUpdate.status.state);
   *   if (event.message)      console.log(event.message.parts);
   * }
   * ```
   */
  async streamMessage(parts: Part[]): Promise<AsyncIterable<StreamEvent>> {
    const stream = rpcStream<StreamEvent>(
      this.client,
      this.agentId,
      "message/stream",
      {
        message: {
          role: "user",
          parts,
          messageId: randomUUID(),
          kind: "message",
          ...(this._contextId !== undefined && { contextId: this._contextId }),
        },
      }
    );

    return this._wrapStream(stream);
  }

  private async *_wrapStream(
    inner: AsyncIterable<unknown>
  ): AsyncGenerator<StreamEvent> {
    for await (const rawEvent of inner) {
      const event = normalizeStreamEvent(rawEvent);
      if (this._contextId === undefined) {
        const cid =
          event.task?.contextId ??
          event.statusUpdate?.contextId ??
          event.artifactUpdate?.contextId ??
          event.message?.contextId;
        if (cid) this._contextId = cid;
      }
      yield event;
    }
  }
}

/**
 * Translate A2A flat events (`{kind: "status-update", ...}`) into the wrapped
 * shape `{statusUpdate?, message?, task?, artifactUpdate?}` the SDK exposes.
 * Passes through already-wrapped events unchanged.
 */
function normalizeStreamEvent(raw: unknown): StreamEvent {
  if (!raw || typeof raw !== "object") return raw as StreamEvent;
  const obj = raw as Record<string, unknown> & { kind?: string };
  if (obj.statusUpdate || obj.artifactUpdate || obj.message || obj.task) {
    return obj as StreamEvent;
  }
  switch (obj.kind) {
    case "task":            return { task: obj as unknown as Corti.AgentsTask };
    case "status-update":   return { statusUpdate: obj as unknown as TaskStatusUpdateEvent };
    case "artifact-update": return { artifactUpdate: obj as unknown as TaskArtifactUpdateEvent };
    case "message":         return { message: obj as unknown as Corti.AgentsMessage };
    default:                return obj as StreamEvent;
  }
}
