// Static New Tab — bookmarks section.
// One card per folder on the bookmarks bar (plus one for its loose
// bookmarks), then the same for "Other bookmarks" and "Mobile bookmarks".
// Nested folders collapse inside their card; their open state is remembered.

(() => {
  const SHOW_KEY = 'showBookmarks';
  const OPEN_KEY = 'bookmarks-open';

  const section = document.getElementById('bookmarks');
  const main = section.closest('main');
  const toggle = document.getElementById('toggle-bookmarks');

  let show = true;
  let openIds = readOpen();

  function readOpen() {
    try {
      return new Set(JSON.parse(localStorage.getItem(OPEN_KEY)) || []);
    } catch {
      return new Set();
    }
  }

  function writeOpen() {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...openIds]));
    } catch {}
  }

  // Links a page can't open by itself (browser pages, files) are opened
  // through the tabs API instead; bookmarklets can't run here and are skipped.
  const isWeb = (url) => /^https?:/i.test(url);
  const isBookmarklet = (url) => /^javascript:/i.test(url);

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '') || url;
    } catch {
      return url;
    }
  }

  function countLinks(node) {
    return (node.children || []).reduce(
      (n, c) => n + (c.url ? (isBookmarklet(c.url) ? 0 : 1) : countLinks(c)),
      0
    );
  }

  function linkItem(node) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'bm-link';
    a.href = node.url;
    a.title = `${node.title || node.url}\n${node.url}`;
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = faviconUrl(node.url);
    const title = document.createElement('span');
    title.className = 'bm-title';
    title.textContent = node.title || hostOf(node.url);
    a.append(img, title);
    li.append(a);
    return li;
  }

  function folderItem(node) {
    const li = document.createElement('li');
    const details = document.createElement('details');
    details.dataset.id = node.id;
    details.open = openIds.has(node.id);
    const summary = document.createElement('summary');
    const title = document.createElement('span');
    title.className = 'bm-title';
    title.textContent = node.title || 'Untitled folder';
    const count = document.createElement('span');
    count.className = 'bm-count';
    count.textContent = countLinks(node);
    summary.append(title, count);
    details.append(summary, list(node.children));
    li.append(details);
    return li;
  }

  function list(children) {
    const ul = document.createElement('ul');
    for (const c of children || []) {
      if (c.url) {
        if (!isBookmarklet(c.url)) ul.append(linkItem(c));
      } else if (countLinks(c)) {
        ul.append(folderItem(c));
      }
    }
    return ul;
  }

  function card(title, children) {
    const ul = list(children);
    if (!ul.childElementCount) return null;
    const article = document.createElement('article');
    article.className = 'bm-card';
    const h = document.createElement('h2');
    h.textContent = title;
    article.append(h, ul);
    return article;
  }

  function rootRank(node, i) {
    const order = { 'bookmarks-bar': 0, other: 1, mobile: 2, managed: 3 };
    return node.folderType in order ? order[node.folderType] : i;
  }

  async function render() {
    toggle.textContent = show ? 'Hide bookmarks' : 'Show bookmarks';
    if (!show) {
      section.hidden = true;
      section.replaceChildren();
      main.classList.remove('with-bookmarks');
      return;
    }

    const [tree] = await chrome.bookmarks.getTree();
    const roots = (tree.children || [])
      .map((node, i) => ({ node, rank: rootRank(node, i) }))
      .sort((a, b) => a.rank - b.rank)
      .map((r) => r.node);

    const cards = [];
    for (const root of roots) {
      const loose = root.children.filter((c) => c.url);
      cards.push(card(root.title, loose));
      for (const folder of root.children.filter((c) => !c.url)) {
        cards.push(card(folder.title || 'Untitled folder', folder.children));
      }
    }

    const shown = cards.filter(Boolean);
    section.replaceChildren(...shown);
    section.hidden = !shown.length;
    main.classList.toggle('with-bookmarks', shown.length > 0);
  }

  let pending = 0;
  function scheduleRender() {
    clearTimeout(pending);
    pending = setTimeout(() => render().catch(console.error), 50);
  }

  // Remember which folders are open.
  section.addEventListener('toggle', (e) => {
    const id = e.target.dataset?.id;
    if (!id) return;
    if (e.target.open) openIds.add(id);
    else openIds.delete(id);
    writeOpen();
  }, true);

  // Open non-web bookmarks (chrome://, file://…) through the tabs API.
  section.addEventListener('click', async (e) => {
    const a = e.target.closest('a.bm-link');
    if (!a || isWeb(a.href)) return;
    e.preventDefault();
    const url = a.href;
    if (e.ctrlKey || e.metaKey || e.button === 1) {
      chrome.tabs.create({ url, active: e.shiftKey });
    } else {
      const tab = await chrome.tabs.getCurrent();
      chrome.tabs.update(tab.id, { url });
    }
  });
  section.addEventListener('auxclick', (e) => {
    const a = e.target.closest('a.bm-link');
    if (!a || isWeb(a.href) || e.button !== 1) return;
    e.preventDefault();
    chrome.tabs.create({ url: a.href, active: false });
  });

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
