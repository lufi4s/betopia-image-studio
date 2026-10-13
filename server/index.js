'use strict';

const fs = require('fs');
const path = require('path');

// Load .env BEFORE any module reads config. Values defined in the project .env
// take precedence over inherited shell/machine environment variables, so
// credentials in .env always win.
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  }
} catch (err) {
  console.warn('[env] could not read .env:', err.message);
}

const express = require('express');
const betopia = require('./betopia');
const store = require('./store');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, '..', 'dist');
const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

/* ------------------------------------------------------------------ */
/* Simple per-IP rate limit: 12 generations / minute                    */
/* ------------------------------------------------------------------ */
const buckets = new Map();
function rateLimit(max = 12, windowMs = 60000) {
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      buckets.set(ip, bucket);
    }
    bucket.count += 1;
    if (buckets.size > 5000) {
      for (const [key, value] of buckets) if (now - value.start > windowMs) buckets.delete(key);
    }
    if (bucket.count > max) {
      return res.status(429).json({ error: `Too many requests. Try again in a moment.` });
    }
    next();
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const SIZE_RE = /^\d{2,4}x\d{2,4}$/;

function validateGenerate(body) {
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return { error: 'A prompt is required.' };
  if (prompt.length > 2000) return { error: 'Prompt is too long (max 2000 characters).' };

  const negativePrompt =
    typeof body?.negativePrompt === 'string' ? body.negativePrompt.trim().slice(0, 1000) : '';

  const n = Number(body?.n ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > 4) return { error: 'Number of images must be between 1 and 4.' };

  const size = typeof body?.size === 'string' ? body.size.trim() : '1024x1024';
  if (!SIZE_RE.test(size)) return { error: 'Invalid size format.' };
  const [w, h] = size.split('x').map(Number);
  if (w < 256 || h < 256 || w > 2048 || h > 2048) return { error: 'Size must be between 256 and 2048 pixels.' };

  let seed;
  if (body?.seed !== undefined && body.seed !== '' && body.seed !== null) {
    seed = Number(body.seed);
    if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 31 - 1) {
      return { error: 'Seed must be a whole number between 0 and 2147483647.' };
    }
  }

  return { value: { prompt, negativePrompt, n, size, seed } };
}

async function fetchRemoteImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Failed to download image (HTTP ${res.status})`);
  const type = res.headers.get('content-type') || '';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, ext: type.includes('jpeg') || type.includes('jpg') ? 'jpg' : 'png' };
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

app.get('/api/config', async (req, res) => {
  let models = [betopia.config.model];
  try {
    models = await betopia.listModels();
  } catch {
    /* keep default when the model list is unreachable */
  }
  res.json({
    model: betopia.config.model,
    models,
    ready: Boolean(betopia.config.apiKey),
    defaults: {
      size: '1024x1024',
      n: 1,
      maxN: 4,
      sizes: ['1024x1024', '1536x1024', '1024x1536', '1344x768', '768x1344'],
    },
  });
});

app.post('/api/generate', rateLimit(), async (req, res) => {
  const { error, value } = validateGenerate(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const { images, elapsedMs } = await betopia.generate(value);
    const saved = [];

    for (const image of images) {
      let buffer = image.buffer;
      let ext = 'png';
      if (!buffer && image.url) {
        const remote = await fetchRemoteImage(image.url);
        buffer = remote.buffer;
        ext = remote.ext;
      }
      const file = store.saveImage(buffer, ext);
      saved.push(
        store.add({
          prompt: value.prompt,
          negativePrompt: value.negativePrompt,
          size: value.size,
          seed: value.seed ?? null,
          n: value.n,
          model: betopia.config.model,
          file,
          bytes: buffer.length,
          revisedPrompt: image.revisedPrompt || null,
          elapsedMs,
          url: `/images/${file}`,
        })
      );
    }

    res.json({ images: saved, elapsedMs });
  } catch (err) {
    const status = err instanceof betopia.BetopiaError && err.status && err.status < 500 ? 502 : 500;
    console.error('[generate]', err.message);
    res.status(status).json({ error: err.message || 'Generation failed.' });
  }
});

app.get('/api/gallery', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  res.json(store.list({ limit, offset, q }));
});

app.get('/api/gallery/:id', (req, res) => {
  const entry = store.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found.' });
  res.json(entry);
});

app.delete('/api/gallery/:id', (req, res) => {
  const ok = store.remove(req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
});

app.get('/api/stats', (req, res) => res.json(store.stats()));

/* ------------------------------------------------------------------ */
/* Static assets (Astro build output in /dist)                         */
/* ------------------------------------------------------------------ */
app.use('/images', express.static(store.IMAGES_DIR, { maxAge: '30d', immutable: true }));

if (!fs.existsSync(INDEX_FILE)) {
  console.warn('[ui] dist/index.html not found — run `npm run build` to serve the interface.');
}

app.use(express.static(PUBLIC_DIR));
app.get(/^\/(?!api\/|images\/).*/, (req, res) => {
  if (fs.existsSync(INDEX_FILE)) return res.sendFile(INDEX_FILE);
  res
    .status(503)
    .type('text/plain')
    .send('UI not built yet.\n\nRun:  npm run build   (then refresh this page)\nOr for development:  npm run dev  →  http://localhost:4321');
});

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`\n  Betopia Image Studio → http://localhost:${PORT}`);
  console.log(`  Model: ${betopia.config.model} @ ${betopia.config.baseUrl}`);
  console.log(`  API key: ${betopia.config.apiKey ? 'loaded' : 'MISSING (set BETOPIA_API_KEY in .env)'}\n`);
});
