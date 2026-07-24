import type { components } from "./gen/api-v2.js";

type Task = components["schemas"]["CommonTaskResponse"];
type Message = components["schemas"]["CommonMessage"];
type Artifact = components["schemas"]["CommonArtifactResponse"];
type TaskState = components["schemas"]["CommonTaskState"];
type Part = components["schemas"]["CommonPart"];
type SendMessageResponse = components["schemas"]["A2ASendMessageResponse"];

export class MessageResponse {
  private readonly _task: Task | undefined;
  private readonly _msg: Message | undefined;

  constructor(response: SendMessageResponse) {
    this._task = response.task;
    this._msg = response.msg;
  }

  static fromText(text: string): MessageResponse {
    return new MessageResponse({
      msg: {
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
    if (this._msg) return this._msg;
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

  get status(): "completed" | "failed" | "working" | "submitted" | "canceled" | "input-required" | undefined {
    const state = this.state;
    if (!state) return undefined;
    return state.replace("TASK_STATE_", "").toLowerCase() as
      | "completed"
      | "failed"
      | "working"
      | "submitted"
      | "canceled"
      | "input-required";
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
    if (this._msg) return { msg: this._msg };
    return {};
  }
}
