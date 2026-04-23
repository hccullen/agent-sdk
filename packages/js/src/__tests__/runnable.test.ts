import { describe, expect, it, vi } from "vitest";
import { Parallel, parallel } from "../runnable";
import { MessageResponse } from "../MessageResponse";
import type { AgentHandle } from "../AgentHandle";

function mockAgent(text: string): AgentHandle {
  return { run: vi.fn().mockResolvedValue(MessageResponse.fromText(text)) } as unknown as AgentHandle;
}

describe("Parallel", () => {
  it("run() merges fulfilled branches' parts into one MessageResponse", async () => {
    const merged = await parallel([mockAgent("a"), mockAgent("b"), mockAgent("c")]).run("x");
    const parts = merged.statusMessage?.parts ?? [];
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => (p as { text?: string }).text)).toEqual(["a", "b", "c"]);
  });

  it("run() throws when every branch fails", async () => {
    const boom: AgentHandle = { run: vi.fn().mockRejectedValue(new Error("boom")) } as unknown as AgentHandle;
    await expect(parallel([boom, boom]).run("x")).rejects.toThrow(
      "[AgentSDK] All parallel branches failed — no output to merge.",
    );
  });

  it("runSettled() returns allSettled-shaped fulfilled + rejected", async () => {
    const ok = mockAgent("ok");
    const bad: AgentHandle = { run: vi.fn().mockRejectedValue(new Error("bad")) } as unknown as AgentHandle;

    const result = await parallel([ok, bad]).runSettled("x");

    expect(result.fulfilled).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.fulfilled[0].text).toBe("ok");
    expect((result.rejected[0] as Error).message).toBe("bad");
  });

  it("accepts a bare Runnable branch (not just AgentHandle)", async () => {
    const custom = { run: vi.fn().mockResolvedValue(MessageResponse.fromText("custom")) };
    const merged = await parallel([custom, mockAgent("a")]).run("x");
    const parts = merged.statusMessage?.parts ?? [];
    expect(parts.map((p) => (p as { text?: string }).text)).toEqual(["custom", "a"]);
  });

  it("nests: a Parallel inside a Parallel", async () => {
    const inner = parallel([mockAgent("x"), mockAgent("y")]);
    const outer = await parallel([inner, mockAgent("z")]).run("input");
    const parts = outer.statusMessage?.parts ?? [];
    // Inner merged parts (x,y) come first, then the bare branch (z).
    expect(parts.map((p) => (p as { text?: string }).text)).toEqual(["x", "y", "z"]);
  });

  it("dict-form branch forwards per-branch input override", async () => {
    const a = mockAgent("unused");
    await parallel([{ agent: a, input: "override" }]).run("shared");
    expect(a.run).toHaveBeenCalledWith("override", undefined);
  });

  it("constructor throws on empty steps", () => {
    expect(() => new Parallel([])).toThrow("[AgentSDK] Parallel must have at least one step.");
  });
});
