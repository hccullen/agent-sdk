import { AgentHandle } from "./AgentHandle";
import { MessageResponse } from "./MessageResponse";
import type { Part } from "./types";

// ── Shared helpers ────────────────────────────────────────────────────────────

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ── Workflow ──────────────────────────────────────────────────────────────────

/**
 * A fully-specified workflow step.
 *
 * Use a bare `AgentHandle` when you always want the step to run and the
 * default input mapping (previous `text`) is fine.
 */
export interface WorkflowStep {
  agent: AgentHandle;
  /** Return `false` to skip this step; the previous response passes forward unchanged. */
  when?: (prev: MessageResponse) => boolean;
  /** Map the previous response to this step's input. Default: `prev.text ?? ""` */
  transform?: (prev: MessageResponse) => string | Part[];
  /** Number of additional attempts if the step returns `status === "failed"`. Default: 0. */
  retries?: number;
  /** Milliseconds between retry attempts. Default: 1000. */
  retryDelay?: number;
}

/** Returned by `Workflow.run()`. */
export interface WorkflowResult {
  /** The last executed response. */
  output: MessageResponse;
  /** Responses from every executed step. Skipped steps are excluded. */
  steps: MessageResponse[];
  /** `true` when a step failed and stopped execution early. */
  stoppedEarly: boolean;
}

type WorkflowStepDef = AgentHandle | WorkflowStep;

function normaliseWorkflow(step: WorkflowStepDef): WorkflowStep {
  return step instanceof AgentHandle ? { agent: step } : step;
}

/**
 * A deterministic, code-first pipeline of agent invocations.
 *
 * @example
 * ```ts
 * const result = await workflow([
 *   agentA,
 *   { agent: agentB, when: (r) => (r.text ?? "").includes("urgent"), retries: 2 },
 *   { agent: agentC, transform: (r) => `Summarise: ${r.text}` },
 * ]).run("Start");
 *
 * console.log(result.output.text);
 * console.log(result.steps.length);
 * console.log(result.stoppedEarly);
 * ```
 */
export class Workflow {
  private readonly _steps: WorkflowStep[];

  constructor(steps: WorkflowStepDef[]) {
    if (steps.length === 0) throw new Error("[AgentSDK] Workflow must have at least one step.");
    this._steps = steps.map(normaliseWorkflow);
  }

  async run(input: string | Part[]): Promise<WorkflowResult> {
    const executed: MessageResponse[] = [];
    let current: string | Part[] = input;
    let stoppedEarly = false;

    for (let i = 0; i < this._steps.length; i++) {
      const step = this._steps[i];
      const isFirst = i === 0;

      if (!isFirst && step.when !== undefined && !step.when(executed[executed.length - 1])) {
        continue;
      }

      const stepInput: string | Part[] =
        !isFirst && step.transform !== undefined
          ? step.transform(executed[executed.length - 1])
          : current;

      const maxAttempts = 1 + (step.retries ?? 0);
      const retryMs = step.retryDelay ?? 1000;
      let response!: MessageResponse;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        response = await step.agent.run(stepInput);
        if (response.status !== "failed" || attempt + 1 >= maxAttempts) break;
        if (retryMs > 0) await delay(retryMs);
      }

      executed.push(response);
      current = response.text ?? "";

      if (response.status === "failed") {
        stoppedEarly = true;
        break;
      }
    }

    return { output: executed[executed.length - 1], steps: executed, stoppedEarly };
  }
}

/** Create a `Workflow` from an ordered list of steps. */
export function workflow(steps: WorkflowStepDef[]): Workflow {
  return new Workflow(steps);
}

// ── Parallel ──────────────────────────────────────────────────────────────────

/**
 * A parallel step. Provide `input` to override the shared input for this
 * specific agent; omit to use whatever was passed to `Parallel.run()`.
 */
export type ParallelStep = AgentHandle | { agent: AgentHandle; input?: string | Part[] };

/** Returned by `Parallel.run()`. Mirrors `Promise.allSettled` shape. */
export interface ParallelResult {
  /** One entry per step, in the same order as the step list. */
  results: PromiseSettledResult<MessageResponse>[];
  /** Responses from steps that completed without throwing. */
  fulfilled: MessageResponse[];
  /** Error values from steps that threw. */
  rejected: unknown[];
}

/**
 * Run multiple agents concurrently on the same input and collect all responses.
 *
 * @example
 * ```ts
 * const { fulfilled } = await parallel([agentA, agentB, agentC]).run("prompt");
 * console.log(fulfilled.map((r) => r.text));
 *
 * // Per-step input override:
 * const { fulfilled: [r1, r2] } = await parallel([
 *   { agent: coder,    input: "Write a Python function that…" },
 *   { agent: reviewer, input: "Review this specification…" },
 * ]).run("ignored");
 * ```
 */
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

/** Run multiple agents concurrently on the same input. */
export function parallel(steps: ParallelStep[]): Parallel {
  return new Parallel(steps);
}
