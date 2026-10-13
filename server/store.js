'use strict';

/**
 * File-backed gallery store: images live in data/images, metadata in data/gallery.json.
 *
 * Robustness notes:
 *  - The index is rewritten atomically (tmp file + rename) and a failed write
 *    never poisons the queue, so later writes still go through.
 *  - On load the index self-heals: records whose image file has disappeared
 *    (manually deleted, moved, cleaned up) are dropped so the gallery never
 *    shows broken thumbnails.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const GALLERY_FILE = path.join(DATA_DIR, 'gallery.json');
const MAX_RECORDS = 500;

let cache = null;
let writeQueue = Promise.resolve();

function ensureDirs() {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  if (!fs.existsSync(GALLERY_FILE)) fs.writeFileSync(GALLERY_FILE, '[]', 'utf8');
}

function imageDataPath(filename) {
  return path.join(IMAGES_DIR, path.basename(String(filename || '')));
}

function recordHasImage(item) {
  return Boolean(item && item.file && fs.existsSync(imageDataPath(item.file)));
}

function writeOnce(snapshot) {
  try {
    const tmp = `${GALLERY_FILE}.tmp`;
    fs.writeFileSync(tmp, snapshot, 'utf8');
    fs.renameSync(tmp, GALLERY_FILE);
  } catch (err) {
    console.error('[store] persist failed:', err.message);
    try {
      fs.unlinkSync(`${GALLERY_FILE}.tmp`);
    } catch {
      /* nothing to clean */
    }
  }
}

function persist() {
  const snapshot = JSON.stringify(cache, null, 2);
  // Both handlers run the write so one failure can't block the queue forever.
  writeQueue = writeQueue.then(
    () => writeOnce(snapshot),
    () => writeOnce(snapshot)
  );
  return writeQueue;
}

function load() {
  if (cache) return cache;
  ensureDirs();

  let parsed = null;
  try {
    const raw = fs.readFileSync(GALLERY_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) parsed = data;
  } catch (err) {
    console.error('[store] could not read gallery.json:', err.message);
  }

  const valid = (parsed || []).filter(recordHasImage);
  cache = valid;

  if (parsed && parsed.length !== valid.length) {
    console.warn(`[store] dropped ${parsed.length - valid.length} record(s) whose image files are missing`);
    persist();
  }

  return cache;
}

function saveImage(buffer, ext = 'png') {
  ensureDirs();
  const id = crypto.randomUUID();
  const filename = `${Date.now()}-${id.slice(0, 8)}.${ext}`;
  fs.writeFileSync(imageDataPath(filename), buffer);
  return filename;
}

function add(record) {
  const list = load();
  const entry = { id: crypto.randomUUID(), createdAt: Date.now(), ...record };
  list.unshift(entry);
  if (list.length > MAX_RECORDS) {
    const dropped = list.splice(MAX_RECORDS);
    for (const item of dropped) removeFile(item.file);
  }
  persist();
  return entry;
}

function removeFile(filename) {
  if (!filename) return;
  fs.unlink(imageDataPath(filename), () => {});
}

function list({ limit = 60, offset = 0, q = '' } = {}) {
  const all = load();
  let items = all;
  const needle = q.trim().toLowerCase();
  if (needle) {
    items = all.filter(
      (item) =>
        (item.prompt || '').toLowerCase().includes(needle) ||
        (item.negativePrompt || '').toLowerCase().includes(needle)
    );
  }
  return { total: items.length, items: items.slice(offset, offset + limit) };
}

function get(id) {
  return load().find((item) => item.id === id) || null;
}

function remove(id) {
  const list = load();
  const idx = list.findIndex((item) => item.id === id);
  if (idx === -1) return false;
  const [entry] = list.splice(idx, 1);
  removeFile(entry.file);
  persist();
  return true;
}

function clear() {
  for (const item of load()) removeFile(item.file);
  cache = [];
  persist();
}

function stats() {
  const list = load();
  return {
    total: list.length,
    latestAt: list.length ? list[0].createdAt : null,
    bytes: list.reduce((sum, item) => sum + (item.bytes || 0), 0),
  };
}

module.exports = { IMAGES_DIR, add, list, get, remove, clear, stats, saveImage };
