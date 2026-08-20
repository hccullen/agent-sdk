import { describe, expect, it, vi } from "vitest";
import { CortiClient } from "../client.js";
import type { Agent } from "../types.js";

const agentResponse: Agent = {
  id: "agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40",
  name: "coder",
  visibility: "private",
  lifecycle: "persistent",
  connectors: [],
} as unknown as Agent;

function makeMockSdk(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function makeClient(sdkOverrides: Record<string, unknown> = {}): { client: CortiClient; mockSdk: ReturnType<typeof makeMockSdk> } {
  const mockSdk = makeMockSdk(sdkOverrides);
  return { client: new CortiClient({ sdkClient: mockSdk as never }), mockSdk };
}

describe("CortiClient.agents", () => {
  it("create delegates to sdk.agentic.agents.create", async () => {
    const { client, mockSdk } = makeClient();

    const result = await client.agents.create({
      name: "coder",
      description: "Returns ICD-10 codes.",
    });

    expect(result).toEqual(agentResponse);
    expect(mockSdk.agentic.agents.create).toHaveBeenCalledWith({
      name: "coder",
      description: "Returns ICD-10 codes.",
    });
  });

  it("get delegates to sdk.agentic.agents.get", async () => {
    const { client, mockSdk } = makeClient();

    const result = await client.agents.get("agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40");

    expect(result).toEqual(agentResponse);
    expect(mockSdk.agentic.agents.get).toHaveBeenCalledWith("agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40");
  });

  it("list delegates to sdk.agentic.agents.list and returns response", async () => {
    const { client, mockSdk } = makeClient();

    const result = await client.agents.list({
      visibility: ["private"],
      lifecycle: "persistent",
      q: "coder",
    });

    expect(result.agents).toHaveLength(1);
    expect(mockSdk.agentic.agents.list).toHaveBeenCalledWith({
      visibility: ["private"],
      lifecycle: "persistent",
      q: "coder",
    });
  });

  it("update delegates to sdk.agentic.agents.update", async () => {
    const updated = { ...agentResponse, name: "coder-v2" };
    const { client, mockSdk } = makeClient({
      agentic: {
        agents: {
          update: vi.fn().mockResolvedValue(updated),
        },
      },
    });

    const result = await client.agents.update("agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40", {
      name: "coder-v2",
      model: null,
    });

    expect(result.name).toBe("coder-v2");
    expect(mockSdk.agentic.agents.update).toHaveBeenCalledWith(
      "agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40",
      { name: "coder-v2", model: null },
    );
  });

  it("delete delegates to sdk.agentic.agents.delete", async () => {
    const { client, mockSdk } = makeClient();

    await client.agents.delete("agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40");

    expect(mockSdk.agentic.agents.delete).toHaveBeenCalledWith("agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40");
  });
});
