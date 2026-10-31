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

  function linksIn(node) {
    if (node.url) return isOpenable(node.url) ? [node] : [];
    return (node.children || []).flatMap(linksIn);
  }

  // Bookmarks in the bar come from getTree(); re-read before acting so
  // indexes and children are current.
  async function fresh(node) {
    const [n] = await chrome.bookmarks.getSubTree(node.id);
    return n;
  }

  // -------------------------------------------------------------------------
  // Actions

  const B = () => window.bookmarksBar;
  const flagged = (n) => !!B().incognitoSource(n.id);

  // where: 'tabs' (background tabs here), 'window' or 'incognito'.
  // Bookmarks set to always open in incognito go to an incognito window
  // whatever is chosen.
  async function openAll(nodes, where = 'tabs') {
    if (!nodes.length) return;
    if (nodes.length > OPEN_ALL_CONFIRM && !confirm(`Open ${nodes.length} tabs?`)) return;
    const incognito = where === 'incognito' ? nodes : nodes.filter(flagged);
    const normal = where === 'incognito' ? [] : nodes.filter((n) => !flagged(n));
    if (incognito.length) await B().openWindow(incognito.map((n) => n.url), { incognito: true });
    if (!normal.length) return;
    if (where === 'window') await B().openWindow(normal.map((n) => n.url));
    else for (const n of normal) await chrome.tabs.create({ url: n.url, active: false });
  }

  async function openHere(node) {
    if (flagged(node)) return openAll([node], 'incognito');
    await openUrl(node.url);
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
    const count = linksIn(node).length;
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
    // Keep its "always open in incognito" setting.
    if (B().incognitoSource(node.id) === node.id) await B().toggleIncognito(created.id);
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

  // "Always open in incognito", checked when set here or on a parent
  // folder (then it can only be changed on that folder).
  function incognitoItem(node) {
    const source = B().incognitoSource(node.id);
    const inherited = source && source !== node.id;
    return {
      text: 'Always open in incognito',
      checked: !!source,
      disabled: inherited,
      title: inherited ? `Set on the folder “${B().nodeTitle(source)}”` : '',
      run: () => B().toggleIncognito(node.id),
    };
  }

  function itemsFor(node, parentForAdd) {
    const sep = '-';
    const openable = node && isOpenable(node.url);
    const items = [];

    if (node?.url) {
      items.push(
        ['Open', () => openHere(node), !openable],
        ['Open in new tab', () => openAll([node]), !openable],
        ['Open in new window', () => openAll([node], 'window'), !openable],
        ['Open in incognito window', () => openAll([node], 'incognito'), !openable],
        incognitoItem(node),
        sep,
        ['Edit…', () => edit(node), isLocked(node)],
        ['Copy link', () => navigator.clipboard.writeText(node.url)],
        ['Add to shortcuts', () => addToShortcuts(node), !openable],
        ['Delete', () => remove(node), isLocked(node)],
        sep
      );
    } else if (node) {
      const n = linksIn(node).length;
      items.push(
        [`Open all (${n}) in tabs`, async () => openAll(linksIn(await fresh(node))), !n],
        [`Open all (${n}) in new window`, async () => openAll(linksIn(await fresh(node)), 'window'), !n],
        [`Open all (${n}) in incognito window`, async () => openAll(linksIn(await fresh(node)), 'incognito'), !n],
        incognitoItem(node),
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
        const { text, run, disabled, checked, title } = Array.isArray(it)
          ? { text: it[0], run: it[1], disabled: it[2] }
          : it;
        li.setAttribute('role', 'none');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bm-ctx-item';
        const check = document.createElement('span');
        check.className = 'bm-check';
        check.setAttribute('aria-hidden', 'true');
        if (checked !== undefined) {
          btn.setAttribute('role', 'menuitemcheckbox');
          btn.setAttribute('aria-checked', String(checked));
          check.textContent = checked ? '✓' : '';
        } else {
          btn.setAttribute('role', 'menuitem');
        }
        btn.append(check, text);
        btn.disabled = !!disabled;
        if (title) btn.title = title;
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

  // Middle-click a folder (on the bar or in a dropdown): open all of it,
  // in tabs or, for bookmarks set that way, in an incognito window.
  const folderAt = (e) => {
    const el = e.target.closest('button.bm-item, button.bm-menu-item');
    const node = el?.bmNode;
    return node && !node.kind && !node.url ? node : null;
  };
  document.addEventListener('mousedown', (e) => {
    if (e.button === 1 && folderAt(e)) e.preventDefault(); // no autoscroll
  });
  document.addEventListener('auxclick', async (e) => {
    const node = e.button === 1 && folderAt(e);
    if (!node) return;
    e.preventDefault();
    B().closeMenus();
    try {
      await openAll(linksIn(await fresh(node)));
    } catch (err) {
      alert(err.message);
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
