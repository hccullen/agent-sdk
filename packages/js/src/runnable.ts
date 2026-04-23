import type { Corti } from "@corti/sdk";
import { AgentHandle } from "./AgentHandle";
import { MessageResponse } from "./MessageResponse";
import type { CredentialStore, Part } from "./types";

// ── Runnable ──────────────────────────────────────────────────────────────────

/**
 * The single contract for anything that can be a step in a graph node, a
 * branch of a parallel group, or a building block in any composition.
 * `AgentHandle`, `Parallel`, and any custom object with a matching `run()`
 * all satisfy it.
 */
export interface Runnable {
  run(input: string | Part[]): Promise<MessageResponse>;
}

/** Duck-typed runnable check. */
export function isRunnable(x: unknown): x is Runnable {
  return !!x && typeof (x as Runnable).run === "function";
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
  /** Responses from branches that completed without throwing. */
  fulfilled: MessageResponse[];
  /** Error values from branches that threw. */
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
 * Run multiple `Runnable`s concurrently on the same input.
 *
 * `run()` returns a single `MessageResponse` whose reply message carries the
 * concatenated parts of every fulfilled branch — so a downstream agent sees
 * one message with N branches' worth of parts, not a lossy text-joined
 * string. Use `runSettled()` when you need the per-branch allSettled
 * breakdown.
 *
 * Parallel is itself a `Runnable`, so it composes inside `StateGraph` nodes,
 * inside other `Parallel`s, or anywhere a `Runnable` is expected.
 *
 * @example
 * ```ts
 * // Standalone: per-branch results
 * const { fulfilled, rejected } = await parallel([a, b]).runSettled("prompt");
 *
 * // As a node in a state graph
 * graph.addNode("gather", agentNode(
 *   parallel([retriever, websearch]),
 *   s => s.query,
 *   (r, s) => ({ ...s, evidence: r.statusMessage?.parts ?? [] }),
 * ));
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
      throw new Error("[AgentSDK] All parallel branches failed — no output to merge.");
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

/** Run multiple `Runnable`s concurrently on the same input. */
export function parallel(steps: ParallelStep[]): Parallel {
  return new Parallel(steps);
}
