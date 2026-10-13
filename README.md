# Betopia Image Studio

A self-hosted **text-to-image platform** with a clean **Astro** interface and an **Express** API,
powered by Betopia Cloud's `qwen-image-2.1-turbo` model.

Type a prompt, pick an aspect ratio, and get generated images in a searchable gallery — with
negative prompts, seeds, downloads and a lightbox viewer.

## Quick start

```bash
npm install
npm run build     # build the Astro UI into /dist
npm start         # serve UI + API on http://localhost:3000
```

### Development

```bash
npm run dev
```

Runs both processes at once (see `scripts/dev.js`):

| Service | URL | Notes |
| ------- | --- | ----- |
| Astro dev server | **http://localhost:4321** | HMR, proxies `/api` + `/images` to :3000 |
| Express API | http://localhost:3000 | `node --watch`, restarts on server changes |

Open **http://localhost:4321** while developing.

## Configuration

Credentials live in `.env` (never committed, never sent to the browser):

```env
BETOPIA_BASE_URL=https://models.betopiacloud.com/image/v1
BETOPIA_API_KEY=sk-llm-...
BETOPIA_MODEL=qwen-image-2.1-turbo
PORT=3000
GENERATION_TIMEOUT_MS=180000
```

Copy `.env.example` to `.env` to start fresh. Values in `.env` override inherited shell/machine
environment variables, so credentials in `.env` always win. The key is only used server-side by
`server/betopia.js`.

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
astro.config.mjs          Static build → /dist, dev proxy to :3000
server/
  index.js                Express app: routes, validation, rate limit, serves /dist
  betopia.js              Betopia Cloud API client
  store.js                File-backed gallery (data/images + data/gallery.json)
scripts/dev.js            Runs API + Astro dev together
public/favicon.svg        Copied into the build
data/                     Generated images + gallery index (gitignored)
dist/                     Astro build output (gitignored)
```

## Scripts

```bash
npm run dev     # API (watch) + Astro dev server with HMR
npm run dev:api # API only
npm run dev:web # Astro dev only
npm run build   # astro build → /dist
npm start       # build (prestart) + serve UI & API on :3000
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
