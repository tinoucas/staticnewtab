// Static New Tab — right-click menu for the bookmarks bar.
// Open, edit, add, delete (with undo), copy, add to shortcuts.

(() => {
  const bar = document.getElementById('bookmarks');
  const dialog = document.getElementById('bm-dialog');
  const form = document.getElementById('bm-form');
  const dialogTitle = document.getElementById('bm-dialog-title');
  const fName = document.getElementById('bm-f-name');
  const fUrl = document.getElementById('bm-f-url');
  const fUrlLabel = document.getElementById('bm-f-url-label');
  const toast = document.getElementById('bm-toast');
  const toastText = document.getElementById('bm-toast-text');

  const OPEN_ALL_CONFIRM = 15; // like the browser, ask before opening more

  let menu = null;
  let returnFocus = null;

  const isRoot = (node) => !node.parentId || node.parentId === '0' || !!node.folderType;
  const isLocked = (node) => isRoot(node) || node.unmodifiable === 'managed';
  const isOpenable = (url) => url && !/^javascript:/i.test(url);

  function urlsIn(node) {
    if (node.url) return isOpenable(node.url) ? [node.url] : [];
    return (node.children || []).flatMap(urlsIn);
  }

  // Bookmarks in the bar come from getTree(); re-read before acting so
  // indexes and children are current.
  async function fresh(node) {
    const [n] = await chrome.bookmarks.getSubTree(node.id);
    return n;
  }

  // -------------------------------------------------------------------------
  // Actions

  async function openAll(urls, { newWindow = false } = {}) {
    if (!urls.length) return;
    if (urls.length > OPEN_ALL_CONFIRM && !confirm(`Open ${urls.length} tabs?`)) return;
    if (newWindow) {
      await chrome.windows.create({ url: urls });
    } else {
      for (const url of urls) await chrome.tabs.create({ url, active: false });
    }
  }

  async function openHere(url) {
    const tab = await chrome.tabs.getCurrent();
    chrome.tabs.update(tab.id, { url });
  }

  function ask({ title, name = '', url = null }) {
    dialogTitle.textContent = title;
    fName.value = name;
    fUrl.value = url ?? '';
    fUrlLabel.hidden = url === null;
    fUrl.required = url !== null;
    dialog.showModal();
    (url !== null && !name ? fUrl : fName).focus();
    fName.select();

    return new Promise((resolve) => {
      const done = (value) => {
        form.removeEventListener('submit', onSubmit);
        dialog.removeEventListener('close', onClose);
        resolve(value);
      };
      const onSubmit = (e) => {
        e.preventDefault();
        const value = { title: fName.value.trim() };
        if (url !== null) {
          value.url = normalizeUrl(fUrl.value);
          if (!value.url) return;
        }
        dialog.close();
        done(value);
      };
      const onClose = () => done(null);
      form.addEventListener('submit', onSubmit);
      dialog.addEventListener('close', onClose, { once: true });
    });
  }

  document.getElementById('bm-cancel').addEventListener('click', () => dialog.close());

  async function edit(node) {
    const isFolder = !node.url;
    const value = await ask({
      title: isFolder ? 'Rename folder' : 'Edit bookmark',
      name: node.title,
      url: isFolder ? null : node.url,
    });
    if (value) await chrome.bookmarks.update(node.id, value);
  }

  async function add(kind, parentId, index) {
    const value = await ask(
      kind === 'folder'
        ? { title: 'Add folder', name: 'New folder' }
        : { title: 'Add page', name: '', url: '' }
    );
    if (!value) return;
    if (kind === 'page' && !value.title) value.title = value.url;
    await chrome.bookmarks.create({ parentId, index, ...value });
  }

  async function remove(node) {
    node = await fresh(node);
    const count = urlsIn(node).length;
    if (!node.url && count > 0 && !confirm(`Delete “${node.title}” and the ${count} bookmark(s) in it?`)) return;
    if (node.url) await chrome.bookmarks.remove(node.id);
    else await chrome.bookmarks.removeTree(node.id);
    showUndo(node);
  }

  async function restore(node, parentId, index) {
    const created = await chrome.bookmarks.create({
      parentId,
      index,
      title: node.title,
      ...(node.url ? { url: node.url } : {}),
    });
    for (const child of node.children || []) await restore(child, created.id);
  }

  let toastTimer = 0;
  let undoNode = null;

  function showUndo(node) {
    undoNode = node;
    toastText.textContent = `Deleted “${node.title || node.url}”`;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), 8000);
  }

  document.getElementById('bm-undo').addEventListener('click', async () => {
    toast.hidden = true;
    const node = undoNode;
    undoNode = null;
    if (!node) return;
    try {
      await restore(node, node.parentId, node.index);
    } catch {
      await restore(node, window.bookmarksBar.barRootId()); // parent is gone
    }
  });

  async function addToShortcuts(node) {
    const { shortcuts = [] } = await chrome.storage.local.get('shortcuts');
    if (!shortcuts.some((s) => s.url === node.url)) {
      await chrome.storage.local.set({
        shortcuts: [...shortcuts, { name: node.title || '', url: node.url }],
      });
    }
  }

  // -------------------------------------------------------------------------
  // Menu

  function itemsFor(node, parentForAdd) {
    const sep = '-';
    const openable = node && isOpenable(node.url);
    const items = [];

    if (node?.url) {
      items.push(
        ['Open', () => openHere(node.url), !openable],
        ['Open in new tab', () => openAll([node.url]), !openable],
        ['Open in new window', () => openAll([node.url], { newWindow: true }), !openable],
        sep,
        ['Edit…', () => edit(node), isLocked(node)],
        ['Copy link', () => navigator.clipboard.writeText(node.url)],
        ['Add to shortcuts', () => addToShortcuts(node), !openable],
        ['Delete', () => remove(node), isLocked(node)],
        sep
      );
    } else if (node) {
      const n = urlsIn(node).length;
      items.push(
        [`Open all (${n})`, async () => openAll(urlsIn(await fresh(node))), !n],
        [`Open all in new window`, async () => openAll(urlsIn(await fresh(node)), { newWindow: true }), !n],
        sep,
        ['Rename…', () => edit(node), isLocked(node)],
        ['Delete', () => remove(node), isLocked(node)],
        sep
      );
    }

    // New items go right after the clicked one, into the clicked root
    // folder, or at the end of the bar.
    const [parentId, index] = node
      ? isRoot(node) ? [node.id, undefined] : [node.parentId, node.index + 1]
      : [parentForAdd, undefined];
    items.push(
      ['Add page…', () => add('page', parentId, index), !parentId],
      ['Add folder…', () => add('folder', parentId, index), !parentId],
      sep,
      ['Bookmark manager', () => chrome.tabs.create({ url: 'chrome://bookmarks/' })],
      ['Hide bookmarks bar', () => chrome.storage.local.set({ showBookmarks: false })]
    );
    return items;
  }

  function closeContext({ refocus = false } = {}) {
    if (!menu) return;
    menu.remove();
    menu = null;
    if (refocus) returnFocus?.focus();
    returnFocus = null;
  }

  function openContext(e, node, parentForAdd, target) {
    closeContext();
    returnFocus = target;
    menu = document.createElement('ul');
    menu.className = 'bm-menu bm-context';
    menu.setAttribute('role', 'menu');

    for (const it of itemsFor(node, parentForAdd)) {
      const li = document.createElement('li');
      if (it === '-') {
        li.className = 'bm-sep';
        li.setAttribute('role', 'separator');
      } else {
        const [text, run, disabled] = it;
        li.setAttribute('role', 'none');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bm-ctx-item';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = text;
        btn.disabled = !!disabled;
        btn.addEventListener('click', () => {
          closeContext();
          window.bookmarksBar.closeMenus();
          Promise.resolve(run()).catch((err) => alert(err.message));
        });
        li.append(btn);
      }
      menu.append(li);
    }
    // No double separators at the start or end.
    menu.querySelectorAll('.bm-sep + .bm-sep').forEach((s) => s.remove());

    document.body.append(menu);
    const keyboard = e.clientX === 0 && e.clientY === 0;
    const anchor = keyboard ? target.getBoundingClientRect() : { left: e.clientX, top: e.clientY };
    const x = keyboard ? anchor.left : anchor.left;
    const y = keyboard ? anchor.bottom : anchor.top;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, x + width > vw - 8 ? x - width : x)}px`;
    menu.style.top = `${Math.max(8, y + height > vh - 8 ? y - height : y)}px`;
    if (keyboard) menu.querySelector('.bm-ctx-item:not(:disabled)')?.focus();
  }

  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.bm-context')) return e.preventDefault();
    const el = e.target.closest('.bm-item, .bm-menu-item, .bm-empty');
    const inBar = e.target.closest('.bm-bar');
    if (e.target.closest('.bm-history')) return e.preventDefault();
    if (!el && !inBar) return closeContext(); // leave the page's native menu alone
    e.preventDefault();

    if (el?.bmNode?.kind) return; // history entries: no bookmark actions
    if (el?.bmNode) openContext(e, el.bmNode, null, el);
    else if (el?.bmParent) openContext(e, null, el.bmParent.id, el);
    else if (el?.classList.contains('bm-overflow') || inBar) {
      openContext(e, null, window.bookmarksBar.barRootId(), el || bar);
    }
  });

  // Click or press outside closes the menu.
  document.addEventListener('mousedown', (e) => {
    if (menu && !e.target.closest('.bm-context')) closeContext();
  }, true);

  // Keyboard inside the menu. Registered on window (capture) so it runs
  // before the dropdown menus' own key handling.
  window.addEventListener('keydown', (e) => {
    if (!menu) return;
    const items = [...menu.querySelectorAll('.bm-ctx-item:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      closeContext({ refocus: true });
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(i + step + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') {
      closeContext({ refocus: true });
    } else {
      return; // Enter / Space activate the focused button natively
    }
    e.preventDefault();
    e.stopPropagation();
  }, true);

  window.addEventListener('blur', () => closeContext());
  window.addEventListener('resize', () => closeContext());
})();
