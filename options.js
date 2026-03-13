// hot-keys – options.js

const newLabelEl    = document.getElementById('new-label');
const newCategoryEl = document.getElementById('new-category');
const newMessageEl  = document.getElementById('new-message');
const btnAdd        = document.getElementById('btn-add');
const statusEl      = document.getElementById('status');
const container     = document.getElementById('snippets-container');
const catListEl     = document.getElementById('cat-list');

let shortcuts = [];
let statusTimer = null;

// ── Storage helpers ───────────────────────────────────────────────────────────

function save(msg) {
  chrome.storage.sync.set({ shortcuts }, () => {
    showStatus(msg || 'Saved.');
  });
}

function showStatus(msg) {
  statusEl.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 2200);
}

// ── Derive categories list ────────────────────────────────────────────────────

function getCategories() {
  const set = new Set();
  shortcuts.forEach(sc => {
    const c = (sc.category || 'General').trim() || 'General';
    set.add(c);
  });
  return [...set].sort();
}

function refreshCatDatalist() {
  catListEl.innerHTML = '';
  getCategories().forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    catListEl.appendChild(opt);
  });
}

// ── Render all saved snippets grouped by category ────────────────────────────

const ACCENT_COUNT = 12;

function groupByCategory(items) {
  const map = new Map();
  items.forEach(sc => {
    const cat = (sc.category || 'General').trim() || 'General';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push({ sc, globalIdx: items.indexOf(sc) });
  });
  return map;
}

function renderAll() {
  container.innerHTML = '';
  refreshCatDatalist();

  if (shortcuts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<strong>No snippets yet</strong>Add your first snippet above to get started.';
    container.appendChild(empty);
    return;
  }

  // Build a flat map of snippet -> its position index for accent color
  const groups = new Map();
  shortcuts.forEach((sc, idx) => {
    const cat = (sc.category || 'General').trim() || 'General';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push({ sc, idx });
  });

  groups.forEach((entries, catName) => {
    const group = document.createElement('div');
    group.className = 'cat-group';

    // Category header
    const header = document.createElement('div');
    header.className = 'cat-header';

    const nameEl = document.createElement('span');
    nameEl.className = 'cat-name';
    nameEl.textContent = catName;

    const divider = document.createElement('div');
    divider.className = 'cat-divider';

    const countEl = document.createElement('span');
    countEl.className = 'cat-count';
    countEl.textContent = entries.length + (entries.length === 1 ? ' item' : ' items');

    header.appendChild(nameEl);
    header.appendChild(divider);
    header.appendChild(countEl);
    group.appendChild(header);

    // Grid of snippet cards
    const grid = document.createElement('div');
    grid.className = 'snippets-grid';

    entries.forEach(({ sc, idx }) => {
      grid.appendChild(buildCard(sc, idx));
    });

    group.appendChild(grid);
    container.appendChild(group);
  });
}

function buildCard(sc, idx) {
  const accentClass = 'accent-' + (idx % ACCENT_COUNT);

  const card = document.createElement('div');
  card.className = 'snippet-card';

  // Accent strip
  const accent = document.createElement('div');
  accent.className = 'snippet-card-accent ' + accentClass;
  card.appendChild(accent);

  // Body with editable fields
  const body = document.createElement('div');
  body.className = 'snippet-card-body';

  // Label field
  const labelGroup = document.createElement('div');
  labelGroup.className = 'field-group';
  const labelLbl = document.createElement('label');
  labelLbl.textContent = 'Label';
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.value = sc.label || '';
  labelInput.placeholder = 'Label';
  labelGroup.appendChild(labelLbl);
  labelGroup.appendChild(labelInput);

  // Category field
  const catGroup = document.createElement('div');
  catGroup.className = 'field-group';
  const catLbl = document.createElement('label');
  catLbl.textContent = 'Category';
  const catInput = document.createElement('input');
  catInput.type = 'text';
  catInput.value = (sc.category || 'General').trim() || 'General';
  catInput.placeholder = 'Category';
  catInput.setAttribute('list', 'cat-list');
  catGroup.appendChild(catLbl);
  catGroup.appendChild(catInput);

  // Message field
  const msgGroup = document.createElement('div');
  msgGroup.className = 'field-group';
  const msgLbl = document.createElement('label');
  msgLbl.textContent = 'Message';
  const msgArea = document.createElement('textarea');
  msgArea.value = sc.message || '';
  msgArea.placeholder = 'Text to insert…';
  msgGroup.appendChild(msgLbl);
  msgGroup.appendChild(msgArea);

  body.appendChild(labelGroup);
  body.appendChild(catGroup);
  body.appendChild(msgGroup);
  card.appendChild(body);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'snippet-card-actions';

  const btnSave = document.createElement('button');
  btnSave.className = 'btn btn-ghost btn-sm';
  btnSave.textContent = 'Save';
  btnSave.addEventListener('click', () => {
    const newCat = catInput.value.trim() || 'General';
    shortcuts[idx] = {
      label:    labelInput.value.trim(),
      category: newCat,
      message:  msgArea.value,
    };
    save('Saved.');
    renderAll();
  });

  const btnDel = document.createElement('button');
  btnDel.className = 'btn btn-danger btn-sm';
  btnDel.textContent = 'Delete';
  btnDel.addEventListener('click', () => {
    shortcuts.splice(idx, 1);
    save('Deleted.');
    renderAll();
  });

  actions.appendChild(btnSave);
  actions.appendChild(btnDel);
  card.appendChild(actions);

  return card;
}

// ── Add button ────────────────────────────────────────────────────────────────

btnAdd.addEventListener('click', () => {
  const label    = newLabelEl.value.trim();
  const category = newCategoryEl.value.trim() || 'General';
  const message  = newMessageEl.value;

  if (!label) {
    showStatus('Please enter a label.');
    newLabelEl.focus();
    return;
  }
  if (!message) {
    showStatus('Please enter a message.');
    newMessageEl.focus();
    return;
  }

  shortcuts.push({ label, category, message });
  save('Added!');
  renderAll();

  newLabelEl.value    = '';
  newCategoryEl.value = '';
  newMessageEl.value  = '';
  newLabelEl.focus();
});

// Enter key in label/category jumps to next field
newLabelEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); newCategoryEl.focus(); }
});
newCategoryEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); newMessageEl.focus(); }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

chrome.storage.sync.get('shortcuts', (data) => {
  shortcuts = data.shortcuts || [];
  // Migrate old snippets that lack a category field
  shortcuts = shortcuts.map(sc => ({
    label:    sc.label    || '',
    category: sc.category || 'General',
    message:  sc.message  || '',
  }));
  renderAll();
});
