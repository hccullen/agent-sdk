import { describe, expect, it } from "vitest";
import { parseSSEStream, parseA2AStream } from "../streaming.js";
import type { StreamResponse } from "../types.js";

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collectSSE(chunks: string[]) {
  const events = [];
  for await (const e of parseSSEStream(makeStream(chunks))) {
    events.push(e);
  }
  return events;
}

describe("parseSSEStream", () => {
  it("yields a single event", async () => {
    const events = await collectSSE(['data: {"hello":"world"}\n\n']);
    expect(events).toEqual([{ data: '{"hello":"world"}' }]);
  });

  it("yields multiple events", async () => {
    const events = await collectSSE([
      'data: {"n":1}\n\n',
      'data: {"n":2}\n\n',
      'data: {"n":3}\n\n',
    ]);
    expect(events).toHaveLength(3);
    expect(events[0].data).toBe('{"n":1}');
    expect(events[2].data).toBe('{"n":3}');
  });

  it("handles events split across chunks", async () => {
    const full = 'data: {"split":true}\n\n';
    const mid = Math.floor(full.length / 2);
    const events = await collectSSE([full.slice(0, mid), full.slice(mid)]);
    expect(events).toEqual([{ data: '{"split":true}' }]);
  });

  it("handles \\r\\n line endings", async () => {
    const events = await collectSSE(['data: {"ok":true}\r\n\r\n']);
    expect(events).toEqual([{ data: '{"ok":true}' }]);
  });

  it("handles bare \\r line endings", async () => {
    const events = await collectSSE(['data: {"ok":true}\r\r']);
    expect(events).toEqual([{ data: '{"ok":true}' }]);
  });

  it("concatenates multiple data: lines with \\n", async () => {
    const events = await collectSSE(['data: line1\ndata: line2\n\n']);
    expect(events).toEqual([{ data: "line1\nline2" }]);
  });

  it("skips [DONE] events", async () => {
    const events = await collectSSE([
      'data: {"n":1}\n\n',
      'data: [DONE]\n\n',
      'data: {"n":2}\n\n',
    ]);
    expect(events).toHaveLength(2);
    expect(events[1].data).toBe('{"n":2}');
  });

  it("ignores comment lines (:)", async () => {
    const events = await collectSSE([
      ': this is a comment\ndata: {"ok":true}\n\n',
    ]);
    expect(events).toEqual([{ data: '{"ok":true}' }]);
  });

  it("ignores blank events (keep-alive pings)", async () => {
    const events = await collectSSE(['\n\ndata: {"ok":true}\n\n\n']);
    expect(events).toEqual([{ data: '{"ok":true}' }]);
  });

  it("captures event type and id", async () => {
    const events = await collectSSE([
      'event: message\ndata: {"x":1}\nid: 42\n\n',
    ]);
    expect(events).toEqual([{ data: '{"x":1}', event: "message", id: "42" }]);
  });

  it("captures retry", async () => {
    const events = await collectSSE(['retry: 5000\ndata: {"x":1}\n\n']);
    expect(events[0].retry).toBe(5000);
  });

  it("handles data with no space after colon", async () => {
    const events = await collectSSE(['data:{"x":1}\n\n']);
    expect(events).toEqual([{ data: '{"x":1}' }]);
  });
});

describe("parseA2AStream", () => {
  async function collectA2A(chunks: string[]): Promise<StreamResponse[]> {
    const results: StreamResponse[] = [];
    for await (const e of parseA2AStream(makeStream(chunks))) {
      results.push(e);
    }
    return results;
  }

  it("parses a task event", async () => {
    const task = { task: { id: "task.1", contextId: "ctx.1", status: { state: "TASK_STATE_COMPLETED" } } };
    const results = await collectA2A([`data: ${JSON.stringify(task)}\n\n`]);
    expect(results).toEqual([task]);
  });

  it("parses a statusUpdate event", async () => {
    const update = { statusUpdate: { taskId: "task.1", status: { state: "TASK_STATE_WORKING" }, final: false } };
    const results = await collectA2A([`data: ${JSON.stringify(update)}\n\n`]);
    expect(results).toEqual([update]);
  });

  it("parses an artifactUpdate event", async () => {
    const update = { artifactUpdate: { taskId: "task.1", artifact: { artifactId: "art.1", parts: [{ text: "x" }] }, lastChunk: true } };
    const results = await collectA2A([`data: ${JSON.stringify(update)}\n\n`]);
    expect(results).toEqual([update]);
  });

  it("skips malformed JSON", async () => {
    const results = await collectA2A(['data: {invalid\n\n']);
    expect(results).toEqual([]);
  });

  it("handles multiple events in one chunk", async () => {
    const e1 = { task: { id: "t1", contextId: "c1", status: { state: "TASK_STATE_SUBMITTED" } } };
    const e2 = { statusUpdate: { taskId: "t1", final: true } };
    const results = await collectA2A([
      `data: ${JSON.stringify(e1)}\n\ndata: ${JSON.stringify(e2)}\n\n`,
    ]);
    expect(results).toEqual([e1, e2]);
  });
});
