import { describe, expect, it } from "vitest";
import { MessageResponse } from "../MessageResponse.js";
import type { Corti } from "@corti/sdk";

function makeTask(overrides: Partial<Corti.AgentsTask> = {}): Corti.AgentsTask {
  return {
    id: "task-1",
    contextId: "ctx-1",
    kind: "task",
    status: {
      state: "completed",
      message: {
        role: "agent",
        parts: [{ kind: "text", text: "Hello" }],
        messageId: "msg-1",
        kind: "message",
      },
    },
    ...overrides,
  } as Corti.AgentsTask;
}

describe("MessageResponse", () => {
  describe("constructor", () => {
    it("throws when constructed with undefined", () => {
      expect(() => new MessageResponse(undefined)).toThrow(
        "missing task"
      );
    });
  });

  describe(".text", () => {
    it("returns joined text parts from an agent message", () => {
      const r = new MessageResponse(
        makeTask({
          status: {
            state: "completed",
            message: {
              role: "agent",
              parts: [
                { kind: "text", text: "Hello " },
                { kind: "text", text: "world" },
              ],
              messageId: "m",
              kind: "message",
            },
          },
        })
      );
      expect(r.text).toBe("Hello world");
    });

    it("returns null when the message role is user", () => {
      const r = new MessageResponse(
        makeTask({
          status: {
            state: "completed",
            message: {
              role: "user",
              parts: [{ kind: "text", text: "user said this" }],
              messageId: "m",
              kind: "message",
            },
          },
        })
      );
      expect(r.text).toBeNull();
    });

    it("returns null when parts contain no text parts", () => {
      const r = new MessageResponse(
        makeTask({
          status: {
            state: "completed",
            message: {
              role: "agent",
              parts: [{ kind: "data", data: { x: 1 } } as unknown as Corti.AgentsPart],
              messageId: "m",
              kind: "message",
            },
          },
        })
      );
      expect(r.text).toBeNull();
    });

    it("returns null when status has no message", () => {
      const r = new MessageResponse(makeTask({ status: { state: "working" } as Corti.AgentsTaskStatus }));
      expect(r.text).toBeNull();
    });
  });

  describe(".status", () => {
    it("returns the task state", () => {
      expect(new MessageResponse(makeTask({ status: { state: "completed" } as Corti.AgentsTaskStatus })).status).toBe("completed");
      expect(new MessageResponse(makeTask({ status: { state: "failed" } as Corti.AgentsTaskStatus })).status).toBe("failed");
      expect(new MessageResponse(makeTask({ status: { state: "auth-required" } as Corti.AgentsTaskStatus })).status).toBe("auth-required");
    });
  });

  describe(".artifacts", () => {
    it("returns empty array when no artifacts", () => {
      expect(new MessageResponse(makeTask()).artifacts).toEqual([]);
    });

    it("deduplicates artifacts by parts content", () => {
      const dupe: Corti.AgentsArtifact = {
        artifactId: "a1",
        parts: [{ kind: "text", text: "same" }],
      } as unknown as Corti.AgentsArtifact;
      const r = new MessageResponse(makeTask({ artifacts: [dupe, dupe] }));
      expect(r.artifacts).toHaveLength(1);
    });

    it("keeps distinct artifacts", () => {
      const a1 = { artifactId: "a1", parts: [{ kind: "text", text: "one" }] } as unknown as Corti.AgentsArtifact;
      const a2 = { artifactId: "a2", parts: [{ kind: "text", text: "two" }] } as unknown as Corti.AgentsArtifact;
      const r = new MessageResponse(makeTask({ artifacts: [a1, a2] }));
      expect(r.artifacts).toHaveLength(2);
    });
  });

  describe(".contextId / .taskId", () => {
    it("returns contextId and taskId from the raw task", () => {
      const r = new MessageResponse(makeTask({ id: "t99", contextId: "ctx99" }));
      expect(r.contextId).toBe("ctx99");
      expect(r.taskId).toBe("t99");
    });
  });

  describe(".task and .raw", () => {
    it("returns the underlying task", () => {
      const task = makeTask();
      const r = new MessageResponse(task);
      expect(r.task).toBe(task);
      expect(r.raw).toBe(task);
    });
  });

  describe("MessageResponse.fromText", () => {
    it("produces a completed response with the given text", () => {
      const r = MessageResponse.fromText("synthesised");
      expect(r.text).toBe("synthesised");
      expect(r.status).toBe("completed");
    });

    it("returns null text for an empty string", () => {
      expect(MessageResponse.fromText("").text).toBeNull();
    });
  });
});
