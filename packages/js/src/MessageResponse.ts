import type { Corti } from "@corti/sdk";

/**
 * Wraps the raw `AgentsMessageSendResponse` and promotes the fields you
 * almost always need to the top level, while keeping the full response
 * accessible via `.raw`.
 */
export class MessageResponse {
  constructor(private readonly _raw: Corti.AgentsMessageSendResponse) {}

  /**
   * The task's terminal state.
   * e.g. `"completed"`, `"failed"`, `"input-required"`, `"working"`, …
   */
  get status(): Corti.AgentsTaskStatusState | undefined {
    return this._raw.task?.status.state;
  }

  /**
   * The agent's reply message (the `status.message` inside the task).
   * This is where the agent's answer lives.
   */
  get statusMessage(): Corti.AgentsMessage | undefined {
    return this._raw.task?.status.message;
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

  /** Structured artifacts produced by the task (empty array if none). */
  get artifacts(): Corti.AgentsArtifact[] {
    return this._raw.task?.artifacts ?? [];
  }

  /** The thread ID — same value the context tracks internally. */
  get contextId(): string | undefined {
    return this._raw.task?.contextId;
  }

  /** The task ID for this specific invocation. */
  get taskId(): string | undefined {
    return this._raw.task?.id;
  }

  /** The full, unmodified response from the API. */
  get raw(): Corti.AgentsMessageSendResponse {
    return this._raw;
  }
}
