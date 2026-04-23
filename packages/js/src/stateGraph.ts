import { MessageResponse } from "./MessageResponse";
import type { Part } from "./types";
import type { Runnable } from "./runnable";

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
 * A stateful routing graph — the one composition primitive.
 *
 * Nodes hold typed shared state that accumulates across executions. Edges can
 * be static names or routing functions that inspect state to pick the next
 * node, including cycles (bounded by `maxIterations`, default 25).
 *
 * Linear pipelines, conditional branching, review loops, and parallel
 * fan-outs (via a `Parallel` node) all fit one shape.
 *
 * @example
 * ```ts
 * // Linear pipeline:
 * stateGraph<{ note: string; summary: string; severity: string }>()
 *   .addNode("summarise", agentNode(summariser, s => s.note,    (r, s) => ({ ...s, summary:  r.text ?? "" })))
 *   .addNode("classify",  agentNode(classifier, s => s.summary, (r, s) => ({ ...s, severity: r.text ?? "" })))
 *   .addEdge("summarise", "classify")
 *   .addEdge("classify",  END);
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

const _delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Options for `agentNode()`. */
export interface AgentNodeOptions {
  /** Re-invoke the runnable if it returns `status === "failed"`. Default: 0. */
  retries?: number;
  /** Milliseconds between retry attempts. Default: 1000. */
  retryDelay?: number;
}

/**
 * Wrap any `Runnable` (an `AgentHandle`, a `Parallel` group, or a custom
 * object with a matching `run()`) as a `NodeFn`.
 *
 * @param runnable       The runnable to invoke.
 * @param getInput       Extract the runnable's input from the current state.
 * @param mergeResponse  Merge the response back into state as a partial update.
 * @param opts           Optional retry behaviour for failed responses.
 *
 * @example
 * ```ts
 * // Agent node with two retries on failure:
 * agentNode(escalator, s => s.note, (r, s) => ({ ...s, draft: r.text ?? "" }), { retries: 2 })
 *
 * // Parallel fan-out as a node:
 * agentNode(parallel([a, b]), s => s.q, (r, s) => ({ ...s, parts: r.statusMessage?.parts ?? [] }))
 * ```
 */
export function agentNode<S extends AnyState>(
  runnable: Runnable,
  getInput: (state: S) => string | Part[],
  mergeResponse: (response: MessageResponse, state: S) => Partial<S>,
  opts?: AgentNodeOptions,
): NodeFn<S> {
  const maxAttempts = 1 + (opts?.retries ?? 0);
  const retryMs = opts?.retryDelay ?? 1000;

  return async (state: S) => {
    const input = getInput(state);
    let response!: MessageResponse;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      response = await runnable.run(input);
      if (response.status !== "failed" || attempt + 1 >= maxAttempts) break;
      if (retryMs > 0) await _delay(retryMs);
    }
    return mergeResponse(response, state);
  };
}
