# Scratch scripts

Internal, ad-hoc scripts used during development — not part of the public
examples. They are NOT an npm workspace; they resolve `@newsioaps/agent-sdk`,
`@corti/sdk`, and `dotenv` from the hoisted dependencies in the repo root
`node_modules` (run `npm install` at the repo root first).

Run individual scripts with `npx tsx <script>.ts` from this directory. Most
require credentials in `examples/ts/.env` (loaded via `dotenv` from that path)
or environment variables, and some contain environment-specific URLs.

| Script | Purpose |
| ------ | ------- |
| `ask-thieme.ts` | Ask the thieme expert agent, print credits consumed |
| `compare-envs.ts` | Run identical operations against two environments and diff responses |
| `compare-interviewing.ts` | Compare interviewing behavior across configurations |
| `compare-latency.ts` | Compare latency across environments/configurations |
| `get-thieme-details.ts` | Fetch thieme-expert connector details |
| `list-registry.ts` | List registry connectors |
| `test-textgen-*.ts` | Ad-hoc tests for the textgen MCP connector |
| `08-latency-test.ts` | Latency measurement script (formerly alongside the tutorials) |
