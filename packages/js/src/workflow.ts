import { AgentHandle } from "./AgentHandle";
import { MessageResponse } from "./MessageResponse";
import type { Part } from "./types";

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * A fully-specified workflow step.
 *
 * Use a bare `AgentHandle` when you always want the step to run and the
 * default input mapping (previous `text`) is fine. Use this interface when
 * you need conditional execution or a custom input transform.
 */
export interface WorkflowStep {
  agent: AgentHandle;
  /**
   * Return `false` to skip this step. The previous response is passed forward
   * unchanged. `transform` is not called for skipped steps.
   *
   * Has no effect on the first step (there is no previous response).
   */
  when?: (prev: MessageResponse) => boolean;
  /**
   * Map the previous response to the input for this step.
   * Default: `prev.text ?? ""`
   *
   * Has no effect on the first step.
   */
  transform?: (prev: MessageResponse) => string | Part[];
}

/** Returned by `Workflow.run()`. */
export interface WorkflowResult {
  /** The last executed response. */
  output: MessageResponse;
  /** Responses from every executed step in order. Skipped steps are excluded. */
  steps: MessageResponse[];
  /** `true` when execution stopped early because a step returned `status === "failed"`. */
  stoppedEarly: boolean;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

type StepDef = AgentHandle | WorkflowStep;

function normalise(step: StepDef): WorkflowStep {
  return step instanceof AgentHandle ? { agent: step } : step;
}

// ── Workflow ──────────────────────────────────────────────────────────────────

/**
 * A deterministic, code-first pipeline of agent invocations.
 *
 * Steps are executed in order. Each step can be guarded by a `when` predicate
 * and/or use a `transform` function to remap the previous output before it is
 * passed as input to the next agent.
 *
 * @example
 * ```ts
 * const result = await workflow([
 *   agentA,
 *   { agent: agentB, when: (r) => (r.text ?? "").includes("urgent") },
 *   { agent: agentC, transform: (r) => `Summarise: ${r.text}` },
 * ]).run("Start");
 *
 * console.log(result.output.text);
 * console.log(result.steps.length);   // skipped steps are excluded
 * console.log(result.stoppedEarly);
 * ```
 */
export class Workflow {
  private readonly _steps: WorkflowStep[];

  constructor(steps: StepDef[]) {
    if (steps.length === 0) {
      throw new Error("[AgentSDK] Workflow must have at least one step.");
    }
    this._steps = steps.map(normalise);
  }

  async run(input: string | Part[]): Promise<WorkflowResult> {
    const executed: MessageResponse[] = [];
    let current: string | Part[] = input;
    let stoppedEarly = false;

    for (let i = 0; i < this._steps.length; i++) {
      const step = this._steps[i];
      const isFirst = i === 0;

      // when() only applies once there is a previous response
      if (!isFirst && step.when !== undefined) {
        const prev = executed[executed.length - 1];
        if (!step.when(prev)) continue;
      }

      // Resolve this step's input
      const stepInput: string | Part[] =
        !isFirst && step.transform !== undefined
          ? step.transform(executed[executed.length - 1])
          : current;

      const response = await step.agent.run(stepInput);
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

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a `Workflow` from an ordered list of steps.
 *
 * Each element can be either a bare `AgentHandle` (always runs, passes
 * `prev.text` to the next step) or a `WorkflowStep` object with optional
 * `when` and `transform` callbacks.
 *
 * @example
 * ```ts
 * const w = workflow([agentA, agentB, agentC]);
 * const { output } = await w.run("initial prompt");
 * ```
 */
export function workflow(steps: StepDef[]): Workflow {
  return new Workflow(steps);
}
