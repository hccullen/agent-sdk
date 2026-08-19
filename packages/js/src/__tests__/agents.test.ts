import { describe, expect, it, vi } from "vitest";
import { AgentsResource } from "../agents.js";
import type { CortiClient } from "../client.js";
import type { Agent } from "../types.js";

const agentResponse: Agent = {
  id: "agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40",
  name: "coder",
  visibility: "private",
  lifecycle: "persistent",
  connectors: [],
};

function makeMockClient(overrides: Record<string, unknown> = {}): CortiClient {
  return {
    sdk: {
      agentic: {
        agents: {
          create: vi.fn().mockResolvedValue(agentResponse),
          get: vi.fn().mockResolvedValue(agentResponse),
          list: vi.fn().mockResolvedValue({
            response: { agents: [agentResponse], nextPageToken: null },
            data: [agentResponse],
          }),
          update: vi.fn().mockResolvedValue(agentResponse),
          delete: vi.fn().mockResolvedValue(undefined),
        },
      },
    },
    ...overrides,
  } as unknown as CortiClient;
}

describe("AgentsResource", () => {
  it("create delegates to sdk.agentic.agents.create", async () => {
    const client = makeMockClient();
    const agents = new AgentsResource(client);

    const result = await agents.create({
      name: "coder",
      description: "Returns ICD-10 codes.",
    });

    expect(result).toEqual(agentResponse);
    expect(client.sdk.agentic.agents.create).toHaveBeenCalledWith({
      name: "coder",
      description: "Returns ICD-10 codes.",
    });
  });

  it("get delegates to sdk.agentic.agents.get", async () => {
    const client = makeMockClient();
    const agents = new AgentsResource(client);

    const result = await agents.get("agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40");

    expect(result).toEqual(agentResponse);
    expect(client.sdk.agentic.agents.get).toHaveBeenCalledWith("agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40");
  });

  it("list delegates to sdk.agentic.agents.list and returns response", async () => {
    const client = makeMockClient();
    const agents = new AgentsResource(client);

    const result = await agents.list({
      visibility: ["private"],
      lifecycle: "persistent",
      q: "coder",
    });

    expect(result.agents).toHaveLength(1);
    expect(client.sdk.agentic.agents.list).toHaveBeenCalledWith({
      visibility: ["private"],
      lifecycle: "persistent",
      q: "coder",
    });
  });

  it("update delegates to sdk.agentic.agents.update", async () => {
    const updated = { ...agentResponse, name: "coder-v2" };
    const client = makeMockClient({
      sdk: {
        agentic: {
          agents: {
            update: vi.fn().mockResolvedValue(updated),
          },
        },
      },
    });
    const agents = new AgentsResource(client);

    const result = await agents.update("agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40", {
      name: "coder-v2",
      model: null,
    });

    expect(result.name).toBe("coder-v2");
    expect(client.sdk.agentic.agents.update).toHaveBeenCalledWith(
      "agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40",
      { name: "coder-v2", model: null },
    );
  });

  it("delete delegates to sdk.agentic.agents.delete", async () => {
    const client = makeMockClient();
    const agents = new AgentsResource(client);

    await agents.delete("agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40");

    expect(client.sdk.agentic.agents.delete).toHaveBeenCalledWith("agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40");
  });
});
