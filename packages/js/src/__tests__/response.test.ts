import { describe, expect, it } from "vitest";
import { MessageResponse } from "../response.js";
import type { SendMessageResponse } from "../types.js";

function makeTaskResponse(overrides: Partial<SendMessageResponse> = {}): SendMessageResponse {
  return {
    task: {
      id: "task.1",
      contextId: "ctx.1",
      status: {
        state: "TASK_STATE_COMPLETED",
        message: {
          role: "ROLE_AGENT",
          parts: [{ text: "J45.909" }],
          messageId: "msg.1",
        },
        timestamp: "2026-05-19T12:00:01Z",
      },
      artifacts: [
        { artifactId: "art.1", parts: [{ text: "J45.909" }] },
      ],
    },
    ...overrides,
  };
}

describe("MessageResponse", () => {
  describe("from a task", () => {
    it("extracts text from the agent message", () => {
      const r = new MessageResponse(makeTaskResponse());
      expect(r.text).toBe("J45.909");
    });

    it("returns the task id and context id", () => {
      const r = new MessageResponse(makeTaskResponse());
      expect(r.taskId).toBe("task.1");
      expect(r.contextId).toBe("ctx.1");
    });

    it("returns the state and status", () => {
      const r = new MessageResponse(makeTaskResponse());
      expect(r.state).toBe("TASK_STATE_COMPLETED");
      expect(r.status).toBe("completed");
    });

    it("returns null text for ROLE_USER messages", () => {
      const r = new MessageResponse({
        task: {
          id: "task.1",
          contextId: "ctx.1",
          status: {
            state: "TASK_STATE_COMPLETED",
            message: {
              role: "ROLE_USER",
              parts: [{ text: "user input" }],
              messageId: "msg.1",
            },
          },
        },
      });
      expect(r.text).toBeNull();
    });

    it("returns null text when no message exists", () => {
      const r = new MessageResponse({
        task: {
          id: "task.1",
          contextId: "ctx.1",
          status: { state: "TASK_STATE_WORKING" },
        },
      });
      expect(r.text).toBeNull();
    });

    it("deduplicates artifacts by parts content", () => {
      const r = new MessageResponse({
        task: {
          id: "task.1",
          contextId: "ctx.1",
          status: { state: "TASK_STATE_COMPLETED" },
          artifacts: [
            { artifactId: "art.1", parts: [{ text: "J45.909" }] },
            { artifactId: "art.2", parts: [{ text: "J45.909" }] },
            { artifactId: "art.3", parts: [{ text: "I10" }] },
          ],
        },
      });
      expect(r.artifacts).toHaveLength(2);
    });

    it("joins multiple text parts", () => {
      const r = new MessageResponse({
        task: {
          id: "task.1",
          contextId: "ctx.1",
          status: {
            state: "TASK_STATE_COMPLETED",
            message: {
              role: "ROLE_AGENT",
              parts: [{ text: "Hello " }, { text: "world" }],
              messageId: "msg.1",
            },
          },
        },
      });
      expect(r.text).toBe("Hello world");
    });

    it("returns empty array for no artifacts", () => {
      const r = new MessageResponse({
        task: {
          id: "task.1",
          contextId: "ctx.1",
          status: { state: "TASK_STATE_COMPLETED" },
        },
      });
      expect(r.artifacts).toEqual([]);
    });
  });

  describe("from a message", () => {
    it("extracts text from the message", () => {
      const r = new MessageResponse({
        msg: {
          role: "ROLE_AGENT",
          parts: [{ text: "Direct reply" }],
          messageId: "msg.2",
        },
      });
      expect(r.text).toBe("Direct reply");
      expect(r.task).toBeUndefined();
      expect(r.taskId).toBeUndefined();
    });
  });

  describe("fromText", () => {
    it("creates a response from a plain string", () => {
      const r = MessageResponse.fromText("synthesised");
      expect(r.text).toBe("synthesised");
      expect(r.message?.role).toBe("ROLE_AGENT");
    });
  });

  describe("status mapping", () => {
    it.each([
      ["TASK_STATE_SUBMITTED", "submitted"],
      ["TASK_STATE_WORKING", "working"],
      ["TASK_STATE_COMPLETED", "completed"],
      ["TASK_STATE_FAILED", "failed"],
      ["TASK_STATE_CANCELED", "canceled"],
      ["TASK_STATE_INPUT_REQUIRED", "input-required"],
    ])("maps %s to %s", (state, expected) => {
      const r = new MessageResponse({
        task: {
          id: "t",
          contextId: "c",
          status: { state: state as SendMessageResponse["task"] extends infer T ? T extends { status: infer S } ? S extends { state: infer St } ? St : never : never : never },
        },
      });
      expect(r.status).toBe(expected);
    });
  });
});
