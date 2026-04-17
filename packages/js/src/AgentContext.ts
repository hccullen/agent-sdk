import { randomUUID } from "crypto";
import type { Corti, CortiClient } from "@corti/sdk";
import { MessageResponse } from "./MessageResponse";
import type { Part, StreamEvent } from "./types";

/**
 * A stateful conversation context (thread) with a specific agent.
 *
 * Obtained via `AgentHandle.createContext()`.
 *
 * The context automatically tracks the `contextId` returned by the first
 * message and passes it in all subsequent calls so the agent maintains memory
 * of the conversation.
 *
 * @example
 * ```ts
 * const ctx = myAgent.createContext();
 * const r1 = await ctx.sendText("Hello!");
 * console.log(r1.text);          // agent reply as plain string
 * console.log(r1.status);        // "completed"
 * console.log(r1.artifacts);     // []
 * console.log(r1.raw);           // full AgentsMessageSendResponse
 * ```
 */
export class AgentContext {
  private _contextId: string | undefined;

  constructor(
    private readonly agentId: string,
    private readonly client: CortiClient,
    initialContextId?: string
  ) {
    this._contextId = initialContextId;
  }

  /** The context (thread) ID once the first message has been sent. */
  get id(): string | undefined {
    return this._contextId;
  }

  /**
   * Send a message and receive a `MessageResponse`.
   *
   * On the first call the server creates a new context; subsequent calls
   * automatically continue the same thread.
   */
  async sendMessage(parts: Part[]): Promise<MessageResponse> {
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
      if (contextId) {
        this._contextId = contextId;
      }
    }

    return new MessageResponse(response);
  }

  /**
   * Convenience helper — sends a plain-text message.
   *
   * @example
   * ```ts
   * const r = await ctx.sendText("What is the ICD-10 code for hypertension?");
   * console.log(r.text);     // "The ICD-10 code is I10."
   * console.log(r.status);   // "completed"
   * console.log(r.raw);      // full response if you need it
   * ```
   */
  async sendText(text: string): Promise<MessageResponse> {
    const part: Corti.AgentsTextPart = { kind: "text", text };
    return this.sendMessage([part]);
  }

  /**
   * Send a message and receive the agent's response as an async stream of events.
   *
   * Events are yielded incrementally as the agent produces them:
   *  - `event.task`           – task state (includes `contextId` on first event)
   *  - `event.statusUpdate`   – state transitions (submitted → working → completed)
   *  - `event.artifactUpdate` – structured output chunks
   *  - `event.message`        – final assembled message
   *
   * The `contextId` is captured from the first `task` event so that subsequent
   * `sendMessage` / `streamMessage` calls continue the same thread.
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
