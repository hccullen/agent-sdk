import type { Corti } from "@corti/sdk";
import type { SendMessageResponse } from "./types.js";

type Task = Corti.CommonTaskResponse;
type Message = Corti.CommonMessage;
type Artifact = Corti.CommonArtifactResponse;
type TaskState = Corti.CommonTaskState;
type Part = Corti.CommonPart;

export class MessageResponse {
  private readonly _task: Task | undefined;
  private readonly _message: Message | undefined;

  constructor(response: SendMessageResponse) {
    this._task = response.task;
    this._message = response.message;
  }

  static fromText(text: string): MessageResponse {
    return new MessageResponse({
      message: {
        role: "ROLE_AGENT",
        parts: [{ text }],
      },
    });
  }

  static fromTask(task: Task): MessageResponse {
    return new MessageResponse({ task });
  }

  get task(): Task | undefined {
    return this._task;
  }

  get message(): Message | undefined {
    if (this._message) return this._message;
    return this._task?.status?.message;
  }

  get taskId(): string | undefined {
    return this._task?.id;
  }

  get contextId(): string | undefined {
    return this._task?.contextId;
  }

  get state(): TaskState | undefined {
    return this._task?.status?.state;
  }

  get status(): "completed" | "failed" | "working" | "submitted" | "canceled" | "input-required" | "rejected" | "auth-required" | undefined {
    const state = this.state;
    if (!state) return undefined;
    return state.replace("TASK_STATE_", "").toLowerCase().replace(/_/g, "-") as
      | "completed"
      | "failed"
      | "working"
      | "submitted"
      | "canceled"
      | "input-required"
      | "rejected"
      | "auth-required";
  }

  get text(): string | null {
    const msg = this.message;
    if (!msg || msg.role === "ROLE_USER") return null;
    const joined = (msg.parts ?? [])
      .filter((p: Part): p is { text: string } => "text" in p && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
    return joined === "" ? null : joined;
  }

  get artifacts(): Artifact[] {
    const all = this._task?.artifacts ?? [];
    const seen = new Set<string>();
    return all.filter((a) => {
      const key = JSON.stringify(a.parts);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  get raw(): SendMessageResponse {
    if (this._task) return { task: this._task };
    if (this._message) return { message: this._message };
    return {};
  }
}
