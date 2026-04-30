import { AgentHandle } from "./AgentHandle.js";
import { MessageResponse } from "./MessageResponse.js";
import type { CredentialStore, Part } from "./types.js";

// ── Runnable ──────────────────────────────────────────────────────────────────

/**
 * Anything that can act as a workflow step: an `AgentHandle`, a `Parallel`
 * group, or any custom object with a `run()` method.
 */
export interface Runnable {
  run(input: string | Part[]): Promise<MessageResponse>;
}

// ── Workflow ──────────────────────────────────────────────────────────────────

/**
 * A fully-specified workflow step.
 *
 * `agent` accepts any `Runnable` — an `AgentHandle`, a `Parallel` group
 * (auto-wrapped to merge fulfilled results), or a custom object.
 */
export interface WorkflowStep {
  agent: Runnable;
  /** Return `false` to skip this step; the previous response passes forward unchanged. */
  when?: (prev: MessageResponse) => boolean;
  /** Map the previous response to this step's input. Default: `prev.text ?? ""` */
  transform?: (prev: MessageResponse) => string | Part[];
  /** Additional attempts if the step returns `status === "failed"`. Default: 0. */
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
  // WorkflowStep dict whose agent is a Parallel — wrap the agent in place.
  if (step.agent instanceof Parallel) return { ...step, agent: parallelToRunnable(step.agent) };
  return step;
}

const _delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A deterministic, code-first pipeline of agent invocations.
 *
 * Steps can be `AgentHandle` instances, `Parallel` groups, or `WorkflowStep`
 * objects with optional `when` / `transform` / `retries` controls.
 *
 * @example
 * ```ts
 * const result = await workflow([
 *   agentA,
 *   parallel([agentB, agentC]),          // fan-out as a single step
 *   { agent: agentD, when: (r) => (r.text ?? "").includes("yes"), retries: 2 },
 * ]).run("Start");
 *
 * console.log(result.output.text);
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
        if (retryMs > 0) await _delay(retryMs);
      }

      executed.push(response);
      current = response.text ?? "";

      if (response.status === "failed") {
        stoppedEarly = true;
        break;
      }
    }

    if (executed.length === 0) {
      throw new Error("[AgentSDK] All workflow steps were skipped — no output produced.");
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
 * Provide `credentials` to forward auth credentials for this specific agent.
 */
export type ParallelStep = AgentHandle | { agent: AgentHandle; input?: string | Part[]; credentials?: CredentialStore };

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
 * Can be used standalone (`.run()` → `ParallelResult`) or dropped directly
 * into a `workflow()` step list, where fulfilled results are text-joined into
 * a single `MessageResponse` for the next step.
 *
 * @example
 * ```ts
 * // Standalone
 * const { fulfilled } = await parallel([agentA, agentB]).run("prompt");
 *
 * // Inside a workflow
 * workflow([agentA, parallel([agentB, agentC]), agentD]).run("prompt");
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
      const credentials = !(step instanceof AgentHandle) ? step.credentials : undefined;
      return agent.run(stepInput, credentials !== undefined ? { credentials } : undefined);
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
