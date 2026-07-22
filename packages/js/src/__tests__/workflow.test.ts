import { describe, expect, it, vi } from "vitest";
import { Parallel, Workflow, parallel, workflow } from "../workflow.js";
import { MessageResponse } from "../MessageResponse.js";
import type { AgentHandle } from "../AgentHandle.js";
import type { Runnable } from "../workflow.js";

// ── helpers ───────────────────────────────────────────────────────────────────

// Mocks are plain Runnables (not `instanceof AgentHandle`) so must be wrapped
// in `{ agent: ... }` WorkflowStep objects.  Parallel steps likewise need the
// `{ agent: ... }` wrapper because Parallel.run() uses `instanceof AgentHandle`
// to distinguish bare handles from step objects.

function mockRunnable(text: string, status: "completed" | "failed" = "completed"): Runnable {
  const response =
    status === "failed"
      ? new MessageResponse({
          id: "t",
          contextId: "c",
          kind: "task",
          status: { state: "failed" },
        } as never)
      : MessageResponse.fromText(text);
  return { run: vi.fn().mockResolvedValue(response) };
}

function mockAgentHandle(text: string, status: "completed" | "failed" = "completed"): AgentHandle {
  return mockRunnable(text, status) as unknown as AgentHandle;
}

// ── Workflow ──────────────────────────────────────────────────────────────────

describe("Workflow", () => {
  it("throws for an empty step list", () => {
    expect(() => new Workflow([])).toThrow("at least one step");
  });

  it("runs a single-step workflow", async () => {
    const a = mockRunnable("result");
    const r = await workflow([{ agent: a }]).run("input");
    expect(r.output.text).toBe("result");
    expect(r.steps).toHaveLength(1);
    expect(r.stoppedEarly).toBe(false);
    expect(a.run).toHaveBeenCalledWith("input");
  });

  it("chains steps, passing text output as input", async () => {
    const a = mockRunnable("step1");
    const b = mockRunnable("step2");
    await workflow([{ agent: a }, { agent: b }]).run("start");
    expect(a.run).toHaveBeenCalledWith("start");
    expect(b.run).toHaveBeenCalledWith("step1");
  });

  it("skips a non-first step when `when` returns false", async () => {
    const a = mockRunnable("a");
    const b = mockRunnable("b");
    const r = await workflow([{ agent: a }, { agent: b, when: () => false }]).run("x");
    expect(b.run).not.toHaveBeenCalled();
    expect(r.steps).toHaveLength(1);
    expect(r.output.text).toBe("a");
  });

  it("ignores `when` on the first step (first always runs)", async () => {
    const a = mockRunnable("a");
    // even with `when: () => false` the first step still runs
    const r = await workflow([{ agent: a, when: () => false }]).run("x");
    expect(a.run).toHaveBeenCalled();
    expect(r.steps).toHaveLength(1);
  });

  it("runs a non-first step when `when` returns true", async () => {
    const a = mockRunnable("a");
    const b = mockRunnable("b");
    const r = await workflow([
      { agent: a },
      { agent: b, when: (prev) => prev.text === "a" },
    ]).run("x");
    expect(b.run).toHaveBeenCalled();
    expect(r.steps).toHaveLength(2);
  });

  it("applies `transform` to map the previous response to the next step's input", async () => {
    const a = mockRunnable("raw");
    const b = mockRunnable("done");
    await workflow([
      { agent: a },
      { agent: b, transform: (prev) => `transformed:${prev.text}` },
    ]).run("x");
    expect(b.run).toHaveBeenCalledWith("transformed:raw");
  });

  it("stops early and sets stoppedEarly when a step fails", async () => {
    const a = mockRunnable("ok");
    const b = mockRunnable("", "failed");
    const c = mockRunnable("should not run");
    const r = await workflow([{ agent: a }, { agent: b }, { agent: c }]).run("x");
    expect(r.stoppedEarly).toBe(true);
    expect(r.steps).toHaveLength(2);
    expect(c.run).not.toHaveBeenCalled();
  });

  it("retries a failed step up to retries times", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(
        new MessageResponse({ id: "t", contextId: "c", kind: "task", status: { state: "failed" } } as never)
      )
      .mockResolvedValueOnce(MessageResponse.fromText("ok"));
    const r = await workflow([{ agent: { run }, retries: 1, retryDelay: 0 }]).run("x");
    expect(run).toHaveBeenCalledTimes(2);
    expect(r.output.text).toBe("ok");
    expect(r.stoppedEarly).toBe(false);
  });
});

// ── Parallel ──────────────────────────────────────────────────────────────────

describe("Parallel", () => {
  it("throws for an empty step list", () => {
    expect(() => new Parallel([])).toThrow("at least one step");
  });

  it("runs all agents concurrently and returns fulfilled results", async () => {
    const a = mockAgentHandle("a");
    const b = mockAgentHandle("b");
    // Wrap in {agent: ...} so Parallel.run() accesses .agent.run() correctly
    const { fulfilled, rejected } = await parallel([{ agent: a }, { agent: b }]).run("input");
    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(0);
    expect(fulfilled.map((r) => r.text)).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("separates fulfilled and rejected", async () => {
    const a = mockAgentHandle("ok");
    const b = { run: vi.fn().mockRejectedValue(new Error("boom")) } as unknown as AgentHandle;
    const { fulfilled, rejected } = await parallel([{ agent: a }, { agent: b }]).run("x");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as Error).message).toBe("boom");
  });

  it("forwards per-step input override", async () => {
    const a = mockAgentHandle("a");
    await parallel([{ agent: a, input: "override" }]).run("shared");
    expect(a.run).toHaveBeenCalledWith("override", undefined);
  });

  it("forwards per-step credentials", async () => {
    const a = mockAgentHandle("a");
    const creds = { "my-mcp": { type: "token" as const, token: "t" } };
    await parallel([{ agent: a, credentials: creds }]).run("x");
    expect(a.run).toHaveBeenCalledWith("x", { credentials: creds });
  });

  it("inside a workflow, joins fulfilled results as text", async () => {
    const a = mockAgentHandle("result-a");
    const b = mockAgentHandle("result-b");
    const c = mockRunnable("final");
    const r = await workflow([
      parallel([{ agent: a }, { agent: b }]),
      { agent: c },
    ]).run("x");
    expect(c.run).toHaveBeenCalledWith("result-a\n\nresult-b");
    expect(r.output.text).toBe("final");
  });

  it("throws inside a workflow when all parallel steps fail", async () => {
    const a = { run: vi.fn().mockRejectedValue(new Error("fail")) } as unknown as AgentHandle;
    await expect(workflow([parallel([{ agent: a }])]).run("x")).rejects.toThrow(
      "All parallel steps failed"
    );
  });
});
