import type { Corti } from "@corti/sdk";

/**
 * Wraps the A2A v1 Task returned by a `message/send` JSON-RPC call and
 * promotes the fields you almost always need to the top level, while
 * keeping the full Task accessible via `.raw`.
 */
export class MessageResponse {
  private readonly _raw: Corti.AgentsTask;

  constructor(raw: Corti.AgentsTask | undefined) {
    if (!raw) {
      throw new Error(
        "MessageResponse: missing task — JSON-RPC response had no `result`"
      );
    }
    this._raw = raw;
  }

  /**
   * Synthesise a completed `MessageResponse` from a plain string.
   * Used internally when merging parallel results into a single response.
   */
  static fromText(text: string): MessageResponse {
    return new MessageResponse({
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
    } as Corti.AgentsTask);
  }

  private get _nodeStatus() { return this._raw.status; }

  /** The full A2A v1 Task object. */
  get task(): Corti.AgentsTask | undefined {
    return this._raw;
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
    const all = this._raw.artifacts ?? [];
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
    return this._raw.contextId;
  }

  /** The task ID for this specific invocation. */
  get taskId(): string | undefined {
    return this._raw.id;
  }

  /** The full, unmodified Task returned by the server. */
  get raw(): Corti.AgentsTask {
    return this._raw;
  }
}
