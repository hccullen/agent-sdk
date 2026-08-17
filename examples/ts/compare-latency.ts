/**
 * compare-latency — Run simple and web-search queries against both
 * staging-eu and dev-weu, measure per-request latency, and compare.
 *
 * Run: `npx tsx compare-latency.ts`
 */
import { CortiClient, CortiEnvironment } from "@corti/sdk";
import { AgentsClient, connectors } from "@newsioaps/agent-sdk";
import { writeFileSync } from "fs";

// ── Environment configs ─────────────────────────────────────────────────────

const ENVS = {
  "staging-eu": {
    tenant: "base",
    clientId: "corti-hc-0e20155c-e528-4d92-9249-13bb3e17aaaa-test",
    clientSecret: "xmrN8J6OOAqZNgf0FrZqWxiyxwvKqzN7",
    env: "staging-eu",
  },
  "dev-weu": {
    tenant: "base",
    clientId: "corti-testing-bb04f724-ba49-4c64-9992-3169112406a8-default_client",
    clientSecret: "hWdjsH4Uqys9pXyWnjeQLKX7pFlr5Cu2",
    env: "dev-weu",
  },
} as const;

type EnvName = keyof typeof ENVS;

// ── Timing ──────────────────────────────────────────────────────────────────

interface Timing {
  label: string;
  env: EnvName;
  url: string;
  totalMs: number;
  status: string;
  textLen: number;
  error?: string;
}

function makeClient(env: typeof ENVS[EnvName]): CortiClient {
  return new CortiClient({
    tenantName: env.tenant,
    environment: env.env as unknown as typeof CortiEnvironment.Eu,
    auth: { clientId: env.clientId, clientSecret: env.clientSecret },
  });
}

async function timed(
  label: string,
  envName: EnvName,
  url: string,
  fn: () => Promise<{ status?: string; text?: string | null }>,
): Promise<Timing> {
  const start = performance.now();
  try {
    const result = await fn();
    const totalMs = Math.round(performance.now() - start);
    return {
      label,
      env: envName,
      url,
      totalMs,
      status: result.status ?? "?",
      textLen: (result.text ?? "").length,
    };
  } catch (e) {
    const totalMs = Math.round(performance.now() - start);
    return {
      label,
      env: envName,
      url,
      totalMs,
      status: "error",
      textLen: 0,
      error: (e as Error).message.slice(0, 120),
    };
  }
}

// ── Run latency tests against one environment ──────────────────────────────

async function runLatencyTests(envName: EnvName): Promise<Timing[]> {
  const env = ENVS[envName];
  const client = makeClient(env);

  // Pre-warm auth token so it doesn't inflate the first request
  await client.getAuthHeaders();

  const agents = new AgentsClient(client);
  const timings: Timing[] = [];

  // ── Simple agent ──────────────────────────────────────────────────────────

  const agent = await agents.create({
    name: `latency-${envName}`,
    description: "Ephemeral agent for latency benchmarking.",
    systemPrompt: "You are a concise assistant. Reply in one sentence max.",
  });

  const baseUrl = `https://api.${env.env}.corti.app`;
  const agentUrl = `${baseUrl}/agents/${encodeURIComponent(agent.id)}/v1`;

  const ctx = agent.createContext();

  // Run 1: first turn (cold context)
  timings.push(await timed(
    "Simple — turn 1 (cold context)",
    envName, agentUrl,
    () => ctx.sendText("Say hello in exactly three words."),
  ));

  // Run 2: second turn (warm context)
  timings.push(await timed(
    "Simple — turn 2 (warm context)",
    envName, agentUrl,
    () => ctx.sendText("Now say goodbye in exactly three words."),
  ));

  // Run 3: one-shot agent.run() (fresh context each call)
  timings.push(await timed(
    "Simple — one-shot agent.run()",
    envName, agentUrl,
    () => agent.run("What is 2 + 2?"),
  ));

  // Run 4: slightly longer prompt
  timings.push(await timed(
    "Simple — longer prompt (30 words)",
    envName, agentUrl,
    () => ctx.sendText(
      "Please confirm you understand this is a latency test and respond with exactly the word 'confirmed'.",
    ),
  ));

  // Run 5: repeated short prompt to measure variance
  for (let i = 1; i <= 3; i++) {
    timings.push(await timed(
      `Simple — repeat ${i}/3`,
      envName, agentUrl,
      () => ctx.sendText(`Reply with exactly the number ${i}.`),
    ));
  }

  try { await agent.delete(); } catch { /* ephemeral */ }

  // ── Web-search agent (via MCP Tavily gateway) ─────────────────────────────

  const webAgent = await agents.create({
    name: `latency-mcp-${envName}`,
    description: "Ephemeral agent with MCP web_search connector for latency benchmarking.",
    systemPrompt: "You are a concise assistant. Use the web_search tool when needed to answer factual questions. Answer in one sentence.",
    connectors: [
      connectors.mcp({
        mcpUrl: "http://mcp-gateway.shared:80/tavily/mcp",
        name: "web_search",
        transport: "streamable_http",
        authType: "none",
      }),
    ],
  });

  const webUrl = `${baseUrl}/agents/${encodeURIComponent(webAgent.id)}/v1`;

  // Run 6: MCP web-search — date question
  timings.push(await timed(
    "MCP web-search — date question",
    envName, webUrl,
    () => webAgent.run("What is today's date?", { timeoutInSeconds: 120 }),
  ));

  // Run 7: MCP web-search — factual question
  timings.push(await timed(
    "MCP web-search — factual question (FIFA)",
    envName, webUrl,
    () => webAgent.run("Who won the most recent FIFA World Cup?", { timeoutInSeconds: 120 }),
  ));

  // Run 8: MCP web-search — technical question
  timings.push(await timed(
    "MCP web-search — technical question",
    envName, webUrl,
    () => webAgent.run("What is the latest version of Python?", { timeoutInSeconds: 120 }),
  ));

  try { await webAgent.delete(); } catch { /* ephemeral */ }

  return timings;
}

// ── Reporting ────────────────────────────────────────────────────────────────

function printTable(staging: Timing[], dev: Timing[]) {
  const labels = [...new Set(staging.map((t) => t.label))];

  console.log(`\n${"=".repeat(90)}`);
  console.log("Latency Comparison: staging-eu vs dev-weu");
  console.log(`${"=".repeat(90)}`);
  console.log("");

  // Header
  const hdr = `${"Test".padEnd(42)} ${"staging-eu".padStart(10)} ${"dev-weu".padStart(10)} ${"delta".padStart(10)} ${"ratio".padStart(8)}`;
  console.log(hdr);
  console.log(`${"-".repeat(90)}`);

  let sTotal = 0;
  let dTotal = 0;

  for (const label of labels) {
    const s = staging.find((t) => t.label === label);
    const d = dev.find((t) => t.label === label);
    const sMs = s?.totalMs ?? 0;
    const dMs = d?.totalMs ?? 0;
    const delta = dMs - sMs;
    const ratio = sMs > 0 ? (dMs / sMs).toFixed(2) + "x" : "—";
    const deltaStr = delta >= 0 ? `+${delta}ms` : `${delta}ms`;

    sTotal += sMs;
    dTotal += dMs;

    // Truncate label to 40 chars
    const l = label.length > 40 ? label.slice(0, 37) + "..." : label;

    // Status indicators
    const sStatus = s?.status === "completed" ? "" : ` (${s?.status ?? "?"})`;
    const dStatus = d?.status === "completed" ? "" : ` (${d?.status ?? "?"})`;

    console.log(
      `${l.padEnd(42)} ${(sMs + "ms").padStart(8)}${sStatus.padEnd(2)} ${(dMs + "ms").padStart(8)}${dStatus.padEnd(2)} ${deltaStr.padStart(10)} ${ratio.padStart(8)}`,
    );
  }

  console.log(`${"-".repeat(90)}`);
  const deltaTotal = dTotal - sTotal;
  const ratioTotal = sTotal > 0 ? (dTotal / sTotal).toFixed(2) + "x" : "—";
  console.log(
    `${"TOTAL".padEnd(42)} ${(sTotal + "ms").padStart(10)} ${(dTotal + "ms").padStart(10)} ${(deltaTotal >= 0 ? "+" : "") + deltaTotal + "ms".padStart(9)} ${ratioTotal.padStart(8)}`,
  );
  console.log(`${"-".repeat(90)}`);
  const sAvg = sTotal / labels.length;
  const dAvg = dTotal / labels.length;
  console.log(
    `${"AVERAGE".padEnd(42)} ${(Math.round(sAvg) + "ms").padStart(10)} ${(Math.round(dAvg) + "ms").padStart(10)}`,
  );

  // Simple vs web-search breakdown
  const sSimple = staging.filter((t) => t.label.startsWith("Simple"));
  const dSimple = dev.filter((t) => t.label.startsWith("Simple"));
  const sWeb = staging.filter((t) => t.label.startsWith("MCP web-search"));
  const dWeb = dev.filter((t) => t.label.startsWith("MCP web-search"));

  const sSimpleSum = sSimple.reduce((a, t) => a + t.totalMs, 0);
  const dSimpleSum = dSimple.reduce((a, t) => a + t.totalMs, 0);
  const sWebSum = sWeb.reduce((a, t) => a + t.totalMs, 0);
  const dWebSum = dWeb.reduce((a, t) => a + t.totalMs, 0);

  console.log("");
  console.log(`${"Breakdown:".padEnd(42)} ${"staging-eu".padStart(10)} ${"dev-weu".padStart(10)}`);
  console.log(`${"  Simple queries (7 calls)".padEnd(42)} ${(sSimpleSum + "ms").padStart(10)} ${(dSimpleSum + "ms").padStart(10)}`);
  console.log(`${"  MCP web-search queries (3 calls)".padEnd(42)} ${(sWebSum + "ms").padStart(10)} ${(dWebSum + "ms").padStart(10)}`);
  if (sSimple.length > 0 && dSimple.length > 0) {
    console.log(`${"  Simple avg per call".padEnd(42)} ${(Math.round(sSimpleSum / sSimple.length) + "ms").padStart(10)} ${(Math.round(dSimpleSum / dSimple.length) + "ms").padStart(10)}`);
  }
  if (sWeb.length > 0 && dWeb.length > 0) {
    console.log(`${"  Web-search avg per call".padEnd(42)} ${(Math.round(sWebSum / sWeb.length) + "ms").padStart(10)} ${(Math.round(dWebSum / dWeb.length) + "ms").padStart(10)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n>>> Running latency tests against staging-eu...");
  const stagingTimings = await runLatencyTests("staging-eu");
  console.log(`  ${stagingTimings.length} requests completed.`);

  console.log("\n>>> Running latency tests against dev-weu...");
  const devTimings = await runLatencyTests("dev-weu");
  console.log(`  ${devTimings.length} requests completed.`);

  // Print comparison table
  printTable(stagingTimings, devTimings);

  // Save raw timings
  writeFileSync(
    "/tmp/opencode/latency-comparison.json",
    JSON.stringify({ staging: stagingTimings, dev: devTimings }, null, 2),
  );
  console.log("\nRaw timings saved to /tmp/opencode/latency-comparison.json");
  console.log("Done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
