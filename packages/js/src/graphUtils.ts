import { END, StateGraph, agentNode } from "./stateGraph";
import { Parallel, Workflow } from "./workflow";
import type { EdgeRouter, NodeFn } from "./stateGraph";
import type { AgentHandle } from "./AgentHandle";
import type { MessageResponse } from "./MessageResponse";
import type { Part } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

/** JSON-safe sentinel for graph termination (mirrors the `END` symbol). */
export const JSON_END = "__END__" as const;
export type JsonEnd = typeof JSON_END;

// ── StateGraph JSON types ─────────────────────────────────────────────────────

export interface StateGraphNodeDef {
  /** Unique node identifier — must match keys in the agent registry. */
  id: string;
  /** Key in the `AgentRegistry` to use for this node. */
  agent: string;
  /** Optional display label (falls back to `id`). */
  label?: string;
}

/**
 * A directed edge in the graph.
 *
 * Multiple edges from the same `from` node represent conditional routing:
 * conditions are evaluated in order and the first match wins.
 * The last edge with no `condition` acts as the default fallback.
 */
export interface StateGraphEdgeDef {
  from: string;
  to: string | JsonEnd;
  /** Key in the `ConditionRegistry` — omit for unconditional / default edges. */
  condition?: string;
  /** Optional label shown on the edge in React Flow. */
  label?: string;
}

export interface StateGraphDef {
  type: "stateGraph";
  /** Name of the first node to execute. */
  entry: string;
  nodes: StateGraphNodeDef[];
  edges: StateGraphEdgeDef[];
}

// ── Workflow JSON types ───────────────────────────────────────────────────────

export interface WorkflowAgentStepDef {
  type: "agent";
  /** Unique step identifier used as the React Flow node id. */
  id: string;
  /** Key in the `AgentRegistry`. */
  agent: string;
  label?: string;
  /** Key in the workflow `ConditionRegistry` — receives the previous `MessageResponse`. */
  when?: string;
  retries?: number;
  retryDelay?: number;
}

export interface WorkflowParallelStepDef {
  type: "parallel";
  id: string;
  /** Agent keys to run concurrently. */
  agents: string[];
  label?: string;
  /** Key in the workflow `ConditionRegistry`. */
  when?: string;
}

export type WorkflowStepDef = WorkflowAgentStepDef | WorkflowParallelStepDef;

export interface WorkflowDef {
  type: "workflow";
  steps: WorkflowStepDef[];
}

export type GraphDef = StateGraphDef | WorkflowDef;

// ── React Flow output types ───────────────────────────────────────────────────

export interface ReactFlowNodeData {
  label: string;
  /** Semantic type for custom React Flow node renderers. */
  nodeType: "agent" | "parallel" | "end";
  /** Agent registry key (agent/parallel nodes). */
  agentId?: string;
  /** Agent registry keys for parallel nodes. */
  agents?: string[];
  [key: string]: unknown;
}

export interface ReactFlowNode {
  id: string;
  position: { x: number; y: number };
  data: ReactFlowNodeData;
}

export interface ReactFlowEdge {
  id: string;
  source: string;
  target: string;
  /** Condition name or custom label. */
  label?: string;
}

export interface ReactFlowGraph {
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
}

// ── Registries ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyState = Record<string, any>;

export type AgentRegistry = Record<string, AgentHandle>;

/** Condition functions keyed by name — used in `StateGraph` edge routing. */
export type StateConditionRegistry<S extends AnyState = AnyState> = Record<
  string,
  (state: S) => boolean
>;

/** Condition functions keyed by name — used in `Workflow` step gating. */
export type WorkflowConditionRegistry = Record<
  string,
  (prev: MessageResponse) => boolean
>;

/** Per-node input/output mapping for `stateGraphFromDef`. */
export interface NodeIOMapping<S extends AnyState> {
  getInput: (state: S) => string | Part[];
  mergeResponse: (response: MessageResponse, state: S) => Partial<S>;
}

// ── stateGraphFromDef ─────────────────────────────────────────────────────────

export interface StateGraphFromDefOptions<S extends AnyState> {
  agents: AgentRegistry;
  conditions?: StateConditionRegistry<S>;
  /**
   * Per-node input/output mapping.
   *
   * If a node has no entry here the default behaviour is used:
   * the full state is JSON-stringified as input and the response text
   * is stored as `${nodeId}Result` in the state.
   */
  nodes?: Record<string, NodeIOMapping<S>>;
}

/**
 * Build a `StateGraph` from a plain JSON definition.
 *
 * @example
 * ```ts
 * const graph = stateGraphFromDef<TriageState>(def, {
 *   agents: { triage: triageAgent, coder: coderAgent, reviewer: reviewerAgent },
 *   conditions: {
 *     isUrgent:   (s) => s.severity.includes("urgent"),
 *     isApproved: (s) => s.approved === true,
 *   },
 *   nodes: {
 *     triage:   { getInput: (s) => s.note, mergeResponse: (r, s) => ({ ...s, severity: r.text ?? "" }) },
 *     coder:    { getInput: (s) => s.note, mergeResponse: (r, s) => ({ ...s, codes: r.text ?? "" }) },
 *     reviewer: { getInput: (s) => s.codes!, mergeResponse: (r, s) => ({ ...s, approved: r.text?.includes("approved") ?? false }) },
 *   },
 * });
 * ```
 */
export function stateGraphFromDef<S extends AnyState>(
  def: StateGraphDef,
  options: StateGraphFromDefOptions<S>,
): StateGraph<S> {
  const { agents, conditions, nodes: nodeMappings } = options;
  const graph = new StateGraph<S>();

  for (const nodeDef of def.nodes) {
    const agent = agents[nodeDef.agent];
    if (!agent) throw new Error(`[stateGraphFromDef] Unknown agent: "${nodeDef.agent}"`);

    const mapping = nodeMappings?.[nodeDef.id];
    const fn: NodeFn<S> = mapping
      ? agentNode(agent, mapping.getInput, mapping.mergeResponse)
      : async (s: S) => {
          const response = await agent.run(JSON.stringify(s));
          return { [`${nodeDef.id}Result`]: response.text } as unknown as Partial<S>;
        };

    graph.addNode(nodeDef.id, fn);
  }

  // Group edges by source node to build routers
  const edgesByFrom = new Map<string, StateGraphEdgeDef[]>();
  for (const edge of def.edges) {
    const list = edgesByFrom.get(edge.from) ?? [];
    list.push(edge);
    edgesByFrom.set(edge.from, list);
  }

  for (const [from, edges] of edgesByFrom) {
    // Single unconditional edge → static router
    if (edges.length === 1 && !edges[0].condition) {
      graph.addEdge(from, edges[0].to === JSON_END ? END : edges[0].to);
      continue;
    }

    // Multiple edges or a conditional edge → dynamic router
    const router: EdgeRouter<S> = (state: S) => {
      for (const edge of edges) {
        if (!edge.condition) return edge.to === JSON_END ? END : edge.to;
        const cond = conditions?.[edge.condition];
        if (!cond) throw new Error(`[stateGraphFromDef] Unknown condition: "${edge.condition}"`);
        if (cond(state)) return edge.to === JSON_END ? END : edge.to;
      }
      throw new Error(`[stateGraphFromDef] No matching route from "${from}"`);
    };
    graph.addEdge(from, router);
  }

  return graph;
}

// ── workflowFromDef ───────────────────────────────────────────────────────────

/**
 * Build a `Workflow` from a plain JSON definition.
 *
 * @example
 * ```ts
 * const wf = workflowFromDef(def, agents, {
 *   hasKeywords: (prev) => (prev.text ?? "").includes("yes"),
 * });
 * ```
 */
export function workflowFromDef(
  def: WorkflowDef,
  agents: AgentRegistry,
  conditions?: WorkflowConditionRegistry,
): Workflow {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const steps: any[] = def.steps.map((stepDef) => {
    const whenFn = stepDef.when
      ? (() => {
          const cond = conditions?.[stepDef.when!];
          if (!cond) throw new Error(`[workflowFromDef] Unknown condition: "${stepDef.when}"`);
          return cond;
        })()
      : undefined;

    if (stepDef.type === "parallel") {
      const parallelAgents = stepDef.agents.map((key) => {
        const a = agents[key];
        if (!a) throw new Error(`[workflowFromDef] Unknown agent: "${key}"`);
        return { agent: a };
      });
      return { agent: new Parallel(parallelAgents), when: whenFn };
    }

    const agent = agents[stepDef.agent];
    if (!agent) throw new Error(`[workflowFromDef] Unknown agent: "${stepDef.agent}"`);

    return {
      agent,
      when: whenFn,
      retries: stepDef.retries,
      retryDelay: stepDef.retryDelay,
    };
  });

  return new Workflow(steps);
}

// ── toReactFlow ───────────────────────────────────────────────────────────────

const NODE_W = 160;
const NODE_H = 50;
const H_GAP = 80;
const V_GAP = 80;

/**
 * Convert a `StateGraphDef` or `WorkflowDef` to React Flow `nodes` and `edges`.
 *
 * Positions are computed with a simple layered (top-down) layout.
 * For production use, pass the result through a layout library such as
 * `@dagrejs/dagre` or `elkjs` for more refined positioning.
 *
 * @example
 * ```ts
 * // In your React app (no SDK import needed):
 * import { toReactFlow } from "@corti/agent-sdk/graphUtils";
 * const { nodes, edges } = toReactFlow(myDef);
 * return <ReactFlow nodes={nodes} edges={edges} fitView />;
 * ```
 */
export function toReactFlow(def: GraphDef): ReactFlowGraph {
  return def.type === "stateGraph"
    ? _stateGraphToReactFlow(def)
    : _workflowToReactFlow(def);
}

function _stateGraphToReactFlow(def: StateGraphDef): ReactFlowGraph {
  // BFS from entry to assign depth levels
  const depths = new Map<string, number>([[def.entry, 0]]);
  const queue = [def.entry];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const depth = depths.get(current)!;
    for (const edge of def.edges) {
      if (edge.from !== current || edge.to === JSON_END || depths.has(edge.to)) continue;
      depths.set(edge.to, depth + 1);
      queue.push(edge.to);
    }
  }

  // Any node unreachable from entry gets depth 0
  for (const n of def.nodes) {
    if (!depths.has(n.id)) depths.set(n.id, 0);
  }

  // Collect node ids per depth for horizontal centering
  const byDepth = new Map<number, string[]>();
  for (const [id, d] of depths) {
    const list = byDepth.get(d) ?? [];
    list.push(id);
    byDepth.set(d, list);
  }

  const nodes: ReactFlowNode[] = def.nodes.map((n) => {
    const depth = depths.get(n.id)!;
    const siblings = byDepth.get(depth)!;
    const idx = siblings.indexOf(n.id);
    const totalW = siblings.length * (NODE_W + H_GAP) - H_GAP;
    return {
      id: n.id,
      position: {
        x: idx * (NODE_W + H_GAP) - totalW / 2,
        y: depth * (NODE_H + V_GAP),
      },
      data: { label: n.label ?? n.id, nodeType: "agent", agentId: n.agent },
    };
  });

  // Add __END__ node if referenced
  if (def.edges.some((e) => e.to === JSON_END)) {
    const maxDepth = Math.max(...depths.values()) + 1;
    nodes.push({
      id: JSON_END,
      position: { x: 0, y: maxDepth * (NODE_H + V_GAP) },
      data: { label: "END", nodeType: "end" },
    });
  }

  const edges: ReactFlowEdge[] = def.edges.map((e, i) => ({
    id: `e${i}`,
    source: e.from,
    target: e.to === JSON_END ? JSON_END : e.to,
    label: e.label ?? e.condition,
  }));

  return { nodes, edges };
}

function _workflowToReactFlow(def: WorkflowDef): ReactFlowGraph {
  const nodes: ReactFlowNode[] = [];
  const edges: ReactFlowEdge[] = [];
  let y = 0;
  let prevId: string | null = null;

  for (const step of def.steps) {
    if (step.type === "parallel") {
      const node: ReactFlowNode = {
        id: step.id,
        position: { x: 0, y },
        data: {
          label: step.label ?? `parallel(${step.agents.join(", ")})`,
          nodeType: "parallel",
          agents: step.agents,
        },
      };
      nodes.push(node);
      if (prevId) {
        edges.push({ id: `e-${prevId}-${step.id}`, source: prevId, target: step.id, label: step.when });
      }
      y += NODE_H + V_GAP;
      prevId = step.id;
    } else {
      const node: ReactFlowNode = {
        id: step.id,
        position: { x: 0, y },
        data: {
          label: step.label ?? step.agent,
          nodeType: "agent",
          agentId: step.agent,
        },
      };
      nodes.push(node);
      if (prevId) {
        edges.push({ id: `e-${prevId}-${step.id}`, source: prevId, target: step.id, label: step.when });
      }
      y += NODE_H + V_GAP;
      prevId = step.id;
    }
  }

  return { nodes, edges };
}
