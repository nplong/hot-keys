// hot-keys – options.js

const tbody = document.getElementById('shortcuts-body');
const newType = document.getElementById('new-type');
const newTrigger = document.getElementById('new-trigger');
const newMessage = document.getElementById('new-message');
const btnAdd = document.getElementById('btn-add');
const statusEl = document.getElementById('status');

let shortcuts = [];

// ── Storage helpers ──────────────────────────────────────────────────────────

function save() {
  chrome.storage.sync.set({ shortcuts }, () => {
    showStatus('Saved.');
  });
}

function showStatus(msg) {
  statusEl.textContent = msg;
  setTimeout(() => { statusEl.textContent = ''; }, 2000);
}

// ── Key-combo capture ────────────────────────────────────────────────────────

function buildCombo(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  const key = e.key;
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    parts.push(key.length === 1 ? key.toUpperCase() : key);
  }
  return parts.join('+');
}

function attachComboCapture(input) {
  input.addEventListener('focus', () => {
    if (input.dataset.captureType !== 'combo') return;
    input.classList.add('capturing');
    input.value = '';
    input.placeholder = 'Press keys…';
  });

  input.addEventListener('keydown', (e) => {
    if (input.dataset.captureType !== 'combo') return;
    e.preventDefault();
    const combo = buildCombo(e);
    if (combo) input.value = combo;
  });

  input.addEventListener('blur', () => {
    input.classList.remove('capturing');
    input.placeholder = input.dataset.captureType === 'combo'
      ? 'Click to capture…'
      : 'e.g. ;hello';
  });
}

function syncTriggerInputMode(typeSelect, triggerInput) {
  const isCombo = typeSelect.value === 'combo';
  triggerInput.dataset.captureType = typeSelect.value;
  triggerInput.readOnly = isCombo;
  triggerInput.placeholder = isCombo ? 'Click to capture…' : 'e.g. ;hello';
  if (!isCombo) triggerInput.value = '';
}

// ── Render saved rows ────────────────────────────────────────────────────────

function renderRows() {
  tbody.innerHTML = '';
  shortcuts.forEach((sc, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'saved-row';
    tr.dataset.index = idx;

    // Type cell
    const tdType = document.createElement('td');
    const typeSelect = document.createElement('select');
    typeSelect.className = 'type-select';
    ['combo', 'trigger'].forEach(val => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val === 'combo' ? 'Key Combo' : 'Text Trigger';
      if (sc.type === val) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    tdType.appendChild(typeSelect);

    // Trigger cell
    const tdTrigger = document.createElement('td');
    const triggerInput = document.createElement('input');
    triggerInput.type = 'text';
    triggerInput.className = 'trigger-input';
    triggerInput.value = sc.trigger;
    triggerInput.dataset.captureType = sc.type;
    triggerInput.readOnly = sc.type === 'combo';
    triggerInput.placeholder = sc.type === 'combo' ? 'Click to capture…' : 'e.g. ;hello';
    attachComboCapture(triggerInput);
    tdTrigger.appendChild(triggerInput);

    // Keep input mode in sync when type changes
    typeSelect.addEventListener('change', () => {
      syncTriggerInputMode(typeSelect, triggerInput);
    });

    // Message cell
    const tdMsg = document.createElement('td');
    const msgArea = document.createElement('textarea');
    msgArea.className = 'message-textarea';
    msgArea.value = sc.message;
    tdMsg.appendChild(msgArea);

    // Actions cell
    const tdActions = document.createElement('td');

    const btnSave = document.createElement('button');
    btnSave.className = 'btn-save';
    btnSave.textContent = 'Save';
    btnSave.addEventListener('click', () => {
      shortcuts[idx] = {
        type: typeSelect.value,
        trigger: triggerInput.value.trim(),
        message: msgArea.value,
      };
      save();
    });

    const btnDel = document.createElement('button');
    btnDel.className = 'btn-delete';
    btnDel.textContent = 'Delete';
    btnDel.addEventListener('click', () => {
      shortcuts.splice(idx, 1);
      save();
      renderRows();
    });

    tdActions.appendChild(btnSave);
    tdActions.appendChild(btnDel);

    tr.appendChild(tdType);
    tr.appendChild(tdTrigger);
    tr.appendChild(tdMsg);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });
}

// ── "Add" row wiring ─────────────────────────────────────────────────────────

// Initialise the new-row trigger input
newTrigger.dataset.captureType = newType.value;
attachComboCapture(newTrigger);

newType.addEventListener('change', () => {
  syncTriggerInputMode(newType, newTrigger);
});

btnAdd.addEventListener('click', () => {
  const trigger = newTrigger.value.trim();
  const message = newMessage.value;

  if (!trigger) {
    showStatus('Please enter a trigger / key combo.');
    newTrigger.focus();
    return;
  }
  if (!message) {
    showStatus('Please enter a message.');
    newMessage.focus();
    return;
  }

  shortcuts.push({ type: newType.value, trigger, message });
  save();
  renderRows();

  // Reset add row
  newTrigger.value = '';
  newMessage.value = '';
  newType.value = 'combo';
  syncTriggerInputMode(newType, newTrigger);
});

// ── Boot ─────────────────────────────────────────────────────────────────────

chrome.storage.sync.get('shortcuts', (data) => {
  shortcuts = data.shortcuts || [];
  renderRows();
});
