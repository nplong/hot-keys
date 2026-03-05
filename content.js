// hot-keys content script
// Listens for keypresses and inserts mapped text snippets into focused inputs.

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

// ── Picker modal ─────────────────────────────────────────────────────────────

let pickerOpen = false;
let pickerEl = null;
let pickerActiveIndex = 0;
let pickerItems = [];

function buildPickerStyles() {
  const style = document.createElement('style');
  style.id = 'hk-picker-styles';
  style.textContent = `
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
      width: 480px;
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
    }
    #hk-search:focus { border-color: #4a90e2; }
    #hk-modal-hint {
      font-size: 11px;
      color: #999;
      white-space: nowrap;
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
      gap: 3px;
    }
    .hk-item:last-child { border-bottom: none; }
    .hk-item.hk-active, .hk-item:hover { background: #eef4fd; }
    .hk-item-trigger {
      font-size: 11px;
      color: #888;
      font-family: monospace;
    }
    .hk-item-message {
      font-size: 13px;
      color: #222;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 60px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hk-empty {
      padding: 24px 16px;
      text-align: center;
      color: #aaa;
      font-size: 13px;
    }
    #hk-modal-footer {
      padding: 8px 16px;
      border-top: 1px solid #eee;
      font-size: 11px;
      color: #aaa;
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
    #hk-copied-toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: #222;
      color: #fff;
      padding: 8px 18px;
      border-radius: 20px;
      font-size: 13px;
      z-index: 2147483647;
      opacity: 0;
      transition: opacity 0.2s;
      pointer-events: none;
    }
    #hk-copied-toast.hk-show { opacity: 1; }
  `;
  return style;
}

function showCopiedToast() {
  let toast = document.getElementById('hk-copied-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'hk-copied-toast';
    toast.textContent = 'Copied to clipboard';
    document.body.appendChild(toast);
  }
  toast.classList.add('hk-show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('hk-show'), 1800);
}

function renderPickerItems(filter) {
  const list = document.getElementById('hk-list');
  if (!list) return;

  const q = (filter || '').toLowerCase();
  pickerItems = shortcuts.filter(sc =>
    !q ||
    sc.trigger.toLowerCase().includes(q) ||
    sc.message.toLowerCase().includes(q)
  );

  list.innerHTML = '';

  if (pickerItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hk-empty';
    empty.textContent = shortcuts.length === 0
      ? 'No shortcuts saved yet. Add some in Options.'
      : 'No matches.';
    list.appendChild(empty);
    pickerActiveIndex = -1;
    return;
  }

  pickerActiveIndex = 0;
  pickerItems.forEach((sc, i) => {
    const item = document.createElement('div');
    item.className = 'hk-item' + (i === 0 ? ' hk-active' : '');
    item.dataset.index = i;

    const triggerEl = document.createElement('div');
    triggerEl.className = 'hk-item-trigger';
    triggerEl.textContent = (sc.type === 'combo' ? '⌨ ' : '✦ ') + sc.trigger;

    const msgEl = document.createElement('div');
    msgEl.className = 'hk-item-message';
    msgEl.textContent = sc.message;

    item.appendChild(triggerEl);
    item.appendChild(msgEl);

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
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
  const sc = pickerItems[idx];
  navigator.clipboard.writeText(sc.message).then(() => {
    closePicker();
    showCopiedToast();
  }).catch(() => {
    // Fallback for pages that block clipboard API
    const ta = document.createElement('textarea');
    ta.value = sc.message;
    ta.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    closePicker();
    showCopiedToast();
  });
}

function openPicker() {
  if (pickerOpen) return;
  pickerOpen = true;

  if (!document.getElementById('hk-picker-styles')) {
    document.head.appendChild(buildPickerStyles());
  }

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
  search.placeholder = 'Search shortcuts…';
  search.autocomplete = 'off';

  const hint = document.createElement('div');
  hint.id = 'hk-modal-hint';
  hint.textContent = 'hot-keys';

  header.appendChild(search);
  header.appendChild(hint);

  // List
  const list = document.createElement('div');
  list.id = 'hk-list';

  // Footer
  const footer = document.createElement('div');
  footer.id = 'hk-modal-footer';
  footer.innerHTML =
    '<span><kbd>↑↓</kbd> navigate</span>' +
    '<span><kbd>Enter</kbd> copy</span>' +
    '<span><kbd>Esc</kbd> close</span>';

  modal.appendChild(header);
  modal.appendChild(list);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  pickerEl = overlay;

  renderPickerItems('');

  // Close on overlay backdrop click
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closePicker();
  });

  // Search input handling
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

  // Focus search field
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

// Global Escape key closes picker even when focus is elsewhere
document.addEventListener('keydown', (e) => {
  if (pickerOpen && e.key === 'Escape') {
    e.preventDefault();
    closePicker();
  }
}, true);

// --- Text insertion ---

function insertText(el, text) {
  if (el.isContentEditable) {
    document.execCommand('insertText', false, text);
    return;
  }
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    // Try execCommand first (triggers input events properly)
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted) {
      // Fallback: direct value manipulation
      el.value = before + text + after;
      el.setSelectionRange(start + text.length, start + text.length);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}

// --- Key combo matching ---

function buildComboString(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');

  const key = e.key;
  // Avoid duplicating modifier key names
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    parts.push(key.length === 1 ? key.toUpperCase() : key);
  }
  return parts.join('+');
}

// --- Text trigger tracking ---

// We keep a per-element input buffer to detect text triggers.
// Using a WeakMap so buffers are GC'd when elements are removed.
const buffers = new WeakMap();

function getBuffer(el) {
  if (!buffers.has(el)) buffers.set(el, '');
  return buffers.get(el);
}

function setBuffer(el, val) {
  buffers.set(el, val);
}

function getTextTriggers() {
  return shortcuts.filter(s => s.type === 'trigger');
}

function checkTriggers(el, buffer) {
  const triggers = getTextTriggers();
  for (const shortcut of triggers) {
    const trigger = shortcut.trigger;
    if (buffer.endsWith(trigger)) {
      return shortcut;
    }
  }
  return null;
}

// --- Main keydown handler ---

document.addEventListener('keydown', (e) => {
  // Alt+S → open picker modal (works anywhere on the page)
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (pickerOpen) {
      closePicker();
    } else {
      openPicker();
    }
    return;
  }

  const el = document.activeElement;
  if (!el) return;

  const isEditable =
    el.isContentEditable ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA';

  if (!isEditable) return;

  // --- Key combo shortcuts ---
  const combo = buildComboString(e);
  for (const shortcut of shortcuts) {
    if (shortcut.type === 'combo' && shortcut.trigger === combo) {
      e.preventDefault();
      insertText(el, shortcut.message);
      setBuffer(el, '');
      return;
    }
  }
}, true);

// --- Input event for text trigger tracking ---

document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el) return;

  const isEditable =
    el.isContentEditable ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA';

  if (!isEditable) return;

  // Update buffer with latest typed character(s)
  let currentValue;
  if (el.isContentEditable) {
    currentValue = el.textContent;
  } else {
    currentValue = el.value;
  }

  // Keep only last 50 chars to avoid unbounded growth
  const buf = currentValue.slice(-50);
  setBuffer(el, buf);

  const matched = checkTriggers(el, buf);
  if (matched) {
    const trigger = matched.trigger;
    const message = matched.message;

    // Remove the trigger text and insert the message
    if (el.isContentEditable) {
      // Select the trigger text and replace it
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.setStart(range.startContainer, range.startOffset - trigger.length);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, message);
      }
    } else {
      const pos = el.selectionStart;
      const before = el.value.slice(0, pos - trigger.length);
      const after = el.value.slice(pos);
      el.value = before + after;
      el.setSelectionRange(pos - trigger.length, pos - trigger.length);
      document.execCommand('insertText', false, message);
    }

    setBuffer(el, '');
  }
}, true);
