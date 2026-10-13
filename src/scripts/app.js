/* ============================================================
   Betopia Image Studio — client logic
   ============================================================ */

/* ------------------------------ state ------------------------------ */
const state = {
  config: null,
  items: [],
  total: 0,
  offset: 0,
  query: '',
  busy: false,
  lbIndex: -1,
  ratio: '1:1',
  count: 1,
};

const RATIOS = [
  { label: '1:1', size: '1024x1024' },
  { label: '3:2', size: '1536x1024' },
  { label: '2:3', size: '1024x1536' },
  { label: '16:9', size: '1344x768' },
  { label: '9:16', size: '768x1344' },
];

const STYLE_CHIPS = [
  { label: 'Photorealistic', text: 'photorealistic, 85mm lens, natural light' },
  { label: 'Cinematic', text: 'cinematic film still, dramatic lighting' },
  { label: 'Anime', text: 'anime style, vibrant colors' },
  { label: '3D render', text: '3D render, octane, soft studio light' },
  { label: 'Watercolor', text: 'watercolor painting, loose brush strokes' },
  { label: 'Minimal', text: 'minimalist flat illustration, clean shapes' },
  { label: 'Cyberpunk', text: 'cyberpunk, neon glow, rainy night' },
  { label: 'Analog', text: 'vintage analog photo, film grain' },
];

const PROMPT_IDEAS = [
  'A samurai standing on a cliff during a thunderstorm, cape flowing, epic wide shot, cinematic lighting',
  'Isometric cutaway of a cozy treehouse library, tiny warm lamps, houseplant details, 3D render',
  'Portrait of an astronaut botanist tending glowing plants in a space station greenhouse, photorealistic',
  'A neon ramen shop in a Tokyo back alley at night, steam rising, reflections on wet pavement',
  'Product photo of a matte black wireless headphone floating above a marble surface, soft shadows',
  'A whale swimming through clouds above a golden sunrise, dreamlike surrealism, ultra detailed',
];

/* ------------------------------ elements ------------------------------ */
const $ = (id) => document.getElementById(id);
const els = {
  prompt: $('prompt'),
  promptCount: $('promptCount'),
  negativePrompt: $('negativePrompt'),
  seed: $('seed'),
  generateBtn: $('generateBtn'),
  statusLine: $('statusLine'),
  modelBadge: $('modelBadge'),
  modelDot: $('modelDot'),
  heroModel: $('heroModel'),
  statBadge: $('statBadge'),
  footModel: $('footModel'),
  styleChips: $('styleChips'),
  ratioGroup: $('ratioGroup'),
  countGroup: $('countGroup'),
  advToggle: $('advToggle'),
  advPanel: $('advPanel'),
  surpriseBtn: $('surpriseBtn'),
  grid: $('grid'),
  empty: $('empty'),
  gallerySub: $('gallerySub'),
  search: $('search'),
  loadMoreWrap: $('loadMoreWrap'),
  loadMoreBtn: $('loadMoreBtn'),
  promptIdeas: $('promptIdeas'),
  toasts: $('toasts'),
  lightbox: $('lightbox'),
  lbImage: $('lbImage'),
  lbPrompt: $('lbPrompt'),
  lbMeta: $('lbMeta'),
  lbPrev: $('lbPrev'),
  lbNext: $('lbNext'),
  lbClose: $('lbClose'),
  lbDownload: $('lbDownload'),
  lbReuse: $('lbReuse'),
  lbCopy: $('lbCopy'),
  lbDelete: $('lbDelete'),
};

/* ------------------------------ helpers ------------------------------ */
function toast(message, type = 'info') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  els.toasts.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .3s, transform .3s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 320);
  }, 3600);
}

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (HTTP ${res.status})`);
  return data;
}

const escapeHtml = (str = '') =>
  str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const formatDate = (ts) =>
  new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const ratioSize = () => (RATIOS.find((r) => r.label === state.ratio) || RATIOS[0]).size;

/* ------------------------------ controls ------------------------------ */
function renderControls() {
  // style chips
  els.styleChips.innerHTML = '';
  STYLE_CHIPS.forEach((style) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = style.label;
    btn.title = `Add “${style.text}” to your prompt`;
    btn.addEventListener('click', () => appendToPrompt(style.text));
    els.styleChips.appendChild(btn);
  });

  // aspect ratios
  els.ratioGroup.innerHTML = '';
  RATIOS.forEach((r) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = r.label === state.ratio ? 'active' : '';
    btn.textContent = r.label;
    btn.addEventListener('click', () => {
      state.ratio = r.label;
      [...els.ratioGroup.children].forEach((c) => (c.className = c.textContent === r.label ? 'active' : ''));
    });
    els.ratioGroup.appendChild(btn);
  });

  // image count
  const maxN = state.config?.defaults?.maxN || 4;
  els.countGroup.innerHTML = '';
  for (let i = 1; i <= maxN; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = i === state.count ? 'active' : '';
    btn.textContent = String(i);
    btn.addEventListener('click', () => {
      state.count = i;
      [...els.countGroup.children].forEach((c) => (c.className = c.textContent === String(i) ? 'active' : ''));
    });
    els.countGroup.appendChild(btn);
  }

  // prompt ideas in the empty state
  els.promptIdeas.innerHTML = '';
  PROMPT_IDEAS.slice(0, 3).forEach((idea) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'idea';
    btn.textContent = `“${idea}”`;
    btn.addEventListener('click', () => {
      els.prompt.value = idea;
      updateCounter();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      els.prompt.focus();
    });
    els.promptIdeas.appendChild(btn);
  });
}

function appendToPrompt(text) {
  const current = els.prompt.value.trim();
  els.prompt.value = current ? `${current}, ${text}` : text;
  updateCounter();
  els.prompt.focus();
}

function updateCounter() {
  els.promptCount.textContent = `${els.prompt.value.length} / 2000`;
}

function openAdvanced() {
  els.advPanel.hidden = false;
  els.advToggle.setAttribute('aria-expanded', 'true');
}

/* ------------------------------ gallery ------------------------------ */
function cardMarkup(item, pending = false) {
  if (pending) {
    return `
      <div class="card pending" data-id="${item.id}">
        <span class="card-badge">${escapeHtml(item.size)}</span>
        <div class="skeleton" style="aspect-ratio:1/1"></div>
        <div class="card-caption">Painting pixels…</div>
      </div>`;
  }
  return `
    <div class="card" data-id="${item.id}" tabindex="0" role="button" aria-label="Open image">
      <span class="card-badge">${escapeHtml(item.size)}</span>
      <img src="${item.url}" alt="${escapeHtml(item.prompt)}" loading="lazy" />
      <div class="card-caption">${escapeHtml(item.prompt)}</div>
    </div>`;
}

function renderGallery() {
  els.grid.innerHTML = state.items.map((item) => cardMarkup(item, Boolean(item.pending))).join('');
  const hasItems = state.items.length > 0;
  els.empty.hidden = hasItems;
  els.grid.hidden = !hasItems;
  const total = state.total || 0;
  els.gallerySub.textContent = total
    ? `${total} image${total === 1 ? '' : 's'} generated on this platform.`
    : 'Every image generated on this platform.';
  els.statBadge.textContent = `${total} image${total === 1 ? '' : 's'}`;
  els.loadMoreWrap.hidden = state.items.length >= total;
}

async function loadGallery({ append = false } = {}) {
  try {
    const data = await api(`/api/gallery?limit=60&offset=${state.offset}&q=${encodeURIComponent(state.query)}`);
    state.total = data.total;
    state.items = append ? [...state.items, ...data.items] : data.items;
    state.offset = append ? state.offset + data.items.length : data.items.length;
    renderGallery();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ------------------------------ generation ------------------------------ */
function setBusy(busy) {
  state.busy = busy;
  els.generateBtn.disabled = busy;
  els.generateBtn.querySelector('.btn-label').textContent = busy ? '✦ Generating…' : '✦ Generate';
}

async function generate() {
  const prompt = els.prompt.value.trim();
  if (!prompt) {
    toast('Write a prompt first.', 'error');
    els.prompt.focus();
    return;
  }
  if (state.busy) return;

  const body = {
    prompt,
    negativePrompt: els.negativePrompt.value.trim(),
    size: ratioSize(),
    n: state.count,
    seed: els.seed.value === '' ? undefined : Number(els.seed.value),
  };

  setBusy(true);
  els.statusLine.textContent = 'Contacting the model… this usually takes 10–40 seconds.';

  const pendingId = `pending-${Date.now()}`;
  state.items = [{ id: pendingId, prompt, size: body.size, pending: true }, ...state.items];
  state.total += body.n;
  renderGallery();

  const startedAt = Date.now();
  const ticker = setInterval(() => {
    const secs = Math.round((Date.now() - startedAt) / 1000);
    els.statusLine.textContent = `Painting ${body.n} image${body.n > 1 ? 's' : ''}… ${secs}s elapsed`;
  }, 1000);

  try {
    const data = await api('/api/generate', { method: 'POST', body: JSON.stringify(body) });
    state.items = [...data.images, ...state.items.filter((item) => item.id !== pendingId)];
    renderGallery();
    els.statusLine.textContent = `Done in ${(data.elapsedMs / 1000).toFixed(1)}s ✦`;
    toast(`Generated ${data.images.length} image${data.images.length > 1 ? 's' : ''}`, 'success');
  } catch (err) {
    state.items = state.items.filter((item) => item.id !== pendingId);
    state.total = Math.max(state.total - body.n, 0);
    renderGallery();
    els.statusLine.textContent = 'Generation failed — give it another try.';
    toast(err.message, 'error');
  } finally {
    clearInterval(ticker);
    setBusy(false);
  }
}

/* ------------------------------ lightbox ------------------------------ */
const visibleItems = () => state.items.filter((item) => !item.pending);
const currentItem = () => visibleItems()[state.lbIndex];

function openLightbox(id) {
  const index = visibleItems().findIndex((item) => item.id === id);
  if (index === -1) return;
  state.lbIndex = index;
  els.lightbox.hidden = false;
  document.body.style.overflow = 'hidden';
  paintLightbox();
}

function paintLightbox() {
  const items = visibleItems();
  const item = items[state.lbIndex];
  if (!item) return closeLightbox();
  els.lbImage.src = item.url;
  els.lbImage.alt = item.prompt;
  els.lbPrompt.textContent = item.prompt;
  const bits = [item.size, item.model, formatDate(item.createdAt)];
  if (item.seed != null) bits.push(`seed ${item.seed}`);
  if (item.negativePrompt) bits.push(`negative: ${item.negativePrompt}`);
  if (item.elapsedMs) bits.push(`${(item.elapsedMs / 1000).toFixed(1)}s`);
  els.lbMeta.textContent = bits.join('  ·  ');
  els.lbPrev.disabled = items.length < 2;
  els.lbNext.disabled = items.length < 2;
}

function closeLightbox() {
  state.lbIndex = -1;
  els.lightbox.hidden = true;
  els.lbImage.removeAttribute('src');
  document.body.style.overflow = '';
}

function stepLightbox(delta) {
  const items = visibleItems();
  if (!items.length) return;
  state.lbIndex = (state.lbIndex + delta + items.length) % items.length;
  paintLightbox();
}

async function downloadCurrent() {
  const item = currentItem();
  if (!item) return;
  try {
    const res = await fetch(item.url);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${item.id}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Download started', 'success');
  } catch {
    window.open(item.url, '_blank');
  }
}

async function deleteCurrent() {
  const item = currentItem();
  if (!item) return;
  if (!confirm('Delete this image permanently?')) return;
  try {
    await api(`/api/gallery/${item.id}`, { method: 'DELETE' });
    state.items = state.items.filter((i) => i.id !== item.id);
    state.total = Math.max(state.total - 1, 0);
    if (state.lbIndex >= visibleItems().length) state.lbIndex = Math.max(visibleItems().length - 1, 0);
    renderGallery();
    if (!visibleItems().length) closeLightbox();
    else paintLightbox();
    toast('Image deleted', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ------------------------------ events ------------------------------ */
function bindEvents() {
  els.prompt.addEventListener('input', updateCounter);
  els.prompt.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') generate();
  });
  els.generateBtn.addEventListener('click', generate);

  els.advToggle.addEventListener('click', () => {
    const isOpen = !els.advPanel.hidden;
    if (isOpen) {
      els.advPanel.hidden = true;
      els.advToggle.setAttribute('aria-expanded', 'false');
    } else openAdvanced();
  });

  els.surpriseBtn.addEventListener('click', () => {
    els.prompt.value = PROMPT_IDEAS[Math.floor(Math.random() * PROMPT_IDEAS.length)];
    updateCounter();
    els.prompt.focus();
  });

  let searchTimer;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = els.search.value;
      state.offset = 0;
      loadGallery();
    }, 300);
  });

  els.loadMoreBtn.addEventListener('click', () => loadGallery({ append: true }));

  els.grid.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card && !card.classList.contains('pending')) openLightbox(card.dataset.id);
  });
  els.grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card');
    if (card && !card.classList.contains('pending')) {
      e.preventDefault();
      openLightbox(card.dataset.id);
    }
  });

  els.lbClose.addEventListener('click', closeLightbox);
  els.lbPrev.addEventListener('click', () => stepLightbox(-1));
  els.lbNext.addEventListener('click', () => stepLightbox(1));
  els.lbDownload.addEventListener('click', downloadCurrent);
  els.lbDelete.addEventListener('click', deleteCurrent);

  els.lbCopy.addEventListener('click', async () => {
    const item = currentItem();
    if (!item) return;
    try {
      await navigator.clipboard.writeText(item.prompt);
      toast('Prompt copied', 'success');
    } catch {
      toast('Copy failed', 'error');
    }
  });

  els.lbReuse.addEventListener('click', () => {
    const item = currentItem();
    if (!item) return;
    els.prompt.value = item.prompt;
    els.negativePrompt.value = item.negativePrompt || '';
    if (item.seed != null) els.seed.value = item.seed;
    const match = RATIOS.find((r) => r.size === item.size);
    if (match) {
      state.ratio = match.label;
      [...els.ratioGroup.children].forEach((c) => (c.className = c.textContent === match.label ? 'active' : ''));
    }
    if (item.negativePrompt || item.seed != null) openAdvanced();
    updateCounter();
    closeLightbox();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    els.prompt.focus();
    toast('Prompt loaded into the composer', 'success');
  });

  els.lightbox.addEventListener('click', (e) => {
    if (e.target === els.lightbox) closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (els.lightbox.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') stepLightbox(-1);
    if (e.key === 'ArrowRight') stepLightbox(1);
  });
}

/* ------------------------------ boot ------------------------------ */
async function init() {
  renderControls();
  bindEvents();
  updateCounter();

  try {
    state.config = await api('/api/config');
    const model = state.config.model;
    els.modelBadge.textContent = model;
    if (els.heroModel) els.heroModel.textContent = model;
    els.footModel.textContent = model;
    if (!state.config.ready) {
      els.modelDot.classList.add('offline');
      toast('API key missing — set BETOPIA_API_KEY in .env', 'error');
    }
  } catch (err) {
    els.modelBadge.textContent = 'offline';
    els.modelDot.classList.add('offline');
    toast(err.message, 'error');
  }

  renderControls();
  await loadGallery();
}

init();
