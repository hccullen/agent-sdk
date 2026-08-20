import { AgentHandle } from "./handle.js";
import type { AgentHandleFactory } from "./handle.js";
import { MessageResponse } from "./response.js";
import type { Part } from "./types.js";
import {
  compileWorkflow,
  runWorkflow,
} from "./declarativeGraph.js";
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowHandlers,
} from "./declarativeGraph.js";

export type { StateGraphResult, StateGraphStep } from "./declarativeGraph.js";

export const END = Symbol("END");
export type END = typeof END;

type AnyState = Record<string, unknown>;

export type NodeFn<S extends AnyState> = (state: S) => Promise<Partial<S>>;

export type EdgeRouter<S extends AnyState> =
  | string
  | END
  | ((state: S) => string | END);

export class StateGraph<S extends AnyState> {
  private readonly _factory: AgentHandleFactory | undefined;
  private readonly _nodes = new Map<string, NodeFn<S>>();
  private readonly _edges = new Map<string, EdgeRouter<S>>();

  constructor(factory?: AgentHandleFactory) {
    this._factory = factory;
  }

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
  ): Promise<import("./declarativeGraph.js").StateGraphResult<S>> {
    const { def, handlers } = this._build(entryNode);
    const compiled = await compileWorkflow(
      def,
      this._factory,
      handlers,
    );
    return runWorkflow(compiled, initialState, opts) as Promise<import("./declarativeGraph.js").StateGraphResult<S>>;
  }

  toDefinition(entryNode: string): WorkflowDefinition {
    return this._build(entryNode).def;
  }

  private _build(entryNode: string): { def: WorkflowDefinition; handlers: WorkflowHandlers } {
    const nodes: WorkflowNode[] = [];
    const edges: { source: string; target: string }[] = [];
    const handlers: WorkflowHandlers = {};

    for (const [name, fn] of this._nodes) {
      const handlerName = `__cb_${name}`;
      const router = this._edges.get(name);

      if (typeof router === "function") {
        const routeFn = router;
        handlers[handlerName] = async (state: AnyState) => {
          const delta = await fn(state as S);
          const target = routeFn({ ...state, ...delta } as S);
          return { delta, next: target === END ? "__end__" : target };
        };
        nodes.push({
          id: name,
          type: "callback",
          config: { handler: handlerName },
        });
      } else {
        handlers[handlerName] = async (state: AnyState) => fn(state as S);
        nodes.push({
          id: name,
          type: "callback",
          config: { handler: handlerName },
        });
      }

      if (router === END) {
        edges.push({ source: name, target: "__end__" });
      } else if (typeof router === "string") {
        edges.push({ source: name, target: router });
      }
    }

    edges.push({ source: "__start__", target: entryNode });

    if (!nodes.some((n) => n.id === "__end__")) {
      nodes.push({ id: "__end__", type: "end" });
    }

    return {
      def: {
        document: { name: "stategraph", version: "1.0.0" },
        nodes,
        edges,
      },
      handlers,
    };
  }
}

export function stateGraph<S extends AnyState>(factory?: AgentHandleFactory): StateGraph<S> {
  return new StateGraph<S>(factory);
}

export function agentNode<S extends AnyState>(
  agent: AgentHandle,
  getInput: (state: S) => string | Part[],
  mergeResponse: (response: MessageResponse, state: S) => Partial<S>,
): NodeFn<S> {
  return async (state: S) => mergeResponse(await agent.run(getInput(state)), state);
}
