import type { Part } from "../types.js";
import type { AgentHandleFactory } from "../handle.js";
import { evalCel } from "./compile.js";
import type { CompiledGraph, CompiledNode } from "./compile.js";
import { parseWorkflowDefinition } from "./parse.js";
import { compileWorkflow } from "./compile.js";
import type {
  WorkflowDefinition,
  AgentCallConfig,
  SwitchConfig,
  SetStateConfig,
  HttpCallConfig,
  InterruptConfig,
  WaitConfig,
  ParallelConfig,
  CallbackConfig,
  WorkflowHandlers,
  WorkflowHandler,
  WorkflowHandlerResult,
} from "./parse.js";

type AnyState = Record<string, unknown>;

export interface HttpPort {
  fetch(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<Response>;
}

export interface TimerPort {
  wait(ms: number): Promise<void>;
}

const defaultHttpPort: HttpPort = {
  fetch: (url, init) => fetch(url, init as RequestInit),
};

const defaultTimerPort: TimerPort = {
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface StateGraphStep<S extends AnyState = AnyState> {
  node: string;
  delta: Partial<S>;
  state: S;
}

export interface StateGraphResult<S extends AnyState = AnyState> {
  state: S;
  steps: StateGraphStep<S>[];
  iterations: number;
  terminatedBy: "end" | "maxIterations" | "noEdge" | "interrupted";
}

export interface WorkflowInterrupt {
  kind: "interrupt";
  node: string;
  prompt: string;
  state: AnyState;
  checkpoint: string;
}

export type { WorkflowHandler, WorkflowHandlerResult, WorkflowHandlers } from "./parse.js";

interface NodeExecutionResult {
  delta: Partial<AnyState>;
  next: string | undefined;
  interrupt?: { node: string; prompt: string; field: string };
}

export interface GraphAnalysis {
  unreachable: string[];
  deadEnds: string[];
}

interface CheckpointData {
  nodeId: string;
  state: AnyState;
  steps: StateGraphStep<AnyState>[];
  iterations: number;
}

function encodeCheckpoint(data: CheckpointData): string {
  return btoa(JSON.stringify(data));
}

function decodeCheckpoint(checkpoint: string): CheckpointData {
  return JSON.parse(atob(checkpoint)) as CheckpointData;
}

function resolveRoute(
  compiled: CompiledGraph,
  current: string,
  node: CompiledNode,
  state: AnyState,
): string | undefined {
  if (node.routeFromExpr) {
    return evalCel(node.routeFromExpr, { state }) as string;
  }
  return compiled.edges.get(current);
}

export async function executeNode(
  compiled: CompiledGraph,
  current: string,
  state: AnyState,
  opts?: {
    handlers?: WorkflowHandlers;
    onInterrupt?: (node: string, prompt: string, state: AnyState) => Promise<unknown>;
    httpPort?: HttpPort;
    timerPort?: TimerPort;
  },
): Promise<NodeExecutionResult> {
  const node = compiled.nodes.get(current);
  if (!node) {
    throw new Error(`[DeclarativeGraph] Unknown node: "${current}".`);
  }

  const nodeType = node.type;

  if (nodeType === "agent_call") {
    const agentInput = evalCel(node.inputExpr!, { state }) as string | Part[];
    const response = await node.agentHandle!.run(agentInput);
    const responseBinding = {
      text: response.text,
      status: response.status,
      artifacts: response.artifacts,
    };
    const delta: Partial<AnyState> = {};
    for (const [field, expr] of node.outputExprs!) {
      const value = evalCel(expr, { state, response: responseBinding });
      state[field] = value;
      delta[field] = value;
    }
    return { delta, next: resolveRoute(compiled, current, node, state) };
  }

  if (nodeType === "switch") {
    const cfg = node.config as SwitchConfig;
    for (let i = 0; i < cfg.cases.length; i++) {
      if (evalCel(node.caseExprs![i], { state })) {
        return { delta: {}, next: cfg.cases[i].target };
      }
    }
    return { delta: {}, next: cfg.default };
  }

  if (nodeType === "set_state") {
    const delta: Partial<AnyState> = {};
    for (const [field, expr] of node.setExprs!) {
      const value = evalCel(expr, { state });
      state[field] = value;
      delta[field] = value;
    }
    return { delta, next: resolveRoute(compiled, current, node, state) };
  }

  if (nodeType === "http_call") {
    const cfg = node.config as HttpCallConfig;
    const url = evalCel(node.urlExpr!, { state }) as string;
    const method = cfg.method;
    const headers: Record<string, string> = {};
    if (node.headerExprs) {
      for (const [name, expr] of node.headerExprs) {
        headers[name] = evalCel(expr, { state }) as string;
      }
    }
    const body = node.bodyExpr ? evalCel(node.bodyExpr, { state }) : undefined;
    const http = opts?.httpPort ?? defaultHttpPort;
    const httpResponse = await http.fetch(url, {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const responseHeaders: Record<string, string> = {};
    httpResponse.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    const contentType = httpResponse.headers.get("content-type") ?? "";
    const responseBody: unknown = contentType.includes("application/json")
      ? await httpResponse.json()
      : await httpResponse.text();
    if (!httpResponse.ok) {
      throw new Error(`[DeclarativeGraph] HTTP ${method} ${url} failed with status ${httpResponse.status}: ${typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody)}`);
    }
    const responseBinding = {
      status: httpResponse.status,
      headers: responseHeaders,
      body: responseBody,
    };
    const delta: Partial<AnyState> = {};
    for (const [field, expr] of node.outputExprs!) {
      const value = evalCel(expr, { state, response: responseBinding });
      state[field] = value;
      delta[field] = value;
    }
    return { delta, next: resolveRoute(compiled, current, node, state) };
  }

  if (nodeType === "interrupt") {
    const cfg = node.config as InterruptConfig;
    const prompt = evalCel(node.promptExpr!, { state }) as string;
    if (opts?.onInterrupt) {
      const answer = await opts.onInterrupt(current, prompt, { ...state });
      state[cfg.field] = answer;
      const delta = { [cfg.field]: answer };
      return { delta, next: resolveRoute(compiled, current, node, state) };
    }
    return { delta: {}, next: undefined, interrupt: { node: current, prompt, field: cfg.field } };
  }

  if (nodeType === "wait") {
    let ms: number;
    if (node.durationExpr) {
      const seconds = evalCel(node.durationExpr, { state }) as number;
      ms = seconds * 1000;
    } else if (node.untilExpr) {
      const target = evalCel(node.untilExpr, { state }) as string;
      ms = new Date(target).getTime() - Date.now();
      if (ms < 0) ms = 0;
    } else {
      throw new Error(`[DeclarativeGraph] Wait node "${current}" requires either duration or until.`);
    }
    const timer = opts?.timerPort ?? defaultTimerPort;
    await timer.wait(ms);
    return { delta: {}, next: resolveRoute(compiled, current, node, state) };
  }

  if (nodeType === "parallel") {
    const cfg = node.config as ParallelConfig;
    const branchPromises = cfg.branches.map(async (branch) => {
      const branchState = evalCel(node.branchInputExprs!.get(branch.name)!, { state }) as AnyState;
      const result = await runSubGraph(compiled, branch.node, branchState, opts);
      return { name: branch.name, result };
    });
    const results: Record<string, unknown> = {};
    if (cfg.join === "any") {
      const settled = await Promise.allSettled(branchPromises);
      for (const s of settled) {
        if (s.status === "fulfilled") {
          results[s.value.name] = s.value.result.state;
          break;
        }
      }
    } else {
      const settled = await Promise.allSettled(branchPromises);
      for (const s of settled) {
        if (s.status === "fulfilled") {
          results[s.value.name] = s.value.result.state;
        } else {
          throw new Error(`[DeclarativeGraph] Parallel branch failed: ${(s.reason as Error).message}`);
        }
      }
    }
    const delta: Partial<AnyState> = {};
    for (const [field, expr] of node.outputExprs!) {
      const value = evalCel(expr, { state, results });
      state[field] = value;
      delta[field] = value;
    }
    return { delta, next: resolveRoute(compiled, current, node, state) };
  }

  if (nodeType === "callback") {
    const handler = opts?.handlers?.[node.handlerName!] ?? compiled.handlers[node.handlerName!];
    if (!handler) {
      throw new Error(`[DeclarativeGraph] No handler registered for callback node "${current}" (handler: "${node.handlerName}").`);
    }
    const rawResult = await handler({ ...state });
    const delta: Partial<AnyState> = {};

    const isStructured =
      rawResult != null && typeof rawResult === "object" &&
      ("delta" in rawResult || "next" in rawResult);
    const handlerDelta = isStructured
      ? (rawResult as WorkflowHandlerResult).delta ?? {}
      : rawResult as Partial<AnyState>;
    const handlerNext = isStructured
      ? (rawResult as WorkflowHandlerResult).next
      : (rawResult as AnyState).__next as string | undefined;

    if (node.outputExprs && node.outputExprs.size > 0) {
      for (const [field, expr] of node.outputExprs) {
        const value = evalCel(expr, { state, result: handlerDelta });
        state[field] = value;
        delta[field] = value;
      }
    } else {
      for (const [field, value] of Object.entries(handlerDelta)) {
        state[field] = value;
        delta[field] = value;
      }
    }

    const next = handlerNext ?? resolveRoute(compiled, current, node, state);
    return { delta, next };
  }

  return { delta: {}, next: "__end__" };
}

async function* runGraph(
  compiled: CompiledGraph,
  startNode: string,
  initialState: AnyState,
  opts?: {
    maxIterations?: number;
    priorSteps?: StateGraphStep<AnyState>[];
    priorIterations?: number;
    onInterrupt?: (node: string, prompt: string, state: AnyState) => Promise<unknown>;
    handlers?: WorkflowHandlers;
    httpPort?: HttpPort;
    timerPort?: TimerPort;
  },
): AsyncGenerator<WorkflowInterrupt | StateGraphResult<AnyState>> {
  const maxIter = opts?.maxIterations ?? compiled.maxIterations;
  const steps = opts?.priorSteps ?? [];
  let state: AnyState = { ...initialState };
  let current = startNode;
  let iterations = opts?.priorIterations ?? 0;
  let terminatedBy: StateGraphResult<AnyState>["terminatedBy"] = "end";

  while (current !== "__end__") {
    if (iterations >= maxIter) {
      terminatedBy = "maxIterations";
      break;
    }

    const result = await executeNode(compiled, current, state, opts);

    if (result.interrupt) {
      const checkpoint = encodeCheckpoint({
        nodeId: current,
        state: { ...state },
        steps: [...steps],
        iterations,
      });
      yield { kind: "interrupt" as const, node: current, prompt: result.interrupt.prompt, state: { ...state }, checkpoint };
      return;
    }

    steps.push({ node: current, delta: result.delta, state: { ...state } });
    iterations++;

    if (result.next === undefined) {
      terminatedBy = "noEdge";
      break;
    }
    current = result.next;
  }

  yield { state, steps, iterations, terminatedBy };
}

async function runSubGraph(
  compiled: CompiledGraph,
  entryNode: string,
  initialState: AnyState,
  opts?: {
    maxIterations?: number;
    onInterrupt?: (node: string, prompt: string, state: AnyState) => Promise<unknown>;
    handlers?: WorkflowHandlers;
    httpPort?: HttpPort;
    timerPort?: TimerPort;
  },
): Promise<StateGraphResult<AnyState>> {
  const gen = runGraph(compiled, entryNode, initialState, opts);
  const first = await gen.next();
  if (first.value && (first.value as WorkflowInterrupt).kind === "interrupt") {
    throw new Error(`[DeclarativeGraph] Interrupt node "${(first.value as WorkflowInterrupt).node}" not supported in parallel branches.`);
  }
  return first.value as StateGraphResult<AnyState>;
}

export async function runWorkflow(
  compiled: CompiledGraph,
  initialState: AnyState,
  opts?: {
    maxIterations?: number;
    onInterrupt?: (node: string, prompt: string, state: AnyState) => Promise<unknown>;
    handlers?: WorkflowHandlers;
    httpPort?: HttpPort;
    timerPort?: TimerPort;
  },
): Promise<StateGraphResult<AnyState>> {
  const gen = runGraph(compiled, compiled.entryNode, initialState, opts);
  const first = await gen.next();
  if (first.value && (first.value as WorkflowInterrupt).kind === "interrupt") {
    throw new Error(`[DeclarativeGraph] Interrupt node "${(first.value as WorkflowInterrupt).node}" requires onInterrupt callback in runWorkflow options.`);
  }
  return first.value as StateGraphResult<AnyState>;
}

export async function executeWorkflow(
  json: string | object,
  factory: AgentHandleFactory,
  initialState: AnyState,
  opts?: {
    maxIterations?: number;
    onInterrupt?: (node: string, prompt: string, state: AnyState) => Promise<unknown>;
    handlers?: WorkflowHandlers;
    httpPort?: HttpPort;
    timerPort?: TimerPort;
  },
): Promise<StateGraphResult<AnyState>> {
  const def = parseWorkflowDefinition(json);
  const compiled = await compileWorkflow(def, factory, opts?.handlers);
  return runWorkflow(compiled, initialState, opts);
}

export function analyzeGraphStructure(def: WorkflowDefinition): GraphAnalysis {
  const nodeIds = new Set(def.nodes.map((n) => n.id));
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const edge of def.edges) {
    if (edge.source === "__start__") {
      queue.push(edge.target);
    }
  }

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (reachable.has(current)) continue;
    reachable.add(current);

    const node = def.nodes.find((n) => n.id === current);
    if (!node) continue;

    if (node.type === "switch") {
      const cfg = node.config as SwitchConfig;
      for (const c of cfg.cases) {
        if (!reachable.has(c.target)) queue.push(c.target);
      }
      if (!reachable.has(cfg.default)) queue.push(cfg.default);
    }

    if (node.type === "parallel") {
      const cfg = node.config as ParallelConfig;
      for (const branch of cfg.branches) {
        if (!reachable.has(branch.node)) queue.push(branch.node);
      }
    }

    if (node.type !== "end" && node.type !== "switch" && node.type !== "parallel") {
      for (const edge of def.edges) {
        if (edge.source === current && !reachable.has(edge.target)) {
          queue.push(edge.target);
        }
      }
    }
  }

  const unreachable = [...nodeIds].filter((id) => !reachable.has(id) && id !== "__end__");

  const deadEnds: string[] = [];
  for (const node of def.nodes) {
    if (node.type === "end") continue;
    if (node.type === "switch") {
      const cfg = node.config as SwitchConfig;
      const allTargets = [...cfg.cases.map((c) => c.target), cfg.default];
      if (!allTargets.some((t) => reachable.has(t) || t === "__end__")) {
        deadEnds.push(node.id);
      }
    } else if (node.type === "parallel") {
      const cfg = node.config as ParallelConfig;
      if (!cfg.branches.some((b) => reachable.has(b.node) || b.node === "__end__")) {
        deadEnds.push(node.id);
      }
    } else if (node.type === "callback") {
      const hasEdge = def.edges.some((e) => e.source === node.id);
      const cfg = node.config as unknown as Record<string, unknown>;
      const hasRouteFrom = cfg?.route_from !== undefined;
      const hasHandler = typeof cfg?.handler === "string" && cfg.handler.length > 0;
      if (!hasEdge && !hasRouteFrom && !hasHandler) {
        deadEnds.push(node.id);
      }
    } else {
      const hasEdge = def.edges.some((e) => e.source === node.id);
      const cfg = node.config as unknown as Record<string, unknown>;
      const hasRouteFrom = cfg?.route_from !== undefined;
      if (!hasEdge && !hasRouteFrom) {
        deadEnds.push(node.id);
      }
    }
  }

  return { unreachable, deadEnds };
}

export async function* runWorkflowInteractive(
  compiled: CompiledGraph,
  initialState: AnyState,
  opts?: {
    maxIterations?: number;
    handlers?: WorkflowHandlers;
    httpPort?: HttpPort;
    timerPort?: TimerPort;
  },
): AsyncGenerator<WorkflowInterrupt | StateGraphResult<AnyState>> {
  yield* runGraph(compiled, compiled.entryNode, initialState, opts);
}

export async function* resumeWorkflow(
  compiled: CompiledGraph,
  checkpoint: string,
  interruptResult: unknown,
  opts?: {
    maxIterations?: number;
    handlers?: WorkflowHandlers;
    httpPort?: HttpPort;
    timerPort?: TimerPort;
  },
): AsyncGenerator<WorkflowInterrupt | StateGraphResult<AnyState>> {
  const cp = decodeCheckpoint(checkpoint);
  const node = compiled.nodes.get(cp.nodeId);
  if (!node) {
    throw new Error(`[DeclarativeGraph] Checkpoint node "${cp.nodeId}" not found in compiled graph.`);
  }

  let state: AnyState = { ...cp.state };
  let iterations = cp.iterations;
  const steps: StateGraphStep<AnyState>[] = [...cp.steps];

  const cfg = node.config as InterruptConfig;
  state[cfg.field] = interruptResult;
  const delta = { [cfg.field]: interruptResult };
  steps.push({ node: cp.nodeId, delta, state: { ...state } });
  iterations++;

  let next: string | undefined;
  if (node.routeFromExpr) {
    next = evalCel(node.routeFromExpr, { state }) as string;
  } else {
    next = compiled.edges.get(cp.nodeId);
  }

  if (next === undefined) {
    yield { state, steps, iterations, terminatedBy: "noEdge" };
    return;
  }

  yield* runGraph(compiled, next, state, { ...opts, priorSteps: steps, priorIterations: iterations });
}
