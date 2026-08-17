/**
 * compare-interviewing — Create an agent with the `interviewing-expert`
 * registry connector, run a structured questionnaire interview, and compare
 * the raw JSON responses between staging-eu and dev-weu.
 *
 * Run: `npx tsx compare-interviewing.ts`
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

// ── HTTP capture (same as compare-envs.ts) ───────────────────────────────────

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

const ORIG_FETCH = globalThis.fetch.bind(globalThis);

function patchFetch(): { calls: CapturedCall[]; done: Promise<void> } {
  const calls: CapturedCall[] = [];
  const pending: Promise<void>[] = [];

  (globalThis as unknown as { fetch: typeof fetch }).fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const method = init?.method ?? "GET";

    const reqHeaders: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers;
      if (h instanceof Headers) {
        h.forEach((v, k) => { if (!k.toLowerCase().startsWith("authorization")) reqHeaders[k] = v; });
      } else if (typeof h === "object") {
        for (const [k, v] of Object.entries(h)) { if (!k.toLowerCase().startsWith("authorization")) reqHeaders[k] = String(v); }
      }
    }

    let reqBody: unknown = undefined;
    if (init?.body) { try { reqBody = JSON.parse(init.body as string); } catch { reqBody = String(init.body); } }

    const resp = await ORIG_FETCH(input, init);
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => (respHeaders[k] = v));

    const ct = resp.headers.get("content-type") ?? "";
    const isStream = ct.includes("text/event-stream") || ct.includes("application/x-ndjson");

    if (isStream) {
      const cloned = resp.clone();
      pending.push(cloned.text().then((rawText) => {
        let parsed: unknown = rawText;
        try { parsed = JSON.parse(rawText); } catch { /* SSE */ }
        calls.push({ url, method, requestHeaders: reqHeaders, requestBody: reqBody, status: resp.status, responseHeaders: respHeaders, responseBody: parsed, rawResponseText: rawText, isStream: true });
      }).catch(() => {}).then(() => {}));
      return resp;
    }

    const cloned = resp.clone();
    const rawText = await cloned.text().catch(() => "");
    let respBody: unknown = rawText;
    try { respBody = JSON.parse(rawText); } catch { /* text */ }
    calls.push({ url, method, requestHeaders: reqHeaders, requestBody: reqBody, status: resp.status, responseHeaders: respHeaders, responseBody: respBody, rawResponseText: rawText, isStream: false });
    return resp;
  };

  return { calls, done: Promise.all(pending).then(() => {}) };
}

function restoreFetch(): void {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = ORIG_FETCH;
}

// ── Normalisation ────────────────────────────────────────────────────────────

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g;
const NONDET_FIELDS = new Set(["id", "contextId", "taskId", "messageId", "agentId", "createdAt", "updatedAt", "expiresAt", "artifactId"]);

function normalise(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.replace(UUID_RE, "<uuid>").replace(ISO_RE, "<timestamp>").replace(/Bearer [^\s,]+/gi, "Bearer <token>");
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(normalise);
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (NONDET_FIELDS.has(k)) { result[k] = "<redacted>"; continue; }
      if (k === "text" && typeof v === "string") { result[k] = "<text>"; continue; }
      if (k === "access_token" || k === "accessToken" || k === "refresh_token" || k === "refreshToken") { result[k] = "<token>"; continue; }
      result[k] = normalise(v);
    }
    return result;
  }
  return value;
}

function deepEqual(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

// ── Normalise URL ────────────────────────────────────────────────────────────

function normaliseUrl(url: string): string {
  return url
    .replace(/\/agents\/[0-9a-f-]{36}/gi, "/agents/<id>")
    .replace(/\/agents\/[^/?]+\/v1/, "/agents/<id>/v1")
    .replace(/\/agents\/[^/]+\/agent-card\.json/, "/agents/<id>/agent-card.json");
}

// ── Questionnaire definition ────────────────────────────────────────────────

const sleepSurvey = {
  questionnaireId: "sleep-survey-v1",
  version: "1.0",
  startQuestion: "question_1",
  title: "Sleep survey",
  description: "A short questionnaire about sleep quality.",
  questions: [
    { id: "question_1", type: "scale", text: "How satisfied are you?", required: true, defaultNext: "question_2", min: 1, max: 5, step: 1 },
    { id: "question_2", type: "number", text: "How many hours of sleep did you have?", required: true, defaultNext: "question_3" },
    { id: "question_3", type: "text_short", text: "How well rested do you feel?", defaultNext: "question_4" },
    { id: "question_4", type: "terminal", text: "Thanks for completing the sleep survey." },
  ],
};

// ── Run interview against one environment ───────────────────────────────────

function makeClient(env: typeof ENVS[EnvName]): CortiClient {
  return new CortiClient({
    tenantName: env.tenant,
    environment: env.env as unknown as typeof CortiEnvironment.Eu,
    auth: { clientId: env.clientId, clientSecret: env.clientSecret },
  });
}

async function runInterview(envName: EnvName): Promise<CapturedCall[]> {
  const env = ENVS[envName];
  const { calls, done } = patchFetch();
  const client = makeClient(env);

  await client.getAuthHeaders();

  const agents = new AgentsClient(client);

  // 1. Create agent with interviewing-expert registry connector
  const agent = await agents.create({
    name: `interview-test-${envName}`,
    description: "Agent that conducts a sleep survey questionnaire.",
    systemPrompt: "You are a clinical interview assistant. Use the interviewing expert to guide the user through the questionnaire.",
    connectors: [connectors.registry({ name: "interviewing-expert" })],
  });
  console.log(`  [${envName}] Agent created: ${agent.id}`);

  // 2. First turn — start the questionnaire with a data part
  const ctx = agent.createContext();
  const reply1 = await ctx.sendMessage([
    { kind: "text", text: "I'm okay, somewhat satisfied with my sleep" },
    { kind: "data", data: { type: "questionnaire", questionnaire: sleepSurvey } },
  ], { timeoutInSeconds: 120 });
  console.log(`  [${envName}] Turn 1 — status: ${reply1.status}, text: ${reply1.text}`);

  // 3. Second turn — answer next question
  const reply2 = await ctx.sendText("I had 7 hours of sleep", { timeoutInSeconds: 120 });
  console.log(`  [${envName}] Turn 2 — status: ${reply2.status}, text: ${reply2.text}`);

  // 4. Third turn — answer remaining questions in one message
  const reply3 = await ctx.sendText("I feel well rested and was not interrupted at all", { timeoutInSeconds: 120 });
  console.log(`  [${envName}] Turn 3 — status: ${reply3.status}, text: ${reply3.text}`);

  // 5. Print artifacts from each turn
  for (let i = 0; i < 3; i++) {
    const r = [reply1, reply2, reply3][i];
    const artifacts = r.artifacts;
    console.log(`  [${envName}] Turn ${i + 1} artifacts: ${artifacts.length}`);
    for (const a of artifacts) {
      const dataParts = a.parts?.filter((p) => p.kind === "data");
      for (const dp of dataParts) {
        const data = (dp as { data: unknown }).data;
        console.log(`  [${envName}]   data: ${JSON.stringify(data).slice(0, 200)}`);
      }
    }
  }

  // 6. Cleanup
  try { await agent.delete(); } catch (e) { console.log(`  [${envName}] delete warning: ${(e as Error).message.slice(0, 80)}`); }

  await done;
  restoreFetch();
  return calls;
}

// ── Comparison helpers ───────────────────────────────────────────────────────

function compareJson(path: string, a: unknown, b: unknown): void {
  if (a === null || a === undefined) {
    if (b !== null && b !== undefined) console.log(`    ${path || "<root>"}: staging=null/undefined vs dev=${JSON.stringify(b).slice(0, 200)}`);
    return;
  }
  if (b === null || b === undefined) {
    console.log(`    ${path || "<root>"}: staging=${JSON.stringify(a).slice(0, 200)} vs dev=null/undefined`);
    return;
  }
  if (typeof a !== typeof b) { console.log(`    ${path || "<root>"}: type mismatch staging=${typeof a} vs dev=${typeof b}`); return; }
  if (typeof a === "string" || typeof a === "number" || typeof a === "boolean") {
    const aN = normalise(a); const bN = normalise(b);
    if (aN !== bN) console.log(`    ${path || "<root>"}: staging=${JSON.stringify(a).slice(0, 200)} vs dev=${JSON.stringify(b).slice(0, 200)}`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) console.log(`    ${path}.length: staging=${a.length} vs dev=${b.length}`);
    for (let i = 0; i < Math.max(a.length, b.length); i++) compareJson(`${path}[${i}]`, a[i], b[i]);
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

function extractRpc(calls: CapturedCall[]) {
  return calls
    .filter((c) => c.requestBody && typeof c.requestBody === "object" && "jsonrpc" in c.requestBody)
    .map((c) => ({
      url: normaliseUrl(c.url),
      method: (c.requestBody as Record<string, unknown>).method as string,
      body: c.responseBody,
    }));
}

function extractRest(calls: CapturedCall[]) {
  return calls
    .filter((c) => !(c.requestBody && typeof c.requestBody === "object" && "jsonrpc" in c.requestBody) && !c.url.includes("/token") && !c.url.includes("agent-card.json"))
    .map((c) => ({ url: normaliseUrl(c.url), method: c.method, status: c.status, body: c.responseBody }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const outDir = "/tmp/opencode";

  console.log("\n>>> Running interview against staging-eu...");
  const stagingCalls = await runInterview("staging-eu");
  console.log(`  Captured ${stagingCalls.length} HTTP calls.`);

  console.log("\n>>> Running interview against dev-weu...");
  const devCalls = await runInterview("dev-weu");
  console.log(`  Captured ${devCalls.length} HTTP calls.`);

  // Save raw captures
  const serialize = (calls: CapturedCall[]) => JSON.stringify(calls.map((c) => ({
    url: c.url, method: c.method, requestHeaders: c.requestHeaders, requestBody: c.requestBody,
    status: c.status, responseHeaders: c.responseHeaders, responseBody: c.responseBody, rawResponseText: c.rawResponseText.slice(0, 10000),
  })), null, 2);

  writeFileSync(`${outDir}/staging-interviewing-raw.json`, serialize(stagingCalls));
  writeFileSync(`${outDir}/dev-interviewing-raw.json`, serialize(devCalls));
  console.log(`\nRaw JSON saved to ${outDir}/staging-interviewing-raw.json and ${outDir}/dev-interviewing-raw.json`);

  // ── Compare REST (agent CRUD) ──────────────────────────────────────────────
  console.log(`\n${"=".repeat(70)}`);
  console.log("REST API (Agent CRUD)");
  console.log(`${"=".repeat(70)}`);
  const sRest = extractRest(stagingCalls);
  const dRest = extractRest(devCalls);
  for (let i = 0; i < Math.max(sRest.length, dRest.length); i++) {
    const s = sRest[i]; const d = dRest[i];
    if (!s || !d) { console.log(`  [${i}] ${s ? "staging-only" : "dev-only"}: ${s?.url ?? d?.url}`); continue; }
    const sNorm = normalise(s.body); const dNorm = normalise(d.body);
    if (!deepEqual(sNorm, dNorm)) {
      console.log(`\n  [${i}] DIFF in ${s.method} ${s.url}:`);
      compareJson("", s.body, d.body);
    } else {
      console.log(`  [${i}] OK: ${s.method} ${s.url}`);
    }
  }

  // ── Compare JSON-RPC message/send ──────────────────────────────────────────
  console.log(`\n${"=".repeat(70)}`);
  console.log("JSON-RPC message/send (interview turns)");
  console.log(`${"=".repeat(70)}`);
  const sRpc = extractRpc(stagingCalls);
  const dRpc = extractRpc(devCalls);
  console.log(`  staging: ${sRpc.length} RPC calls, dev: ${dRpc.length} RPC calls`);

  for (let i = 0; i < Math.max(sRpc.length, dRpc.length); i++) {
    const s = sRpc[i]; const d = dRpc[i];
    if (!s || !d) { console.log(`  [${i}] ${s ? "staging-only" : "dev-only"}`); continue; }
    const sNorm = normalise(s.body); const dNorm = normalise(d.body);
    if (!deepEqual(sNorm, dNorm)) {
      console.log(`\n  [${i}] DIFF (${s.method}):`);
      compareJson("", s.body, d.body);
    } else {
      console.log(`  [${i}] OK: ${s.method}`);
    }
  }

  // ── Detailed artifact comparison ───────────────────────────────────────────
  console.log(`\n${"=".repeat(70)}`);
  console.log("Questionnaire artifact data (turn-by-turn)");
  console.log(`${"=".repeat(70)}`);

  for (let i = 0; i < Math.max(sRpc.length, dRpc.length); i++) {
    const s = sRpc[i]?.body as Record<string, unknown> | undefined;
    const d = dRpc[i]?.body as Record<string, unknown> | undefined;
    const sResult = s?.result as Record<string, unknown> | undefined;
    const dResult = d?.result as Record<string, unknown> | undefined;
    const sArtifacts = sResult?.artifacts as Record<string, unknown>[] | undefined;
    const dArtifacts = dResult?.artifacts as Record<string, unknown>[] | undefined;

    console.log(`\n  Turn ${i}:`);
    console.log(`    staging artifacts: ${sArtifacts?.length ?? 0}, dev artifacts: ${dArtifacts?.length ?? 0}`);

    const sDataParts = (sArtifacts ?? []).flatMap((a) => (a.parts as Record<string, unknown>[] ?? []).filter((p) => p.kind === "data"));
    const dDataParts = (dArtifacts ?? []).flatMap((a) => (a.parts as Record<string, unknown>[] ?? []).filter((p) => p.kind === "data"));

    console.log(`    staging data parts: ${sDataParts.length}, dev data parts: ${dDataParts.length}`);

    for (let j = 0; j < Math.max(sDataParts.length, dDataParts.length); j++) {
      const sData = sDataParts[j]?.data;
      const dData = dDataParts[j]?.data;
      console.log(`    [${j}] staging: ${JSON.stringify(sData)}`);
      console.log(`    [${j}] dev:     ${JSON.stringify(dData)}`);
      if (sData && dData) {
        const sNorm = normalise(sData);
        const dNorm = normalise(dData);
        if (!deepEqual(sNorm, dNorm)) {
          console.log(`    [${j}] DIFF:`);
          compareJson("      ", sData, dData);
        } else {
          console.log(`    [${j}] OK (structurally identical after normalisation)`);
        }
      }
    }

    // Also compare status.state
    const sState = (sResult?.status as Record<string, unknown>)?.state;
    const dState = (dResult?.status as Record<string, unknown>)?.state;
    if (sState !== dState) {
      console.log(`    state: staging=${sState} vs dev=${dState}`);
    } else {
      console.log(`    state: ${sState} (match)`);
    }
  }

  // ── HTTP call sequence ──────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(70)}`);
  console.log("HTTP Call Sequence");
  console.log(`${"=".repeat(70)}`);
  const sSeq = stagingCalls.map((c) => `${c.method} ${normaliseUrl(c.url)}`);
  const dSeq = devCalls.map((c) => `${c.method} ${normaliseUrl(c.url)}`);
  console.log(`  staging: ${sSeq.length} calls, dev: ${dSeq.length} calls`);
  for (let i = 0; i < Math.max(sSeq.length, dSeq.length); i++) {
    const s = sSeq[i] ?? "(none)";
    const d = dSeq[i] ?? "(none)";
    if (s === d) console.log(`  [${i}] OK: ${s}`);
    else console.log(`  [${i}] MISMATCH: staging="${s}" vs dev="${d}"`);
  }

  console.log("\nDone.");
}

main().catch((err) => { console.error(err); process.exit(1); });
