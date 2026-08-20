import { AgentHandle } from "./handle.js";
import { MessageResponse } from "./response.js";
import type { Part } from "./types.js";
import {
  parseWorkflowDefinition,
  compileWorkflow,
  runWorkflow,
} from "./declarativeGraph.js";
import type { WorkflowDefinition, WorkflowHandlers } from "./declarativeGraph.js";

export interface Runnable {
  run(input: string | Part[]): Promise<MessageResponse>;
}

export interface WorkflowStep {
  agent: Runnable;
  when?: (prev: MessageResponse) => boolean;
  transform?: (prev: MessageResponse) => string | Part[];
  retries?: number;
  retryDelay?: number;
}

export interface WorkflowResult {
  output: MessageResponse;
  steps: MessageResponse[];
  stoppedEarly: boolean;
}

type WorkflowStepDef = AgentHandle | Parallel | WorkflowStep;

function parallelToRunnable(p: Parallel): Runnable {
  return {
    run: async (input: string | Part[]) => {
      const { fulfilled } = await p.run(input);
      if (fulfilled.length === 0) {
        throw new Error("[AgentSDK] All parallel steps failed — no output to merge.");
      }
      return MessageResponse.fromText(fulfilled.map((r) => r.text ?? "").join("\n\n"));
    },
  };
}

function normaliseWorkflow(step: WorkflowStepDef): WorkflowStep {
  if (step instanceof AgentHandle) return { agent: step };
  if (step instanceof Parallel) return { agent: parallelToRunnable(step) };
  if (step.agent instanceof Parallel) return { ...step, agent: parallelToRunnable(step.agent) };
  return step;
}

const _delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class Workflow {
  private readonly _steps: WorkflowStep[];

  constructor(steps: WorkflowStepDef[]) {
    if (steps.length === 0) throw new Error("[AgentSDK] Workflow must have at least one step.");
    this._steps = steps.map(normaliseWorkflow);
  }

  async run(input: string | Part[]): Promise<WorkflowResult> {
    const nodes: WorkflowDefinition["nodes"] = [];
    const edges: { source: string; target: string }[] = [];
    const handlers: WorkflowHandlers = {};
    const stepResponses: MessageResponse[] = [];
    let stoppedEarly = false;

    nodes.push({ id: "__end__", type: "end" });

    for (let i = 0; i < this._steps.length; i++) {
      const step = this._steps[i];
      const nodeId = `step_${i}`;
      const handlerName = `__wf_${i}`;

      handlers[handlerName] = async (state: Record<string, unknown>) => {
        const isFirst = i === 0;
        const prevResponse = stepResponses[stepResponses.length - 1];

        if (!isFirst && step.when !== undefined && !step.when(prevResponse)) {
          return { next: i < this._steps.length - 1 ? `step_${i + 1}` : "__end__" };
        }

        const stepInput: string | Part[] =
          !isFirst && step.transform !== undefined
            ? step.transform(prevResponse)
            : !isFirst
              ? (prevResponse.text ?? "")
              : (state.__input as string | Part[]);

        const maxAttempts = 1 + (step.retries ?? 0);
        const retryMs = step.retryDelay ?? 1000;
        let response!: MessageResponse;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          response = await step.agent.run(stepInput);
          if (response.status !== "failed" || attempt + 1 >= maxAttempts) break;
          if (retryMs > 0) await _delay(retryMs);
        }

        stepResponses.push(response);

        if (response.status === "failed") {
          stoppedEarly = true;
          return { next: "__end__" };
        }

        return {
          next: i < this._steps.length - 1 ? `step_${i + 1}` : "__end__",
        };
      };

      nodes.push({
        id: nodeId,
        type: "callback",
        config: { handler: handlerName },
      });

      edges.push({
        source: i === 0 ? "__start__" : `step_${i - 1}`,
        target: nodeId,
      });
    }

    const def: WorkflowDefinition = {
      document: { name: "workflow", version: "1.0.0" },
      nodes,
      edges,
    };

    const parsed = parseWorkflowDefinition(def);
    const compiled = await compileWorkflow(parsed, undefined, handlers);
    await runWorkflow(compiled, { __input: input });

    if (stepResponses.length === 0) {
      throw new Error("[AgentSDK] All workflow steps were skipped — no output produced.");
    }

    return {
      output: stepResponses[stepResponses.length - 1],
      steps: stepResponses,
      stoppedEarly,
    };
  }
}

export function workflow(steps: WorkflowStepDef[]): Workflow {
  return new Workflow(steps);
}

export type ParallelStep = AgentHandle | { agent: AgentHandle; input?: string | Part[] };

export interface ParallelResult {
  results: PromiseSettledResult<MessageResponse>[];
  fulfilled: MessageResponse[];
  rejected: unknown[];
}

export class Parallel {
  private readonly _steps: ParallelStep[];

  constructor(steps: ParallelStep[]) {
    if (steps.length === 0) throw new Error("[AgentSDK] Parallel must have at least one step.");
    this._steps = steps;
  }

  async run(input: string | Part[]): Promise<ParallelResult> {
    const promises = this._steps.map((step) => {
      const agent = step instanceof AgentHandle ? step : step.agent;
      const stepInput =
        !(step instanceof AgentHandle) && step.input !== undefined ? step.input : input;
      return agent.run(stepInput);
    });

    const results = await Promise.allSettled(promises);
    const fulfilled: MessageResponse[] = [];
    const rejected: unknown[] = [];

    for (const r of results) {
      if (r.status === "fulfilled") fulfilled.push(r.value);
      else rejected.push(r.reason);
    }

    return { results, fulfilled, rejected };
  }
}

export function parallel(steps: ParallelStep[]): Parallel {
  return new Parallel(steps);
}
