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

// Open a URL from this page, in a new tab at the end of the strip (the
// pinned tab stays as it is). A new tab reaches the site like a URL typed in
// the browser's address bar ("Sec-Fetch-Site: none", SameSite=Strict cookies
// included, so you stay signed in). Navigating this tab itself, by a link or
// chrome.tabs.update, is sent as a cross-site request without those cookies.
function openUrl(url, { background = false } = {}) {
  return chrome.tabs.create({ url, active: !background });
}

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

// faviconUrl(), pixels() and Favicons live in favicons.js.

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
  if (s.icon) {
    img.src = s.icon;
    img.addEventListener('error', () => img.replaceWith(letter), { once: true });
  } else {
    Favicons.set(img, s.url, {
      onMissing: () => {
        const text = document.createTextNode(letter);
        img.replaceWith(text);
        return text; // swapped back if an icon turns up later
      },
    });
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
  if (!editing) {
    e.preventDefault();
    openUrl(tile.href, { background: e.ctrlKey || e.metaKey });
    return;
  }

  e.preventDefault();
  const index = Number(tile.dataset.index);
  if (e.target.closest('.remove')) save(shortcuts.filter((_, i) => i !== index));
  else openDialog(index);
});

grid.addEventListener('auxclick', (e) => {
  const tile = e.target.closest('.tile:not(.add)');
  if (!tile || e.button !== 1 || editing) return;
  e.preventDefault();
  openUrl(tile.href, { background: true });
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

// Export / import. Export saves everything (shortcuts, wallpaper and
// settings) as settings.json; see settings.js.
document.getElementById('export').addEventListener('click', async () => {
  try {
    const data = await Settings.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (err) {
    alert(`Couldn't export: ${err.message}`);
  }
});

document.getElementById('import').addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async () => {
  const file = importFile.files[0];
  importFile.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (Settings.isBackup(data)) {
      if (confirm('Replace your shortcuts, wallpaper and settings with the ones in this file?')) {
        await Settings.importAll(data);
      }
      return;
    }
    // Older export: a plain list of shortcuts.
    const list = sanitize(Array.isArray(data) ? data : data.shortcuts);
    if (!list.length) throw new Error('No shortcuts found in that file.');
    const replace = !shortcuts.length ||
      confirm(`Replace your ${shortcuts.length} shortcut(s) with the ${list.length} from the file?\nCancel adds them to the end instead.`);
    save(replace ? list : [...shortcuts, ...list]);
  } catch (err) {
    alert(`Couldn't import: ${err.message}`);
  }
});

// ---------------------------------------------------------------------------
// Missing icons (opt-in): find the icons sites declare in their page.

const fiDialog = document.getElementById('fi-dialog');
const fiText = document.getElementById('fi-text');
const fiStatus = document.getElementById('fi-status');
const fiFind = document.getElementById('fi-find');
const fiRevoke = document.getElementById('fi-revoke');
const fiForget = document.getElementById('fi-forget');

async function fiRefresh() {
  const access = await Favicons.hasAccess();
  fiText.textContent = access
    ? 'Access to websites is on: icons missing from new bookmarks are found automatically. ' +
      'Find icons checks all your bookmarks and shortcuts again.'
    : 'Some sites only list their icon inside their page. To find those, each site without an ' +
      'icon has its page read once, without your cookies, and the icon is saved on this ' +
      'computer. Helium will ask to allow access to all websites. Nothing is sent anywhere else.';
  fiRevoke.hidden = !access;
  fiForget.hidden = Favicons.savedCount() === 0;
  fiForget.textContent = `Forget saved icons (${Favicons.savedCount()})`;
}

function fiSay(text) {
  fiStatus.hidden = !text;
  fiStatus.textContent = text;
}

async function allPageUrls() {
  const urls = shortcuts.map((s) => s.url);
  const walk = (n) => (n.url ? urls.push(n.url) : (n.children || []).forEach(walk));
  (await chrome.bookmarks.getTree()).forEach(walk);
  return urls;
}

document.getElementById('open-icons').addEventListener('click', async () => {
  fiSay('');
  await fiRefresh();
  fiDialog.showModal();
});

fiFind.addEventListener('click', async () => {
  // Asked straight from the click: browsers only show the prompt then.
  const granted = await chrome.permissions.request({ origins: Favicons.ALL_SITES }).catch(() => false);
  if (!granted) {
    fiSay('Access not granted: nothing was fetched.');
    return;
  }
  fiFind.disabled = true;
  try {
    const result = await Favicons.scan(await allPageUrls(), (done, total) =>
      fiSay(total ? `Checking sites without an icon… ${done} of ${total}` : 'Checking…')
    );
    if (!result.checked) fiSay('Every site already has an icon.');
    else {
      const none = result.checked - result.found;
      fiSay(`Found ${result.found} of ${result.checked} missing icon${result.checked === 1 ? '' : 's'}.` +
        (none ? ` ${none} site${none === 1 ? ' has' : 's have'} no icon, or couldn't be reached.` : ''));
    }
  } finally {
    fiFind.disabled = false;
    fiRefresh();
  }
});

fiRevoke.addEventListener('click', async () => {
  await chrome.permissions.remove({ origins: Favicons.ALL_SITES });
  fiSay('Access removed. Icons already saved are kept.');
  fiRefresh();
});

fiForget.addEventListener('click', async () => {
  await Favicons.forget();
  fiSay('Saved icons removed.');
  fiRefresh();
});

render();
