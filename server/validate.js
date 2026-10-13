'use strict';

/**
 * Request validation shared by the Express server (local dev) and the Netlify
 * Function (deployed). Keep this module dependency-free and side-effect free.
 */

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

module.exports = { SIZE_RE, validateGenerate };
