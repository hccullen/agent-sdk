import { describe, expect, it, vi } from "vitest";
import { makeAbortController, parseSSEStream, parseA2AStream, collectText, StreamCollector, collectCitations, toMarkdown } from "../streaming.js";
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

describe("makeAbortController", () => {
  it("returns a non-aborted controller when no options given", () => {
    const { controller, timer } = makeAbortController();
    expect(controller.signal.aborted).toBe(false);
    expect(timer).toBeUndefined();
  });

  it("returns an already-aborted controller when abortSignal is already aborted", () => {
    const external = new AbortController();
    external.abort();
    const { controller } = makeAbortController({ abortSignal: external.signal });
    expect(controller.signal.aborted).toBe(true);
  });

  it("aborts the controller when the external signal fires", () => {
    const external = new AbortController();
    const { controller } = makeAbortController({ abortSignal: external.signal });
    expect(controller.signal.aborted).toBe(false);
    external.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  it("sets a timeout timer that aborts after N seconds", () => {
    vi.useFakeTimers();
    const { controller, timer } = makeAbortController({ timeoutInSeconds: 5 });
    expect(controller.signal.aborted).toBe(false);
    expect(timer).toBeDefined();
    vi.advanceTimersByTime(5000);
    expect(controller.signal.aborted).toBe(true);
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Test fixtures — mirror the real dev-weu token-by-token wire format.
// ---------------------------------------------------------------------------

/** Build a realistic event sequence: task → working → tokens → lastChunk → completed. */
function makeTokenStreamEvents(tokens: string[], finalText: string): StreamResponse[] {
  const events: StreamResponse[] = [
    { task: { id: "task.1", contextId: "ctx.1", status: { state: "TASK_STATE_SUBMITTED" } } },
    { statusUpdate: { taskId: "task.1", contextId: "ctx.1", status: { state: "TASK_STATE_WORKING" } } },
  ];

  // First chunk: no `append`, no `lastChunk` — creates the artifact.
  events.push({
    artifactUpdate: {
      taskId: "task.1",
      contextId: "ctx.1",
      artifact: { artifactId: "art.1", parts: [{ text: tokens[0] }] },
    },
  });

  // Append chunks: `append: true` — incremental deltas.
  for (let i = 1; i < tokens.length; i++) {
    events.push({
      artifactUpdate: {
        taskId: "task.1",
        contextId: "ctx.1",
        artifact: { artifactId: "art.1", parts: [{ text: tokens[i] }] },
        append: true,
      },
    });
  }

  // Final chunk: `lastChunk: true`, no `append` — carries the COMPLETE text.
  events.push({
    artifactUpdate: {
      taskId: "task.1",
      contextId: "ctx.1",
      artifact: { artifactId: "art.1", parts: [{ text: finalText }] },
      lastChunk: true,
    },
  });

  // Terminal status update.
  events.push({
    statusUpdate: {
      taskId: "task.1",
      contextId: "ctx.1",
      status: { state: "TASK_STATE_COMPLETED" },
      metadata: { corti: { usage: { creditsConsumed: 0.05 } } },
    },
  });

  return events;
}

function makeAsyncIterable(events: StreamResponse[]): AsyncIterable<StreamResponse> {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

// ---------------------------------------------------------------------------
// collectText
// ---------------------------------------------------------------------------

describe("collectText", () => {
  it("yields incremental deltas then the authoritative final text", async () => {
    const tokens = ["Photo", "synthesis", " is", " the", " process"];
    const finalText = "Photosynthesis is the process";
    const events = makeTokenStreamEvents(tokens, finalText);
    const chunks: { delta: string; text: string; done: boolean }[] = [];

    for await (const chunk of collectText(makeAsyncIterable(events))) {
      chunks.push(chunk);
    }

    // 5 artifact events → 5 yielded chunks (5 tokens, then lastChunk)
    expect(chunks).toHaveLength(6);

    // First chunk: delta is the first token
    expect(chunks[0].delta).toBe("Photo");
    expect(chunks[0].text).toBe("Photo");
    expect(chunks[0].done).toBe(false);

    // Second chunk: delta is the second token, accumulated text grows
    expect(chunks[1].delta).toBe("synthesis");
    expect(chunks[1].text).toBe("Photosynthesis");
    expect(chunks[1].done).toBe(false);

    // Last chunk before final: all tokens accumulated
    expect(chunks[4].delta).toBe(" process");
    expect(chunks[4].text).toBe("Photosynthesis is the process");
    expect(chunks[4].done).toBe(false);

    // Final chunk: done=true, delta="", text = authoritative complete text
    expect(chunks[5].delta).toBe("");
    expect(chunks[5].text).toBe(finalText);
    expect(chunks[5].done).toBe(true);
  });

  it("reconstructs the same text whether or not lastChunk is used", async () => {
    const tokens = ["Hello", " world", "!"];
    const finalText = "Hello world!";
    const events = makeTokenStreamEvents(tokens, finalText);

    const chunks = [];
    for await (const chunk of collectText(makeAsyncIterable(events))) {
      chunks.push(chunk);
    }

    // Accumulated from deltas (before the lastChunk override)
    const accumulatedFromDeltas = chunks.filter((c) => !c.done).map((c) => c.delta).join("");
    // Authoritative text from the lastChunk event
    const finalFromLastChunk = chunks.find((c) => c.done)?.text ?? "";

    expect(accumulatedFromDeltas).toBe(finalText);
    expect(finalFromLastChunk).toBe(finalText);
  });

  it("skips non-artifactUpdate events silently", async () => {
    const events: StreamResponse[] = [
      { task: { id: "t1", contextId: "c1", status: { state: "TASK_STATE_SUBMITTED" } } },
      { statusUpdate: { taskId: "t1", status: { state: "TASK_STATE_WORKING" } } },
      { message: { role: "ROLE_AGENT", parts: [{ text: "should be skipped" }] } },
    ];

    const chunks = [];
    for await (const chunk of collectText(makeAsyncIterable(events))) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(0);
  });

  it("yields nothing for an empty stream", async () => {
    const chunks = [];
    for await (const chunk of collectText(makeAsyncIterable([]))) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(0);
  });

  it("handles a single lastChunk event with no preceding deltas", async () => {
    const events: StreamResponse[] = [
      {
        artifactUpdate: {
          taskId: "t1",
          contextId: "c1",
          artifact: { artifactId: "a1", parts: [{ text: "complete response" }] },
          lastChunk: true,
        },
      },
    ];

    const chunks = [];
    for await (const chunk of collectText(makeAsyncIterable(events))) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].delta).toBe("");
    expect(chunks[0].text).toBe("complete response");
    expect(chunks[0].done).toBe(true);
  });

  it("handles artifacts with no text parts", async () => {
    const events: StreamResponse[] = [
      {
        artifactUpdate: {
          taskId: "t1",
          contextId: "c1",
          artifact: { artifactId: "a1", parts: [{ data: { x: 1 } }] },
          append: true,
        },
      },
      {
        artifactUpdate: {
          taskId: "t1",
          contextId: "c1",
          artifact: { artifactId: "a1", parts: [{ text: "done" }] },
          lastChunk: true,
        },
      },
    ];

    const chunks = [];
    for await (const chunk of collectText(makeAsyncIterable(events))) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    // First chunk: no text parts → empty delta, empty accumulated text
    expect(chunks[0].delta).toBe("");
    expect(chunks[0].text).toBe("");
    // Final chunk
    expect(chunks[1].done).toBe(true);
    expect(chunks[1].text).toBe("done");
  });

  it("handles artifacts with multiple text parts in a single chunk", async () => {
    const events: StreamResponse[] = [
      {
        artifactUpdate: {
          taskId: "t1",
          contextId: "c1",
          artifact: { artifactId: "a1", parts: [{ text: "Hello" }, { text: " " }, { text: "world" }] },
        },
      },
      {
        artifactUpdate: {
          taskId: "t1",
          contextId: "c1",
          artifact: { artifactId: "a1", parts: [{ text: "Hello world" }] },
          lastChunk: true,
        },
      },
    ];

    const chunks = [];
    for await (const chunk of collectText(makeAsyncIterable(events))) {
      chunks.push(chunk);
    }

    // First chunk concatenates all text parts: "Hello" + " " + "world"
    expect(chunks[0].delta).toBe("Hello world");
    expect(chunks[0].text).toBe("Hello world");
    expect(chunks[0].done).toBe(false);

    // Final chunk
    expect(chunks[1].text).toBe("Hello world");
    expect(chunks[1].done).toBe(true);
  });

  it("handles a stream that ends without lastChunk (no terminal event)", async () => {
    const events: StreamResponse[] = [
      {
        artifactUpdate: {
          taskId: "t1",
          contextId: "c1",
          artifact: { artifactId: "a1", parts: [{ text: "partial" }] },
        },
      },
      {
        artifactUpdate: {
          taskId: "t1",
          contextId: "c1",
          artifact: { artifactId: "a1", parts: [{ text: " response" }] },
          append: true,
        },
      },
    ];

    const chunks = [];
    for await (const chunk of collectText(makeAsyncIterable(events))) {
      chunks.push(chunk);
    }

    // No lastChunk → no done=true → just accumulated deltas
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => !c.done)).toBe(true);
    expect(chunks[1].text).toBe("partial response");
  });

  it("handles many tokens (stress test with 100 chunks)", async () => {
    const tokens = Array.from({ length: 100 }, (_, i) => `token${i} `);
    const finalText = tokens.join("");
    const events = makeTokenStreamEvents(tokens, finalText);

    const chunks = [];
    for await (const chunk of collectText(makeAsyncIterable(events))) {
      chunks.push(chunk);
    }

    // 100 artifact deltas + 1 lastChunk
    expect(chunks).toHaveLength(101);
    expect(chunks[100].done).toBe(true);
    expect(chunks[100].text).toBe(finalText);

    // Verify mid-stream accumulation
    expect(chunks[49].text).toBe(tokens.slice(0, 50).join(""));
    expect(chunks[50].delta).toBe("token50 ");
  });
});

// ---------------------------------------------------------------------------
// StreamCollector
// ---------------------------------------------------------------------------

describe("StreamCollector", () => {
  it("accumulates text from sequential update() calls", () => {
    const collector = new StreamCollector();
    const events = makeTokenStreamEvents(["Hello", " world", "!"], "Hello world!");

    const deltas: string[] = [];
    for (const event of events) {
      const delta = collector.update(event);
      if (delta !== null) deltas.push(delta);
    }

    expect(collector.done).toBe(true);
    expect(collector.text).toBe("Hello world!");
    // Deltas from non-final chunks, final lastChunk returns "" (no new delta)
    expect(deltas).toEqual(["Hello", " world", "!", ""]);
  });

  it("returns null for non-artifactUpdate events", () => {
    const collector = new StreamCollector();

    const result1 = collector.update({ task: { id: "t1", contextId: "c1", status: { state: "TASK_STATE_SUBMITTED" } } });
    const result2 = collector.update({ statusUpdate: { taskId: "t1", status: { state: "TASK_STATE_WORKING" } } });
    const result3 = collector.update({ message: { role: "ROLE_AGENT", parts: [{ text: "hi" }] } });

    expect(result1).toBeNull();
    expect(result2).toBeNull();
    expect(result3).toBeNull();
    expect(collector.text).toBe("");
    expect(collector.done).toBe(false);
  });

  it("replaces accumulated text with the authoritative lastChunk text", () => {
    const collector = new StreamCollector();

    // Simulate a case where accumulated deltas differ from the final text
    collector.update({
      artifactUpdate: {
        taskId: "t1",
        contextId: "c1",
        artifact: { artifactId: "a1", parts: [{ text: "partial" }] },
      },
    });
    expect(collector.text).toBe("partial");

    collector.update({
      artifactUpdate: {
        taskId: "t1",
        contextId: "c1",
        artifact: { artifactId: "a1", parts: [{ text: " more" }] },
        append: true,
      },
    });
    expect(collector.text).toBe("partial more");

    // lastChunk replaces with the authoritative complete text
    collector.update({
      artifactUpdate: {
        taskId: "t1",
        contextId: "c1",
        artifact: { artifactId: "a1", parts: [{ text: "partial more complete" }] },
        lastChunk: true,
      },
    });
    expect(collector.text).toBe("partial more complete");
    expect(collector.done).toBe(true);
  });

  it("can be reset for reuse", () => {
    const collector = new StreamCollector();

    collector.update({
      artifactUpdate: {
        taskId: "t1",
        contextId: "c1",
        artifact: { artifactId: "a1", parts: [{ text: "hello" }] },
        lastChunk: true,
      },
    });
    expect(collector.text).toBe("hello");
    expect(collector.done).toBe(true);

    collector.reset();
    expect(collector.text).toBe("");
    expect(collector.done).toBe(false);
  });

  it("starts empty", () => {
    const collector = new StreamCollector();
    expect(collector.text).toBe("");
    expect(collector.done).toBe(false);
  });

  it("handles empty artifact parts", () => {
    const collector = new StreamCollector();

    const delta = collector.update({
      artifactUpdate: {
        taskId: "t1",
        contextId: "c1",
        artifact: { artifactId: "a1", parts: [] },
        append: true,
      },
    });

    expect(delta).toBe("");
    expect(collector.text).toBe("");
  });

  it("works with the real-world event sequence from dev-weu", () => {
    // Exact event sequence observed in testing:
    // task → statusUpdate(WORKING) → statusUpdate(WORKING) → first chunk →
    // append chunks... → lastChunk → statusUpdate(COMPLETED with usage)
    const collector = new StreamCollector();
    const tokens = ["Photo", "synthesis", " is", " the", " process", " by", " which"];
    const finalText = "Photosynthesis is the process by which";

    const results: string[] = [];

    // task event
    expect(collector.update({ task: { id: "t1", contextId: "c1", status: { state: "TASK_STATE_SUBMITTED" } } })).toBeNull();

    // working status events
    expect(collector.update({ statusUpdate: { taskId: "t1", contextId: "c1", status: { state: "TASK_STATE_WORKING" } } })).toBeNull();
    expect(collector.update({ statusUpdate: { taskId: "t1", contextId: "c1", status: { state: "TASK_STATE_WORKING" } } })).toBeNull();

    // first artifact chunk (no append)
    results.push(collector.update({
      artifactUpdate: { taskId: "t1", contextId: "c1", artifact: { artifactId: "a1", parts: [{ text: tokens[0] }] } },
    })!);

    // append chunks
    for (let i = 1; i < tokens.length; i++) {
      results.push(collector.update({
        artifactUpdate: { taskId: "t1", contextId: "c1", artifact: { artifactId: "a1", parts: [{ text: tokens[i] }] }, append: true },
      })!);
    }

    expect(collector.text).toBe("Photosynthesis is the process by which");
    expect(collector.done).toBe(false);

    // lastChunk — authoritative complete text
    results.push(collector.update({
      artifactUpdate: { taskId: "t1", contextId: "c1", artifact: { artifactId: "a1", parts: [{ text: finalText }] }, lastChunk: true },
    })!);

    // completed status with usage metadata
    expect(collector.update({
      statusUpdate: { taskId: "t1", contextId: "c1", status: { state: "TASK_STATE_COMPLETED" }, metadata: { corti: { usage: { creditsConsumed: 0.05 } } } },
    })).toBeNull();

    expect(collector.text).toBe(finalText);
    expect(collector.done).toBe(true);

    // Deltas match the tokens, plus empty string from lastChunk
    expect(results).toEqual([...tokens, ""]);
  });
});

// ---------------------------------------------------------------------------
// Integration: collectText + StreamCollector with parseA2AStream
// ---------------------------------------------------------------------------

describe("integration: collectText with parseA2AStream", () => {
  it("end-to-end: SSE bytes → parsed events → collected text", async () => {
    const tokens = ["Rain", "bows", " form"];
    const finalText = "Rainbows form";
    const events = makeTokenStreamEvents(tokens, finalText);

    // Serialize events to SSE wire format
    const sseChunks = events.map((e) => `data: ${JSON.stringify(e)}\n\n`);
    const stream = parseA2AStream(makeStream(sseChunks));

    const chunks = [];
    for await (const chunk of collectText(stream)) {
      chunks.push(chunk);
    }

    // 3 artifact deltas + 1 lastChunk
    expect(chunks).toHaveLength(4);
    expect(chunks[0].delta).toBe("Rain");
    expect(chunks[1].delta).toBe("bows");
    expect(chunks[2].delta).toBe(" form");
    expect(chunks[3].done).toBe(true);
    expect(chunks[3].text).toBe(finalText);
  });

  it("end-to-end: StreamCollector over parsed SSE events", async () => {
    const events = makeTokenStreamEvents(["A", "B", "C"], "ABC");
    const sseChunks = events.map((e) => `data: ${JSON.stringify(e)}\n\n`);
    const stream = parseA2AStream(makeStream(sseChunks));

    const collector = new StreamCollector();
    for await (const event of stream) {
      collector.update(event);
    }

    expect(collector.done).toBe(true);
    expect(collector.text).toBe("ABC");
  });
});

// ---------------------------------------------------------------------------
// Citation test fixtures
// ---------------------------------------------------------------------------

function makeCitationEvent(
  text: string,
  citations: Array<{ data_part_id: string; locator: string; offset: number }>,
  dataResults: Record<string, unknown>[],
): StreamResponse {
  return {
    artifactUpdate: {
      taskId: "task.1",
      contextId: "ctx.1",
      lastChunk: true,
      artifact: {
        artifactId: "art.1",
        parts: [
          {
            text,
            metadata: {
              citations,
              offsetUnit: "chars",
            },
          },
          {
            data: { results: dataResults },
            metadata: { dataPartId: "tool_data_01", toolName: "search" },
          },
        ],
      },
    },
  };
}

function makeSearchResult(
  url: string,
  title: string,
  snippet: string,
  siteName?: string,
  faviconUrl?: string,
): Record<string, unknown> {
  return {
    site: {
      name: siteName || new URL(url).hostname,
      favicon_url: faviconUrl || `https://${new URL(url).hostname}/favicon.ico`,
    },
    snippet,
    title,
    type: "web_result",
    url,
    source: { provider: "tavily", retrieved_at: "2026-09-11T12:00:00Z" },
  };
}

// ---------------------------------------------------------------------------
// collectCitations
// ---------------------------------------------------------------------------

describe("collectCitations", () => {
  it("yields deltas during streaming then citations on lastChunk", async () => {
    const results = [
      makeSearchResult("https://fifa.com/final", "FIFA World Cup 2026 Final", "Spain claimed ultimate glory..."),
      makeSearchResult("https://espn.com/world-cup", "World Cup Final Recap", "Spain beat Argentina 1-0..."),
    ];
    const events: StreamResponse[] = [
      { task: { id: "task.1", contextId: "ctx.1", status: { state: "TASK_STATE_SUBMITTED" } } },
      { statusUpdate: { taskId: "task.1", contextId: "ctx.1", status: { state: "TASK_STATE_WORKING" } } },
      {
        artifactUpdate: {
          taskId: "task.1",
          contextId: "ctx.1",
          artifact: { artifactId: "art.1", parts: [{ text: "Spain " }] },
        },
      },
      {
        artifactUpdate: {
          taskId: "task.1",
          contextId: "ctx.1",
          artifact: { artifactId: "art.1", parts: [{ text: "won the World Cup." }] },
          append: true,
        },
      },
      makeCitationEvent(
        "Spain won the World Cup.",
        [
          { data_part_id: "tool_data_01", locator: "/results/0/snippet", offset: 5 },
          { data_part_id: "tool_data_01", locator: "/results/1/snippet", offset: 22 },
        ],
        results,
      ),
    ];

    const chunks: { delta: string; text: string; done: boolean; citations: unknown[] }[] = [];
    for await (const chunk of collectCitations(makeAsyncIterable(events))) {
      chunks.push(chunk);
    }

    // 2 streaming chunks + 1 lastChunk
    expect(chunks).toHaveLength(3);

    // Streaming chunks: deltas present, citations empty
    expect(chunks[0].delta).toBe("Spain ");
    expect(chunks[0].done).toBe(false);
    expect(chunks[0].citations).toEqual([]);

    expect(chunks[1].delta).toBe("won the World Cup.");
    expect(chunks[1].done).toBe(false);
    expect(chunks[1].citations).toEqual([]);

    // Final chunk: delta empty, citations populated
    expect(chunks[2].delta).toBe("");
    expect(chunks[2].done).toBe(true);
    expect(chunks[2].citations).toHaveLength(2);
    expect(chunks[2].citations![0]).toMatchObject({
      offset: 5,
      url: "https://fifa.com/final",
      title: "FIFA World Cup 2026 Final",
      snippet: "Spain claimed ultimate glory...",
      siteName: "fifa.com",
    });
    expect(chunks[2].citations![1]).toMatchObject({
      offset: 22,
      url: "https://espn.com/world-cup",
      title: "World Cup Final Recap",
      snippet: "Spain beat Argentina 1-0...",
      siteName: "espn.com",
    });
  });

  it("extracts citations with correct source info from data parts", async () => {
    const results = [
      makeSearchResult("https://example.com/1", "Result One", "Snippet one", "example.com", "https://example.com/icon.png"),
      makeSearchResult("https://example.com/2", "Result Two", "Snippet two"),
      makeSearchResult("https://example.com/3", "Result Three", "Snippet three"),
    ];
    const event = makeCitationEvent(
      "Text with refs.",
      [
        { data_part_id: "tool_data_01", locator: "/results/0/snippet", offset: 0 },
        { data_part_id: "tool_data_01", locator: "/results/1/snippet", offset: 5 },
        { data_part_id: "tool_data_01", locator: "/results/2/snippet", offset: 10 },
      ],
      results,
    );

    const chunks = [];
    for await (const chunk of collectCitations(makeAsyncIterable([event]))) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].citations).toHaveLength(3);
    expect(chunks[0].citations![0]).toMatchObject({
      offset: 0,
      url: "https://example.com/1",
      title: "Result One",
      snippet: "Snippet one",
      siteName: "example.com",
      faviconUrl: "https://example.com/icon.png",
    });
    expect(chunks[0].citations![1]).toMatchObject({
      offset: 5,
      url: "https://example.com/2",
      title: "Result Two",
      snippet: "Snippet two",
    });
    expect(chunks[0].citations![2]).toMatchObject({
      offset: 10,
      url: "https://example.com/3",
      title: "Result Three",
      snippet: "Snippet three",
    });
  });

  it("handles empty locator (whole data object)", async () => {
    const event: StreamResponse = {
      artifactUpdate: {
        taskId: "task.1",
        contextId: "ctx.1",
        lastChunk: true,
        artifact: {
          artifactId: "art.1",
          parts: [
            {
              text: "Some text.",
              metadata: {
                citations: [{ data_part_id: "tool_data_01", locator: "", offset: 4 }],
                offsetUnit: "chars",
              },
            },
            {
              data: { url: "https://top-level.com", title: "Top Level Result", snippet: "Top snippet" },
              metadata: { dataPartId: "tool_data_01", toolName: "search" },
            },
          ],
        },
      },
    };

    const chunks = [];
    for await (const chunk of collectCitations(makeAsyncIterable([event]))) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].citations).toHaveLength(1);
    expect(chunks[0].citations![0]).toMatchObject({
      offset: 4,
      url: "https://top-level.com",
      title: "Top Level Result",
      snippet: "Top snippet",
    });
  });

  it("returns empty citations when no citation metadata exists", async () => {
    const event: StreamResponse = {
      artifactUpdate: {
        taskId: "task.1",
        contextId: "ctx.1",
        lastChunk: true,
        artifact: {
          artifactId: "art.1",
          parts: [
            { text: "No citations here." },
            {
              data: { results: [makeSearchResult("https://x.com", "X", "x")] },
              metadata: { dataPartId: "tool_data_01", toolName: "search" },
            },
          ],
        },
      },
    };

    const chunks = [];
    for await (const chunk of collectCitations(makeAsyncIterable([event]))) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].citations).toEqual([]);
  });

  it("returns empty citations when data part is missing", async () => {
    const event: StreamResponse = {
      artifactUpdate: {
        taskId: "task.1",
        contextId: "ctx.1",
        lastChunk: true,
        artifact: {
          artifactId: "art.1",
          parts: [
            {
              text: "Missing data.",
              metadata: {
                citations: [{ data_part_id: "nonexistent", locator: "/results/0/snippet", offset: 0 }],
                offsetUnit: "chars",
              },
            },
            {
              data: { results: [makeSearchResult("https://x.com", "X", "x")] },
              metadata: { dataPartId: "tool_data_01", toolName: "search" },
            },
          ],
        },
      },
    };

    const chunks = [];
    for await (const chunk of collectCitations(makeAsyncIterable([event]))) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].citations).toEqual([]);
  });

  it("returns empty citations when url is missing from source", async () => {
    const event: StreamResponse = {
      artifactUpdate: {
        taskId: "task.1",
        contextId: "ctx.1",
        lastChunk: true,
        artifact: {
          artifactId: "art.1",
          parts: [
            {
              text: "No URL.",
              metadata: {
                citations: [{ data_part_id: "tool_data_01", locator: "/results/0/snippet", offset: 0 }],
                offsetUnit: "chars",
              },
            },
            {
              data: { results: [{ title: "No URL Result", snippet: "snippet" }] },
              metadata: { dataPartId: "tool_data_01", toolName: "search" },
            },
          ],
        },
      },
    };

    const chunks = [];
    for await (const chunk of collectCitations(makeAsyncIterable([event]))) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].citations).toEqual([]);
  });

  it("skips non-artifactUpdate events", async () => {
    const events: StreamResponse[] = [
      { task: { id: "t1", contextId: "c1", status: { state: "TASK_STATE_SUBMITTED" } } },
      { statusUpdate: { taskId: "t1", status: { state: "TASK_STATE_WORKING" } } },
    ];

    const chunks = [];
    for await (const chunk of collectCitations(makeAsyncIterable(events))) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(0);
  });

  it("handles empty stream", async () => {
    const chunks = [];
    for await (const chunk of collectCitations(makeAsyncIterable([]))) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(0);
  });

  it("handles multiple data parts with different dataPartIds", async () => {
    const event: StreamResponse = {
      artifactUpdate: {
        taskId: "task.1",
        contextId: "ctx.1",
        lastChunk: true,
        artifact: {
          artifactId: "art.1",
          parts: [
            {
              text: "Multiple sources.",
              metadata: {
                citations: [
                  { data_part_id: "data_a", locator: "/results/0/snippet", offset: 0 },
                  { data_part_id: "data_b", locator: "/results/0/snippet", offset: 10 },
                ],
                offsetUnit: "chars",
              },
            },
            {
              data: { results: [makeSearchResult("https://a.com", "Source A", "A snippet")] },
              metadata: { dataPartId: "data_a", toolName: "search" },
            },
            {
              data: { results: [makeSearchResult("https://b.com", "Source B", "B snippet")] },
              metadata: { dataPartId: "data_b", toolName: "search" },
            },
          ],
        },
      },
    };

    const chunks = [];
    for await (const chunk of collectCitations(makeAsyncIterable([event]))) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].citations).toHaveLength(2);
    expect(chunks[0].citations![0]).toMatchObject({ url: "https://a.com", title: "Source A" });
    expect(chunks[0].citations![1]).toMatchObject({ url: "https://b.com", title: "Source B" });
  });

  it("deduplicates by preserving all citations (even if same URL)", async () => {
    const results = [
      makeSearchResult("https://same.com", "Same URL", "Snippet 1"),
      makeSearchResult("https://same.com", "Same URL", "Snippet 2"),
    ];
    const event = makeCitationEvent(
      "Two refs same URL.",
      [
        { data_part_id: "tool_data_01", locator: "/results/0/snippet", offset: 0 },
        { data_part_id: "tool_data_01", locator: "/results/1/snippet", offset: 5 },
      ],
      results,
    );

    const chunks = [];
    for await (const chunk of collectCitations(makeAsyncIterable([event]))) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].citations).toHaveLength(2);
    expect(chunks[0].citations![0].url).toBe("https://same.com");
    expect(chunks[0].citations![1].url).toBe("https://same.com");
  });

  it("handles missing text part metadata entirely", async () => {
    const event: StreamResponse = {
      artifactUpdate: {
        taskId: "task.1",
        contextId: "ctx.1",
        lastChunk: true,
        artifact: {
          artifactId: "art.1",
          parts: [
            { text: "No metadata at all." },
            {
              data: { results: [makeSearchResult("https://x.com", "X", "x")] },
              metadata: { dataPartId: "tool_data_01", toolName: "search" },
            },
          ],
        },
      },
    };

    const chunks = [];
    for await (const chunk of collectCitations(makeAsyncIterable([event]))) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].citations).toEqual([]);
  });

  it("skips citations with non-number offset", async () => {
    const event: StreamResponse = {
      artifactUpdate: {
        taskId: "task.1",
        contextId: "ctx.1",
        lastChunk: true,
        artifact: {
          artifactId: "art.1",
          parts: [
            {
              text: "Bad offset.",
              metadata: {
                citations: [
                  { data_part_id: "tool_data_01", locator: "/results/0/snippet", offset: "5" as unknown as number },
                  { data_part_id: "tool_data_01", locator: "/results/0/snippet", offset: 3 },
                ],
                offsetUnit: "chars",
              },
            },
            {
              data: { results: [makeSearchResult("https://x.com", "X", "x")] },
              metadata: { dataPartId: "tool_data_01", toolName: "search" },
            },
          ],
        },
      },
    };

    const chunks = [];
    for await (const chunk of collectCitations(makeAsyncIterable([event]))) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    // Only the valid numeric offset is kept; the string offset is skipped
    expect(chunks[0].citations).toHaveLength(1);
    expect(chunks[0].citations![0].offset).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// toMarkdown
// ---------------------------------------------------------------------------

describe("toMarkdown", () => {
  it("inserts [n] markers at citation offsets", () => {
    const md = toMarkdown("ABCDEF", [
      { offset: 3, url: "https://a.com" },
      { offset: 6, url: "https://b.com" },
    ]);
    expect(md).toBe("ABC[1]DEF[2]\n\n## Sources\n[1] https://a.com\n[2] https://b.com");
  });

  it("appends Sources section with numbered entries", () => {
    const md = toMarkdown("Hello world.", [
      { offset: 12, url: "https://example.com/page", title: "Example Page" },
    ]);
    expect(md).toContain("## Sources");
    expect(md).toContain("[1] Example Page — https://example.com/page");
  });

  it("handles empty citations array", () => {
    expect(toMarkdown("unchanged text", [])).toBe("unchanged text");
  });

  it("assigns sequential numbers by URL", () => {
    const md = toMarkdown("ABCDEF", [
      { offset: 3, url: "https://same.com" },
      { offset: 6, url: "https://same.com" },
    ]);
    expect(md).toBe("ABC[1]DEF[1]\n\n## Sources\n[1] https://same.com");
  });

  it("handles citations at the same offset", () => {
    const md = toMarkdown("ABCDE", [
      { offset: 5, url: "https://a.com" },
      { offset: 5, url: "https://b.com" },
    ]);
    expect(md).toBe("ABCDE[1][2]\n\n## Sources\n[1] https://a.com\n[2] https://b.com");
  });

  it("handles citation offset beyond text length", () => {
    const md = toMarkdown("short", [
      { offset: 100, url: "https://a.com" },
    ]);
    expect(md).toBe("short[1]\n\n## Sources\n[1] https://a.com");
  });

  it("uses siteName when title is missing", () => {
    const md = toMarkdown("text", [
      { offset: 4, url: "https://example.com", siteName: "example.com" },
    ]);
    expect(md).toContain("[1] example.com — https://example.com");
  });

  it("uses URL when both title and siteName are missing", () => {
    const md = toMarkdown("text", [
      { offset: 4, url: "https://example.com" },
    ]);
    expect(md).toContain("[1] https://example.com");
    expect(md).not.toContain("https://example.com — https://example.com");
  });

  it("sorts citations by offset before inserting", () => {
    const md = toMarkdown("ABCDEF", [
      { offset: 6, url: "https://b.com" },
      { offset: 3, url: "https://a.com" },
    ]);
    expect(md).toBe("ABC[1]DEF[2]\n\n## Sources\n[1] https://a.com\n[2] https://b.com");
  });

  it("handles single citation", () => {
    const md = toMarkdown("Hello world.", [
      { offset: 12, url: "https://example.com", title: "Example" },
    ]);
    expect(md).toBe("Hello world.[1]\n\n## Sources\n[1] Example — https://example.com");
  });

  it("preserves text exactly when no citations overlap with content", () => {
    const text = "Line one\nLine two\n";
    const md = toMarkdown(text, [{ offset: text.length, url: "https://a.com" }]);
    expect(md).toBe("Line one\nLine two\n[1]\n\n## Sources\n[1] https://a.com");
  });
});

// ---------------------------------------------------------------------------
// Integration: collectCitations + toMarkdown
// ---------------------------------------------------------------------------

describe("integration: collectCitations + toMarkdown", () => {
  it("end-to-end: stream → collectCitations → toMarkdown", async () => {
    const results = [
      makeSearchResult("https://fifa.com/final", "FIFA World Cup 2026 Final", "Spain claimed ultimate glory..."),
      makeSearchResult("https://espn.com/world-cup", "World Cup Recap", "Spain beat Argentina 1-0..."),
    ];
    const events: StreamResponse[] = [
      { task: { id: "task.1", contextId: "ctx.1", status: { state: "TASK_STATE_SUBMITTED" } } },
      { statusUpdate: { taskId: "task.1", contextId: "ctx.1", status: { state: "TASK_STATE_WORKING" } } },
      {
        artifactUpdate: {
          taskId: "task.1",
          contextId: "ctx.1",
          artifact: { artifactId: "art.1", parts: [{ text: "Spain " }] },
        },
      },
      {
        artifactUpdate: {
          taskId: "task.1",
          contextId: "ctx.1",
          artifact: { artifactId: "art.1", parts: [{ text: "won the World Cup." }] },
          append: true,
        },
      },
      makeCitationEvent(
        "Spain won the World Cup.",
        [
          { data_part_id: "tool_data_01", locator: "/results/0/snippet", offset: 5 },
          { data_part_id: "tool_data_01", locator: "/results/1/snippet", offset: 22 },
        ],
        results,
      ),
    ];

    const sseChunks = events.map((e) => `data: ${JSON.stringify(e)}\n\n`);
    const stream = parseA2AStream(makeStream(sseChunks));

    let finalText = "";
    let finalCitations: { offset: number; url: string; title?: string; snippet?: string; siteName?: string; faviconUrl?: string }[] = [];
    for await (const chunk of collectCitations(stream)) {
      if (chunk.done) {
        finalText = chunk.text;
        finalCitations = chunk.citations;
      }
    }

    const md = toMarkdown(finalText, finalCitations);

    expect(md).toContain("[1]");
    expect(md).toContain("[2]");
    expect(md).toContain("## Sources");
    expect(md).toContain("FIFA World Cup 2026 Final — https://fifa.com/final");
    expect(md).toContain("World Cup Recap — https://espn.com/world-cup");
  });
});
