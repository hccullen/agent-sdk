import { parse, plan, celEnv, isCelError, isCelMap, isCelList } from "@bufbuild/cel";
import type { Agent, Part } from "./types.js";
import type { CortiClient } from "./client.js";
import { AgentHandle } from "./handle.js";
import { MessageResponse } from "./response.js";
import type { StateGraphResult, StateGraphStep } from "./stateGraph.js";

type AnyState = Record<string, unknown>;

export interface WorkflowDefinition {
  document: { name: string; version: string; description?: string };
  state_schema?: object;
  nodes: WorkflowNode[];
  edges: { source: string; target: string }[];
  max_iterations?: number;
}

export type WorkflowNode =
  | { id: string; type: "agent_call"; config: AgentCallConfig; retry?: RetryPolicy; timeout?: string }
  | { id: string; type: "switch"; config: SwitchConfig }
  | { id: string; type: "set_state"; config: SetStateConfig }
  | { id: string; type: "http_call"; config: HttpCallConfig; retry?: RetryPolicy; timeout?: string }
  | { id: string; type: "interrupt"; config: InterruptConfig }
  | { id: string; type: "wait"; config: WaitConfig }
  | { id: string; type: "parallel"; config: ParallelConfig }
  | { id: string; type: "end" };

export interface AgentCallConfig {
  agent: string;
  input: string;
  output: Record<string, string>;
  route_from?: string;
}

export interface SwitchConfig {
  cases: { when: string; target: string }[];
  default: string;
}

export interface SetStateConfig {
  set: Record<string, string>;
  route_from?: string;
}

export interface HttpCallConfig {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  output: Record<string, string>;
  route_from?: string;
}

export interface InterruptConfig {
  prompt: string;
  field: string;
  route_from?: string;
}

export interface WaitConfig {
  duration?: string;
  until?: string;
  route_from?: string;
}

export interface ParallelConfig {
  branches: { name: string; node: string; input: string }[];
  join: "all" | "any";
  output: Record<string, string>;
  route_from?: string;
}

export interface RetryPolicy {
  max_attempts: number;
  backoff_coefficient?: number;
}

type CompiledCel = (bindings?: Record<string, unknown>) => unknown;

interface CompiledNode {
  id: string;
  type: "agent_call" | "switch" | "set_state" | "http_call" | "interrupt" | "wait" | "parallel" | "end";
  config: AgentCallConfig | SwitchConfig | SetStateConfig | HttpCallConfig | InterruptConfig | WaitConfig | ParallelConfig | Record<string, never>;
  inputExpr?: CompiledCel;
  outputExprs?: Map<string, CompiledCel>;
  routeFromExpr?: CompiledCel;
  caseExprs?: CompiledCel[];
  setExprs?: Map<string, CompiledCel>;
  urlExpr?: CompiledCel;
  headerExprs?: Map<string, CompiledCel>;
  bodyExpr?: CompiledCel;
  promptExpr?: CompiledCel;
  durationExpr?: CompiledCel;
  untilExpr?: CompiledCel;
  branchInputExprs?: Map<string, CompiledCel>;
  agentHandle?: AgentHandle;
}

export interface CompiledGraph {
  definition: WorkflowDefinition;
  nodes: Map<string, CompiledNode>;
  edges: Map<string, string>;
  entryNode: string;
  maxIterations: number;
}

function compileCel(expr: string): CompiledCel {
  const ast = parse(expr);
  return plan(celEnv(), ast) as unknown as CompiledCel;
}

function evalCel(compiled: CompiledCel, bindings: Record<string, unknown>): unknown {
  const result = compiled(bindings);
  if (isCelError(result)) {
    throw new Error(`[DeclarativeGraph] CEL evaluation error: ${(result as Error).message}`);
  }
  return celToJs(result);
}

function celToJs(value: unknown): unknown {
  if (isCelMap(value)) {
    const obj: Record<string, unknown> = {};
    const map = (value as unknown as { _map: Map<unknown, unknown> })._map;
    for (const [key, val] of map) {
      obj[String(key)] = celToJs(val);
    }
    return obj;
  }
  if (isCelList(value)) {
    const arr = (value as unknown as { _array: unknown[] })._array;
    return arr.map(celToJs);
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return value;
}

export function parseWorkflowDefinition(input: string | object): WorkflowDefinition {
  const def: unknown = typeof input === "string" ? JSON.parse(input) : input;

  if (typeof def !== "object" || def === null) {
    throw new Error("[DeclarativeGraph] Definition must be an object.");
  }

  const d = def as Record<string, unknown>;

  if (!d.document || typeof d.document !== "object") {
    throw new Error("[DeclarativeGraph] Missing or invalid required field: document.");
  }
  const doc = d.document as Record<string, unknown>;
  if (!doc.name || typeof doc.name !== "string") {
    throw new Error("[DeclarativeGraph] document.name is required and must be a string.");
  }
  if (!doc.version || typeof doc.version !== "string") {
    throw new Error("[DeclarativeGraph] document.version is required and must be a string.");
  }

  if (!Array.isArray(d.nodes) || d.nodes.length === 0) {
    throw new Error("[DeclarativeGraph] nodes is required and must be a non-empty array.");
  }
  if (!Array.isArray(d.edges)) {
    throw new Error("[DeclarativeGraph] edges is required and must be an array.");
  }

  const validNodeTypes = new Set(["agent_call", "switch", "set_state", "http_call", "interrupt", "wait", "parallel", "end"]);
  const nodeIds = new Set<string>();
  for (const node of d.nodes) {
    const n = node as Record<string, unknown>;
    if (!n.id || typeof n.id !== "string") {
      throw new Error("[DeclarativeGraph] Each node must have a string id.");
    }
    if (nodeIds.has(n.id)) {
      throw new Error(`[DeclarativeGraph] Duplicate node id: "${n.id}".`);
    }
    nodeIds.add(n.id);
    if (!n.type || typeof n.type !== "string" || !validNodeTypes.has(n.type)) {
      throw new Error(`[DeclarativeGraph] Node "${n.id}" has invalid type. Must be one of: agent_call, switch, set_state, http_call, interrupt, wait, parallel, end.`);
    }
    if (n.type !== "end" && (!n.config || typeof n.config !== "object")) {
      throw new Error(`[DeclarativeGraph] Node "${n.id}" must have a config object.`);
    }
  }

  let hasStart = false;
  let hasEnd = false;
  for (const edge of d.edges) {
    const e = edge as Record<string, unknown>;
    if (!e.source || typeof e.source !== "string" || !e.target || typeof e.target !== "string") {
      throw new Error("[DeclarativeGraph] Each edge must have string source and target.");
    }
    if (e.source === "__start__") hasStart = true;
    if (!nodeIds.has(e.target)) {
      throw new Error(`[DeclarativeGraph] Edge target "${e.target}" does not match any node id.`);
    }
  }

  if (!hasStart) {
    throw new Error("[DeclarativeGraph] No edge with source \"__start__\" found.");
  }

  for (const node of d.nodes) {
    const n = node as Record<string, unknown>;
    if (n.id === "__end__" && n.type !== "end") {
      throw new Error(`[DeclarativeGraph] Node "__end__" must have type "end".`);
    }
    if (n.id === "__end__") hasEnd = true;
  }

  if (!hasEnd) {
    throw new Error("[DeclarativeGraph] No node with id \"__end__\" and type \"end\" found.");
  }

  return d as unknown as WorkflowDefinition;
}

export async function compileWorkflow(
  def: WorkflowDefinition,
  client: CortiClient,
): Promise<CompiledGraph> {
  const nodes = new Map<string, CompiledNode>();
  const edges = new Map<string, string>();
  let entryNode = "";

  for (const edge of def.edges) {
    edges.set(edge.source, edge.target);
    if (edge.source === "__start__") {
      entryNode = edge.target;
    }
  }

  if (!entryNode) {
    throw new Error("[DeclarativeGraph] No entry node found.");
  }

  for (const node of def.nodes) {
    const compiled: CompiledNode = {
      id: node.id,
      type: node.type,
      config: node.type === "end" ? {} : node.config,
    };

    if (node.type === "agent_call") {
      const cfg = node.config as AgentCallConfig;
      compiled.inputExpr = compileCel(cfg.input);
      compiled.outputExprs = new Map<string, CompiledCel>();
      for (const [field, expr] of Object.entries(cfg.output ?? {})) {
        compiled.outputExprs.set(field, compileCel(expr));
      }
      if (cfg.route_from) {
        compiled.routeFromExpr = compileCel(cfg.route_from);
      }
    } else if (node.type === "switch") {
      const cfg = node.config as SwitchConfig;
      compiled.caseExprs = cfg.cases.map((c) => compileCel(c.when));
    } else if (node.type === "set_state") {
      const cfg = node.config as SetStateConfig;
      compiled.setExprs = new Map<string, CompiledCel>();
      for (const [field, expr] of Object.entries(cfg.set ?? {})) {
        compiled.setExprs.set(field, compileCel(expr));
      }
      if (cfg.route_from) {
        compiled.routeFromExpr = compileCel(cfg.route_from);
      }
    } else if (node.type === "http_call") {
      const cfg = node.config as HttpCallConfig;
      compiled.urlExpr = compileCel(cfg.url);
      if (cfg.headers) {
        compiled.headerExprs = new Map<string, CompiledCel>();
        for (const [name, expr] of Object.entries(cfg.headers)) {
          compiled.headerExprs.set(name, compileCel(expr));
        }
      }
      if (cfg.body) {
        compiled.bodyExpr = compileCel(cfg.body);
      }
      compiled.outputExprs = new Map<string, CompiledCel>();
      for (const [field, expr] of Object.entries(cfg.output ?? {})) {
        compiled.outputExprs.set(field, compileCel(expr));
      }
      if (cfg.route_from) {
        compiled.routeFromExpr = compileCel(cfg.route_from);
      }
    } else if (node.type === "interrupt") {
      const cfg = node.config as InterruptConfig;
      compiled.promptExpr = compileCel(cfg.prompt);
      if (cfg.route_from) {
        compiled.routeFromExpr = compileCel(cfg.route_from);
      }
    } else if (node.type === "wait") {
      const cfg = node.config as WaitConfig;
      if (cfg.duration) {
        compiled.durationExpr = compileCel(cfg.duration);
      }
      if (cfg.until) {
        compiled.untilExpr = compileCel(cfg.until);
      }
      if (cfg.route_from) {
        compiled.routeFromExpr = compileCel(cfg.route_from);
      }
    } else if (node.type === "parallel") {
      const cfg = node.config as ParallelConfig;
      compiled.branchInputExprs = new Map<string, CompiledCel>();
      for (const branch of cfg.branches) {
        compiled.branchInputExprs.set(branch.name, compileCel(branch.input));
      }
      compiled.outputExprs = new Map<string, CompiledCel>();
      for (const [field, expr] of Object.entries(cfg.output ?? {})) {
        compiled.outputExprs.set(field, compileCel(expr));
      }
      if (cfg.route_from) {
        compiled.routeFromExpr = compileCel(cfg.route_from);
      }
    }

    nodes.set(node.id, compiled);
  }

  if (!nodes.has(entryNode)) {
    throw new Error(`[DeclarativeGraph] Entry node "${entryNode}" not found in nodes.`);
  }

  for (const [source, target] of edges) {
    if (source === "__start__") continue;
    if (!nodes.has(source)) {
      throw new Error(`[DeclarativeGraph] Edge source "${source}" does not match any node id.`);
    }
    if (!nodes.has(target) && target !== "__end__") {
      throw new Error(`[DeclarativeGraph] Edge target "${target}" does not match any node id.`);
    }
  }

  for (const node of def.nodes) {
    if (node.type === "switch") {
      const cfg = node.config as SwitchConfig;
      for (const c of cfg.cases) {
        if (!nodes.has(c.target) && c.target !== "__end__") {
          throw new Error(`[DeclarativeGraph] Switch case target "${c.target}" in node "${node.id}" does not match any node id.`);
        }
      }
      if (!nodes.has(cfg.default) && cfg.default !== "__end__") {
        throw new Error(`[DeclarativeGraph] Switch default "${cfg.default}" in node "${node.id}" does not match any node id.`);
      }
    }
    if (node.type === "parallel") {
      const cfg = node.config as ParallelConfig;
      for (const branch of cfg.branches) {
        if (!nodes.has(branch.node) && branch.node !== "__end__") {
          throw new Error(`[DeclarativeGraph] Parallel branch "${branch.name}" target "${branch.node}" in node "${node.id}" does not match any node id.`);
        }
      }
    }
  }

  for (const node of def.nodes) {
    if (node.type === "agent_call") {
      const cfg = node.config as AgentCallConfig;
      const agent: Agent = await client.agents.get(cfg.agent);
      const compiled = nodes.get(node.id)!;
      compiled.agentHandle = new AgentHandle(agent, client);
    }
  }

  return {
    definition: def,
    nodes,
    edges,
    entryNode,
    maxIterations: def.max_iterations ?? 25,
  };
}

async function runSubGraph(
  compiled: CompiledGraph,
  entryNode: string,
  initialState: AnyState,
  opts?: {
    maxIterations?: number;
    onInterrupt?: (node: string, prompt: string, state: AnyState) => Promise<unknown>;
  },
): Promise<StateGraphResult<AnyState>> {
  const maxIter = opts?.maxIterations ?? compiled.maxIterations;
  let state: AnyState = { ...initialState };
  let current: string = entryNode;
  let iterations = 0;
  let terminatedBy: StateGraphResult<AnyState>["terminatedBy"] = "end";

  while (current !== "__end__") {
    if (iterations >= maxIter) {
      terminatedBy = "maxIterations";
      break;
    }

    const node = compiled.nodes.get(current);
    if (!node) {
      throw new Error(`[DeclarativeGraph] Unknown node: "${current}".`);
    }

    let next: string | undefined;
    const nodeType = node.type;

    if (nodeType === "agent_call") {
      const agentInput = evalCel(node.inputExpr!, { state }) as string | Part[];
      const response = await node.agentHandle!.run(agentInput);
      const responseBinding = {
        text: response.text,
        status: response.status,
        artifacts: response.artifacts,
      };
      for (const [field, expr] of node.outputExprs!) {
        state[field] = evalCel(expr, { state, response: responseBinding });
      }
      if (node.routeFromExpr) {
        next = evalCel(node.routeFromExpr, { state }) as string;
      } else {
        next = compiled.edges.get(current);
      }
    } else if (nodeType === "switch") {
      const cfg = node.config as SwitchConfig;
      let matched = false;
      for (let i = 0; i < cfg.cases.length; i++) {
        if (evalCel(node.caseExprs![i], { state })) {
          next = cfg.cases[i].target;
          matched = true;
          break;
        }
      }
      if (!matched) next = cfg.default;
    } else if (nodeType === "set_state") {
      for (const [field, expr] of node.setExprs!) {
        state[field] = evalCel(expr, { state });
      }
      if (node.routeFromExpr) {
        next = evalCel(node.routeFromExpr, { state }) as string;
      } else {
        next = compiled.edges.get(current);
      }
    } else if (nodeType === "end") {
      next = "__end__";
    } else {
      next = compiled.edges.get(current);
    }

    iterations++;
    if (next === undefined) {
      terminatedBy = "noEdge";
      break;
    }
    current = next;
  }

  return { state, steps: [], iterations, terminatedBy };
}

export async function runWorkflow(
  compiled: CompiledGraph,
  initialState: AnyState,
  opts?: {
    maxIterations?: number;
    onInterrupt?: (node: string, prompt: string, state: AnyState) => Promise<unknown>;
  },
): Promise<StateGraphResult<AnyState>> {
  const maxIter = opts?.maxIterations ?? compiled.maxIterations;
  const steps: StateGraphStep<AnyState>[] = [];
  let state: AnyState = { ...initialState };
  let current: string = compiled.entryNode;
  let iterations = 0;
  let terminatedBy: StateGraphResult<AnyState>["terminatedBy"] = "end";

  while (current !== "__end__") {
    if (iterations >= maxIter) {
      terminatedBy = "maxIterations";
      break;
    }

    const node = compiled.nodes.get(current);
    if (!node) {
      throw new Error(`[DeclarativeGraph] Unknown node: "${current}".`);
    }

    let next: string | undefined;
    let delta: Partial<AnyState> = {};
    const nodeType = node.type;

    if (nodeType === "agent_call") {
      const cfg = node.config as AgentCallConfig;
      const agentInput = evalCel(node.inputExpr!, { state }) as string | Part[];
      const response = await node.agentHandle!.run(agentInput);

      const responseBinding = {
        text: response.text,
        status: response.status,
        artifacts: response.artifacts,
      };

      delta = {};
      for (const [field, expr] of node.outputExprs!) {
        const value = evalCel(expr, { state, response: responseBinding });
        state[field] = value;
        delta[field] = value;
      }

      if (node.routeFromExpr) {
        next = evalCel(node.routeFromExpr, { state }) as string;
      } else {
        next = compiled.edges.get(current);
      }
    } else if (nodeType === "switch") {
      const cfg = node.config as SwitchConfig;
      delta = {};
      let matched = false;
      for (let i = 0; i < cfg.cases.length; i++) {
        const result = evalCel(node.caseExprs![i], { state });
        if (result) {
          next = cfg.cases[i].target;
          matched = true;
          break;
        }
      }
      if (!matched) {
        next = cfg.default;
      }
    } else if (nodeType === "set_state") {
      delta = {};
      for (const [field, expr] of node.setExprs!) {
        const value = evalCel(expr, { state });
        state[field] = value;
        delta[field] = value;
      }
      if (node.routeFromExpr) {
        next = evalCel(node.routeFromExpr, { state }) as string;
      } else {
        next = compiled.edges.get(current);
      }
    } else if (nodeType === "http_call") {
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

      const httpResponse = await fetch(url, {
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

      delta = {};
      for (const [field, expr] of node.outputExprs!) {
        const value = evalCel(expr, { state, response: responseBinding });
        state[field] = value;
        delta[field] = value;
      }

      if (node.routeFromExpr) {
        next = evalCel(node.routeFromExpr, { state }) as string;
      } else {
        next = compiled.edges.get(current);
      }
    } else if (nodeType === "interrupt") {
      const cfg = node.config as InterruptConfig;
      const prompt = evalCel(node.promptExpr!, { state }) as string;

      if (!opts?.onInterrupt) {
        throw new Error(`[DeclarativeGraph] Interrupt node "${current}" requires onInterrupt callback in runWorkflow options.`);
      }

      const answer = await opts.onInterrupt(current, prompt, { ...state });
      state[cfg.field] = answer;
      delta = { [cfg.field]: answer };

      if (node.routeFromExpr) {
        next = evalCel(node.routeFromExpr, { state }) as string;
      } else {
        next = compiled.edges.get(current);
      }
    } else if (nodeType === "wait") {
      delta = {};
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
      await new Promise((resolve) => setTimeout(resolve, ms));
      if (node.routeFromExpr) {
        next = evalCel(node.routeFromExpr, { state }) as string;
      } else {
        next = compiled.edges.get(current);
      }
    } else if (nodeType === "parallel") {
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

      delta = {};
      for (const [field, expr] of node.outputExprs!) {
        const value = evalCel(expr, { state, results });
        state[field] = value;
        delta[field] = value;
      }
      if (node.routeFromExpr) {
        next = evalCel(node.routeFromExpr, { state }) as string;
      } else {
        next = compiled.edges.get(current);
      }
    } else {
      delta = {};
      next = "__end__";
    }

    steps.push({ node: current, delta, state: { ...state } });
    iterations++;

    if (next === undefined) {
      terminatedBy = "noEdge";
      break;
    }

    current = next;
  }

  return { state, steps, iterations, terminatedBy };
}

export async function executeWorkflow(
  json: string | object,
  client: CortiClient,
  initialState: AnyState,
  opts?: {
    maxIterations?: number;
    onInterrupt?: (node: string, prompt: string, state: AnyState) => Promise<unknown>;
  },
): Promise<StateGraphResult<AnyState>> {
  const def = parseWorkflowDefinition(json);
  const compiled = await compileWorkflow(def, client);
  return runWorkflow(compiled, initialState, opts);
}

export interface GraphAnalysis {
  unreachable: string[];
  deadEnds: string[];
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
    } else {
      const hasEdge = def.edges.some((e) => e.source === node.id);
      const cfg = node.config as Record<string, unknown>;
      const hasRouteFrom = cfg?.route_from !== undefined;
      if (!hasEdge && !hasRouteFrom) {
        deadEnds.push(node.id);
      }
    }
  }

  return { unreachable, deadEnds };
}

export interface StateGraphBridgeConfig {
  agentCall: { agent: string; input: string; output: Record<string, string> };
}

export function stateGraphToDefinition<S extends Record<string, unknown>>(
  graph: {
    run: (entry: string, state: S, opts?: { maxIterations?: number }) => Promise<unknown>;
  },
  nodes: { name: string; type: string; config?: StateGraphBridgeConfig }[],
  edges: { from: string; to: string | ((state: S) => string) }[],
  entryNode: string,
  opts?: { maxIterations?: number; name?: string; version?: string },
): WorkflowDefinition {
  const def: WorkflowDefinition = {
    document: {
      name: opts?.name ?? "converted",
      version: opts?.version ?? "1.0.0",
    },
    nodes: [],
    edges: [],
    ...(opts?.maxIterations !== undefined && { max_iterations: opts.maxIterations }),
  };

  for (const node of nodes) {
    if (node.type === "agent_call" && node.config?.agentCall) {
      def.nodes.push({
        id: node.name,
        type: "agent_call",
        config: {
          agent: node.config.agentCall.agent,
          input: node.config.agentCall.input,
          output: node.config.agentCall.output,
        },
      });
    } else if (node.type === "end" || node.name === "__end__") {
      def.nodes.push({ id: node.name, type: "end" });
    } else if (node.type === "switch") {
      def.nodes.push({
        id: node.name,
        type: "switch",
        config: { cases: [], default: "__end__" },
      });
    } else {
      def.nodes.push({
        id: node.name,
        type: "set_state",
        config: { set: {} },
      });
    }
  }

  def.edges.push({ source: "__start__", target: entryNode });

  for (const edge of edges) {
    if (typeof edge.to === "string") {
      def.edges.push({ source: edge.from, target: edge.to });
    }
  }

  if (!def.nodes.some((n) => n.id === "__end__")) {
    def.nodes.push({ id: "__end__", type: "end" });
  }

  return def;
}
