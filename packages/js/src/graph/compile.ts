import { parse, plan, celEnv, isCelError, isCelMap, isCelList } from "@bufbuild/cel";
import type { AgentHandle, AgentHandleFactory } from "../handle.js";
import type {
  WorkflowDefinition,
  WorkflowNode,
  AgentCallConfig,
  SwitchConfig,
  SetStateConfig,
  HttpCallConfig,
  InterruptConfig,
  WaitConfig,
  ParallelConfig,
  CallbackConfig,
  WorkflowHandlers,
} from "./parse.js";

type AnyState = Record<string, unknown>;

export type CompiledCel = (bindings?: Record<string, unknown>) => unknown;

export interface CompiledNode {
  id: string;
  type: "agent_call" | "switch" | "set_state" | "http_call" | "interrupt" | "wait" | "parallel" | "callback" | "end";
  config: AgentCallConfig | SwitchConfig | SetStateConfig | HttpCallConfig | InterruptConfig | WaitConfig | ParallelConfig | CallbackConfig | Record<string, never>;
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
  handlerName?: string;
  agentHandle?: AgentHandle;
}

export interface CompiledGraph {
  definition: WorkflowDefinition;
  nodes: Map<string, CompiledNode>;
  edges: Map<string, string>;
  entryNode: string;
  maxIterations: number;
  handlers: WorkflowHandlers;
}

export function compileCel(expr: string): CompiledCel {
  const ast = parse(expr);
  return plan(celEnv(), ast) as unknown as CompiledCel;
}

export function evalCel(compiled: CompiledCel, bindings: Record<string, unknown>): unknown {
  const result = compiled(bindings);
  if (isCelError(result)) {
    throw new Error(`[DeclarativeGraph] CEL evaluation error: ${(result as Error).message}`);
  }
  return celToJs(result);
}

export function celToJs(value: unknown): unknown {
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

export async function compileWorkflow(
  def: WorkflowDefinition,
  factory?: AgentHandleFactory,
  handlers?: WorkflowHandlers,
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
    } else if (node.type === "callback") {
      const cfg = node.config as CallbackConfig;
      compiled.handlerName = cfg.handler;
      if (cfg.output) {
        compiled.outputExprs = new Map<string, CompiledCel>();
        for (const [field, expr] of Object.entries(cfg.output)) {
          compiled.outputExprs.set(field, compileCel(expr));
        }
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
      if (!factory) {
        throw new Error("[DeclarativeGraph] AgentHandleFactory required for agent_call nodes.");
      }
      const compiled = nodes.get(node.id)!;
      compiled.agentHandle = await factory(cfg.agent);
    }
  }

  return {
    definition: def,
    nodes,
    edges,
    entryNode,
    maxIterations: def.max_iterations ?? 25,
    handlers: handlers ?? {},
  };
}
