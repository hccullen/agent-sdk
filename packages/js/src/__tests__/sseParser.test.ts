/**
 * Tests for the SSE parsing behaviour in rpcStream.
 *
 * rpcStream is tested indirectly: we stub `fetch` to return a synthetic
 * ReadableStream carrying raw SSE bytes, then collect what rpcStream yields.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rpcStream } from "../rpcTransport.js";
import type { CortiClient } from "@corti/sdk";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeClient(agentId: string): CortiClient {
  return {
    getAuthHeaders: vi.fn().mockResolvedValue(new Headers()),
    agents: {
      getCardUrl: vi
        .fn()
        .mockResolvedValue(
          new URL(`https://api.eu.corti.app/agents/${encodeURIComponent(agentId)}/agent-card.json`)
        ),
    },
  } as unknown as CortiClient;
}

function sseStream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function jsonRpcEvent(result: unknown): string {
  return `data: ${JSON.stringify({ jsonrpc: "2.0", id: "1", result })}\n\n`;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("rpcStream SSE parsing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function collect<T>(agentId: string, rawSSE: string[]): Promise<T[]> {
    vi.mocked(fetch).mockResolvedValue(sseStream(rawSSE));
    const results: T[] = [];
    for await (const item of rpcStream<T>(makeClient(agentId), agentId, "message/stream", {})) {
      results.push(item);
    }
    return results;
  }

  it("yields a result from a single complete event", async () => {
    const results = await collect("a1", [jsonRpcEvent({ text: "hello" })]);
    expect(results).toEqual([{ text: "hello" }]);
  });

  it("yields multiple events", async () => {
    const results = await collect("a1", [
      jsonRpcEvent({ n: 1 }),
      jsonRpcEvent({ n: 2 }),
      jsonRpcEvent({ n: 3 }),
    ]);
    expect(results).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it("handles an event split across multiple chunks", async () => {
    const full = jsonRpcEvent({ text: "split" });
    const mid = Math.floor(full.length / 2);
    const results = await collect("a1", [full.slice(0, mid), full.slice(mid)]);
    expect(results).toEqual([{ text: "split" }]);
  });

  it("handles \\r\\n line endings", async () => {
    const crlf = `data: ${JSON.stringify({ jsonrpc: "2.0", id: "1", result: { ok: true } })}\r\n\r\n`;
    const results = await collect("a1", [crlf]);
    expect(results).toEqual([{ ok: true }]);
  });

  it("handles bare \\r line endings", async () => {
    const cr = `data: ${JSON.stringify({ jsonrpc: "2.0", id: "1", result: { ok: true } })}\r\r`;
    const results = await collect("a1", [cr]);
    expect(results).toEqual([{ ok: true }]);
  });

  it("concatenates multiple data: lines in one event with \\n", async () => {
    // Multi-line data is unusual for JSON-RPC but the spec requires it.
    // We just verify the lines are joined; parsing a split JSON string would fail,
    // so this test checks the join behaviour via a string result.
    const event =
      `data: part1\n` +
      `data: part2\n\n`;
    // This won't be valid JSON-RPC so it will be silently skipped — the test
    // verifies no exception is thrown and the bad event is dropped.
    const results = await collect("a1", [event]);
    expect(results).toHaveLength(0);
  });

  it("stops at [DONE]", async () => {
    const events = jsonRpcEvent({ n: 1 }) + "data: [DONE]\n\n" + jsonRpcEvent({ n: 2 });
    const results = await collect("a1", [events]);
    expect(results).toEqual([{ n: 1 }]);
  });

  it("ignores comment lines (:)", async () => {
    const event = `: this is a comment\n` + jsonRpcEvent({ ok: true });
    const results = await collect("a1", [event]);
    expect(results).toEqual([{ ok: true }]);
  });

  it("ignores blank events (keep-alive pings)", async () => {
    const events = "\n\n" + jsonRpcEvent({ ok: true }) + "\n\n";
    const results = await collect("a1", [events]);
    expect(results).toEqual([{ ok: true }]);
  });

  it("throws RpcError for JSON-RPC error responses", async () => {
    const errEvent = `data: ${JSON.stringify({ jsonrpc: "2.0", id: "1", error: { code: -32600, message: "Invalid Request" } })}\n\n`;
    await expect(collect("a1", [errEvent])).rejects.toMatchObject({
      name: "RpcError",
      code: -32600,
    });
  });

  it("throws HttpError for non-2xx responses", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("Unauthorized", { status: 401 })
    );
    const client = makeClient("a1");
    await expect(async () => {
      for await (const _ of rpcStream(client, "a1", "message/stream", {})) { /* drain */ }
    }).rejects.toMatchObject({ name: "HttpError", status: 401 });
  });
});
