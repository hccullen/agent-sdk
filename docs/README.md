# docs/

A single-page static documentation site for `@corti/agent-sdk`.

## View locally

Any static server works — two one-liners:

```bash
# Python
python3 -m http.server -d docs 8000

# Node (npx, no install)
npx --yes serve docs
```

Then open http://localhost:8000.

## Deploy

The folder is self-contained (HTML + CSS + tiny JS, no build step). Drop it
on any static host — GitHub Pages, Netlify, Cloudflare Pages, S3, etc.

GitHub Pages:

1. In repo settings → Pages, source = `main` branch, folder = `/docs`.
2. The site is served at `https://<org>.github.io/<repo>/`.

Content lives in `index.html`. Syntax highlighting is provided by Prism via
CDN; swap the theme stylesheet in `<head>` for a different palette.
