# docs/

VitePress-powered documentation site for `@corti/agent-sdk`.

## View locally

```bash
npm run docs:dev
```

Then open http://localhost:5173.

## Build

```bash
npm run docs:build
```

Output is written to `docs/.vitepress/dist/`.

## Preview the built site

```bash
npm run docs:preview
```

## Deploy

The build output is static HTML + JS. Drop `docs/.vitepress/dist/` on any
static host — GitHub Pages, Netlify, Cloudflare Pages, S3, etc.

Content lives in Markdown files: `index.md` (main docs), `examples/*.md`
(TypeScript examples), and `python/*.md` (Python SDK docs). The VitePress
config is in `.vitepress/config.mts`. Custom Vue components and theme
overrides are in `.vitepress/theme/`.
