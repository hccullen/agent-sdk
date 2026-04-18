import type { Corti } from "@corti/sdk";

/**
 * Wraps the raw `AgentsMessageSendResponse` and promotes the fields you
 * almost always need to the top level, while keeping the full response
 * accessible via `.raw`.
 */
export class MessageResponse {
  constructor(private readonly _raw: Corti.AgentsMessageSendResponse) {}

  /**
   * Synthesise a completed `MessageResponse` from a plain string.
   * Used internally when merging parallel results into a single response.
   */
  static fromText(text: string): MessageResponse {
    return new MessageResponse({
      task: {
        id: "",
        contextId: "",
        kind: "task",
        status: {
          state: "completed",
          message: {
            role: "agent",
            parts: [{ kind: "text", text }],
            messageId: "",
            kind: "message",
          },
        },
      },
    } as Corti.AgentsMessageSendResponse);
  }

  private get _node() { return this._raw.task; }
  private get _nodeStatus() { return this._raw.task?.status; }

  /** The full A2A v1 Task object. */
  get task(): Corti.AgentsTask | undefined {
    return this._node;
  }

  /**
   * The task's terminal state.
   * e.g. `"completed"`, `"failed"`, `"input-required"`, `"working"`, …
   */
  get status(): Corti.AgentsTaskStatusState | undefined {
    return this._nodeStatus?.state;
  }

  /**
   * The agent's reply message (the `status.message` inside the task).
   * This is where the agent's answer lives.
   */
  get statusMessage(): Corti.AgentsMessage | undefined {
    return this._nodeStatus?.message;
  }

  /**
   * Convenience: all text parts from `statusMessage` joined into a single
   * string. Returns `undefined` when there is no text content.
   */
  get text(): string | undefined {
    const parts = this.statusMessage?.parts ?? [];
    const joined = parts
      .filter((p): p is Corti.AgentsTextPart => p.kind === "text")
      .map((p) => p.text)
      .join("");
    return joined || undefined;
  }

  /** Structured artifacts produced by the task, deduplicated by parts content. */
  get artifacts(): Corti.AgentsArtifact[] {
    const all = this._node?.artifacts ?? [];
    const seen = new Set<string>();
    return all.filter((a) => {
      const key = JSON.stringify(a.parts);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** The thread ID — same value the context tracks internally. */
  get contextId(): string | undefined {
    return this._node?.contextId;
  }

  /** The task ID for this specific invocation. */
  get taskId(): string | undefined {
    return this._node?.id;
  }

  /** The full, unmodified response from the API. */
  get raw(): Corti.AgentsMessageSendResponse {
    return this._raw;
  }
}
