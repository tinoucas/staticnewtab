// Static New Tab — shortcut page.
// Shortcuts live in chrome.storage.local as [{ name, url, icon? }], mirrored
// to localStorage so the page paints them instantly on open.

const KEY = 'shortcuts';
const CACHE_KEY = 'shortcuts-cache';

const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const toggleEdit = document.getElementById('toggle-edit');
const editTools = document.getElementById('edit-tools');
const dialog = document.getElementById('dialog');
const form = document.getElementById('form');
const dialogTitle = document.getElementById('dialog-title');
const deleteBtn = document.getElementById('delete');
const importFile = document.getElementById('import-file');
const fName = document.getElementById('f-name');
const fUrl = document.getElementById('f-url');
const fIcon = document.getElementById('f-icon');

let shortcuts = readCache();
let editing = false;
let editIndex = -1; // -1 = adding

// ---------------------------------------------------------------------------
// Storage

function readCache() {
  try {
    const list = JSON.parse(localStorage.getItem(CACHE_KEY));
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

function writeCache(list) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch {}
}

async function save(list) {
  shortcuts = list;
  writeCache(list);
  render();
  await chrome.storage.local.set({ [KEY]: list });
}

chrome.storage.local.get(KEY).then((data) => {
  shortcuts = sanitize(data[KEY] || []);
  writeCache(shortcuts);
  render();
});

// Keep every open New Tab (e.g. the pinned one in each window) in sync.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[KEY]) return;
  shortcuts = sanitize(changes[KEY].newValue || []);
  writeCache(shortcuts);
  render();
});

// ---------------------------------------------------------------------------
// Helpers

function normalizeUrl(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return 'https://' + s;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function sanitize(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s.url === 'string' && s.url.trim())
    .map((s) => ({
      name: typeof s.name === 'string' ? s.name.trim() : '',
      url: normalizeUrl(s.url),
      ...(typeof s.icon === 'string' && s.icon.trim() ? { icon: s.icon.trim() } : {}),
    }));
}

function faviconUrl(pageUrl) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', '64');
  return u.toString();
}

function pixels(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c.toDataURL();
}

// The browser answers with a generic globe for sites it has no favicon for
// (never visited yet). Fetch that globe once so tiles can show a letter instead.
let genericIcon = null;
function genericIconPixels() {
  genericIcon ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(pixels(img));
    img.onerror = () => resolve(null);
    img.src = faviconUrl('https://static-new-tab.invalid/');
  });
  return genericIcon;
}

// ---------------------------------------------------------------------------
// Rendering

function tileFor(s, index) {
  const name = s.name || hostOf(s.url);

  const a = document.createElement('a');
  a.className = 'tile';
  a.href = s.url;
  a.title = `${name}\n${s.url}`;
  a.dataset.index = index;
  a.draggable = editing;

  const icon = document.createElement('span');
  icon.className = 'icon';
  const letter = (name.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  const img = document.createElement('img');
  img.alt = '';
  img.src = s.icon || faviconUrl(s.url);
  img.addEventListener('error', () => img.replaceWith(letter), { once: true });
  if (!s.icon) {
    img.addEventListener('load', async () => {
      if (pixels(img) === (await genericIconPixels())) img.replaceWith(letter);
    }, { once: true });
  }
  icon.append(img);

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = name;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove';
  remove.title = `Remove ${name}`;
  remove.setAttribute('aria-label', `Remove ${name}`);
  remove.textContent = '×';

  a.append(icon, label, remove);
  return a;
}

function addTile() {
  const b = document.createElement('a');
  b.className = 'tile add';
  b.href = '#';
  b.innerHTML = '<span class="icon" aria-hidden="true">+</span><span class="label">Add shortcut</span>';
  return b;
}

function render() {
  if (!shortcuts) return; // wait for storage on the very first open
  document.body.classList.toggle('editing', editing);
  toggleEdit.textContent = editing ? 'Done' : 'Edit';
  toggleEdit.setAttribute('aria-pressed', String(editing));
  editTools.hidden = !editing;

  grid.replaceChildren(...shortcuts.map(tileFor));
  if (editing || shortcuts.length === 0) grid.append(addTile());
  empty.hidden = shortcuts.length > 0;
}

// ---------------------------------------------------------------------------
// Editing

function setEditing(on) {
  editing = on;
  render();
}

function openDialog(index) {
  editIndex = index;
  const s = index >= 0 ? shortcuts[index] : { name: '', url: '', icon: '' };
  dialogTitle.textContent = index >= 0 ? 'Edit shortcut' : 'Add shortcut';
  fName.value = s.name || '';
  fUrl.value = s.url || '';
  fIcon.value = s.icon || '';
  deleteBtn.hidden = index < 0;
  dialog.showModal();
  (index >= 0 ? fName : fUrl).focus();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const entry = sanitize([{ name: fName.value, url: fUrl.value, icon: fIcon.value }])[0];
  if (!entry) return;
  const list = [...shortcuts];
  if (editIndex >= 0) list[editIndex] = entry;
  else list.push(entry);
  dialog.close();
  save(list);
});

document.getElementById('cancel').addEventListener('click', () => dialog.close());

deleteBtn.addEventListener('click', () => {
  const list = shortcuts.filter((_, i) => i !== editIndex);
  dialog.close();
  save(list);
});

toggleEdit.addEventListener('click', () => setEditing(!editing));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && editing && !dialog.open) setEditing(false);
});

grid.addEventListener('click', (e) => {
  const tile = e.target.closest('.tile');
  if (!tile) return;

  if (tile.classList.contains('add')) {
    e.preventDefault();
    openDialog(-1);
    return;
  }
  if (!editing) return; // normal click: follow the link

  e.preventDefault();
  const index = Number(tile.dataset.index);
  if (e.target.closest('.remove')) save(shortcuts.filter((_, i) => i !== index));
  else openDialog(index);
});

// Drag to reorder (edit mode only).
let dragFrom = -1;

function clearDropMarks() {
  grid.querySelectorAll('.drop-before, .drop-after').forEach((el) =>
    el.classList.remove('drop-before', 'drop-after')
  );
}

function dropSide(tile, e) {
  const r = tile.getBoundingClientRect();
  return e.clientX < r.left + r.width / 2 ? 'before' : 'after';
}

grid.addEventListener('dragstart', (e) => {
  const tile = e.target.closest('.tile:not(.add)');
  if (!editing || !tile) return e.preventDefault();
  dragFrom = Number(tile.dataset.index);
  tile.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});

grid.addEventListener('dragover', (e) => {
  const tile = e.target.closest('.tile:not(.add)');
  if (dragFrom < 0 || !tile) return;
  e.preventDefault();
  clearDropMarks();
  tile.classList.add(`drop-${dropSide(tile, e)}`);
});

grid.addEventListener('drop', (e) => {
  const tile = e.target.closest('.tile:not(.add)');
  if (dragFrom < 0 || !tile) return;
  e.preventDefault();
  let to = Number(tile.dataset.index) + (dropSide(tile, e) === 'after' ? 1 : 0);
  const list = [...shortcuts];
  const [moved] = list.splice(dragFrom, 1);
  if (to > dragFrom) to -= 1;
  list.splice(to, 0, moved);
  save(list);
});

grid.addEventListener('dragend', () => {
  dragFrom = -1;
  clearDropMarks();
  grid.querySelector('.dragging')?.classList.remove('dragging');
});

// Import / export as JSON.
document.getElementById('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(shortcuts, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'shortcuts.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

document.getElementById('import').addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async () => {
  const file = importFile.files[0];
  importFile.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = sanitize(Array.isArray(data) ? data : data.shortcuts);
    if (!list.length) throw new Error('No shortcuts found in that file.');
    const replace = !shortcuts.length ||
      confirm(`Replace your ${shortcuts.length} shortcut(s) with the ${list.length} from the file?\nCancel adds them to the end instead.`);
    save(replace ? list : [...shortcuts, ...list]);
  } catch (err) {
    alert(`Couldn't import: ${err.message}`);
  }
});

render();
