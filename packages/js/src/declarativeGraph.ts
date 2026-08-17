import { parse, plan, celEnv, isCelError } from "@bufbuild/cel";
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

export interface RetryPolicy {
  max_attempts: number;
  backoff_coefficient?: number;
}

type CompiledCel = (bindings?: Record<string, unknown>) => unknown;

interface CompiledNode {
  id: string;
  type: "agent_call" | "switch" | "end";
  config: AgentCallConfig | SwitchConfig | Record<string, never>;
  inputExpr?: CompiledCel;
  outputExprs?: Map<string, CompiledCel>;
  routeFromExpr?: CompiledCel;
  caseExprs?: CompiledCel[];
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
  return result;
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

  const validNodeTypes = new Set(["agent_call", "switch", "end"]);
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
      throw new Error(`[DeclarativeGraph] Node "${n.id}" has invalid type. Must be one of: agent_call, switch, end.`);
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

export async function runWorkflow(
  compiled: CompiledGraph,
  initialState: AnyState,
  opts?: { maxIterations?: number },
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

    if (node.type === "agent_call") {
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
    } else if (node.type === "switch") {
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
  opts?: { maxIterations?: number },
): Promise<StateGraphResult<AnyState>> {
  const def = parseWorkflowDefinition(json);
  const compiled = await compileWorkflow(def, client);
  return runWorkflow(compiled, initialState, opts);
}
