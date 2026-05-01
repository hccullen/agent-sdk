import { AgentHandle } from "./AgentHandle.js";
import { AgentsClient } from "./AgentsClient.js";
import { Parallel, Workflow } from "./workflow.js";
import type { WorkflowStep } from "./workflow.js";
import type { ConnectorDef, TaskState } from "./types.js";
import type { MessageResponse } from "./MessageResponse.js";

// ── Agent config ──────────────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  description: string;
  systemPrompt?: string;
  lifecycle?: "ephemeral" | "persistent";
  connectors?: ConnectorDef[];
}

// ── When predicate ────────────────────────────────────────────────────────────

export type WhenPredicate =
  | { text: { includes: string } }
  | { text: { notIncludes: string } }
  | { status: TaskState };

// ── Step configs ──────────────────────────────────────────────────────────────

export type ParallelItemConfig = string | { agent: string; input?: string };

export interface FullStepConfig {
  agent: string;
  retries?: number;
  retryDelay?: number;
  when?: WhenPredicate;
}

export interface ParallelGroupConfig {
  parallel: ParallelItemConfig[];
}

export type WorkflowStepConfig = string | FullStepConfig | ParallelGroupConfig;

// ── Top-level config ──────────────────────────────────────────────────────────

export interface WorkflowConfig {
  agents: AgentConfig[];
  workflow: WorkflowStepConfig[];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function evalWhen(pred: WhenPredicate, resp: MessageResponse): boolean {
  if ("text" in pred) {
    const txt = resp.text ?? "";
    if ("includes" in pred.text) return txt.includes(pred.text.includes);
    return !txt.includes(pred.text.notIncludes);
  }
  return resp.status === pred.status;
}

// ── fromConfig ────────────────────────────────────────────────────────────────

/**
 * Build a ready-to-run `Workflow` from a plain JSON config.
 *
 * All agents are created concurrently, then the workflow topology is
 * assembled from the `workflow` step list — referencing agents by name.
 *
 * This is an additive alternative to the code-first API; both can be used
 * in the same project. For steps requiring a custom `transform` function,
 * use the code-first `workflow()` / `WorkflowStep` API instead.
 *
 * @example
 * ```ts
 * const wf = await fromConfig({
 *   agents: [
 *     { name: "summarizer", description: "Summarises text" },
 *     { name: "classifier", description: "Classifies the summary" },
 *   ],
 *   workflow: [
 *     "summarizer",
 *     { agent: "classifier", when: { text: { includes: "urgent" } }, retries: 1 },
 *   ],
 * }, agentsClient);
 *
 * const result = await wf.run("Patient note…");
 * ```
 */
export async function fromConfig(
  config: WorkflowConfig,
  agentsClient: AgentsClient,
): Promise<Workflow> {
  const agentConfigs = config.agents;

  const handles = await Promise.all(agentConfigs.map((a) => agentsClient.create(a)));
  const byName = new Map(agentConfigs.map((a, i) => [a.name, handles[i]]));

  function resolve(name: string): AgentHandle {
    const h = byName.get(name);
    if (!h) throw new Error(`[AgentSDK] fromConfig: unknown agent "${name}"`);
    return h;
  }

  const steps: Array<AgentHandle | Parallel | WorkflowStep> = config.workflow.map((step) => {
    if (typeof step === "string") return { agent: resolve(step) };

    if ("parallel" in step) {
      return new Parallel(
        step.parallel.map((s) =>
          typeof s === "string"
            ? { agent: resolve(s) }
            : { agent: resolve(s.agent), ...(s.input !== undefined && { input: s.input }) },
        ),
      );
    }

    const ws: WorkflowStep = { agent: resolve(step.agent) };
    if (step.retries !== undefined) ws.retries = step.retries;
    if (step.retryDelay !== undefined) ws.retryDelay = step.retryDelay;
    if (step.when !== undefined) {
      const pred = step.when;
      ws.when = (prev) => evalWhen(pred, prev);
    }
    return ws;
  });

  return new Workflow(steps);
}
