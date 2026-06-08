# OSS NPM Release Plan — Corti Agent SDK (TypeScript)

**Goal:** Ship `@corti/agent-sdk` as a production-quality OSS package on npm that is the
definitive tool for TypeScript/Node.js developers building complex multi-agent flows on the
Corti Agentic platform.

---

## Status overview

The core SDK is well-architected. The API surface (agent lifecycle, workflow, parallel,
stateGraph, connectors, streaming) is clean and the composition primitives are genuinely
useful. The gaps are largely operational and hygiene-level — not architectural.

---

## Blockers — must fix before any public publish

### 1. Rename the package

`@newsioaps/agent-sdk` → `@corti/agent-sdk`

- Update `packages/js/package.json` `name` field
- Update all `README.md` install commands and import examples
- Update `repository`, `homepage`, and `bugs` URLs from `hccullen/agent-sdk` to the
  canonical org repo (e.g. `corti-ai/agent-sdk` or whichever org hosts this)
- Confirm the `@corti` npm org is claimed and the publishing token is scoped to it

### 2. Fix the broken build script

`packages/js/package.json`:

```json
// broken — fs is not a Node.js global
"build": "node -e \"fs.rmSync('dist',{recursive:true,force:true})\" && tsc -p tsconfig.json"

// fix option A — use require()
"build": "node -e \"require('fs').rmSync('dist',{recursive:true,force:true})\" && tsc -p tsconfig.json"

// fix option B — shell (simpler, works on CI)
"build": "rm -rf dist && tsc -p tsconfig.json"
```

### 3. Reconcile the peer dependency version

`package.json` declares `@corti/sdk >= 3.0.0`; `README.md` says `>= 1.2.0`.
Determine the actual minimum version, update both, and add a note in the changelog if there
was a breaking change in 3.0.0 that this SDK depends on.

### 4. Verify `@corti/sdk` is publicly available on npm

If `@corti/sdk` is not public on `npmjs.org`, the install step will fail for all external
developers. Confirm it is published and accessible before announcing this SDK.

### 5. Add a CI test workflow

Create `.github/workflows/ci.yml` that runs on every PR and push to `main`:

```yaml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run build     # in packages/js
      - run: npm test          # vitest run
```

An OSS package without automated test gates on contributions is a liability.

---

## High priority — fix before public announcement

### 6. Remove `_patchClientAgents`

`packages/js/src/AgentsClient.ts:38`

The monkey-patch on `client.agents.create` is fragile:

- Mutates a shared `CortiClient`; if the same client is passed to two `AgentsClient`
  instances, the `self` closure captures the first one only
- Changes the runtime return type from `Promise<Corti.AgentsAgent>` to
  `Promise<AgentHandle>` while TypeScript still sees the original signature
- Will silently break if `@corti/sdk` changes its internal object shape

**Fix:** Remove the patch entirely. `AgentsClient.create()` is the documented entry point.
No user needs `client.agents.create()` to be patched.

### 7. Break the dependency on `@corti/sdk` private internals

`packages/js/src/rpcTransport.ts:22`

```ts
const opts = (client as unknown as { _options: { ... } })._options;
```

This accesses an undocumented private field. Any internal `@corti/sdk` refactor will break
this silently at runtime with no TypeScript error.

**Options (pick one):**

- Ask the Corti SDK team to expose a `client.getAgentsBaseUrl(): Promise<string>` method
- Accept `baseUrl` as an explicit constructor parameter on `AgentsClient` (simpler, no SDK
  coupling)
- Require the caller to pass `environment` explicitly alongside `CortiClient`

### 8. Fix `streamMessage` API shape

`packages/js/src/AgentContext.ts:163`

```ts
// Current — awkward double-step
const stream = await ctx.streamMessage([...]);
for await (const e of stream) { ... }

// Expected by users
for await (const e of ctx.streamMessage([...])) { ... }
```

Change the return type from `Promise<AsyncIterable<StreamEvent>>` to
`AsyncGenerator<StreamEvent>` and make the method `async *`.

### 9. Add credential support to `streamMessage`

`sendMessage` proactively injects auth `DataPart`s on the first call of a new context;
`streamMessage` does not. Users who need credentials + streaming currently have no path.

Implement the same `_buildAuthParts()` injection in the streaming path, mirroring
`sendMessage`'s behaviour.

### 10. Introduce structured error types

All errors are currently plain `new Error(string)`. Callers must string-match `.message`.

Add to `packages/js/src/errors.ts`:

```ts
export class AgentSDKError extends Error { ... }
export class RpcError extends AgentSDKError { code: number; data?: unknown }
export class HttpError extends AgentSDKError { status: number }
```

Re-throw all errors through these types in `rpcTransport.ts` and export them from
`index.ts`.

### 11. Expand test coverage

Only `stateGraph.test.ts` exists. Add test files for:

| Module | Key scenarios to cover |
|---|---|
| `AgentContext` | Context ID tracking, credential injection, `sendText`, `sendMessage`, `auth-required` retry |
| `MessageResponse` | `.text` extraction, artifact deduplication, `fromText`, null cases |
| `workflow` | Retry logic, `when` branching, `transform`, `stoppedEarly`, empty-skip guard |
| `connectors` | `connectorsToRequestFields` mapping for all connector types, exhaustive check |
| `rpcTransport` | SSE line parsing, timeout/abort, HTTP error, RPC error unwrapping |

---

## Medium priority — fix in first patch release

### 12. Extract the duplicated `randomUUID` polyfill

Identical code in `AgentContext.ts:3` and `rpcTransport.ts:3`. Move to a shared
`packages/js/src/utils.ts`:

```ts
export const randomUUID = (): string => crypto.randomUUID();
```

Node ≥ 18 (the declared engine minimum) guarantees `globalThis.crypto.randomUUID`.

### 13. Make SSE parsing spec-compliant

`packages/js/src/rpcTransport.ts:176`

The current parser splits on `\n` and processes `data:` lines one at a time. The SSE spec
uses blank lines (`\n\n`) as event delimiters and supports multi-line `data:` values, `id:`,
`event:`, and `:` comment fields. The current code works against the A2A server today but
will fail if the server evolves. Rewrite the inner loop to accumulate field lines and
dispatch on `\n\n`.

### 14. Fix `MessageResponse.task` return type

`packages/js/src/MessageResponse.ts:44`

The constructor throws on `undefined`, so `.task` can never be `undefined`. The return type
`Corti.AgentsTask | undefined` is misleading. Change to `Corti.AgentsTask`.

### 15. Make `AgentHandle.description` and `.systemPrompt` nullable

`packages/js/src/AgentHandle.ts:28,32`

Typed as `string` but the underlying Corti SDK types may allow `undefined`. Change to
`string | undefined` or add runtime guards to avoid surprising users with empty-string
values.

### 16. Remove or clearly gate `connectors.a2a`

`packages/js/src/connectors.ts:54` and `types.ts:51`

The `a2a` factory is exported in the public API but throws unconditionally at runtime.
Options:

- Remove from the public API entirely until supported (preferred for a clean v1)
- Keep but gate behind an `@experimental` JSDoc tag with a clear error message

### 17. Document the silent filter in `AgentsClient.list()`

`packages/js/src/AgentsClient.ts:84`

```ts
.filter((a): a is Corti.AgentsAgent => !("type" in a))
```

Add a comment explaining what agents with a `type` field represent and why they are
excluded, or expose the unfiltered list as an option.

---

## Low priority — OSS polish

### 18. Add missing `package.json` metadata

```json
{
  "author": "Corti <developer@corti.ai>",
  "keywords": [
    "corti", "agents", "ai", "sdk",
    "a2a", "mcp", "workflow", "state-machine",
    "multi-agent", "agentic", "llm"
  ]
}
```

### 19. Add dual CJS + ESM build (optional but high-impact)

The package is ESM-only. Many Node.js projects — particularly older tooling, `ts-node` in
CJS mode, and Jest environments — cannot consume ESM directly. A dual build using
`tsconfig.cjs.json` + a `dist/cjs/` output, plus an `exports` map with `require` conditions,
would remove the most common adoption friction.

### 20. Add standard OSS files

| File | Contents |
|---|---|
| `CHANGELOG.md` | Semver history starting from current 0.3.1 |
| `CONTRIBUTING.md` | Setup, test commands, PR process, branch conventions |
| `SECURITY.md` | Responsible disclosure contact and process |

### 21. Add publish safety to the CI workflow

The current `publish.yml` runs immediately on any `v*` tag. Add a dry-run step
(`npm publish --dry-run`) before the real publish so the artifact can be inspected, and
consider requiring a manual approval via a GitHub environment gate.

---

## Suggested release sequence

```
Phase 1 — Fix blockers (items 1–5)
  └── Unblocks: package usable by external developers at all

Phase 2 — Fix high-priority items (6–11)
  └── Unblocks: public announcement / ProductHunt / docs site launch

Phase 3 — First patch release after launch feedback
  └── Items 12–17 + any community-reported issues

Phase 4 — Ongoing OSS health
  └── Items 18–21, dual CJS build if adoption data warrants it
```

---

## Quick-reference checklist

- [ ] Rename package to `@corti/agent-sdk`
- [ ] Fix repository/homepage/bugs URLs to org repo
- [ ] Fix broken build script (`fs` is not a global)
- [ ] Reconcile `@corti/sdk` peer dependency version across `package.json` + README
- [ ] Confirm `@corti/sdk` is public on npm
- [ ] Add `.github/workflows/ci.yml` (test on every PR)
- [ ] Remove `_patchClientAgents` monkey-patch
- [ ] Replace private `_options` access in `rpcTransport` with a stable URL resolution path
- [ ] Fix `streamMessage` to return `AsyncGenerator` directly (not `Promise<AsyncIterable>`)
- [ ] Add credential injection to `streamMessage`
- [ ] Add structured error classes (`RpcError`, `HttpError`)
- [ ] Add tests for `AgentContext`, `MessageResponse`, `workflow`, `connectors`, `rpcTransport`
- [ ] Extract duplicated `randomUUID` to `utils.ts`
- [ ] Fix SSE parser to use `\n\n` event delimiter
- [ ] Fix `MessageResponse.task` return type
- [ ] Remove or gate `connectors.a2a` behind experimental flag
- [ ] Add `author` and expanded `keywords` to `package.json`
- [ ] Add `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`
