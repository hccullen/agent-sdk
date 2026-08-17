/**
 * 08 — Declarative workflows (JSON / YAML DSL).
 *
 * Shows the definition format that underlies workflow() and stateGraph().
 * The same engine, exposed as data: parse → compile → run.
 *
 * Run: `npm run declarative-workflows`
 */
import {
  AgentsClient,
  parseWorkflowDefinition,
  compileWorkflow,
  runWorkflow,
  executeWorkflow,
  analyzeGraphStructure,
  runWorkflowInteractive,
  resumeWorkflow,
} from "@newsioaps/agent-sdk";
import { makeClient } from "./_client";

interface TriageState {
  note: string;
  severity: string;
  codes: string;
  approved: boolean;
}

async function main() {
  const client = makeClient();
  const agents = new AgentsClient(client);

  // -- Create the agents the definition will reference ------------------
  const triageAgent = await agents.create({
    name: "dw-triage",
    description: "Classifies clinical urgency.",
    systemPrompt:
      'Read the clinical note and reply with exactly one word: "urgent" or "routine". No punctuation.',
  });

  const coderAgent = await agents.create({
    name: "dw-coder",
    description: "Assigns ICD-10 codes.",
    systemPrompt:
      "Suggest up to three ICD-10 codes for the clinical note. Format: comma-separated codes only.",
  });

  // -- Define the graph as JSON -----------------------------------------
  const definition = {
    document: {
      name: "triage-flow",
      version: "1.0.0",
      description: "Triage → code → review loop",
    },
    max_iterations: 25,
    nodes: [
      {
        id: "triage",
        type: "agent_call" as const,
        config: {
          agent: triageAgent.id,
          input: "state.note",
          output: { severity: "response.text" },
        },
      },
      {
        id: "route",
        type: "switch" as const,
        config: {
          cases: [{ when: "state.severity == 'urgent'", target: "coder" }],
          default: "__end__",
        },
      },
      {
        id: "coder",
        type: "agent_call" as const,
        config: {
          agent: coderAgent.id,
          input: "state.note",
          output: { codes: "response.text" },
        },
      },
      { id: "__end__", type: "end" as const },
    ],
    edges: [
      { source: "__start__", target: "triage" },
      { source: "triage", target: "route" },
      { source: "coder", target: "__end__" },
    ],
  };

  // -- Validate the definition (throws on structural errors) ------------
  parseWorkflowDefinition(definition);

  // -- Static analysis: find unreachable nodes & dead ends -------------
  const { unreachable, deadEnds } = analyzeGraphStructure(definition);
  if (unreachable.length) console.warn("Unreachable:", unreachable);
  if (deadEnds.length) console.warn("Dead ends:", deadEnds);

  // -- One-shot: parse + compile + run ----------------------------------
  const result = await executeWorkflow(definition, client, {
    note: "Patient presents with sudden onset chest pain radiating to the left arm, diaphoresis, and shortness of breath for 45 minutes.",
  });

  console.log("— One-shot execution —");
  console.log("Severity:", result.state.severity);
  console.log("Codes:", result.state.codes);
  console.log("Iterations:", result.iterations);
  console.log("Terminated by:", result.terminatedBy);

  // -- Human-in-the-loop with checkpoint/resume -------------------------
  const hitlDefinition = {
    document: { name: "hitl-flow", version: "1.0.0" },
    nodes: [
      {
        id: "triage",
        type: "agent_call" as const,
        config: {
          agent: triageAgent.id,
          input: "state.note",
          output: { severity: "response.text" },
        },
      },
      {
        id: "review",
        type: "interrupt" as const,
        config: {
          prompt: "'Severity: ' + state.severity + '. Approve?'",
          field: "approved",
          route_from: "state.approved == 'yes' ? 'coder' : '__end__'",
        },
      },
      {
        id: "coder",
        type: "agent_call" as const,
        config: {
          agent: coderAgent.id,
          input: "state.note",
          output: { codes: "response.text" },
        },
      },
      { id: "__end__", type: "end" as const },
    ],
    edges: [
      { source: "__start__", target: "triage" },
      { source: "triage", target: "review" },
      { source: "coder", target: "__end__" },
    ],
  };

  parseWorkflowDefinition(hitlDefinition);
  const compiled = await compileWorkflow(hitlDefinition, client);

  console.log("\n— Human-in-the-loop (interactive) —");
  const gen = runWorkflowInteractive(compiled, {
    note: "Patient presents with mild chest pain on exertion for 2 weeks.",
    severity: "",
    codes: "",
    approved: false,
  });

  const first = await gen.next();
  if (first.value.kind === "interrupt") {
    const interrupt = first.value;
    console.log("Interrupt prompt:", interrupt.prompt);
    console.log("Checkpoint saved (first 40 chars):", interrupt.checkpoint.slice(0, 40) + "...");

    // Simulate a human answering "yes" after a pause
    const resumeGen = resumeWorkflow(compiled, interrupt.checkpoint, "yes");
    const final = await resumeGen.next();
    if (final.value.kind !== "interrupt") {
      const hitlResult = final.value;
      console.log("Approved:", hitlResult.state.approved);
      console.log("Codes:", hitlResult.state.codes);
      console.log("Iterations:", hitlResult.iterations);
      console.log("Terminated by:", hitlResult.terminatedBy);
    }
  }

  // -- Export a StateGraph as a portable definition ---------------------
  console.log("\n— StateGraph.toDefinition() round-trip —");
  const { stateGraph, agentNode, END } = await import("@newsioaps/agent-sdk");

  const graph = stateGraph<TriageState>()
    .addNode(
      "triage",
      agentNode(triageAgent, (s) => s.note, (r) => ({ severity: r.text ?? "" })),
    )
    .addNode(
      "coder",
      agentNode(coderAgent, (s) => s.note, (r) => ({ codes: r.text ?? "" })),
    )
    .addEdge("triage", (s) => (s.severity.includes("urgent") ? "coder" : END))
    .addEdge("coder", END);

  const exportedDef = graph.toDefinition("triage");
  console.log("Exported nodes:", exportedDef.nodes.map((n) => `${n.id} (${n.type})`).join(", "));
  console.log("Exported edges:", exportedDef.edges.map((e) => `${e.source} → ${e.target}`).join(", "));

  // Verify the exported definition is valid:
  parseWorkflowDefinition(exportedDef);
  const exportedCompiled = await compileWorkflow(exportedDef, client);
  const exportedResult = await runWorkflow(exportedCompiled, {
    note: "Patient has acute shortness of breath and wheezing.",
    severity: "",
    codes: "",
    approved: false,
  });

  console.log("Round-trip severity:", exportedResult.state.severity);
  console.log("Round-trip codes:", exportedResult.state.codes);
  console.log("Round-trip terminated by:", exportedResult.terminatedBy);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
