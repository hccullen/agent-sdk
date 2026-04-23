import type { Corti } from "@corti/sdk";
import { AgentHandle } from "./AgentHandle";
import { MessageResponse } from "./MessageResponse";
import type { CredentialStore, Part } from "./types";

// ── Runnable ──────────────────────────────────────────────────────────────────

/**
 * The single contract for anything that can be a step in a workflow, a branch
 * of a parallel group, or a node in a state graph. `AgentHandle`, `Parallel`,
 * and any custom object with a matching `run()` all satisfy it.
 */
export interface Runnable {
  run(input: string | Part[]): Promise<MessageResponse>;
}

function isRunnable(x: unknown): x is Runnable {
  return !!x && typeof (x as Runnable).run === "function";
}

// ── Workflow ──────────────────────────────────────────────────────────────────

/**
 * A fully-specified workflow step.
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

type WorkflowStepDef = Runnable | WorkflowStep;

function normaliseWorkflow(step: WorkflowStepDef): WorkflowStep {
  if (isRunnable(step)) return { agent: step };
  return step;
}

const _delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A deterministic, code-first pipeline of agent invocations.
 *
 * Steps can be any `Runnable` (an `AgentHandle`, a `Parallel` group, or a
 * custom object) or a `WorkflowStep` with optional `when` / `transform` /
 * `retries` controls.
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
 * A parallel branch. Either a bare `Runnable` (an `AgentHandle`, a nested
 * `Parallel`, or any object with a matching `run()`), or a dict form
 * providing a per-branch `input` override and/or `credentials` (the latter
 * applies to `AgentHandle` branches).
 */
export type ParallelStep =
  | Runnable
  | { agent: AgentHandle; input?: string | Part[]; credentials?: CredentialStore };

/** Returned by `Parallel.runSettled()`. Mirrors `Promise.allSettled` shape. */
export interface ParallelResult {
  /** One entry per step, in the same order as the step list. */
  results: PromiseSettledResult<MessageResponse>[];
  /** Responses from steps that completed without throwing. */
  fulfilled: MessageResponse[];
  /** Error values from steps that threw. */
  rejected: unknown[];
}

/**
 * Combine N agent responses into one by concatenating their reply-message
 * parts. Preserves text parts, data parts, file parts, and their order within
 * each branch. Failed / user-echo responses are skipped.
 */
function mergeResponses(responses: MessageResponse[]): MessageResponse {
  const parts: Part[] = [];
  for (const r of responses) {
    const msg = r.statusMessage;
    if (!msg || msg.role === "user") continue;
    for (const p of msg.parts ?? []) parts.push(p);
  }
  return new MessageResponse({
    id: "",
    contextId: "",
    kind: "task",
    status: {
      state: "completed",
      message: { role: "agent", parts, messageId: "", kind: "message" },
    },
  } as Corti.AgentsTask);
}

/**
 * Run multiple agents concurrently on the same input.
 *
 * `run()` returns a single `MessageResponse` whose reply message carries the
 * concatenated parts of every fulfilled branch — so downstream agents (or a
 * workflow step) see one message with N branches' worth of parts, not a
 * lossy text-joined string. Use `runSettled()` when you need the per-branch
 * allSettled breakdown.
 *
 * @example
 * ```ts
 * // Inside a workflow — merged parts flow straight into the next step
 * workflow([agentA, parallel([agentB, agentC]), agentD]).run("prompt");
 *
 * // Standalone, per-branch results
 * const { fulfilled, rejected } = await parallel([agentA, agentB]).runSettled("prompt");
 * ```
 */
export class Parallel implements Runnable {
  private readonly _steps: ParallelStep[];

  constructor(steps: ParallelStep[]) {
    if (steps.length === 0) throw new Error("[AgentSDK] Parallel must have at least one step.");
    this._steps = steps;
  }

  /** Run all branches concurrently and merge fulfilled responses into one `MessageResponse`. */
  async run(input: string | Part[]): Promise<MessageResponse> {
    const settled = await this.runSettled(input);
    if (settled.fulfilled.length === 0) {
      throw new Error("[AgentSDK] All parallel steps failed — no output to merge.");
    }
    return mergeResponses(settled.fulfilled);
  }

  /** Run all branches concurrently and return the full per-branch allSettled result. */
  async runSettled(input: string | Part[]): Promise<ParallelResult> {
    const promises = this._steps.map((step) => {
      if (isRunnable(step)) return step.run(input);
      const stepInput = step.input !== undefined ? step.input : input;
      return step.agent.run(
        stepInput,
        step.credentials !== undefined ? { credentials: step.credentials } : undefined,
      );
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
