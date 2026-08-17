/**
 * compare-envs — Run the same API operations against two environments
 * (staging-eu and dev-weu) and compare the raw JSON responses to catch
 * accidental API changes in DEV.
 *
 * Captures every HTTP request/response pair via a fetch interceptor,
 * normalises non-deterministic values (IDs, tokens, timestamps, LLM text),
 * and reports structural differences.
 *
 * Run: `npx tsx compare-envs.ts`
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

// ── HTTP capture ──────────────────────────────────────────────────────────────

interface CapturedCall {
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  status: number;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  rawResponseText: string;
  isStream: boolean;
}

function makeClient(env: typeof ENVS[EnvName]): CortiClient {
  return new CortiClient({
    tenantName: env.tenant,
    environment: env.env as unknown as typeof CortiEnvironment.Eu,
    auth: { clientId: env.clientId, clientSecret: env.clientSecret },
  });
}

// Global backup of the original fetch — set before any patching.
const ORIG_FETCH = globalThis.fetch.bind(globalThis);

/**
 * Patch fetch to capture all HTTP traffic.
 * Returns `{ calls, done }` where `done` resolves after ALL background
 * stream captures complete.
 */
function patchFetch(): {
  calls: CapturedCall[];
  done: Promise<void>;
} {
  const calls: CapturedCall[] = [];
  const pending: Promise<void>[] = [];

  (globalThis as unknown as { fetch: typeof fetch }).fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const method = init?.method ?? "GET";

    // Capture request headers (exclude authorization)
    const reqHeaders: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers;
      if (h instanceof Headers) {
        h.forEach((v, k) => {
          if (!k.toLowerCase().startsWith("authorization")) reqHeaders[k] = v;
        });
      } else if (typeof h === "object") {
        for (const [k, v] of Object.entries(h)) {
          if (!k.toLowerCase().startsWith("authorization")) reqHeaders[k] = String(v);
        }
      }
    }

    // Capture request body
    let reqBody: unknown = undefined;
    if (init?.body) {
      try {
        reqBody = JSON.parse(init.body as string);
      } catch {
        reqBody = String(init.body);
      }
    }

    const resp = await ORIG_FETCH(input, init);

    // Capture response headers
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => (respHeaders[k] = v));

    const ct = resp.headers.get("content-type") ?? "";
    const isStream = ct.includes("text/event-stream") || ct.includes("application/x-ndjson");

    if (isStream) {
      // For streaming: clone and capture in background, return immediately.
      const cloned = resp.clone();
      const p = cloned
        .text()
        .then((rawText) => {
          let parsed: unknown = rawText;
          try {
            parsed = JSON.parse(rawText);
          } catch {
            // keep as text (SSE, etc.)
          }
          calls.push({
            url,
            method,
            requestHeaders: reqHeaders,
            requestBody: reqBody,
            status: resp.status,
            responseHeaders: respHeaders,
            responseBody: parsed,
            rawResponseText: rawText,
            isStream: true,
          });
        })
        .catch(() => {})
        .then(() => {});
      pending.push(p);
      return resp;
    }

    // Non-streaming: read synchronously
    const cloned = resp.clone();
    const rawText = await cloned.text().catch(() => "");
    let respBody: unknown = rawText;
    try {
      respBody = JSON.parse(rawText);
    } catch {
      // keep as text
    }

    calls.push({
      url,
      method,
      requestHeaders: reqHeaders,
      requestBody: reqBody,
      status: resp.status,
      responseHeaders: respHeaders,
      responseBody: respBody,
      rawResponseText: rawText,
      isStream: false,
    });

    return resp;
  };

  return {
    calls,
    done: Promise.all(pending).then(() => {}),
  };
}

function restoreFetch(): void {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = ORIG_FETCH;
}

// ── Normalisation ────────────────────────────────────────────────────────────

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g;
const NONDET_FIELDS = new Set([
  "id", "contextId", "taskId", "messageId", "agentId",
  "createdAt", "updatedAt", "expiresAt", "tokenType",
  "expiresIn", "refreshExpiresIn",
]);

function normalise(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value
      .replace(UUID_RE, "<uuid>")
      .replace(ISO_RE, "<timestamp>")
      .replace(/Bearer [^\s,]+/gi, "Bearer <token>");
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(normalise);
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (NONDET_FIELDS.has(k)) {
        result[k] = "<redacted>";
        continue;
      }
      // Redact LLM text content (we only care about structure)
      if (k === "text" && typeof v === "string") {
        result[k] = "<text>";
        continue;
      }
      // Redact auth tokens
      if (k === "access_token" || k === "accessToken" || k === "refresh_token" || k === "refreshToken") {
        result[k] = "<token>";
        continue;
      }
      result[k] = normalise(v);
    }
    return result;
  }
  return value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Extractors ────────────────────────────────────────────────────────────────

function isRpcCall(c: CapturedCall): boolean {
  const body = c.requestBody;
  return !!body && typeof body === "object" && "jsonrpc" in body;
}

function extractRest(calls: CapturedCall[]) {
  return calls
    .filter((c) => !isRpcCall(c) && !c.url.includes("/token") && !c.url.includes("agent-card.json"))
    .map((c) => ({
      url: normaliseUrl(c.url),
      method: c.method,
      status: c.status,
      body: c.responseBody,
    }));
}

function extractAgentCards(calls: CapturedCall[]) {
  return calls
    .filter((c) => c.url.includes("agent-card.json"))
    .map((c) => ({
      url: normaliseUrl(c.url),
      method: c.method,
      status: c.status,
      body: c.responseBody,
    }));
}

function extractRpcSend(calls: CapturedCall[]) {
  return calls
    .filter((c) => isRpcCall(c) && (c.requestBody as Record<string, unknown>).method === "message/send")
    .map((c) => ({
      url: normaliseUrl(c.url),
      method: (c.requestBody as Record<string, unknown>).method as string,
      body: c.responseBody,
    }));
}

function extractRpcStream(calls: CapturedCall[]) {
  return calls
    .filter((c) => isRpcCall(c) && (c.requestBody as Record<string, unknown>).method === "message/stream")
    .map((c) => c.rawResponseText);
}

function normaliseUrl(url: string): string {
  return url
    .replace(/\/agents\/[0-9a-f-]{36}/gi, "/agents/<id>")
    .replace(/\/agents\/[^/?]+\/v1/, "/agents/<id>/v1")
    .replace(/\/agents\/[^/]+\/agent-card\.json/, "/agents/<id>/agent-card.json");
}

// ── Run operations against one environment ───────────────────────────────────

async function runAll(envName: EnvName): Promise<CapturedCall[]> {
  const env = ENVS[envName];
  const { calls, done } = patchFetch();
  const client = makeClient(env);

  // Pre-warm auth
  await client.getAuthHeaders();

  const agents = new AgentsClient(client);

  // 1. Agent CRUD: create
  const agent = await agents.create({
    name: `compare-test-${envName}`,
    description: "Comparison test agent.",
    systemPrompt: "You are a concise assistant. Reply in one sentence.",
  });

  // 2. Agent CRUD: get
  await agents.get(agent.id);

  // 3. Agent CRUD: list
  await agents.list();

  // 4. Message send (JSON-RPC) — first turn
  const ctx = agent.createContext();
  const reply1 = await ctx.sendText("Say hello in exactly three words.");
  console.log(`  [${envName}] sendText reply: ${reply1.text}`);

  // 5. Message send — second turn (warm context)
  const reply2 = await ctx.sendText("Now say goodbye in exactly three words.");
  console.log(`  [${envName}] followUp reply: ${reply2.text}`);

  // 6. One-shot agent.run()
  const reply3 = await agent.run("What is 2 + 2?");
  console.log(`  [${envName}] run() reply: ${reply3.text}`);

  // 7. Agent update
  await agent.update({ systemPrompt: "You are now more concise." });

  // 8. Message stream (JSON-RPC SSE)
  const streamCtx = agent.createContext();
  const stream = await streamCtx.streamMessage([
    { kind: "text" as const, text: "Say hello in exactly three words." },
  ]);
  for await (const event of stream) {
    if (event.statusUpdate) {
      console.log(`  [${envName}] stream status: ${event.statusUpdate.status.state}`);
    }
    if (event.message) {
      const texts = event.message.parts
        ?.filter((p) => p.kind === "text")
        .map((p) => (p as { text: string }).text);
      if (texts?.length) console.log(`  [${envName}] stream message: ${texts.join("")}`);
    }
  }

  // 9. Agent with connector (fromAgent)
  const subAgent = await agents.create({
    name: `compare-sub-${envName}`,
    description: "Sub-agent for connector test.",
    systemPrompt: "Reply with exactly one word.",
  });

  const orchestrator = await agents.create({
    name: `compare-orch-${envName}`,
    description: "Orchestrator with sub-agent connector.",
    systemPrompt: "You are a test orchestrator. Reply concisely.",
    connectors: [connectors.fromAgent({ agentId: subAgent.id })],
  });

  const connReply = await orchestrator.run("Say hello.", { timeoutInSeconds: 120 });
  console.log(`  [${envName}] connector reply: ${connReply.text}`);

  // 10. Registry expert connector (web-search-expert)
  console.log(`  [${envName}] Testing registry expert (web-search-expert)...`);
  try {
    const webAgent = await agents.create({
      name: `compare-web-${envName}`,
      description: "Agent with web-search-expert connector.",
      systemPrompt: "You are a concise assistant. Answer in one sentence using the web-search-expert when needed.",
      connectors: [connectors.registry({ name: "web-search-expert" })],
    });

    const webReply = await webAgent.run("What is today's date?", { timeoutInSeconds: 60 });
    console.log(`  [${envName}] web-search reply: ${webReply.text}`);

    const webReply2 = await webAgent.run("Who won the most recent FIFA World Cup?", { timeoutInSeconds: 60 });
    console.log(`  [${envName}] web-search reply 2: ${webReply2.text}`);

    try { await webAgent.delete(); } catch { /* ephemeral */ }
  } catch (e) {
    console.log(`  [${envName}] registry expert error: ${(e as Error).message}`);
  }

  // 11. Error handling: non-existent agent GET
  const FAKE_ID = "00000000-0000-0000-0000-000000000000";
  try { await agents.get(FAKE_ID); } catch (e) { console.log(`  [${envName}] GET fake-id: ${(e as Error).message.slice(0, 80)}`); }

  // 12. Error handling: non-existent agent DELETE
  try { await client.agents.delete(FAKE_ID); } catch (e) { console.log(`  [${envName}] DELETE fake-id: ${(e as Error).message.slice(0, 80)}`); }

  // 13. Error handling: send message to non-existent agent (raw RPC via fetch)
  try {
    const cardUrl = await client.agents.getCardUrl(FAKE_ID);
    const rpcUrl = new URL("v1", cardUrl).href;
    const authHeaders = await client.getAuthHeaders();
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    authHeaders.forEach((v, k) => (headers[k] = v));
    await fetch(rpcUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0", id: "error-test", method: "message/send",
        params: { message: { role: "user", parts: [{ kind: "text", text: "hello" }], messageId: "fake", kind: "message" } },
      }),
    });
  } catch (e) { console.log(`  [${envName}] RPC fake-id: ${(e as Error).message.slice(0, 80)}`); }

  // 14. Error handling: update non-existent agent
  try {
    await client.agents.update(FAKE_ID, { systemPrompt: "test" } as never);
  } catch (e) { console.log(`  [${envName}] PATCH fake-id: ${(e as Error).message.slice(0, 80)}`); }

  // 15. Cleanup (delete orchestrator first — it also deletes its sub-agent experts)
  for (const a of [orchestrator, subAgent, agent]) {
    try { await a.delete(); } catch (e) { console.log(`  [${envName}] delete warning: ${(e as Error).message.slice(0, 80)}`); }
  }

  // Wait for all background stream captures
  await done;

  restoreFetch();
  return calls;
}

// ── Comparison helpers ───────────────────────────────────────────────────────

function compareJson(path: string, a: unknown, b: unknown): void {
  if (a === null || a === undefined) {
    if (b !== null && b !== undefined) {
      console.log(`    ${path || "<root>"}: staging=null/undefined vs dev=${JSON.stringify(b).slice(0, 120)}`);
    }
    return;
  }
  if (b === null || b === undefined) {
    console.log(`    ${path || "<root>"}: staging=${JSON.stringify(a).slice(0, 120)} vs dev=null/undefined`);
    return;
  }
  if (typeof a !== typeof b) {
    console.log(`    ${path || "<root>"}: type mismatch staging=${typeof a} vs dev=${typeof b}`);
    return;
  }
  if (typeof a === "string" || typeof a === "number" || typeof a === "boolean") {
    const aN = normalise(a);
    const bN = normalise(b);
    if (aN !== bN) {
      console.log(`    ${path || "<root>"}: staging=${JSON.stringify(a).slice(0, 120)} vs dev=${JSON.stringify(b).slice(0, 120)}`);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      console.log(`    ${path}.length: staging=${a.length} vs dev=${b.length}`);
    }
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      compareJson(`${path}[${i}]`, a[i], b[i]);
    }
    return;
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as object).sort();
    const bKeys = Object.keys(b as object).sort();
    const sOnly = aKeys.filter((k) => !bKeys.includes(k));
    const dOnly = bKeys.filter((k) => !aKeys.includes(k));
    if (sOnly.length) console.log(`    ${path}: keys only in staging: ${sOnly.join(", ")}`);
    if (dOnly.length) console.log(`    ${path}: keys only in dev: ${dOnly.join(", ")}`);
    for (const k of aKeys.filter((k) => bKeys.includes(k))) {
      compareJson(path ? `${path}.${k}` : k, (a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
    }
    return;
  }
}

function compareSection<T extends { url: string; method?: string; status?: number; body: unknown }>(
  label: string,
  staging: T[],
  dev: T[],
) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${label} (${staging.length} staging vs ${dev.length} dev)`);
  console.log(`${"=".repeat(70)}`);

  if (staging.length !== dev.length) {
    console.log(`  !! CALL COUNT MISMATCH: staging=${staging.length}, dev=${dev.length}`);
  }

  let diffs = 0;
  for (let i = 0; i < Math.max(staging.length, dev.length); i++) {
    const s = staging[i];
    const d = dev[i];
    if (!s || !d) {
      console.log(`  [${i}] ${s ? "staging-only" : "dev-only"}: ${s?.url ?? d?.url}`);
      diffs++;
      continue;
    }

    if (s.status !== undefined && d.status !== undefined && s.status !== d.status) {
      console.log(`  [${i}] HTTP status mismatch: staging=${s.status} vs dev=${d.status}`);
      diffs++;
    }

    const sNorm = normalise(s.body);
    const dNorm = normalise(d.body);
    if (!deepEqual(sNorm, dNorm)) {
      diffs++;
      console.log(`\n  [${i}] DIFF in ${s.method ?? "GET"} ${s.url}:`);
      compareJson("", s.body, d.body);
    } else {
      console.log(`  [${i}] OK: ${s.method ?? "GET"} ${s.url}`);
    }
  }

  if (diffs === 0 && staging.length === dev.length) {
    console.log(`  All ${staging.length} calls match (after normalisation).`);
  } else {
    console.log(`\n  ${diffs} difference(s) found.`);
  }
}

function compareStreamSection(label: string, stagingTexts: string[], devTexts: string[]) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${label} (${stagingTexts.length} staging vs ${devTexts.length} dev)`);
  console.log(`${"=".repeat(70)}`);

  for (let i = 0; i < Math.max(stagingTexts.length, devTexts.length); i++) {
    const sText = stagingTexts[i] ?? "";
    const dText = devTexts[i] ?? "";

    const sEvents = sText.split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter((l) => l && l !== "[DONE]");
    const dEvents = dText.split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter((l) => l && l !== "[DONE]");

    console.log(`\n  Stream ${i}: staging=${sEvents.length} events, dev=${dEvents.length} events`);

    const sParsed = sEvents.map((e) => {
      try { return JSON.parse(e); } catch { return e; }
    });
    const dParsed = dEvents.map((e) => {
      try { return JSON.parse(e); } catch { return e; }
    });

    for (let j = 0; j < Math.max(sParsed.length, dParsed.length); j++) {
      const sEvt = sParsed[j];
      const dEvt = dParsed[j];
      if (!sEvt || !dEvt) {
        console.log(`    [${j}] ${sEvt ? "staging-only" : "dev-only"} event`);
        continue;
      }

      // Extract kind for display
      const getKind = (e: unknown): string => {
        if (typeof e !== "object" || e === null) return "?";
        const obj = e as Record<string, unknown>;
        if (obj.kind) return String(obj.kind);
        const result = obj.result;
        if (typeof result === "object" && result) {
          return String((result as Record<string, unknown>).kind ?? "?");
        }
        if (obj.error) return "error";
        return "?";
      };

      const sKind = getKind(sEvt);
      const dKind = getKind(dEvt);
      const sNorm = normalise(sEvt);
      const dNorm = normalise(dEvt);

      if (!deepEqual(sNorm, dNorm)) {
        if (sKind !== dKind) {
          console.log(`    [${j}] kind mismatch: staging=${sKind} vs dev=${dKind}`);
        }
        compareJson(`  [${j}]`, sEvt, dEvt);
      } else {
        console.log(`    [${j}] OK: kind=${sKind}`);
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const outDir = "/tmp/opencode";

  console.log("\n>>> Running against staging-eu...");
  const stagingCalls = await runAll("staging-eu");
  console.log(`  Captured ${stagingCalls.length} HTTP calls.`);

  console.log("\n>>> Running against dev-weu...");
  const devCalls = await runAll("dev-weu");
  console.log(`  Captured ${devCalls.length} HTTP calls.`);

  // Save raw captures
  writeFileSync(
    `${outDir}/staging-eu-raw-2.json`,
    JSON.stringify(stagingCalls.map((c) => ({
      url: c.url,
      method: c.method,
      requestHeaders: c.requestHeaders,
      requestBody: c.requestBody,
      status: c.status,
      responseHeaders: c.responseHeaders,
      responseBody: c.responseBody,
      rawResponseText: c.rawResponseText.slice(0, 10000),
    })), null, 2),
  );
  writeFileSync(
    `${outDir}/dev-weu-raw-2.json`,
    JSON.stringify(devCalls.map((c) => ({
      url: c.url,
      method: c.method,
      requestHeaders: c.requestHeaders,
      requestBody: c.requestBody,
      status: c.status,
      responseHeaders: c.responseHeaders,
      responseBody: c.responseBody,
      rawResponseText: c.rawResponseText.slice(0, 10000),
    })), null, 2),
  );
  console.log(`\nRaw JSON saved to ${outDir}/staging-eu-raw-2.json and ${outDir}/dev-weu-raw-2.json`);

  // ── Comparisons ─────────────────────────────────────────────────────────────

  // 1. REST API (agent CRUD)
  compareSection("REST API (Agent CRUD)", extractRest(stagingCalls), extractRest(devCalls));

  // 2. Agent Card
  compareSection("Agent Card", extractAgentCards(stagingCalls), extractAgentCards(devCalls));

  // 3. JSON-RPC message/send (includes normal + connector + error calls)
  compareSection("JSON-RPC message/send", extractRpcSend(stagingCalls), extractRpcSend(devCalls));

  // 4. SSE Stream events
  compareStreamSection("SSE Stream (message/stream)", extractRpcStream(stagingCalls), extractRpcStream(devCalls));

  // 5. Error-handling REST calls (GET/DELETE/PATCH on fake agent ID)
  compareSection(
    "Error handling — REST (fake agent ID)",
    extractRest(stagingCalls).filter((c) => c.url.includes("<id>") && c.url.includes("00000000")),
    extractRest(devCalls).filter((c) => c.url.includes("<id>") && c.url.includes("00000000")),
  );

  // 6. Error-handling RPC (message/send to fake agent ID)
  compareSection(
    "Error handling — JSON-RPC (fake agent ID)",
    extractRpcSend(stagingCalls).filter((c) => c.url.includes("00000000")),
    extractRpcSend(devCalls).filter((c) => c.url.includes("00000000")),
  );

  // 7. Registry expert REST (create agent with web-search-expert)
  compareSection(
    "Registry expert — agent creation",
    extractRest(stagingCalls).filter((c) => c.url.includes("agents") && c.method === "POST" && JSON.stringify(c.body).includes("web-search")),
    extractRest(devCalls).filter((c) => c.url.includes("agents") && c.method === "POST" && JSON.stringify(c.body).includes("web-search")),
  );

  // 8. Registry expert JSON-RPC (web-search messages)
  compareSection(
    "Registry expert — message/send responses",
    extractRpcSend(stagingCalls).filter((c) => !c.url.includes("00000000") && c.url.includes("compare-web")),
    extractRpcSend(devCalls).filter((c) => !c.url.includes("00000000") && c.url.includes("compare-web")),
  );

  // 9. HTTP call sequence (URLs + methods)
  console.log(`\n${"=".repeat(70)}`);
  console.log("HTTP Call Sequence");
  console.log(`${"=".repeat(70)}`);
  const sSeq = stagingCalls.map((c) => `${c.method} ${normaliseUrl(c.url)}`);
  const dSeq = devCalls.map((c) => `${c.method} ${normaliseUrl(c.url)}`);
  console.log(`  staging: ${sSeq.length} calls`);
  console.log(`  dev:     ${dSeq.length} calls`);
  for (let i = 0; i < Math.max(sSeq.length, dSeq.length); i++) {
    const s = sSeq[i] ?? "(none)";
    const d = dSeq[i] ?? "(none)";
    if (s === d) {
      console.log(`  [${i}] OK: ${s}`);
    } else {
      console.log(`  [${i}] MISMATCH: staging="${s}" vs dev="${d}"`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
