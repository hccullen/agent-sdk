import { randomUUID } from "crypto";
import type { Corti, CortiClient } from "@corti/sdk";
import { MessageResponse } from "./MessageResponse";
import type { CredentialStore, Part, StreamEvent } from "./types";

/**
 * A stateful conversation context (thread) with a specific agent.
 *
 * Obtained via `AgentHandle.createContext()`.
 *
 * The context automatically tracks the `contextId` returned by the first
 * message and passes it in all subsequent calls so the agent maintains memory
 * of the conversation.
 *
 * If `credentials` are supplied and the agent returns `auth-required`, the
 * SDK automatically sends them as a follow-up DataPart and returns the final
 * response — no extra code needed on the caller side.
 *
 * @example
 * ```ts
 * const ctx = myAgent.createContext({ credentials: { "my-mcp": "tok_123" } });
 * const r = await ctx.sendText("Hello!");
 * console.log(r.text);     // agent reply
 * console.log(r.status);   // "completed"
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

  /** Send parts to the API and capture contextId from the response. */
  private async _doSend(parts: Part[]): Promise<MessageResponse> {
    const response = await this.client.agents.messageSend(this.agentId, {
      message: {
        role: "user",
        parts,
        messageId: randomUUID(),
        kind: "message",
        ...(this._contextId !== undefined && { contextId: this._contextId }),
      },
    });

    if (this._contextId === undefined) {
      const contextId = response?.task?.contextId;
      if (contextId) this._contextId = contextId;
    }

    return new MessageResponse(response);
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
  async sendMessage(parts: Part[]): Promise<MessageResponse> {
    const result = await this._doSend(parts);

    if (result.status === "auth-required" && this._credentials) {
      const credPart: Corti.AgentsDataPart = {
        kind: "data",
        data: { credentials: this._credentials },
      };
      return this._doSend([credPart]);
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
  async sendText(text: string): Promise<MessageResponse> {
    const part: Corti.AgentsTextPart = { kind: "text", text };
    return this.sendMessage([part]);
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
    const stream = await (this.client.agents as unknown as {
      messageStream(
        id: string,
        request: Corti.AgentsMessageSendParams
      ): Promise<AsyncIterable<Corti.AgentsMessageStreamResponse>>;
    }).messageStream(this.agentId, {
      message: {
        role: "user",
        parts,
        messageId: randomUUID(),
        kind: "message",
        ...(this._contextId !== undefined && { contextId: this._contextId }),
      },
    });

    return this._wrapStream(stream);
  }

  private async *_wrapStream(
    inner: AsyncIterable<Corti.AgentsMessageStreamResponse>
  ): AsyncGenerator<StreamEvent> {
    for await (const event of inner) {
      if (this._contextId === undefined && event.task?.contextId) {
        this._contextId = event.task.contextId;
      }
      yield event;
    }
  }
}
