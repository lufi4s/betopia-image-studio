# Betopia Image Studio

A self-hosted **text-to-image platform** with a clean **Astro** interface and an **Express** API,
powered by Betopia Cloud's `qwen-image-2.1-turbo` model.

Type a prompt, pick an aspect ratio, and get generated images in a searchable gallery — with
negative prompts, seeds, downloads and a lightbox viewer.

## Quick start

```bash
npm install
npm run build     # build the Astro UI into /dist
npm start         # serve UI + API on http://localhost:4321
```

### Development

```bash
npm run dev
```

One port, one URL: **http://localhost:4321**

`scripts/dev.js` runs two things together:

| Process | What it does |
| ------- | ------------ |
| Express API + static UI | `node --watch` — restarts when anything in `server/` changes |
| Astro rebuild watcher | reruns `astro build` when `src/`, `public/` or `astro.config.mjs` change |

After a rebuild the open page detects the new build stamp (`/__buildid`) and reloads
itself — no second port, no manual refresh. The API, UI and generated images all come
from the same port defined by `PORT` in `.env`.

Optional: `npm run astro` starts Astro's own dev server (HMR) — it falls back to port
4322 when 4321 is already taken and still proxies `/api` + `/images` to the main server.

## Configuration

Credentials live in `.env` (never committed, never sent to the browser):

```env
BETOPIA_BASE_URL=https://models.betopiacloud.com/image/v1
BETOPIA_API_KEY=sk-llm-...
BETOPIA_MODEL=qwen-image-2.1-turbo
PORT=4321
GENERATION_TIMEOUT_MS=180000
```

Copy `.env.example` to `.env` to start fresh. Values in `.env` override inherited shell/machine
environment variables, so credentials in `.env` always win. The key is only used server-side by
`server/betopia.js`.

## Deploying to Netlify

The repo is wired for Netlify: push to GitHub and the site builds `/dist` and deploys a single
function that serves the API and the generated images on the same URL.

1. Connect the GitHub repo to a Netlify site — build settings come from `netlify.toml`.
2. In **Site configuration → Environment variables** add:

   | Variable | Required | Value |
   | -------- | -------- | ----- |
   | `BETOPIA_API_KEY` | yes | your `sk-llm-...` key |
   | `BETOPIA_BASE_URL` | no | `https://models.betopiacloud.com/image/v1` (default) |
   | `BETOPIA_MODEL` | no | `qwen-image-2.1-turbo` (default) |
   | `GENERATION_TIMEOUT_MS` | no | `55000` (default — Netlify's hard sync limit is 60s) |

3. Deploy. Every push to `main` redeploys automatically.

How the deployed version maps to the local one:

| Local (Express) | Deployed (Netlify) |
| --------------- | ------------------ |
| `server/index.js` routes | `netlify/functions/app.mjs` — one function for `path: ['/api/*', '/images/*']` |
| `data/images/*.png` on disk | PNGs in a Netlify **Blobs** store named `gallery` (survive redeploys) |
| `data/gallery.json` index | a single `index` blob holding the JSON array |
| `server/betopia.js`, `server/validate.js` | shared — imported by both runtimes |

Test the deployed runtime locally:

```bash
npx netlify-cli dev   # http://localhost:8888 — dist + function + Blobs emulator
```

Deployed behaviour differs slightly: the gallery keeps the newest **200** records (500 locally) to
keep the index blob light, Blobs writes are last-write-wins if two generations land at the same
instant, and the rate limit is per function instance (best effort).

## Features

- **Text → image** with prompt, negative prompt, aspect ratio (1:1, 3:2, 2:3, 16:9, 9:16),
  1–4 images per run, and optional seed for reproducible results
- **Style chips** and a "Surprise" idea generator for quick inspiration
- **Persistent gallery** — images on disk with metadata, searchable by prompt
- **Lightbox** with keyboard navigation (←/→/Esc), download, copy, reuse-prompt, delete
- **Rate limiting** (12 generations per minute per IP) and input validation
- **Key stays server-side** — clients never see the API key

## Project structure

```
src/
  layouts/Base.astro      HTML shell, header, footer, toasts
  components/
    Composer.astro        Prompt box, style chips, toolbar, advanced options
    Gallery.astro         Grid, search, empty state, load more
    Lightbox.astro        Full-size viewer with actions
  pages/index.astro       Page assembly
  scripts/app.js          All client logic (bundled by Astro)
  styles/global.css       Dark & refined design system
astro.config.mjs          Static build → /dist (single-port setup)
server/
  index.js                Express app: routes, validation, rate limit, serves /dist
  betopia.js              Betopia Cloud API client
  store.js                File-backed gallery (data/images + data/gallery.json)
  validate.js             Request validation shared with the Netlify function
netlify/
  functions/app.mjs       Deployed API: /api/* + /images/* on Netlify Blobs
netlify.toml              Netlify build, function and dev settings
scripts/dev.js            API watch + Astro rebuild watcher + auto browser reload
public/favicon.svg        Copied into the build
data/                     Generated images + gallery index (gitignored)
dist/                     Astro build output (gitignored)
```

## Scripts

```bash
npm run dev     # API (watch) + Astro rebuild watcher + auto browser reload
npm run dev:api # API only (no UI rebuilds)
npm run astro   # optional Astro HMR server (port 4322 if 4321 is busy)
npm run build   # astro build → /dist
npm start       # build (prestart) + serve UI & API on :4321
```

## Design system

Dark & refined, defined in `src/styles/global.css`:

| Role | Font | Treatment |
| ---- | ---- | --------- |
| Display (h1–h3, wordmark, primary button) | **Bricolage Grotesque** | 700–800, tight tracking (`-0.045em`), line-height `0.96` |
| Body (paragraphs, labels, UI chrome) | **Outfit** | 400–600, `16px / 1.62` |

Hierarchy: uppercase eyebrow labels (`0.26em` tracking, accent colour) → fluid H1
(`clamp(2.6rem, 5.6vw, 4.25rem)`) → section H2 → muted lead paragraph → small meta text.
Both families load from Google Fonts with `display=swap`.

## API

| Method | Route                  | Description                                   |
| ------ | ---------------------- | --------------------------------------------- |
| GET    | `/api/config`          | Active model, available models, defaults      |
| POST   | `/api/generate`        | `{ prompt, negativePrompt?, size, n, seed? }` |
| GET    | `/api/gallery`         | `?limit=&offset=&q=` — image history          |
| DELETE | `/api/gallery/:id`     | Remove an image and its record                |
| GET    | `/api/stats`           | Totals                                        |

## Notes

- Node 18+ required (uses native `fetch`).
- `cookie` is pinned at the root because Astro's prerender bundle needs its ESM named exports,
  while Express keeps its own nested `cookie@0.7.x` — do not remove it from `package.json`.
- Images are capped at 500 records; older entries are pruned automatically.
- To reset the gallery, delete `data/gallery.json` and the files in `data/images/`.
