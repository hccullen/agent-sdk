import { describe, expect, it, vi } from "vitest";
import { Workflow, Parallel, workflow, parallel } from "../workflow.js";
import { MessageResponse } from "../response.js";
import type { Runnable } from "../workflow.js";

function mockRunnable(text: string): Runnable {
  return {
    run: vi.fn().mockResolvedValue(MessageResponse.fromText(text)),
  };
}

function failingRunnable(error: string): Runnable {
  return {
    run: vi.fn().mockRejectedValue(new Error(error)),
  };
}

function step(text: string) {
  return { agent: mockRunnable(text) };
}

describe("Workflow", () => {
  it("executes steps in order and returns the last output", async () => {
    const a = mockRunnable("step-a");
    const b = mockRunnable("step-b");

    const result = await workflow([{ agent: a }, { agent: b }]).run("start");

    expect(result.output.text).toBe("step-b");
    expect(result.steps).toHaveLength(2);
    expect(result.stoppedEarly).toBe(false);
  });

  it("passes the previous step's text as input to the next", async () => {
    const a = mockRunnable("from-a");
    const b = mockRunnable("from-b");

    await workflow([{ agent: a }, { agent: b }]).run("start");

    expect(a.run).toHaveBeenCalledWith("start");
    expect(b.run).toHaveBeenCalledWith("from-a");
  });

  it("skips a step when when() returns false", async () => {
    const a = mockRunnable("step-a");
    const b = mockRunnable("step-b");

    const result = await workflow([
      { agent: a },
      { agent: b, when: () => false },
    ]).run("start");

    expect(result.output.text).toBe("step-a");
    expect(result.steps).toHaveLength(1);
    expect(b.run).not.toHaveBeenCalled();
  });

  it("uses transform to map the previous response", async () => {
    const a = mockRunnable("step-a");
    const b = mockRunnable("step-b");

    await workflow([
      { agent: a },
      { agent: b, transform: (prev) => `transformed:${prev.text}` },
    ]).run("start");

    expect(b.run).toHaveBeenCalledWith("transformed:step-a");
  });

  it("retries on failed status", async () => {
    const fail = new MessageResponse({
      task: {
        id: "t",
        contextId: "c",
        status: { state: "TASK_STATE_FAILED" },
      },
    });
    const ok = MessageResponse.fromText("ok");
    const agent: Runnable = {
      run: vi.fn()
        .mockResolvedValueOnce(fail)
        .mockResolvedValueOnce(ok),
    };

    const result = await workflow([
      { agent, retries: 1, retryDelay: 0 },
    ]).run("start");

    expect(result.output.text).toBe("ok");
    expect(agent.run).toHaveBeenCalledTimes(2);
  });

  it("stops early when a step fails after retries", async () => {
    const fail = new MessageResponse({
      task: {
        id: "t",
        contextId: "c",
        status: { state: "TASK_STATE_FAILED" },
      },
    });
    const agent: Runnable = {
      run: vi.fn().mockResolvedValue(fail),
    };
    const next = mockRunnable("next");

    const result = await workflow([
      { agent, retries: 1, retryDelay: 0 },
      { agent: next },
    ]).run("start");

    expect(result.stoppedEarly).toBe(true);
    expect(next.run).not.toHaveBeenCalled();
  });

  it("throws if no steps", () => {
    expect(() => workflow([])).toThrow("at least one step");
  });
});

describe("Parallel", () => {
  it("runs all agents concurrently and collects fulfilled results", async () => {
    const a = mockRunnable("a");
    const b = mockRunnable("b");

    const result = await parallel([{ agent: a }, { agent: b }]).run("input");

    expect(result.fulfilled).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
    expect(a.run).toHaveBeenCalledWith("input");
    expect(b.run).toHaveBeenCalledWith("input");
  });

  it("collects rejected results without throwing", async () => {
    const a = mockRunnable("ok");
    const b = failingRunnable("boom");

    const result = await parallel([{ agent: a }, { agent: b }]).run("input");

    expect(result.fulfilled).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it("supports per-step input override", async () => {
    const a = mockRunnable("a");
    const b = mockRunnable("b");

    await parallel([
      { agent: a },
      { agent: b, input: "custom-input" },
    ]).run("default-input");

    expect(a.run).toHaveBeenCalledWith("default-input");
    expect(b.run).toHaveBeenCalledWith("custom-input");
  });

  it("throws if no steps", () => {
    expect(() => parallel([])).toThrow("at least one step");
  });
});
