/**
 * 08 — Send-message latency benchmarks.
 *
 * Creates a short-lived agent, fires several sendText calls, and prints
 * the URL, a short description, and wall-clock latency for each request.
 * Also runs a separate agent wired with the web-search-expert connector
 * to measure the overhead of a grounded web-search turn.
 *
 * Run: `npx tsx 08-latency-test.ts`
 */
import "dotenv/config";
import { CortiClient } from "@corti/sdk";
import { AgentsClient, connectors } from "@newsioaps/agent-sdk";
import { makeClient } from "./_client.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function agentsBaseUrl(client: CortiClient): string {
  const opts = (client as unknown as {
    _options: { baseUrl?: string; environment?: { agents?: string } };
  })._options;
  const base = opts.baseUrl ?? opts.environment?.agents ?? "";
  return base.replace(/\/+$/, "");
}

// Patch globalThis.fetch to capture per-request TTFB vs body-download timing.
interface FetchTiming { ttfb: number; download: number }
const fetchTimings: FetchTiming[] = [];

function patchFetch() {
  const orig = globalThis.fetch.bind(globalThis);
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async (input, init) => {
    const t0 = performance.now();
    const resp = await orig(input, init);
    const ttfb = performance.now() - t0;

    const wrapBody = <T>(fn: () => Promise<T>) => () => {
      const t1 = performance.now();
      return fn().then((v) => {
        fetchTimings.push({ ttfb, download: performance.now() - t1 });
        return v;
      });
    };
    Object.defineProperty(resp, "json", { value: wrapBody(resp.json.bind(resp)), writable: true });
    Object.defineProperty(resp, "text", { value: wrapBody(resp.text.bind(resp)), writable: true });
    return resp;
  };
}

async function timed<T>(
  label: string,
  url: string,
  fn: () => Promise<T>
): Promise<T> {
  const before = fetchTimings.length;
  const start = performance.now();
  const result = await fn();
  const total = Math.round(performance.now() - start);

  // Sum all fetch phases that fired during this call (usually one).
  let ttfb = 0, download = 0;
  for (let i = before; i < fetchTimings.length; i++) {
    ttfb     += fetchTimings[i].ttfb;
    download += fetchTimings[i].download;
  }
  const overhead = total - Math.round(ttfb + download);

  console.log(`URL:         ${url}`);
  console.log(`Description: ${label}`);
  console.log(`Total:       ${total} ms  (TTFB ${Math.round(ttfb)} ms | download ${Math.round(download)} ms | SDK overhead ${overhead} ms)`);
  console.log("─".repeat(60));
  return result;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const client = makeClient();

  // Pre-warm auth token so it doesn't inflate the first timed request.
  await client.getAuthHeaders();

  patchFetch();

  const agents = new AgentsClient(client);

  const agent = await agents.create({
    name: "latency-bench",
    description: "Ephemeral agent used for latency benchmarking.",
    systemPrompt: "You are a concise assistant. Reply in one sentence max.",
  });

  const baseUrl = agentsBaseUrl(client);
  const url = `${baseUrl}/agents/${encodeURIComponent(agent.id)}/v1`;

  console.log("\n=== Send-message latency test ===\n");

  // Run 1: first turn (cold context, server allocates contextId)
  const ctx = agent.createContext();
  await timed("First turn — cold context, server assigns contextId", url, () =>
    ctx.sendText("Say hello in exactly three words.")
  );

  // Run 2: second turn (warm context, same thread)
  await timed("Second turn — warm context, multi-turn thread", url, () =>
    ctx.sendText("Now say goodbye in exactly three words.")
  );

  // Run 3: one-shot via agent.run() (creates its own fresh context)
  await timed("One-shot agent.run() — fresh context each call", url, () =>
    agent.run("What is 2 + 2?")
  );

  // Run 4: slightly longer prompt to observe prompt-size effect
  await timed("Longer prompt — 30-word input", url, () =>
    ctx.sendText(
      "Please confirm you understand this is a latency test and respond with exactly the word 'confirmed'."
    )
  );

  await agent.delete();

  // ── Web-search-expert connector ─────────────────────────────────────────
  console.log("\n=== Web-search-expert latency test ===\n");

  const webAgent = await agents.create({
    name: "latency-bench-web",
    description: "Ephemeral agent with web-search-expert connector for latency benchmarking.",
    systemPrompt: "You are a concise assistant. Answer in one sentence using the web-search-expert when needed.",
    connectors: [connectors.registry({ name: "web-search-expert" })],
  });

  const webUrl = `${baseUrl}/agents/${encodeURIComponent(webAgent.id)}/v1`;

  // Run 5: question that requires a web search
  await timed("Web-search turn — grounded lookup via web-search-expert", webUrl, () =>
    webAgent.run("What is today's date?", { timeoutInSeconds: 60 })
  );

  // Run 6: second web-search turn on a fresh context
  await timed("Web-search turn — factual question needing live data", webUrl, () =>
    webAgent.run("Who won the most recent FIFA World Cup?", { timeoutInSeconds: 60 })
  );

  await webAgent.delete();
  console.log("Agents cleaned up.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
