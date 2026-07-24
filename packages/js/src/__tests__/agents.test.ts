import { describe, expect, it, vi } from "vitest";
import { CortiClient } from "../client.js";
import { AgentsResource } from "../agents.js";
import type { Agent } from "../types.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(fetchFn: ReturnType<typeof vi.fn>): CortiClient {
  return new CortiClient({
    token: "test-token",
    tenant: "test-tenant",
    baseUrl: "https://api.test.corti.app",
    fetch: fetchFn as unknown as typeof fetch,
  });
}

const agentResponse: Agent = {
  id: "agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40",
  name: "coder",
  visibility: "private",
  lifecycle: "persistent",
  connectors: [],
  createdAt: "2026-05-19T12:00:00Z",
  updatedAt: "2026-05-19T12:00:00Z",
  createdBy: "usr.0192f4c8-8bc0-7194-8570-92e3ce81d0a6",
};

function getRequest(fetchFn: ReturnType<typeof vi.fn>): Request {
  return fetchFn.mock.calls[0][0] as Request;
}

async function getRequestBody(fetchFn: ReturnType<typeof vi.fn>): Promise<unknown> {
  const req = getRequest(fetchFn);
  return JSON.parse(await req.text());
}

describe("AgentsResource", () => {
  it("create sends POST and returns the agent", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(agentResponse, 201));
    const client = makeClient(fetchFn);
    const agents = new AgentsResource(client);

    const result = await agents.create({
      name: "coder",
      description: "Returns ICD-10 codes.",
    });

    expect(result).toEqual(agentResponse);
    const req = getRequest(fetchFn);
    expect(req.url).toContain("/v2/agentic/agents");
    expect(req.method).toBe("POST");
    const body = await getRequestBody(fetchFn);
    expect((body as { name: string }).name).toBe("coder");
  });

  it("get sends GET with path param", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(agentResponse));
    const client = makeClient(fetchFn);
    const agents = new AgentsResource(client);

    const result = await agents.get("agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40");

    expect(result).toEqual(agentResponse);
    const req = getRequest(fetchFn);
    expect(req.url).toContain("/v2/agentic/agents/agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40");
    expect(req.method).toBe("GET");
  });

  it("list sends GET with query params", async () => {
    const listResponse = {
      agents: [agentResponse],
      nextPageOffset: null,
      totalSize: 1,
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(listResponse));
    const client = makeClient(fetchFn);
    const agents = new AgentsResource(client);

    const result = await agents.list({
      visibility: ["private"],
      lifecycle: "persistent",
      q: "coder",
    });

    expect(result.agents).toHaveLength(1);
    const req = getRequest(fetchFn);
    expect(req.url).toContain("visibility=private");
    expect(req.url).toContain("lifecycle=persistent");
    expect(req.url).toContain("q=coder");
  });

  it("update sends PATCH with merge-patch content type", async () => {
    const updated = { ...agentResponse, name: "coder-v2" };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(updated));
    const client = makeClient(fetchFn);
    const agents = new AgentsResource(client);

    const result = await agents.update("agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40", {
      name: "coder-v2",
      model: null,
    });

    expect(result.name).toBe("coder-v2");
    const req = getRequest(fetchFn);
    expect(req.method).toBe("PATCH");
    expect(req.headers.get("Content-Type")).toBe("application/merge-patch+json");
  });

  it("delete sends DELETE", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = makeClient(fetchFn);
    const agents = new AgentsResource(client);

    await agents.delete("agt.0192f4c8-2c5a-7b3e-9f1a-3c8d6e2b7a40");

    const req = getRequest(fetchFn);
    expect(req.method).toBe("DELETE");
  });

  it("throws ManagementError on error response", async () => {
    const errorBody = {
      error: {
        code: "VALIDATION_FAILED",
        message: "validation failed",
        details: {
          validationErrors: [{ field: "name", reason: "required" }],
        },
      },
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(errorBody, 422));
    const client = makeClient(fetchFn);
    const agents = new AgentsResource(client);

    await expect(agents.create({ name: "" })).rejects.toMatchObject({
      name: "ManagementError",
      code: "VALIDATION_FAILED",
    });
  });
});
