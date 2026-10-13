'use strict';

/**
 * Betopia Cloud image API client (OpenAI-compatible /images/generations).
 */

const DEFAULT_BASE_URL = 'https://models.betopiacloud.com/image/v1';
const DEFAULT_MODEL = 'qwen-image-2.1-turbo';

// Read at call time so environment loaded after require is still honoured.
const config = {
  get baseUrl() {
    return (process.env.BETOPIA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  },
  get apiKey() {
    return process.env.BETOPIA_API_KEY || '';
  },
  get model() {
    return process.env.BETOPIA_MODEL || DEFAULT_MODEL;
  },
  get timeoutMs() {
    return Number(process.env.GENERATION_TIMEOUT_MS || 180000);
  },
};

class BetopiaError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'BetopiaError';
    this.status = status;
    this.body = body;
  }
}

async function listModels() {
  const res = await fetch(`${config.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BetopiaError(`Unexpected response from model list (HTTP ${res.status})`, res.status, text);
  }
  if (!res.ok) {
    throw new BetopiaError(json?.error?.message || `Model list failed (HTTP ${res.status})`, res.status, json);
  }
  return Array.isArray(json.data) ? json.data.map((m) => m.id) : [config.model];
}

/**
 * Generate images.
 * @returns {Promise<Array<{buffer: Buffer, mime: string, revisedPrompt?: string}>>}
 */
async function generate({ prompt, negativePrompt, size, n = 1, seed }) {
  if (!config.apiKey) {
    throw new BetopiaError('Missing BETOPIA_API_KEY. Add it to the .env file.', 500);
  }

  const payload = {
    model: config.model,
    prompt,
    n,
    size,
    response_format: 'b64_json',
  };
  if (negativePrompt) payload.negative_prompt = negativePrompt;
  if (Number.isFinite(seed)) payload.seed = seed;

  const started = Date.now();
  const res = await fetch(`${config.baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BetopiaError(`Unexpected response from image API (HTTP ${res.status})`, res.status, text.slice(0, 500));
  }
  if (!res.ok) {
    throw new BetopiaError(json?.error?.message || `Image generation failed (HTTP ${res.status})`, res.status, json);
  }

  const data = Array.isArray(json.data) ? json.data : [];
  if (!data.length) throw new BetopiaError('The model returned no images.', res.status, json);

  return {
    elapsedMs: Date.now() - started,
    images: data.map((item) => {
      if (item.b64_json) {
        return { buffer: Buffer.from(item.b64_json, 'base64'), mime: 'image/png', revisedPrompt: item.revised_prompt };
      }
      if (item.url) return { url: item.url, mime: '', revisedPrompt: item.revised_prompt };
      throw new BetopiaError('Image entry had neither b64_json nor url.', res.status, json);
    }),
  };
}

module.exports = { config, generate, listModels, BetopiaError };
