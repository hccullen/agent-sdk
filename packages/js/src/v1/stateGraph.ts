import { AgentHandle } from "./AgentHandle.js";
import { MessageResponse } from "./MessageResponse.js";
import type { Part } from "./types.js";

// ── END sentinel ──────────────────────────────────────────────────────────────

/** Pass as an edge target to terminate the graph. */
export const END = Symbol("END");
export type END = typeof END;

// ── Types ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyState = Record<string, any>;

/**
 * A node function. Receives the current accumulated state and returns a
 * partial update that is shallow-merged into the state before routing.
 */
export type NodeFn<S extends AnyState> = (state: S) => Promise<Partial<S>>;

/**
 * An edge router: a static next-node name, `END`, or a function that
 * inspects the post-node state and returns one of those.
 */
export type EdgeRouter<S extends AnyState> =
  | string
  | END
  | ((state: S) => string | END);

/** One recorded execution step. */
export interface StateGraphStep<S extends AnyState> {
  /** Name of the node that ran. */
  node: string;
  /** Partial update returned by the node. */
  delta: Partial<S>;
  /** Full state after applying the delta. */
  state: S;
}

/** Returned by `StateGraph.run()`. */
export interface StateGraphResult<S extends AnyState> {
  /** Final accumulated state. */
  state: S;
  /** Ordered history of every node execution. */
  steps: StateGraphStep<S>[];
  /** Total number of node executions. */
  iterations: number;
  /** Why execution stopped. */
  terminatedBy: "end" | "maxIterations" | "noEdge";
}

// ── StateGraph ────────────────────────────────────────────────────────────────

/**
 * A stateful routing graph for multi-agent workflows.
 *
 * Unlike the linear `Workflow`, a `StateGraph` maintains a typed shared state
 * object that accumulates across node executions. Edges can be static names or
 * routing functions that inspect the state to decide what runs next — including
 * cycles, bounded by `maxIterations` (default 25).
 *
 * @example
 * ```ts
 * interface TriageState {
 *   note: string;
 *   severity?: string;
 *   codes?: string;
 *   approved?: boolean;
 * }
 *
 * const graph = stateGraph<TriageState>()
 *   .addNode("triage",   agentNode(triageAgent,   s => s.note,     (r, s) => ({ ...s, severity: r.text ?? "" })))
 *   .addNode("coder",    agentNode(coderAgent,    s => s.note,     (r, s) => ({ ...s, codes: r.text ?? "" })))
 *   .addNode("reviewer", agentNode(reviewerAgent, s => s.codes!,   (r, s) => ({ ...s, approved: (r.text ?? "").includes("approved") })))
 *   .addEdge("triage",   s => (s.severity ?? "").includes("urgent") ? "coder" : END)
 *   .addEdge("coder",    "reviewer")
 *   .addEdge("reviewer", s => s.approved ? END : "coder");   // bounded by maxIterations
 *
 * const { state, steps } = await graph.run("triage", { note: "Chest pain..." });
 * ```
 */
export class StateGraph<S extends AnyState> {
  private readonly _nodes = new Map<string, NodeFn<S>>();
  private readonly _edges = new Map<string, EdgeRouter<S>>();

  /**
   * Register a named node.
   *
   * @param name  Unique node identifier.
   * @param fn    Async function that receives state and returns a partial update.
   */
  addNode(name: string, fn: NodeFn<S>): this {
    this._nodes.set(name, fn);
    return this;
  }

  /**
   * Define routing from a node.
   *
   * @param from  Source node name.
   * @param to    A static node name, `END`, or a function `(state) => name | END`.
   */
  addEdge(from: string, to: EdgeRouter<S>): this {
    this._edges.set(from, to);
    return this;
  }

  /**
   * Execute the graph starting from `entryNode`.
   *
   * @param entryNode     Name of the first node to run.
   * @param initialState  Starting state passed to the first node.
   * @param opts.maxIterations  Safety limit on total node executions (default 25).
   */
  async run(
    entryNode: string,
    initialState: S,
    opts?: { maxIterations?: number },
  ): Promise<StateGraphResult<S>> {
    const maxIter = opts?.maxIterations ?? 25;
    const steps: StateGraphStep<S>[] = [];
    let state: S = { ...initialState };
    let current: string | END = entryNode;
    let iterations = 0;
    let terminatedBy: StateGraphResult<S>["terminatedBy"] = "end";

    while (current !== END) {
      if (iterations >= maxIter) {
        terminatedBy = "maxIterations";
        break;
      }

      const nodeName = current as string;
      const fn = this._nodes.get(nodeName);
      if (!fn) throw new Error(`[StateGraph] Unknown node: "${nodeName}".`);

      const delta = await fn(state);
      state = { ...state, ...delta };
      steps.push({ node: nodeName, delta, state: { ...state } });
      iterations++;

      const router = this._edges.get(nodeName);
      if (router === undefined) {
        terminatedBy = "noEdge";
        break;
      }

      current = typeof router === "function" ? router(state) : router;
    }

    return { state, steps, iterations, terminatedBy };
  }
}

/** Create a new `StateGraph` with typed state `S`. */
export function stateGraph<S extends AnyState>(): StateGraph<S> {
  return new StateGraph<S>();
}

// ── agentNode helper ──────────────────────────────────────────────────────────

/**
 * Wrap an `AgentHandle` as a `NodeFn`.
 *
 * @param agent          The agent to invoke.
 * @param getInput       Extract the agent's input from the current state.
 * @param mergeResponse  Merge the agent's response back into state as a partial update.
 *
 * @example
 * ```ts
 * agentNode(myAgent, s => s.note, (r, s) => ({ summary: r.text ?? "" }))
 * ```
 */
export function agentNode<S extends AnyState>(
  agent: AgentHandle,
  getInput: (state: S) => string | Part[],
  mergeResponse: (response: MessageResponse, state: S) => Partial<S>,
): NodeFn<S> {
  return async (state: S) => mergeResponse(await agent.run(getInput(state)), state);
}
