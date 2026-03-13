// hot-keys content script
// Alt+S opens a picker modal listing all saved snippets.
// Clicking an item inserts its text directly into the last focused input.

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
  if (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable
  ) {
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
    const end = el.selectionEnd;
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted) {
      // Fallback: direct value manipulation
      el.value = el.value.slice(0, start) + text + el.value.slice(end);
      el.setSelectionRange(start + text.length, start + text.length);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}

// ── Picker modal ──────────────────────────────────────────────────────────────

let pickerOpen = false;
let pickerEl = null;
let pickerActiveIndex = 0;
let pickerItems = [];

// Accent colors cycling per item index
const ITEM_ACCENTS = [
  { bar: '#6c63ff', badge: 'linear-gradient(135deg,#6c63ff,#a78bfa)', text: '#fff' },
  { bar: '#0ea5e9', badge: 'linear-gradient(135deg,#0ea5e9,#38bdf8)', text: '#fff' },
  { bar: '#10b981', badge: 'linear-gradient(135deg,#10b981,#34d399)', text: '#fff' },
  { bar: '#f59e0b', badge: 'linear-gradient(135deg,#f59e0b,#fcd34d)', text: '#fff' },
  { bar: '#ef4444', badge: 'linear-gradient(135deg,#ef4444,#fca5a5)', text: '#fff' },
  { bar: '#ec4899', badge: 'linear-gradient(135deg,#ec4899,#f9a8d4)', text: '#fff' },
];

const PICKER_STYLES = `
  #hk-overlay {
    position: fixed;
    inset: 0;
    background: rgba(10,10,20,0.55);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 2147483646;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  #hk-modal {
    background: #0f0f17;
    border-radius: 18px;
    box-shadow: 0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.07);
    width: 540px;
    max-width: 94vw;
    max-height: 74vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: hk-pop 0.18s cubic-bezier(0.34,1.56,0.64,1) both;
  }
  @keyframes hk-pop {
    from { opacity: 0; transform: scale(0.92) translateY(10px); }
    to   { opacity: 1; transform: scale(1)   translateY(0);     }
  }
  #hk-modal-header {
    padding: 20px 22px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid rgba(255,255,255,0.07);
  }
  #hk-modal-title {
    font-size: 15.6px;
    font-weight: 700;
    color: rgba(255,255,255,0.85);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    flex: 1;
  }
  #hk-modal-title span {
    display: inline-block;
    background: linear-gradient(135deg,#6c63ff,#0ea5e9);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .hk-badge-shortcut {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: rgba(255,255,255,0.35);
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    padding: 3px 9px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  #hk-list {
    overflow-y: auto;
    flex: 1;
    padding: 8px 10px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.12) transparent;
  }
  #hk-list::-webkit-scrollbar { width: 4px; }
  #hk-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
  .hk-item {
    display: flex;
    align-items: stretch;
    border-radius: 12px;
    margin-bottom: 6px;
    cursor: pointer;
    overflow: hidden;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.06);
    transition: background 0.13s, border-color 0.13s, transform 0.1s;
    user-select: none;
    position: relative;
  }
  .hk-item:last-child { margin-bottom: 0; }
  .hk-item:hover {
    background: rgba(255,255,255,0.08);
    border-color: rgba(255,255,255,0.12);
    transform: translateX(2px);
  }
  .hk-item.hk-active {
    background: rgba(255,255,255,0.09);
    border-color: rgba(255,255,255,0.18);
  }
  .hk-item.hk-active:hover {
    background: rgba(255,255,255,0.11);
  }
  .hk-item-accent {
    width: 4px;
    flex-shrink: 0;
    border-radius: 0;
  }
  .hk-item-body {
    flex: 1;
    padding: 13px 16px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .hk-item-top {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .hk-item-label {
    font-size: 15.6px;
    font-weight: 700;
    color: rgba(255,255,255,0.92);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hk-item-pill {
    flex-shrink: 0;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #fff;
    border-radius: 20px;
    padding: 2px 9px;
    opacity: 0.85;
  }
  .hk-item-message {
    font-size: 14px;
    color: rgba(255,255,255,0.42);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 44px;
    overflow: hidden;
    line-height: 1.5;
  }
  .hk-item-idx {
    flex-shrink: 0;
    align-self: center;
    margin-right: 14px;
    font-size: 11px;
    font-weight: 600;
    color: rgba(255,255,255,0.18);
    font-variant-numeric: tabular-nums;
  }
  .hk-empty {
    padding: 40px 16px;
    text-align: center;
    color: rgba(255,255,255,0.25);
    font-size: 15.6px;
  }
`;

function ensureStyles() {
  if (document.getElementById('hk-styles')) return;
  const style = document.createElement('style');
  style.id = 'hk-styles';
  style.textContent = PICKER_STYLES;
  document.head.appendChild(style);
}

function renderPickerItems(filter) {
  const list = document.getElementById('hk-list');
  if (!list) return;

  const q = (filter || '').toLowerCase();
  pickerItems = shortcuts.filter(sc =>
    !q ||
    (sc.label || '').toLowerCase().includes(q) ||
    sc.message.toLowerCase().includes(q)
  );

  list.innerHTML = '';

  if (pickerItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hk-empty';
    empty.textContent = shortcuts.length === 0
      ? 'No snippets saved yet. Add some in Options.'
      : 'No matches.';
    list.appendChild(empty);
    pickerActiveIndex = -1;
    return;
  }

  pickerActiveIndex = 0;
  pickerItems.forEach((sc, i) => {
    const accent = ITEM_ACCENTS[i % ITEM_ACCENTS.length];

    const item = document.createElement('div');
    item.className = 'hk-item' + (i === 0 ? ' hk-active' : '');

    // Left accent bar
    const accentBar = document.createElement('div');
    accentBar.className = 'hk-item-accent';
    accentBar.style.background = accent.bar;

    // Body
    const body = document.createElement('div');
    body.className = 'hk-item-body';

    // Top row: label + pill badge
    const top = document.createElement('div');
    top.className = 'hk-item-top';

    const labelEl = document.createElement('div');
    labelEl.className = 'hk-item-label';
    labelEl.textContent = sc.label || '(no label)';

    const pill = document.createElement('span');
    pill.className = 'hk-item-pill';
    pill.style.background = accent.badge;
    pill.style.color = accent.text;
    pill.textContent = 'snippet';

    top.appendChild(labelEl);
    top.appendChild(pill);

    const msgEl = document.createElement('div');
    msgEl.className = 'hk-item-message';
    msgEl.textContent = sc.message;

    body.appendChild(top);
    body.appendChild(msgEl);

    // Index number on the right
    const idxEl = document.createElement('div');
    idxEl.className = 'hk-item-idx';
    idxEl.textContent = String(i + 1).padStart(2, '0');

    item.appendChild(accentBar);
    item.appendChild(body);
    item.appendChild(idxEl);

    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep lastFocused from being cleared
      selectPickerItem(i);
    });

    list.appendChild(item);
  });
}

function setActivePickerItem(idx) {
  const list = document.getElementById('hk-list');
  if (!list) return;
  const items = list.querySelectorAll('.hk-item');
  items.forEach(el => el.classList.remove('hk-active'));
  if (idx >= 0 && idx < items.length) {
    items[idx].classList.add('hk-active');
    items[idx].scrollIntoView({ block: 'nearest' });
    pickerActiveIndex = idx;
  }
}

function selectPickerItem(idx) {
  if (idx < 0 || idx >= pickerItems.length) return;
  const text = pickerItems[idx].message;
  const target = lastFocused;
  closePicker();
  insertInto(target, text);
}

function openPicker() {
  if (pickerOpen) return;
  pickerOpen = true;
  ensureStyles();

  const overlay = document.createElement('div');
  overlay.id = 'hk-overlay';

  const modal = document.createElement('div');
  modal.id = 'hk-modal';

  // Header (title only — no search bar, no footer)
  const header = document.createElement('div');
  header.id = 'hk-modal-header';

  const title = document.createElement('div');
  title.id = 'hk-modal-title';
  title.innerHTML = '<span>hot-keys</span>';

  const shortcutBadge = document.createElement('div');
  shortcutBadge.className = 'hk-badge-shortcut';
  shortcutBadge.textContent = 'Alt + S';

  header.appendChild(title);
  header.appendChild(shortcutBadge);

  // List
  const list = document.createElement('div');
  list.id = 'hk-list';

  modal.appendChild(header);
  modal.appendChild(list);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  pickerEl = overlay;

  renderPickerItems('');

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closePicker();
  });

  // Keyboard navigation directly on overlay (no search input to focus)
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActivePickerItem(Math.min(pickerActiveIndex + 1, pickerItems.length - 1));
    } else if (e.key === 'ArrowUp') {
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
  if (pickerEl) {
    pickerEl.remove();
    pickerEl = null;
  }
}

// ── Global keydown: Alt+S toggles picker; Esc closes it ──────────────────────
// Uses e.code ('KeyS') in addition to e.key so that the shortcut works
// regardless of the active keyboard layout (e.g. Thai, Arabic, CJK, etc.).

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
