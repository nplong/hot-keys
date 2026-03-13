// hot-keys content script
// Alt+S (layout-independent via e.code) opens a gallery picker modal.
// Items are grouped by category; click or keyboard-select to insert text.

let shortcuts = [];

function loadShortcuts() {
  chrome.storage.sync.get('shortcuts', (data) => {
    shortcuts = data.shortcuts || [];
  });
}

loadShortcuts();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.shortcuts) {
    shortcuts = changes.shortcuts.newValue || [];
  }
});

// ── Track last focused editable element ──────────────────────────────────────

let lastFocused = null;

document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) {
    lastFocused = el;
  }
}, true);

// ── Text insertion ────────────────────────────────────────────────────────────

function insertInto(el, text) {
  if (!el) return;
  el.focus();
  if (el.isContentEditable) {
    document.execCommand('insertText', false, text);
    return;
  }
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const start = el.selectionStart;
    const end   = el.selectionEnd;
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted) {
      el.value = el.value.slice(0, start) + text + el.value.slice(end);
      el.setSelectionRange(start + text.length, start + text.length);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}

// ── Picker state ──────────────────────────────────────────────────────────────

let pickerOpen         = false;
let pickerEl           = null;
let pickerActiveIndex  = 0;   // flat index across ALL visible items
let pickerItems        = [];  // flat ordered list matching DOM cards

// ── Gallery tile gradients (light-friendly, vivid) ───────────────────────────
// 12 gradients; tiles cycle through them per item index within each category.
const TILE_GRADIENTS = [
  'linear-gradient(135deg,#e0c3fc,#8ec5fc)',   // lavender → sky
  'linear-gradient(135deg,#f9d976,#f39f86)',   // yellow → coral
  'linear-gradient(135deg,#a1ffce,#faffd1)',   // mint → cream
  'linear-gradient(135deg,#fbc2eb,#a6c1ee)',   // pink → periwinkle
  'linear-gradient(135deg,#ffecd2,#fcb69f)',   // peach → salmon
  'linear-gradient(135deg,#c2e9fb,#a1c4fd)',   // powder blue
  'linear-gradient(135deg,#d4fc79,#96e6a1)',   // lime → green
  'linear-gradient(135deg,#fccb90,#d57eeb)',   // orange → purple
  'linear-gradient(135deg,#a8edea,#fed6e3)',   // aqua → blush
  'linear-gradient(135deg,#e0f7fa,#80deea)',   // ice blue
  'linear-gradient(135deg,#ffe0b2,#ffab91)',   // amber → deep orange
  'linear-gradient(135deg,#f3e7e9,#e3eeff)',   // blush → very light blue
];

// Tile size classes cycle in a repeating pattern to create gallery variation
// Sizes: 'normal' = 1×1, 'wide' = 2-col span, 'tall' = 2-row span
const SIZE_PATTERN = ['normal','normal','wide','normal','tall','normal','normal','wide','normal','normal'];

// ── Styles ────────────────────────────────────────────────────────────────────

const PICKER_STYLES = `
  #hk-overlay {
    position: fixed;
    inset: 0;
    background: rgba(30,30,40,0.45);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    z-index: 2147483646;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  #hk-modal {
    background: #f8f8fb;
    border-radius: 20px;
    box-shadow: 0 32px 80px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06);
    width: 680px;
    max-width: 96vw;
    max-height: 82vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: hk-pop 0.2s cubic-bezier(0.34,1.45,0.64,1) both;
  }
  @keyframes hk-pop {
    from { opacity:0; transform:scale(0.90) translateY(14px); }
    to   { opacity:1; transform:scale(1)    translateY(0);    }
  }

  /* ── Header ── */
  #hk-modal-header {
    padding: 18px 22px 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    background: #fff;
    border-bottom: 1px solid #ebebeb;
    flex-shrink: 0;
  }
  #hk-modal-title {
    font-size: 16px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    background: linear-gradient(135deg,#6c63ff 0%,#06b6d4 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    flex: 1;
    line-height: 1;
  }
  .hk-kbd-badge {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: #999;
    background: #f0f0f3;
    border: 1px solid #ddd;
    border-radius: 7px;
    padding: 3px 10px;
  }

  /* ── Scrollable body ── */
  #hk-body {
    overflow-y: auto;
    flex: 1;
    padding: 16px 18px 20px;
    scrollbar-width: thin;
    scrollbar-color: #ddd transparent;
  }
  #hk-body::-webkit-scrollbar { width: 5px; }
  #hk-body::-webkit-scrollbar-thumb { background:#ddd; border-radius:3px; }

  /* ── Category section ── */
  .hk-cat-section { margin-bottom: 20px; }
  .hk-cat-section:last-child { margin-bottom: 0; }
  .hk-cat-label {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #aaa;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .hk-cat-label::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #e8e8e8;
  }

  /* ── Gallery grid ── */
  .hk-gallery {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    grid-auto-rows: 110px;
  }

  /* ── Tile base ── */
  .hk-tile {
    border-radius: 14px;
    overflow: hidden;
    cursor: pointer;
    position: relative;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    user-select: none;
    outline: none;
  }
  .hk-tile.hk-wide  { grid-column: span 2; }
  .hk-tile.hk-tall  { grid-row:    span 2; }
  .hk-tile:hover {
    transform: translateY(-3px) scale(1.01);
    box-shadow: 0 10px 28px rgba(0,0,0,0.15);
    z-index: 2;
  }
  .hk-tile.hk-active {
    box-shadow: 0 0 0 3px #6c63ff, 0 8px 24px rgba(108,99,255,0.25);
    transform: translateY(-2px) scale(1.01);
    z-index: 3;
  }

  /* ── Tile gradient background ── */
  .hk-tile-bg {
    position: absolute;
    inset: 0;
    transition: opacity 0.15s;
  }
  .hk-tile:hover .hk-tile-bg { opacity: 0.9; }

  /* ── Tile overlay scrim (bottom) ── */
  .hk-tile-scrim {
    position: absolute;
    inset: 0;
    background: linear-gradient(to bottom, rgba(255,255,255,0) 30%, rgba(255,255,255,0.72) 100%);
  }

  /* ── Tile text content ── */
  .hk-tile-content {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 10px 12px;
    gap: 2px;
  }
  .hk-tile-label {
    font-size: 15.6px;
    font-weight: 700;
    color: #1a1a2e;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hk-tile.hk-tall .hk-tile-label { font-size: 17px; }
  .hk-tile.hk-wide .hk-tile-label { font-size: 16px; }
  .hk-tile-msg {
    font-size: 14px;
    color: rgba(26,26,46,0.58);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.35;
  }
  .hk-tile.hk-tall .hk-tile-msg {
    white-space: pre-wrap;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }

  /* ── Empty state ── */
  .hk-empty {
    padding: 48px 20px;
    text-align: center;
    color: #bbb;
    font-size: 15.6px;
  }
`;

function ensureStyles() {
  if (document.getElementById('hk-styles')) return;
  const s = document.createElement('style');
  s.id = 'hk-styles';
  s.textContent = PICKER_STYLES;
  document.head.appendChild(s);
}

// ── Build grouped structure ───────────────────────────────────────────────────

function groupByCategory(items) {
  const map = new Map();
  items.forEach(sc => {
    const cat = (sc.category || 'General').trim() || 'General';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(sc);
  });
  return map; // Map<string, snippet[]>
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderPickerItems() {
  const body = document.getElementById('hk-body');
  if (!body) return;
  body.innerHTML = '';
  pickerItems = [];

  if (shortcuts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hk-empty';
    empty.textContent = 'No snippets saved yet. Add some in Options.';
    body.appendChild(empty);
    pickerActiveIndex = -1;
    return;
  }

  const groups = groupByCategory(shortcuts);
  let globalIdx = 0;

  groups.forEach((items, catName) => {
    // Section wrapper
    const section = document.createElement('div');
    section.className = 'hk-cat-section';

    // Category label
    const catLabel = document.createElement('div');
    catLabel.className = 'hk-cat-label';
    catLabel.textContent = catName;
    section.appendChild(catLabel);

    // Gallery grid
    const grid = document.createElement('div');
    grid.className = 'hk-gallery';

    items.forEach((sc, localIdx) => {
      const sizeClass = SIZE_PATTERN[localIdx % SIZE_PATTERN.length];
      const grad      = TILE_GRADIENTS[globalIdx % TILE_GRADIENTS.length];
      const myIndex   = globalIdx;

      pickerItems.push(sc);

      const tile = document.createElement('div');
      tile.className = 'hk-tile' +
        (sizeClass === 'wide' ? ' hk-wide' : '') +
        (sizeClass === 'tall' ? ' hk-tall' : '') +
        (myIndex === 0        ? ' hk-active' : '');
      tile.tabIndex = -1;
      tile.dataset.idx = myIndex;

      const bg = document.createElement('div');
      bg.className = 'hk-tile-bg';
      bg.style.background = grad;

      const scrim = document.createElement('div');
      scrim.className = 'hk-tile-scrim';

      const content = document.createElement('div');
      content.className = 'hk-tile-content';

      const labelEl = document.createElement('div');
      labelEl.className = 'hk-tile-label';
      labelEl.textContent = sc.label || '(no label)';

      const msgEl = document.createElement('div');
      msgEl.className = 'hk-tile-msg';
      msgEl.textContent = sc.message;

      content.appendChild(labelEl);
      content.appendChild(msgEl);

      tile.appendChild(bg);
      tile.appendChild(scrim);
      tile.appendChild(content);

      tile.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectPickerItem(myIndex);
      });

      grid.appendChild(tile);
      globalIdx++;
    });

    section.appendChild(grid);
    body.appendChild(section);
  });

  pickerActiveIndex = 0;
}

// ── Active tile helpers ───────────────────────────────────────────────────────

function setActivePickerItem(idx) {
  if (idx < 0 || idx >= pickerItems.length) return;
  const body = document.getElementById('hk-body');
  if (!body) return;
  body.querySelectorAll('.hk-tile').forEach(el => el.classList.remove('hk-active'));
  const target = body.querySelector(`.hk-tile[data-idx="${idx}"]`);
  if (target) {
    target.classList.add('hk-active');
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  pickerActiveIndex = idx;
}

function selectPickerItem(idx) {
  if (idx < 0 || idx >= pickerItems.length) return;
  const text   = pickerItems[idx].message;
  const target = lastFocused;
  closePicker();
  insertInto(target, text);
}

// ── Open / close ──────────────────────────────────────────────────────────────

function openPicker() {
  if (pickerOpen) return;
  pickerOpen = true;
  ensureStyles();

  const overlay = document.createElement('div');
  overlay.id = 'hk-overlay';
  overlay.tabIndex = -1;

  const modal = document.createElement('div');
  modal.id = 'hk-modal';

  // Header
  const header = document.createElement('div');
  header.id = 'hk-modal-header';

  const title = document.createElement('div');
  title.id = 'hk-modal-title';
  title.textContent = 'hot-keys';

  const badge = document.createElement('div');
  badge.className = 'hk-kbd-badge';
  badge.textContent = 'Alt + S';

  header.appendChild(title);
  header.appendChild(badge);

  // Body (scrollable gallery)
  const body = document.createElement('div');
  body.id = 'hk-body';

  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  pickerEl = overlay;

  renderPickerItems();

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closePicker();
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      setActivePickerItem(Math.min(pickerActiveIndex + 1, pickerItems.length - 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActivePickerItem(Math.max(pickerActiveIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectPickerItem(pickerActiveIndex);
    } else if (e.key === 'Escape') {
      closePicker();
    }
  });

  setTimeout(() => overlay.focus(), 0);
}

function closePicker() {
  if (!pickerOpen) return;
  pickerOpen = false;
  if (pickerEl) { pickerEl.remove(); pickerEl = null; }
}

// ── Global hotkey: Alt+S (layout-independent via e.code) ─────────────────────

document.addEventListener('keydown', (e) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey &&
      (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
    e.preventDefault();
    pickerOpen ? closePicker() : openPicker();
    return;
  }
  if (pickerOpen && e.key === 'Escape') {
    e.preventDefault();
    closePicker();
  }
}, true);
