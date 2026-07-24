import { AgentHandle } from "./handle.js";
import { MessageResponse } from "./response.js";
import type { Part } from "./types.js";

export const END = Symbol("END");
export type END = typeof END;

type AnyState = Record<string, unknown>;

export type NodeFn<S extends AnyState> = (state: S) => Promise<Partial<S>>;

export type EdgeRouter<S extends AnyState> =
  | string
  | END
  | ((state: S) => string | END);

export interface StateGraphStep<S extends AnyState> {
  node: string;
  delta: Partial<S>;
  state: S;
}

export interface StateGraphResult<S extends AnyState> {
  state: S;
  steps: StateGraphStep<S>[];
  iterations: number;
  terminatedBy: "end" | "maxIterations" | "noEdge";
}

export class StateGraph<S extends AnyState> {
  private readonly _nodes = new Map<string, NodeFn<S>>();
  private readonly _edges = new Map<string, EdgeRouter<S>>();

  addNode(name: string, fn: NodeFn<S>): this {
    this._nodes.set(name, fn);
    return this;
  }

  addEdge(from: string, to: EdgeRouter<S>): this {
    this._edges.set(from, to);
    return this;
  }

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

export function stateGraph<S extends AnyState>(): StateGraph<S> {
  return new StateGraph<S>();
}

export function agentNode<S extends AnyState>(
  agent: AgentHandle,
  getInput: (state: S) => string | Part[],
  mergeResponse: (response: MessageResponse, state: S) => Partial<S>,
): NodeFn<S> {
  return async (state: S) => mergeResponse(await agent.run(getInput(state)), state);
}
