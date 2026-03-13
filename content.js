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

const PICKER_STYLES = `
  #hk-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.35);
    z-index: 2147483646;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  #hk-modal {
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.22);
    width: 500px;
    max-width: 92vw;
    max-height: 72vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  #hk-modal-header {
    padding: 14px 16px 10px;
    border-bottom: 1px solid #eee;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  #hk-search {
    flex: 1;
    border: 1px solid #ccc;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 14px;
    outline: none;
    font-family: inherit;
  }
  #hk-search:focus { border-color: #4a90e2; }
  #hk-modal-title {
    font-size: 12px;
    font-weight: 600;
    color: #aaa;
    white-space: nowrap;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  #hk-list {
    overflow-y: auto;
    flex: 1;
  }
  .hk-item {
    padding: 10px 16px;
    cursor: pointer;
    border-bottom: 1px solid #f2f2f2;
    display: flex;
    flex-direction: column;
    gap: 4px;
    user-select: none;
  }
  .hk-item:last-child { border-bottom: none; }
  .hk-item.hk-active { background: #eef4fd; }
  .hk-item:hover { background: #f5f9ff; }
  .hk-item.hk-active:hover { background: #eef4fd; }
  .hk-item-label {
    font-size: 13px;
    font-weight: 600;
    color: #1a1a1a;
  }
  .hk-item-message {
    font-size: 12px;
    color: #777;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 48px;
    overflow: hidden;
  }
  .hk-empty {
    padding: 28px 16px;
    text-align: center;
    color: #bbb;
    font-size: 13px;
  }
  #hk-modal-footer {
    padding: 8px 16px;
    border-top: 1px solid #eee;
    font-size: 11px;
    color: #bbb;
    display: flex;
    gap: 14px;
  }
  #hk-modal-footer kbd {
    background: #f0f0f0;
    border: 1px solid #ccc;
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 10px;
    font-family: monospace;
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
    const item = document.createElement('div');
    item.className = 'hk-item' + (i === 0 ? ' hk-active' : '');

    const labelEl = document.createElement('div');
    labelEl.className = 'hk-item-label';
    labelEl.textContent = sc.label || '(no label)';

    const msgEl = document.createElement('div');
    msgEl.className = 'hk-item-message';
    msgEl.textContent = sc.message;

    item.appendChild(labelEl);
    item.appendChild(msgEl);

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

  // Header
  const header = document.createElement('div');
  header.id = 'hk-modal-header';

  const search = document.createElement('input');
  search.id = 'hk-search';
  search.type = 'text';
  search.placeholder = 'Search snippets…';
  search.autocomplete = 'off';

  const title = document.createElement('div');
  title.id = 'hk-modal-title';
  title.textContent = 'hot-keys';

  header.appendChild(search);
  header.appendChild(title);

  // List
  const list = document.createElement('div');
  list.id = 'hk-list';

  // Footer
  const footer = document.createElement('div');
  footer.id = 'hk-modal-footer';
  footer.innerHTML =
    '<span><kbd>↑↓</kbd> navigate</span>' +
    '<span><kbd>Enter</kbd> or click to insert</span>' +
    '<span><kbd>Esc</kbd> close</span>';

  modal.appendChild(header);
  modal.appendChild(list);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  pickerEl = overlay;

  renderPickerItems('');

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closePicker();
  });

  search.addEventListener('input', () => {
    renderPickerItems(search.value);
  });

  search.addEventListener('keydown', (e) => {
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

  setTimeout(() => search.focus(), 0);
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

document.addEventListener('keydown', (e) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    pickerOpen ? closePicker() : openPicker();
    return;
  }
  if (pickerOpen && e.key === 'Escape') {
    e.preventDefault();
    closePicker();
  }
}, true);
