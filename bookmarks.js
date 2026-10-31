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

  // -------------------------------------------------------------------------
  // Helpers

  const isWeb = (url) => /^https?:/i.test(url);
  const isBookmarklet = (url) => /^javascript:/i.test(url);
  const visible = (nodes) => (nodes || []).filter((n) => !n.url || !isBookmarklet(n.url));

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '') || url;
    } catch {
      return url;
    }
  }

  function icon(node) {
    if (node.url) {
      const img = document.createElement('img');
      img.className = 'bm-icon';
      img.alt = '';
      img.src = faviconUrl(node.url);
      return img;
    }
    const span = document.createElement('span');
    span.className = 'bm-icon bm-folder-icon';
    return span;
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
    if (node.url) {
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
      menu.append(li);
    }
    for (const node of shown) {
      const li = document.createElement('li');
      li.setAttribute('role', 'none');
      li.append(entry(node, 'bm-menu-item', false));
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
      left = anchor.left;
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

  function toggleFromBar(btn, focus) {
    // A click right after hovering opened this menu is part of the same
    // gesture: keep it open instead of toggling it shut.
    if (menus[0]?.opener === btn && Date.now() - hoverOpenedAt < 500) return;
    if (menus[0]?.opener === btn) closeMenus();
    else openMenu(btn, btn === overflowBtn ? hiddenNodes : btn.bmNode.children, 0, { focus });
  }

  // Bar: click a folder (or ») to open/close its menu; while a menu is open,
  // hovering another folder switches to it, as in a menu bar.
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button.bm-item');
    if (btn) toggleFromBar(btn, e.detail === 0); // detail 0 = keyboard
  });

  bar.addEventListener('mouseover', (e) => {
    const btn = e.target.closest('button.bm-item');
    if (btn && menus.length && menus[0].opener !== btn) {
      openMenu(btn, btn === overflowBtn ? hiddenNodes : btn.bmNode.children, 0);
      hoverOpenedAt = Date.now();
    }
  });

  // Menus: hovering a folder opens its submenu after a short delay;
  // hovering anything else closes deeper submenus.
  document.addEventListener('mouseover', (e) => {
    const item = e.target.closest('.bm-menu-item');
    if (!item) return;
    const level = menuOf(item).level;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (item.bmNode.url) closeMenus(level + 1);
      else if (menus[level + 1]?.opener !== item) openMenu(item, item.bmNode.children, level + 1);
    }, 150);
  });

  document.addEventListener('click', (e) => {
    const item = e.target.closest('.bm-menu-item');
    if (item && !item.bmNode.url) {
      openMenu(item, item.bmNode.children, menuOf(item).level + 1, { focus: e.detail === 0 });
      return;
    }
    if (!item && !e.target.closest('.bm-bar')) closeMenus();
  });

  // Open links. Web links navigate normally (or open in a new tab with
  // Ctrl/Cmd/middle click); browser pages and files go through the tabs API.
  async function openLink(e) {
    const a = e.target.closest('a.bm-item, a.bm-menu-item');
    if (!a) return;
    const background = e.ctrlKey || e.metaKey || e.button === 1;
    if (isWeb(a.href)) {
      if (background) closeMenus();
      return;
    }
    e.preventDefault();
    closeMenus();
    if (background) chrome.tabs.create({ url: a.href, active: e.shiftKey });
    else chrome.tabs.update((await chrome.tabs.getCurrent()).id, { url: a.href });
  }
  document.addEventListener('click', openLink);
  document.addEventListener('auxclick', (e) => e.button === 1 && openLink(e));

  // Keyboard navigation.
  document.addEventListener('keydown', (e) => {
    const t = document.activeElement;

    if (t?.classList.contains('bm-item') && t.tagName === 'BUTTON' && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      if (menus[0]?.opener !== t) openMenu(t, t === overflowBtn ? hiddenNodes : t.bmNode.children, 0, { focus: true });
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
    } else if (e.key === 'ArrowRight' && !t.bmNode.url) {
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
    if (!show) {
      bar.hidden = true;
      return;
    }

    const [tree] = await chrome.bookmarks.getTree();
    const roots = rootsOf(tree);

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

  let pending = 0;
  function scheduleRender() {
    clearTimeout(pending);
    pending = setTimeout(() => render().catch(console.error), 50);
  }

  toggle.addEventListener('click', () => {
    chrome.storage.local.set({ [SHOW_KEY]: !show });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SHOW_KEY]) return;
    show = changes[SHOW_KEY].newValue !== false;
    scheduleRender();
  });

  for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded']) {
    chrome.bookmarks[ev]?.addListener(scheduleRender);
  }

  chrome.storage.local.get(SHOW_KEY).then((data) => {
    show = data[SHOW_KEY] !== false;
    render().catch(console.error);
  });
})();
