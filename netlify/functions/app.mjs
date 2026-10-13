/**
 * Betopia Image Studio — Netlify Function (Functions API v1).
 *
 * One function serves both /api/* and /images/*, mirroring the Express server
 * used for local development (server/index.js). The only structural change is
 * storage: instead of data/ on disk, the PNGs and the gallery index live in
 * Netlify Blobs, so they survive redeploys and are shared across instances.
 *
 * Requires these environment variables in the Netlify UI:
 *   BETOPIA_API_KEY          (required)
 *   BETOPIA_BASE_URL         (optional, default https://models.betopiacloud.com/image/v1)
 *   BETOPIA_MODEL            (optional, default qwen-image-2.1-turbo)
 *   GENERATION_TIMEOUT_MS    (optional, default 55000 — stay under Netlify's 60s limit)
 */

import { getStore } from '@netlify/blobs';

import betopiaModule from '../../server/betopia.js';
import validateModule from '../../server/validate.js';

const { config: betopiaConfig, generate, listModels, BetopiaError } = betopiaModule;
const { validateGenerate } = validateModule;

// Netlify cuts synchronous functions off at 60s, so never wait longer than that.
if (!process.env.GENERATION_TIMEOUT_MS) {
  process.env.GENERATION_TIMEOUT_MS = '55000';
}

/** HTTP routes owned by this function (in-source routing). */
export const config = {
  path: ['/api/*', '/images/*'],
};

const STORE_NAME = process.env.GALLERY_STORE || 'gallery';
const INDEX_KEY = 'index';
const IMAGE_PREFIX = 'img:';
const MAX_RECORDS = 200;

/* ------------------------------------------------------------------ */
/* Blobs-backed gallery store                                          */
/* ------------------------------------------------------------------ */
/*
 * Concurrency note: the index blob is read-modify-write, so two simultaneous
 * generations can race (last write wins). For a single-user gallery this is
 * fine; if two users collide, one record can be dropped while its image blob
 * stays behind — harmless (the image is simply never listed).
 */
let blobStore;

function gallery() {
  if (!blobStore) {
    try {
      blobStore = getStore(STORE_NAME);
    } catch (err) {
      throw new Error(
        `Blobs store "${STORE_NAME}" is unavailable: ${err.message}. ` +
          'Blobs work in real Netlify Functions and under `netlify dev`.'
      );
    }
  }
  return blobStore;
}

async function loadIndex() {
  try {
    // v10 of @netlify/blobs has no getJSON(); use get(key, { type: 'json' }).
    // A missing key resolves to null rather than throwing.
    const list = await gallery().get(INDEX_KEY, { type: 'json' });
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error('[blobs] index read failed:', err.message);
    return [];
  }
}

async function saveIndex(list) {
  await gallery().setJSON(INDEX_KEY, list);
}

async function putImage(buffer, ext) {
  const stamp = Date.now();
  const name = `${stamp}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  await gallery().set(`${IMAGE_PREFIX}${name}`, new Uint8Array(buffer));
  return name;
}

async function dropImage(file) {
  if (!file) return;
  try {
    await gallery().delete(`${IMAGE_PREFIX}${file}`);
  } catch {
    /* already gone */
  }
}

async function addRecord(record) {
  const list = await loadIndex();
  const entry = { id: crypto.randomUUID(), createdAt: Date.now(), ...record };
  list.unshift(entry);

  let dropped = [];
  if (list.length > MAX_RECORDS) dropped = list.splice(MAX_RECORDS);

  await saveIndex(list);
  for (const item of dropped) dropImage(item.file);
  return entry;
}

function matchesQuery(item, needle) {
  return (
    (item.prompt || '').toLowerCase().includes(needle) ||
    (item.negativePrompt || '').toLowerCase().includes(needle)
  );
}

async function listRecords({ limit, offset, q }) {
  const all = await loadIndex();
  const needle = String(q || '').trim().toLowerCase();
  const items = needle ? all.filter((item) => matchesQuery(item, needle)) : all;
  return { total: items.length, items: items.slice(offset, offset + limit) };
}

async function getRecord(id) {
  const all = await loadIndex();
  return all.find((item) => item.id === id) || null;
}

async function removeRecord(id) {
  const list = await loadIndex();
  const idx = list.findIndex((item) => item.id === id);
  if (idx === -1) return false;
  const [entry] = list.splice(idx, 1);
  await saveIndex(list);
  await dropImage(entry.file);
  return true;
}

async function galleryStats() {
  const list = await loadIndex();
  return {
    total: list.length,
    latestAt: list.length ? list[0].createdAt : null,
    bytes: list.reduce((sum, item) => sum + (item.bytes || 0), 0),
  };
}

/* ------------------------------------------------------------------ */
/* Rate limit: 12 generations / minute per client IP (best effort)     */
/* ------------------------------------------------------------------ */
const buckets = new Map();

function rateLimited(ip, max = 12, windowMs = 60000) {
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
  return bucket.count > max;
}

function clientIp(req, context) {
  return (
    context?.ip ||
    req.headers.get('x-nf-client-connection-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

/* ------------------------------------------------------------------ */
/* Response helpers                                                    */
/* ------------------------------------------------------------------ */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const notFound = () => json({ error: 'Not found.' }, 404);

async function fetchRemoteImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Failed to download image (HTTP ${res.status})`);
  const type = res.headers.get('content-type') || '';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, ext: type.includes('jpeg') || type.includes('jpg') ? 'jpg' : 'png' };
}

function safeFileName(raw) {
  const name = String(raw || '').replace(/[^a-zA-Z0-9._-]/g, '');
  return name.length && name.length < 120 ? name : '';
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

async function handleConfig() {
  let models = [betopiaConfig.model];
  try {
    models = await listModels();
  } catch {
    /* keep the default when the model list is unreachable */
  }
  return json({
    model: betopiaConfig.model,
    models,
    ready: Boolean(betopiaConfig.apiKey),
    defaults: {
      size: '1024x1024',
      n: 1,
      maxN: 4,
      sizes: ['1024x1024', '1536x1024', '1024x1536', '1344x768', '768x1344'],
    },
  });
}

async function handleGenerate(req, context) {
  if (rateLimited(clientIp(req, context))) {
    return json({ error: 'Too many requests. Try again in a moment.' }, 429);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400);
  }

  const { error, value } = validateGenerate(body);
  if (error) return json({ error }, 400);

  try {
    const { images, elapsedMs } = await generate(value);
    const saved = [];

    for (const image of images) {
      let buffer = image.buffer;
      let ext = 'png';
      if (!buffer && image.url) {
        const remote = await fetchRemoteImage(image.url);
        buffer = remote.buffer;
        ext = remote.ext;
      }
      const file = await putImage(buffer, ext);
      saved.push(
        await addRecord({
          prompt: value.prompt,
          negativePrompt: value.negativePrompt,
          size: value.size,
          seed: value.seed ?? null,
          n: value.n,
          model: betopiaConfig.model,
          file,
          bytes: buffer.length,
          revisedPrompt: image.revisedPrompt || null,
          elapsedMs,
          url: `/images/${file}`,
        })
      );
    }

    return json({ images: saved, elapsedMs });
  } catch (err) {
    const status = err instanceof BetopiaError && err.status && err.status < 500 ? 502 : 500;
    console.error('[generate]', err.message);
    return json({ error: err.message || 'Generation failed.' }, status);
  }
}

async function handleGallery(url) {
  const params = url.searchParams;
  const limit = Math.min(Math.max(Number(params.get('limit')) || 60, 1), 200);
  const offset = Math.max(Number(params.get('offset')) || 0, 0);
  const q = params.get('q') || '';
  return json(await listRecords({ limit, offset, q }));
}

async function handleImage(rawName) {
  const file = safeFileName(rawName);
  if (!file) return notFound();

  let bytes;
  try {
    const buffer = await gallery().get(`${IMAGE_PREFIX}${file}`, { type: 'arrayBuffer' });
    bytes = buffer ? new Uint8Array(buffer) : null;
  } catch (err) {
    console.error('[blobs] image read failed:', err.message);
    return notFound();
  }
  if (!bytes) return notFound();

  return new Response(bytes, {
    headers: {
      'Content-Type': file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' : 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */
export default async (req, context) => {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  if (path.startsWith('/images/')) {
    return handleImage(decodeURIComponent(path.slice('/images/'.length)));
  }

  if (!path.startsWith('/api/')) return notFound();
  const sub = path.slice('/api/'.length);

  try {
    if (sub === 'config' && method === 'GET') return await handleConfig();
    if (sub === 'generate' && method === 'POST') return await handleGenerate(req, context);

    if (sub === 'gallery' && method === 'GET') return await handleGallery(url);

    const galleryItem = sub.match(/^gallery\/([^/]+)$/);
    if (galleryItem) {
      const id = decodeURIComponent(galleryItem[1]);
      if (method === 'GET') {
        const entry = await getRecord(id);
        return entry ? json(entry) : notFound();
      }
      if (method === 'DELETE') {
        const ok = await removeRecord(id);
        return json({ ok }, ok ? 200 : 404);
      }
    }

    if (sub === 'stats' && method === 'GET') return json(await galleryStats());

    return notFound();
  } catch (err) {
    console.error('[function]', err);
    return json({ error: 'Internal server error.' }, 500);
  }
};
