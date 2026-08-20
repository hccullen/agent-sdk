# Agent SDK — Development Guidelines

## Development workflow

1. Make changes in the TypeScript SDK (`packages/js/`).
2. Update the relevant Markdown docs in `docs/` if the public API surface changes
   (e.g. `docs/index.md`, `docs/examples/*.md`).
3. Run `cd packages/js && npm run build` to verify it compiles.
4. Run `npm run docs:build` to verify the docs site builds.
