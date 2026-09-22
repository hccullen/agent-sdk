/**
 * 01 — Hello, agent.
 *
 * The minimum viable example: create an agent, start a conversation,
 * read the reply. Ephemeral agents are GC'd server-side — no explicit
 * cleanup is needed. Pass `lifecycle: "persistent"` if you want the
 * agent to outlive the process.
 *
 * Run: `npm run hello`
 */
import { CortiClient } from "@newsioaps/agent-sdk";
import { makeClient } from "./_client.js";

async function main() {
  const client = new CortiClient({ sdkClient: makeClient() });

  const agent = await client.agents.create({
    name: "hello-agent",
    description: "A minimal greeting agent.",
    systemPrompt: "You are a friendly assistant. Keep replies to one sentence.",
  });
  const handle = await client.createAgentHandle(agent.id);

  const ctx = handle.createContext();

  const reply = await ctx.sendText("Say hello and tell me one fun fact.");
  console.log("Agent:", reply.text);
  console.log("Status:", reply.status);
  console.log("Context ID:", ctx.id);

  // The context persists across calls — the agent remembers the thread.
  const followUp = await ctx.sendText("Tell me another one.");
  console.log("Agent:", followUp.text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
