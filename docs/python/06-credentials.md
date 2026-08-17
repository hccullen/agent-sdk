# 06 — Credentials

Pass a `credentials` dict to `create_context()` and the SDK transparently forwards tokens to authenticated MCP servers — both proactively on the first message and as a follow-up if the agent replies with `auth-required`.

<ConceptGrid>
<ConceptCard title="CredentialStore">A plain dict mapping MCP server name → credential. The key must match the connector's `name`.</ConceptCard>
<ConceptCard title="TokenCredential">`{"type": "token", "token": "..."}` — for MCP servers with `auth_type="bearer"`.</ConceptCard>
<ConceptCard title="OAuth2Credential">`{"type": "credentials", "client_id": "...", "client_secret": "..."}` — for `auth_type="oauth2.0"`.</ConceptCard>
<ConceptCard title="Automatic retry">If the agent still returns `auth-required`, credentials are sent again as a DataPart follow-up with no extra code needed.</ConceptCard>
</ConceptGrid>

## Credential types

| Type | auth_type on connector | Dict shape |
|---|---|---|
| `TokenCredential` | `"bearer"` | `{"type": "token", "token": "tok_..."}` |
| `OAuth2Credential` | `"oauth2.0"` | `{"type": "credentials", "client_id": "...", "client_secret": "..."}` |

The key in the `credentials` dict must exactly match the `name` you gave the MCP connector (or the auto-derived hostname if you omitted `name`).

## Full code

```python
"""
06 — MCP credentials.

When an MCP server requires auth, pass a credentials dict to create_context().
The SDK forwards it automatically — no manual retry needed.
"""
import asyncio, os
from corti_agent_sdk import CortiClient, AgentsClient, connectors

MCP_URL   = os.environ.get("MCP_URL", "")
MCP_TOKEN = os.environ.get("MCP_TOKEN", "")

async def main():
    if not MCP_URL or not MCP_TOKEN:
        print("Set MCP_URL and MCP_TOKEN to run this example.")
        return

    async with CortiClient(
        tenant_name="YOUR_TENANT",
        environment="eu",
        auth={"client_id": "YOUR_ID", "client_secret": "YOUR_SECRET"},
    ) as client:
        agents = AgentsClient(client)

        # The connector name "my-mcp" becomes the key in the credentials dict.
        agent = await agents.create(
            name="auth-demo",
            description="Calls an auth-protected MCP server.",
            connectors=[
                connectors.mcp(mcp_url=MCP_URL, name="my-mcp", auth_type="bearer"),
            ],
        )

        ctx = agent.create_context(
            credentials={
                "my-mcp": {"type": "token", "token": MCP_TOKEN},
            }
        )

        reply = await ctx.send_text("List the tools you have access to.")
        print("Status:", reply.status)   # expect "completed"
        print("Reply:", reply.text)

asyncio.run(main())
```

### Next steps

<ExampleLinks>
<a href="/python/02-connectors">02 · Connectors<span>Set up the MCP connector with auth_type.</span></a>
<a href="/python/07-state-graph">07 · State graph<span>Pass credentials through a multi-node graph.</span></a>
</ExampleLinks>
