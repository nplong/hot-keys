// hot-keys – options.js

const tbody = document.getElementById('shortcuts-body');
const newLabel = document.getElementById('new-label');
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

// ── Render saved rows ────────────────────────────────────────────────────────

function renderRows() {
  tbody.innerHTML = '';
  shortcuts.forEach((sc, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'saved-row';

    // Label cell
    const tdLabel = document.createElement('td');
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'label-input';
    labelInput.value = sc.label || '';
    labelInput.placeholder = 'Label';
    tdLabel.appendChild(labelInput);

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
        label: labelInput.value.trim(),
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

    tr.appendChild(tdLabel);
    tr.appendChild(tdMsg);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });
}

// ── "Add" button ─────────────────────────────────────────────────────────────

btnAdd.addEventListener('click', () => {
  const label = newLabel.value.trim();
  const message = newMessage.value;

  if (!label) {
    showStatus('Please enter a label.');
    newLabel.focus();
    return;
  }
  if (!message) {
    showStatus('Please enter a message.');
    newMessage.focus();
    return;
  }

  shortcuts.push({ label, message });
  save();
  renderRows();

  newLabel.value = '';
  newMessage.value = '';
  newLabel.focus();
});

// ── Boot ─────────────────────────────────────────────────────────────────────

chrome.storage.sync.get('shortcuts', (data) => {
  shortcuts = data.shortcuts || [];
  renderRows();
});
