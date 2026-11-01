// Static New Tab — bookmarks bar.
// A bar at the top of the page like the browser's own: bookmarks-bar items
// in a row, folders open dropdown menus with cascading submenus, items that
// don't fit go behind a » button, and "Other bookmarks" sits at the right.

(() => {
  const SHOW_KEY = 'showBookmarks';

  const bar = document.getElementById('bookmarks');
  const itemsEl = bar.querySelector('.bm-items');
  const overflowBtn = bar.querySelector('.bm-overflow');
  const rightEl = bar.querySelector('.bm-right');
  const toggle = document.getElementById('toggle-bookmarks');

  let show = true;
  let barNodes = [];      // bookmarks-bar children, in order
  let hiddenNodes = [];   // the ones pushed into the » menu
  let barRootId = null;

  // Bookmarks/folders set to always open in incognito (a folder covers
  // everything inside it). nodeById lets us walk up to parent folders.
  const INCOGNITO_KEY = 'incognitoIds';
  let incognitoIds = new Set();
  let nodeById = new Map();

  // -------------------------------------------------------------------------
  // Helpers

  const isBookmarklet = (url) => /^javascript:/i.test(url);
  const visible = (nodes) => (nodes || []).filter((n) => !n.url || !isBookmarklet(n.url));
  // Menus can also hold non-bookmark entries (see history.js):
  //   kind 'link' (a URL), 'action' (runs node.run()), 'header', 'note',
  //   'separator'. Bookmark nodes have no kind.
  const isFolder = (n) => !n.url && !n.kind;

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '') || url;
    } catch {
      return url;
    }
  }

  function icon(node) {
    if (node.icon) {
      const span = document.createElement('span');
      span.className = `bm-icon bm-mask-icon bm-icon-${node.icon}`;
      return span;
    }
    if (node.url) {
      const img = document.createElement('img');
      img.className = 'bm-icon';
      img.alt = '';
      Favicons.set(img, node.url);
      return img;
    }
    const span = document.createElement('span');
    span.className = 'bm-icon bm-mask-icon bm-icon-folder';
    return span;
  }

  // The id this node's incognito setting comes from (itself or a parent
  // folder), or null.
  function incognitoSource(id) {
    for (let n = id; n; n = nodeById.get(n)?.parentId) {
      if (incognitoIds.has(n)) return n;
    }
    return null;
  }

  async function toggleIncognito(id) {
    // Read the stored list (not our copy) so quick successive changes,
    // e.g. undoing a deleted folder, don't overwrite each other.
    const ids = new Set((await chrome.storage.local.get(INCOGNITO_KEY))[INCOGNITO_KEY] || []);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    incognitoIds = ids;
    await chrome.storage.local.set({ [INCOGNITO_KEY]: [...ids] });
  }

  // Open new windows over the current one: same size and position, or
  // maximized / fullscreen like it. (Incognito windows otherwise open at a
  // small default size.)
  async function currentBounds() {
    try {
      const win = await chrome.windows.getCurrent();
      if (win.state === 'maximized' || win.state === 'fullscreen') return { state: win.state };
      return { left: win.left, top: win.top, width: win.width, height: win.height };
    } catch {
      return {};
    }
  }

  async function openWindow(urls, { incognito = false } = {}) {
    if (!urls.length) return;
    const options = { url: urls, incognito };
    try {
      // Bounds can be refused (e.g. the window is mostly off-screen):
      // then open with the browser's default size.
      await chrome.windows.create({ ...options, ...(await currentBounds()) })
        .catch(() => chrome.windows.create(options));
    } catch (err) {
      throw new Error(incognito ? `Couldn't open an incognito window (${err.message}).` : err.message);
    }
  }

  function label(text) {
    const span = document.createElement('span');
    span.className = 'bm-title';
    span.textContent = text;
    return span;
  }

  // A link or folder element; `cls` is bm-item (bar) or bm-menu-item (menu).
  function entry(node, cls, inBar) {
    let el;
    if (node.kind === 'action') {
      el = document.createElement('button');
      el.type = 'button';
      el.title = node.tooltip || node.title || '';
    } else if (node.url) {
      el = document.createElement('a');
      el.href = node.url;
      el.title = node.title ? `${node.title}\n${node.url}` : node.url;
    } else {
      el = document.createElement('button');
      el.type = 'button';
      el.setAttribute('aria-haspopup', 'menu');
      el.setAttribute('aria-expanded', 'false');
      el.title = node.title || '';
    }
    el.className = cls;
    el.setAttribute('role', 'menuitem');
    el.bmNode = node;
    el.append(icon(node));
    // Like the browser's bar, an untitled bookmark shows only its icon.
    const text = node.title || (inBar ? '' : node.url ? hostOf(node.url) : 'Untitled folder');
    if (text) el.append(label(text));
    if (!node.kind && incognitoSource(node.id)) {
      const mark = document.createElement('span');
      mark.className = 'bm-incognito-mark';
      mark.title = 'Opens in incognito';
      el.append(mark);
      el.title = `${el.title}\n(opens in incognito)`.trim();
    }
    if (node.meta) {
      const meta = document.createElement('span');
      meta.className = 'bm-meta';
      meta.textContent = node.meta;
      el.append(meta);
    }
    return el;
  }

  // -------------------------------------------------------------------------
  // Menus

  const menus = []; // open menus, menus[0] hangs off the bar
  let hoverTimer = 0;

  function closeMenus(fromLevel = 0) {
    clearTimeout(hoverTimer);
    while (menus.length > fromLevel) {
      const m = menus.pop();
      m.opener?.setAttribute('aria-expanded', 'false');
      m.remove();
    }
  }

  function openMenu(opener, nodes, level, { focus = false } = {}) {
    closeMenus(level);
    const menu = document.createElement('ul');
    menu.className = 'bm-menu';
    menu.setAttribute('role', 'menu');
    menu.opener = opener;
    menu.level = level;

    const shown = visible(nodes);
    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'bm-empty';
      li.textContent = '(empty)';
      li.bmParent = opener.bmNode; // right-click here adds into this folder
      menu.append(li);
    }
    for (const node of shown) {
      const li = document.createElement('li');
      if (node.kind === 'separator') {
        li.className = 'bm-sep';
        li.setAttribute('role', 'separator');
      } else if (node.kind === 'header' || node.kind === 'note') {
        li.className = node.kind === 'header' ? 'bm-header' : 'bm-empty';
        li.setAttribute('role', 'presentation');
        li.textContent = node.title;
      } else {
        li.setAttribute('role', 'none');
        li.append(entry(node, 'bm-menu-item', false));
      }
      menu.append(li);
    }

    document.body.append(menu);
    menus.push(menu);
    opener.setAttribute('aria-expanded', 'true');
    position(menu, opener.getBoundingClientRect(), level);
    if (focus) menu.querySelector('.bm-menu-item')?.focus();
    return menu;
  }

  function position(menu, anchor, level) {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const pad = 8;
    menu.style.maxHeight = `${vh - 2 * pad}px`;
    const { width, height } = menu.getBoundingClientRect();

    let left, top;
    if (level === 0) {
      left = menu.opener.classList.contains('bm-align-end') ? anchor.right - width : anchor.left;
      top = anchor.bottom + 2;
      if (top + height > vh - pad) menu.style.maxHeight = `${vh - top - pad}px`;
    } else {
      left = anchor.right - 2;
      if (left + width > vw - pad) left = anchor.left - width + 2; // flip to the left
      top = anchor.top - 7;
      if (top + height > vh - pad) top = vh - pad - height;
    }
    menu.style.left = `${Math.max(pad, Math.min(left, vw - width - pad))}px`;
    menu.style.top = `${Math.max(pad, top)}px`;
  }

  function menuOf(el) {
    return el.closest('.bm-menu');
  }

  let hoverOpenedAt = 0;

  // While the right-click menu is up, leave the dropdowns as they are.
  const contextOpen = () => !!document.querySelector('.bm-context');

  // What a bar button's menu shows: the » overflow, a menu that loads its
  // entries on demand (bmLoad, e.g. History), or a bookmark folder.
  async function nodesFor(btn) {
    if (btn === overflowBtn) return hiddenNodes;
    if (btn.bmLoad) return btn.bmLoad();
    return btn.bmNode.children;
  }

  async function openFromBar(btn, opts) {
    const nodes = await nodesFor(btn);
    return openMenu(btn, nodes, 0, opts);
  }

  function toggleFromBar(btn, focus) {
    // A click right after hovering opened this menu is part of the same
    // gesture: keep it open instead of toggling it shut.
    if (menus[0]?.opener === btn && Date.now() - hoverOpenedAt < 500) return;
    if (menus[0]?.opener === btn) closeMenus();
    else openFromBar(btn, { focus });
  }

  // Bar: click a folder (or ») to open/close its menu; while a menu is open,
  // hovering another folder switches to it, as in a menu bar.
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button.bm-item');
    if (btn) toggleFromBar(btn, e.detail === 0); // detail 0 = keyboard
  });

  bar.addEventListener('mouseover', (e) => {
    const btn = e.target.closest('button.bm-item');
    if (contextOpen()) return;
    if (btn && menus.length && menus[0].opener !== btn) {
      hoverOpenedAt = Date.now();
      openFromBar(btn);
    }
  });

  // Menus: hovering a folder opens its submenu after a short delay;
  // hovering anything else closes deeper submenus.
  document.addEventListener('mouseover', (e) => {
    const item = e.target.closest('.bm-menu-item');
    if (!item || contextOpen()) return;
    const level = menuOf(item).level;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (!isFolder(item.bmNode)) closeMenus(level + 1);
      else if (menus[level + 1]?.opener !== item) openMenu(item, item.bmNode.children, level + 1);
    }, 150);
  });

  document.addEventListener('click', (e) => {
    const item = e.target.closest('.bm-menu-item');
    if (item?.bmNode.kind === 'action') {
      closeMenus();
      Promise.resolve(item.bmNode.run(e)).catch(console.error);
      return;
    }
    if (item && isFolder(item.bmNode)) {
      openMenu(item, item.bmNode.children, menuOf(item).level + 1, { focus: e.detail === 0 });
      return;
    }
    if (!item && !e.target.closest('.bm-bar, .bm-opener')) closeMenus();
  });

  // Open links. Web links navigate normally (or open in a new tab with
  // Ctrl/Cmd/middle click); browser pages and files go through the tabs API.
  async function openLink(e) {
    const a = e.target.closest('a.bm-item, a.bm-menu-item');
    if (!a) return;
    const background = e.ctrlKey || e.metaKey || e.button === 1;
    if (a.bmNode && !a.bmNode.kind && incognitoSource(a.bmNode.id)) {
      e.preventDefault();
      closeMenus();
      openWindow([a.href], { incognito: true }).catch((err) => alert(err.message));
      return;
    }
    // Always through a new tab: see openUrl() in newtab.js.
    e.preventDefault();
    closeMenus();
    openUrl(a.href, { background: background && !e.shiftKey });
  }
  document.addEventListener('click', openLink);
  document.addEventListener('auxclick', (e) => e.button === 1 && openLink(e));

  // Keyboard navigation.
  document.addEventListener('keydown', (e) => {
    const t = document.activeElement;

    if (t?.classList.contains('bm-item') && t.tagName === 'BUTTON' && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      if (menus[0]?.opener !== t) openFromBar(t, { focus: true });
      else menus[0].querySelector('.bm-menu-item')?.focus();
      return;
    }

    if (!menus.length) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const opener = menus[0].opener;
      closeMenus();
      opener.focus();
      return;
    }

    const menu = t && menuOf(t);
    if (!menu) return;
    const items = [...menu.querySelectorAll(':scope > li > .bm-menu-item')];
    const i = items.indexOf(t);

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
      next?.focus();
      closeMenus(menu.level + 1);
    } else if (e.key === 'ArrowRight' && isFolder(t.bmNode)) {
      e.preventDefault();
      openMenu(t, t.bmNode.children, menu.level + 1, { focus: true });
    } else if (e.key === 'ArrowLeft' && menu.level > 0) {
      e.preventDefault();
      const opener = menu.opener;
      closeMenus(menu.level);
      opener.focus();
    }
  }, true);

  window.addEventListener('resize', () => closeMenus());
  window.addEventListener('blur', () => closeMenus());
  window.addEventListener('pageshow', () => closeMenus());
  document.addEventListener('visibilitychange', () => closeMenus());

  // -------------------------------------------------------------------------
  // Bar rendering

  // Hide the items that don't fit and list them in the » menu.
  function fit() {
    const items = [...itemsEl.children];
    items.forEach((el) => (el.hidden = false));
    overflowBtn.hidden = true;

    const overflows = () => itemsEl.scrollWidth > itemsEl.clientWidth + 1;
    if (!overflows()) {
      hiddenNodes = [];
      return;
    }
    overflowBtn.hidden = false;
    const limit = itemsEl.getBoundingClientRect().right;
    let cut = items.findIndex((el) => el.getBoundingClientRect().right > limit);
    if (cut < 0) cut = items.length;
    items.slice(cut).forEach((el) => (el.hidden = true));
    hiddenNodes = barNodes.slice(cut);
  }

  new ResizeObserver(() => show && fit()).observe(bar);

  function rootsOf(tree) {
    const byType = { 'bookmarks-bar': [], other: [], mobile: [], managed: [] };
    const fallback = ['bookmarks-bar', 'other', 'mobile'];
    (tree.children || []).forEach((root, i) => {
      const type = root.folderType || fallback[i] || 'other';
      (byType[type] ||= []).push(root);
    });
    return byType;
  }

  async function render() {
    toggle.textContent = show ? 'Hide bookmarks' : 'Show bookmarks';
    closeMenus();

    const [tree] = await chrome.bookmarks.getTree();
    nodeById = new Map();
    const index = (n) => {
      nodeById.set(n.id, n);
      (n.children || []).forEach(index);
    };
    index(tree);

    if (!show) {
      bar.hidden = true;
      return;
    }

    const roots = rootsOf(tree);
    barRootId = roots['bookmarks-bar'][0]?.id;

    barNodes = visible(roots['bookmarks-bar'].flatMap((r) => r.children || []));
    itemsEl.replaceChildren(...barNodes.map((n) => entry(n, 'bm-item', true)));

    // Right side: Other / Mobile / Managed bookmarks, when not empty.
    const right = [...roots.managed, ...roots.other, ...roots.mobile]
      .filter((r) => visible(r.children).length)
      .map((r) => entry(r, 'bm-item', true));
    rightEl.replaceChildren(...right);

    bar.hidden = !barNodes.length && !right.length;
    if (!bar.hidden) fit();
  }

  // Used by bookmarks-edit.js (right-click menu).
  // toggleMenu also opens menus for buttons outside the bar (.bm-opener,
  // e.g. History next to the address bar).
  window.bookmarksBar = {
    closeMenus,
    barRootId: () => barRootId,
    toggleMenu: toggleFromBar,
    openWindow,
    incognitoSource,
    toggleIncognito,
    nodeTitle: (id) => nodeById.get(id)?.title || '',
  };

  let pending = 0;
  function scheduleRender() {
    clearTimeout(pending);
    pending = setTimeout(() => render().catch(console.error), 50);
  }

  toggle.addEventListener('click', () => {
    chrome.storage.local.set({ [SHOW_KEY]: !show });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[SHOW_KEY]) show = changes[SHOW_KEY].newValue !== false;
    if (changes[INCOGNITO_KEY]) incognitoIds = new Set(changes[INCOGNITO_KEY].newValue || []);
    if (changes[SHOW_KEY] || changes[INCOGNITO_KEY]) scheduleRender();
  });

  for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded']) {
    chrome.bookmarks[ev]?.addListener(scheduleRender);
  }

  chrome.storage.local.get([SHOW_KEY, INCOGNITO_KEY]).then((data) => {
    show = data[SHOW_KEY] !== false;
    incognitoIds = new Set(data[INCOGNITO_KEY] || []);
    render().catch(console.error);
  });
})();
