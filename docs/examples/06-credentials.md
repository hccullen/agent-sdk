---
prev:
  text: "05 · Streaming"
  link: "/examples/05-streaming"
next:
  text: "07 · State graph"
  link: "/examples/07-state-graph"
---

# 06 — Credentials

When a connector needs authentication, the agent may respond with `status: "auth-required"`. Pass a `CredentialStore` to `createContext()` and the SDK forwards your tokens automatically — on the first message *and* as a follow-up if the server asks again.

<ConceptGrid>
<ConceptCard title="auth-required">Task status returned when an MCP server challenges the agent for authentication.</ConceptCard>
<ConceptCard title="CredentialStore">A plain object mapping connector names to credential objects. Pass it to `createContext()` or `agent.run()`.</ConceptCard>
<ConceptCard title="Connector name as key">The key in the credential store must match the `name` you gave the connector. If no name was set, the SDK derives one from the MCP URL hostname.</ConceptCard>
<ConceptCard title="Transparent re-send">If the first message still triggers `auth-required`, the SDK sends credentials again as a follow-up — no extra code needed.</ConceptCard>
</ConceptGrid>

## Run it

```bash
# Set your MCP server URL and bearer token
MCP_URL=https://my-mcp.example.com MCP_TOKEN=sk-... npm run credentials

# Or add them to your .env file
echo "MCP_URL=https://my-mcp.example.com" >> .env
echo "MCP_TOKEN=sk-..."                   >> .env
npm run credentials
```

::: info
**This example requires a real MCP server.** Without `MCP_URL` and `MCP_TOKEN`, the script logs a setup message and exits early. The other examples work without any external services.
:::

## How it works

Without a `CredentialStore`, the flow would look like this:

1. You send a message to the agent.
2. The agent calls the MCP server.
3. The MCP server challenges for auth.
4. The agent returns `status: "auth-required"` to you.
5. You must send a follow-up message with credentials as a `DataPart`.

With a `CredentialStore`, the SDK handles steps 4 and 5 automatically:

1. You call `createContext({ credentials })`.
2. The SDK attaches the credentials as a `DataPart` on the *first* message — proactively, before the server even asks.
3. If the agent still returns `status: "auth-required"` (some servers require a challenge-response flow), the SDK automatically sends a follow-up with the credentials.
4. The final `"completed"` response is returned to you as if nothing happened.

## Credential types

| Type | Shape | Use when |
|---|---|---|
| `"token"` | `{ type: "token", token: string }` | Bearer token / API key authentication. Most common. |
| `"credentials"` | `{ type: "credentials", clientId: string, clientSecret: string }` | OAuth2 client credentials flow. The MCP server exchanges these for a token. |

### Multiple MCP servers

Add one entry per server — each key must match the corresponding connector's `name`:

```typescript
agent.createContext({
  credentials: {
    "ehr-mcp":   { type: "token",       token: process.env.EHR_TOKEN! },
    "labs-mcp":  { type: "credentials", clientId: "...", clientSecret: "..." },
    "files-mcp": { type: "token",       token: process.env.FILES_TOKEN! },
  },
})
```

## Walkthrough

### 1 · Guard on env vars

```typescript
const mcpUrl   = process.env.MCP_URL;
const mcpToken = process.env.MCP_TOKEN;
if (!mcpUrl || !mcpToken) {
  console.log("Set MCP_URL and MCP_TOKEN in .env to run this example.");
  return;
}
```

This guard keeps the example safe to run without external services. In production you'd validate credentials at startup.

### 2 · Create the agent with a named MCP connector

```typescript
const agent = await agents.create({
  name: "auth-demo",
  description: "Calls an auth-protected MCP server.",
  connectors: [
    connectors.mcp({
      mcpUrl,
      name:     "my-mcp",    // ← this name is the credential store key
      authType: "bearer",    // tells the platform this server uses bearer auth
    }),
  ],
});
```

The `name` field on the connector is critical — it becomes the key you use in the credential store below. If you omit `name`, the SDK derives a key from the hostname of `mcpUrl` (e.g. `"my-mcp.example.com"`).

### 3 · Create context with credentials

```typescript
const ctx = agent.createContext({
  credentials: {
    "my-mcp": { type: "token", token: mcpToken },
  },
});
```

The key `"my-mcp"` matches the connector name. The SDK will include these credentials on the first message as a `DataPart` and will re-send them as a follow-up if necessary.

### 4 · Send a message — auth is handled automatically

```typescript
const reply = await ctx.sendText("List the tools you have access to.");
console.log("Status:", reply.status);   // "completed"
console.log("Reply:", reply.text);
```

From your code's perspective, this is identical to a call to any agent. The credential forwarding is invisible.

### Using credentials with one-shot run()

```typescript
// Credentials can also be passed directly to agent.run()
const r = await agent.run("List available tools.", {
  credentials: {
    "my-mcp": { type: "token", token: mcpToken },
  },
});
```

## Full code

Source: `examples/ts/06-credentials.ts`

```typescript
/**
 * 06 — MCP credentials.
 *
 * When an MCP server requires auth, the agent may reply with status
 * `auth-required`. Pass a `credentials` map to `createContext()` (or the
 * one-shot `agent.run()`) and the SDK transparently forwards the token —
 * first as a DataPart on the first message, and again as a follow-up if
 * the agent still asks.
 *
 * Run: `npm run credentials`
 */
import { AgentsClient, connectors } from "@newsioaps/agent-sdk";
import { makeClient } from "./_client";

async function main() {
  const mcpUrl = process.env.MCP_URL;
  const mcpToken = process.env.MCP_TOKEN;
  if (!mcpUrl || !mcpToken) {
    console.log("Set MCP_URL and MCP_TOKEN in .env to run this example.");
    return;
  }

  const agents = new AgentsClient(makeClient());

  // Note the MCP connector's `name` — that name becomes the key in the
  // credential store below.
  const agent = await agents.create({
    name: "auth-demo",
    description: "Calls an auth-protected MCP server.",
    connectors: [connectors.mcp({ mcpUrl, name: "my-mcp", authType: "bearer" })],
  });

  const ctx = agent.createContext({
    credentials: {
      "my-mcp": { type: "token", token: mcpToken },
    },
  });

  const reply = await ctx.sendText("List the tools you have access to.");
  console.log("Status:", reply.status);   // expect "completed"
  console.log("Reply:", reply.text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## What to expect

<OutputBlock>
<span style="color: #f99470">Status:</span> completed
<span style="color: #f99470">Reply:</span>  I have access to the following tools via my-mcp:
         - read_file(path: string): Read a file from the filesystem
         - write_file(path: string, content: string): Write content to a file
         - list_directory(path: string): List directory contents
         - search_files(query: string): Full-text search across files
</OutputBlock>

::: info
Actual tool names depend on your MCP server's manifest. The status will be `"completed"` rather than `"auth-required"` if the credential forwarding worked correctly.
:::

### Next steps

<ExampleLinks>
<a href="/examples/02-connectors">02 · Connectors<span>Attach MCP servers and other connector types.</span></a>
<a href="/examples/07-state-graph">07 · State graph<span>Use credentialed agents inside a routing graph.</span></a>
<a href="/#credentials">Credentials concept docs<span>Full API reference for the credential store.</span></a>
</ExampleLinks>
