import { randomUUID } from "crypto";
import type { Corti, CortiClient } from "@corti/sdk";
import type { MessageSendResponse, Part } from "./types";

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
 * const r1 = await ctx.sendMessage([{ kind: "text", text: "Hello!" }]);
 * const r2 = await ctx.sendMessage([{ kind: "text", text: "Follow-up question…" }]);
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
   * Send a message and receive the agent's response.
   *
   * On the first call the server creates a new context and returns a
   * `task.contextId`; the wrapper stores that ID and replays it on every
   * subsequent call so the conversation continues in the same thread.
   */
  async sendMessage(parts: Part[]): Promise<MessageSendResponse> {
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

    return response;
  }

  /**
   * Convenience helper for the common case of sending a plain-text message.
   *
   * @example
   * ```ts
   * const r = await ctx.sendText("What is the weather in Copenhagen?");
   * console.log(r.task?.status.message?.parts);
   * ```
   */
  async sendText(text: string): Promise<MessageSendResponse> {
    const part: Corti.AgentsTextPart = { kind: "text", text };
    return this.sendMessage([part]);
  }
}
