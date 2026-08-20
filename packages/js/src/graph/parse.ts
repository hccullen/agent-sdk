import yaml from "js-yaml";
import { Ajv } from "ajv";

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
  | { id: string; type: "callback"; config: CallbackConfig }
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

export interface CallbackConfig {
  handler: string;
  output?: Record<string, string>;
  route_from?: string;
}

export interface WorkflowHandlerResult {
  delta?: Partial<AnyState>;
  next?: string;
}

export type WorkflowHandler = (state: AnyState) => Promise<WorkflowHandlerResult | Partial<AnyState>>;
export type WorkflowHandlers = Record<string, WorkflowHandler>;

export interface RetryPolicy {
  max_attempts: number;
  backoff_coefficient?: number;
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

  const validNodeTypes = new Set(["agent_call", "switch", "set_state", "http_call", "interrupt", "wait", "parallel", "callback", "end"]);
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
      throw new Error(`[DeclarativeGraph] Node "${n.id}" has invalid type. Must be one of: agent_call, switch, set_state, http_call, interrupt, wait, parallel, callback, end.`);
    }
    if (n.type !== "end" && (!n.config || typeof n.config !== "object")) {
      throw new Error(`[DeclarativeGraph] Node "${n.id}" must have a config object.`);
    }
    if (n.type === "callback") {
      const cfg = n.config as Record<string, unknown>;
      if (!cfg?.handler || typeof cfg.handler !== "string") {
        throw new Error(`[DeclarativeGraph] Callback node "${n.id}" must have a string handler.`);
      }
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

export function parseYamlDefinition(input: string): WorkflowDefinition {
  const parsed = yaml.load(input);
  return parseWorkflowDefinition(parsed as object);
}

export function validateStateSchema(
  state: AnyState,
  schema: object,
): { valid: boolean; errors: string[] } {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const valid = validate(state);
  if (valid) return { valid: true, errors: [] };
  const errors = (validate.errors ?? []).map(
    (e: { instancePath: string; message?: string }) => `${e.instancePath || "/"}: ${e.message ?? "validation error"}`,
  );
  return { valid: false, errors };
}
