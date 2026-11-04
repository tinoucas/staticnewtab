// Static New Tab — address bar.
//
// - Domains complete inline first: "gma" → "gma|il.com" (the completion is
//   selected, so typing on replaces it). Domains are ranked from your
//   history (typed visits count most), bookmarks and shortcuts.
// - Below, suggestions: what Enter does, a web search, matching bookmarks
//   and history pages. ↑/↓ or the mouse pick one.
// - × on a history suggestion deletes that page from the browser history;
//   × on a domain suggestion just stops suggesting that domain here.
// - The field takes the keyboard focus whenever this tab gets focus.
// - Tab after a domain ("amazon.fr", typed or completed) searches that site:
//   the domain becomes a chip, what follows is searched there, Backspace at
//   the start removes the chip. How each site is searched: site-search.js.

(() => {
  const input = document.getElementById('ob-input');
  const form = document.getElementById('ob-form');
  const list = document.getElementById('ob-list');
  const box = document.getElementById('omnibox');

  const HIDDEN_KEY = 'omniboxHiddenHosts';
  const ENGINE_KEY = 'searchEngine'; // { name, url with %s } — url '' = browser default

  // Searches open the engine's URL in a new tab, like a typed URL: fast.
  // The browser's own engine is only reachable through chrome.search.query,
  // which can be slow (seconds in Helium), so it's an option, not the default.
  const ENGINES = [
    { name: 'Google', url: 'https://www.google.com/search?q=%s' },
    { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
    { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
    { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
    { name: 'Startpage', url: 'https://www.startpage.com/sp/search?query=%s' },
    { name: 'Kagi', url: 'https://kagi.com/search?q=%s' },
    { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
    { name: 'Qwant', url: 'https://www.qwant.com/?q=%s' },
    { name: 'Browser default', url: '' },
  ];
  let engine = ENGINES[0];

  function searchUrl(text) {
    return engine.url.replace(/%s/g, encodeURIComponent(text).replace(/%20/g, '+'));
  }
  const MAX_HISTORY = 6;
  const MAX_BOOKMARKS = 3;
  const DAY = 24 * 3600 * 1000;

  const chip = document.getElementById('ob-chip');
  let site = null;        // search mode: { host, info: { name, template } | null, pending }

  let typed = '';         // what the user typed (without the inline completion)
  let inlineHost = null;  // { host, entry } completing the typed text
  let rows = [];
  let selected = 0;
  let seq = 0;
  let tabId = null;

  let hosts = new Map();  // "gmail.com" -> { score, https, http, real }
  // Listed site searches on a subdomain of a site you visit but never typed
  // as such (maps.google.com when you use google.com): offered only when
  // nothing in `hosts` matches.
  let weakHosts = new Map();
  let hostsAt = 0;
  let hiddenHosts = new Set();

  chrome.tabs.getCurrent().then((t) => (tabId = t?.id));

  // -------------------------------------------------------------------------
  // Helpers

  const stripScheme = (s) => s.replace(/^[a-z][a-z0-9+.-]*:\/\/(www\.)?/i, '');
  const display = (url) => stripScheme(url).replace(/\/$/, '');
  const sameUrl = (a, b) => a.replace(/\/$/, '') === b.replace(/\/$/, '');

  // Turn typed text into a URL, or null if it should be a search.
  function toUrl(text) {
    const t = text.trim();
    if (!t || /\s/.test(t)) return null;
    if (/^(https?|file|ftp|chrome|chrome-extension|about|view-source):/i.test(t)) return t;
    if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?([/?#].*)?$/i.test(t)) return `http://${t}`;
    if (/^[^\s/?#:@]+\.(?:[a-z]{2,}|xn--[a-z0-9-]+)\.?(:\d+)?([/?#].*)?$/i.test(t)) return `https://${t}`;
    return null;
  }

  function hostUrl(entry) {
    return `${entry.https >= entry.http ? 'https' : 'http'}://${entry.real}/`;
  }

  // -------------------------------------------------------------------------
  // Domain index for inline completion

  async function buildIndex() {
    const map = new Map();
    // Visits by first path segment: "google.com|maps" for google.com/maps/…
    const bySection = new Map();
    const add = (url, weight) => {
      let u;
      try {
        u = new URL(url);
      } catch {
        return;
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
      const host = u.hostname.replace(/^www\./, '');
      if (!host) return;
      const section = u.pathname.split('/')[1]?.toLowerCase();
      if (section) bySection.set(`${host}|${section}`, (bySection.get(`${host}|${section}`) || 0) + weight);
      const e = map.get(host) || { score: 0, https: 0, http: 0, real: u.hostname };
      e.score += weight;
      e[u.protocol === 'https:' ? 'https' : 'http'] += 1;
      if (u.pathname === '/' && !u.search) e.real = u.hostname; // prefer how the root was reached
      map.set(host, e);
    };

    const [history, tree, stored] = await Promise.all([
      chrome.history.search({ text: '', startTime: Date.now() - 365 * DAY, maxResults: 10000 }),
      chrome.bookmarks.getTree().catch(() => []),
      chrome.storage.local.get(['shortcuts', HIDDEN_KEY]),
      SiteSearch.preload(),
    ]);
    for (const h of history) add(h.url, (h.visitCount || 1) + 10 * (h.typedCount || 0));
    const walk = (n) => (n.url ? add(n.url, 20) : (n.children || []).forEach(walk));
    tree.forEach(walk);
    for (const s of stored.shortcuts || []) add(s.url, 50);

    // Sites with a listed search on a subdomain (maps.google.com) are often
    // visited as a path (google.com/maps): count those visits for the
    // subdomain, so "maps" completes to maps.google.com and Tab searches it.
    // Otherwise, a subdomain of a site you visit is a weak candidate.
    const weak = new Map();
    for (const domain of SiteSearch.domains()) {
      if (map.has(domain)) continue;
      const dot = domain.indexOf('.');
      const label = domain.slice(0, dot);
      const parent = domain.slice(dot + 1);
      if (!parent.includes('.')) continue; // not a subdomain
      const viaPath = bySection.get(`${parent}|${label}`);
      const entry = { score: viaPath || map.get(parent)?.score || 0, https: 1, http: 0, real: domain };
      if (viaPath) map.set(domain, entry);
      else if (entry.score) weak.set(domain, entry);
    }

    hosts = map;
    weakHosts = weak;
    hiddenHosts = new Set(stored[HIDDEN_KEY] || []);
    hostsAt = Date.now();
  }

  function refreshIndexIfStale() {
    if (Date.now() - hostsAt > 60 * 1000) buildIndex().catch(console.error);
  }

  function matchHost(text) {
    const t = stripScheme(text.toLowerCase());
    if (!t || /[\s/?#]/.test(t)) return null;
    const best = (pool) => {
      let found = null;
      for (const [host, entry] of pool) {
        if (!host.startsWith(t) || hiddenHosts.has(host)) continue;
        if (!found || entry.score > found.entry.score ||
            (entry.score === found.entry.score && host.length < found.host.length)) {
          found = { host, entry };
        }
      }
      return found;
    };
    const found = best(hosts) || best(weakHosts);
    return found && { ...found, typedLen: t.length };
  }

  // -------------------------------------------------------------------------
  // Site search mode ("Tab to search")

  // The bare domain the field holds, if any (completed or typed in full).
  function hostOfText() {
    if (inlineHost) return inlineHost.host;
    const t = stripScheme(input.value.trim()).replace(/\/$/, '');
    return /^([a-z0-9-]+\.)+([a-z]{2,}|xn--[a-z0-9-]+)\.?$/i.test(t) ? t.toLowerCase() : null;
  }

  const siteLabel = () => site.info?.name || site.host;

  function enterSite(host) {
    const h = SiteSearch.norm(host);
    site = { host: h, info: SiteSearch.known(h), pending: null };
    site.pending = SiteSearch.find(h).then((info) => {
      if (site?.host === h) {
        site.info = info;
        showChip();
        render();
      }
      return info;
    });
    inlineHost = null;
    input.value = typed = '';
    showChip();
    close();
  }

  function exitSite() {
    site = null;
    chip.hidden = true;
    setPlaceholder();
  }

  function showChip() {
    if (!site) return;
    chip.hidden = false;
    chip.querySelector('.ob-chip-text').textContent = site.host;
    chip.title = site.info ? `Searching ${siteLabel()}` : `Searching ${site.host} with ${engine.url ? engine.name : 'your search engine'}`;
    const img = chip.querySelector('img');
    if (img.dataset.host !== site.host) {
      img.dataset.host = site.host;
      Favicons.set(img, `https://${site.host}/`);
    }
    input.placeholder = site.info ? `Search ${siteLabel()}` : `Search ${site.host}`;
  }

  // The URL for a search on the site (or its home page for an empty query).
  async function siteSearchUrl(text) {
    if (!text) return { url: `https://${site.host}/` };
    const info = site.info || (await Promise.race([site.pending, new Promise((r) => setTimeout(() => r(null), 2500))]));
    if (info) return { url: SiteSearch.urlFor(info.template, text) };
    // No known search for this site: the chosen engine, limited to the site.
    const q = `site:${site.host} ${text}`;
    return engine.url ? { url: searchUrl(q) } : { query: q };
  }

  async function suggestSite() {
    const my = ++seq;
    const text = typed.trim();
    if (!text) return;
    const history = await chrome.history.search({ text, startTime: 0, maxResults: 100 }).catch(() => []);
    if (my !== seq || !site) return;
    const onSite = (url) => {
      try {
        const h = new URL(url).hostname.replace(/^www\./, '');
        return h === site.host || h.endsWith(`.${site.host}`);
      } catch {
        return false;
      }
    };
    const q = text.toLowerCase();
    rows = [{ type: 'site', text }, ...history
      .filter((h) => onSite(h.url))
      .sort((a, b) => score(b, q) - score(a, q))
      .slice(0, MAX_HISTORY)
      .map((h) => ({ type: 'history', url: h.url, main: h.title || display(h.url), sub: h.title ? display(h.url) : '' }))];
    selected = Math.min(selected, rows.length - 1);
    render();
  }

  // -------------------------------------------------------------------------
  // Suggestions

  function defaultRow() {
    if (inlineHost) {
      return { type: 'nav', url: hostUrl(inlineHost.entry), main: inlineHost.host, host: inlineHost.host };
    }
    const url = toUrl(typed);
    if (url) return { type: 'nav', url, main: display(url) };
    return { type: 'search', text: typed.trim() };
  }

  function score(h, q) {
    const age = Date.now() - (h.lastVisitTime || 0);
    const url = stripScheme(h.url).toLowerCase();
    let s = Math.log2(1 + (h.visitCount || 0)) + 2 * Math.log2(1 + (h.typedCount || 0));
    s += age < DAY ? 3 : age < 7 * DAY ? 2 : age < 30 * DAY ? 1 : 0;
    if (url.startsWith(q)) s += 8;
    else if (url.split('/')[0].includes(q)) s += 4;
    if ((h.title || '').toLowerCase().startsWith(q)) s += 2;
    return s;
  }

  async function suggest() {
    const my = ++seq;
    const text = typed.trim();
    if (!text) return;

    const [history, bookmarks] = await Promise.all([
      chrome.history.search({ text, startTime: 0, maxResults: 80 }).catch(() => []),
      chrome.bookmarks.search(text).catch(() => []),
    ]);
    if (my !== seq) return; // the user kept typing

    const first = defaultRow();
    const out = [first];
    const taken = (url) => out.some((r) => r.url && sameUrl(r.url, url));
    if (first.type !== 'search') out.push({ type: 'search', text });

    const q = stripScheme(text.toLowerCase());
    for (const b of bookmarks) {
      if (out.filter((r) => r.type === 'bookmark').length >= MAX_BOOKMARKS) break;
      if (!b.url || /^javascript:/i.test(b.url) || taken(b.url)) continue;
      out.push({
        type: 'bookmark',
        url: b.url,
        main: b.title || display(b.url),
        sub: display(b.url),
        incognito: !!window.bookmarksBar?.incognitoSource(b.id),
      });
    }
    history
      .filter((h) => /^(https?|file|ftp):/i.test(h.url) && !taken(h.url))
      .sort((a, b) => score(b, q) - score(a, q))
      .slice(0, MAX_HISTORY)
      .forEach((h) => out.push({ type: 'history', url: h.url, main: h.title || display(h.url), sub: h.title ? display(h.url) : '' }));

    const keep = rows[selected];
    rows = out;
    // Keep the highlighted row if the list changed under the mouse/keyboard.
    selected = Math.max(0, keep ? rows.findIndex((r) => r.type === keep.type && (r.url ? r.url === keep.url : r.text === keep.text)) : 0);
    render();
  }

  // -------------------------------------------------------------------------
  // Rendering

  function iconFor(row) {
    if (row.type === 'site') {
      const img = document.createElement('img');
      img.alt = '';
      Favicons.set(img, `https://${site.host}/`);
      return img;
    }
    if (row.type === 'search') {
      const span = document.createElement('span');
      span.className = 'ob-icon-search';
      return span;
    }
    const img = document.createElement('img');
    img.alt = '';
    Favicons.set(img, row.url);
    return img;
  }

  function render() {
    if (!typed.trim() || !rows.length) return close();
    const items = rows.map((row, i) => {
      const li = document.createElement('li');
      li.className = 'ob-opt';
      li.id = `ob-opt-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === selected));
      li.dataset.index = i;

      const text = document.createElement('span');
      text.className = 'ob-text';
      const main = document.createElement('span');
      main.textContent = row.type === 'search' || row.type === 'site' ? row.text : row.main;
      if (row.type === 'nav') main.className = 'ob-url';
      text.append(main);
      const subText = row.type === 'site'
        ? (site.info ? `Search ${siteLabel()}` : `Search ${site.host} with ${engine.url ? engine.name : 'your search engine'}`)
        : row.type === 'search'
          ? (engine.url ? `Search ${engine.name}` : 'Search the web')
          : row.sub;
      if (subText) {
        const sub = document.createElement('span');
        sub.className = 'ob-sub';
        sub.textContent = subText;
        text.append(sub);
      }
      li.append(iconFor(row), text);

      if (i === 0 && row.type === 'nav' && !site) {
        // "Tab to search" hint when we know how to search this site.
        const h = hostOfText();
        const info = h && SiteSearch.known(h);
        if (info) {
          const tag = document.createElement('span');
          tag.className = 'ob-tag ob-tab-hint';
          tag.innerHTML = '<kbd>Tab</kbd> ';
          tag.append(`Search ${info.name}`);
          li.append(tag);
        }
      }
      if (row.type === 'bookmark') {
        const tag = document.createElement('span');
        tag.className = 'ob-tag';
        tag.textContent = row.incognito ? 'Bookmark · incognito' : 'Bookmark';
        li.append(tag);
      }
      if (row.type === 'history' || row.host) {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'ob-remove';
        x.tabIndex = -1;
        x.textContent = '×';
        x.title = row.host ? `Stop suggesting ${row.host}` : 'Remove from history';
        x.setAttribute('aria-label', x.title);
        li.append(x);
      }
      return li;
    });
    list.replaceChildren(...items);
    list.hidden = false;
    box.classList.add('open');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', `ob-opt-${selected}`);
  }

  function close() {
    list.hidden = true;
    list.replaceChildren();
    box.classList.remove('open');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  // -------------------------------------------------------------------------
  // Typing

  function update({ allowInline }) {
    if (site) {
      selected = 0;
      rows = typed.trim() ? [{ type: 'site', text: typed.trim() }] : [];
      render();
      suggestSite().catch(console.error);
      return;
    }
    inlineHost = null;
    const m = typed && matchHost(typed);
    if (m) {
      const rest = m.host.slice(m.typedLen);
      if (!rest) inlineHost = m; // typed the whole domain
      else if (allowInline) {
        inlineHost = m;
        input.value = typed + rest;
        input.setSelectionRange(typed.length, input.value.length);
      }
    }
    selected = 0;
    rows = typed.trim() ? [defaultRow()] : [];
    render();
    suggest().catch(console.error);
  }

  input.addEventListener('input', (e) => {
    typed = input.value;
    const kind = e.inputType || '';
    const allowInline = !e.isComposing && !kind.startsWith('delete') && kind !== 'insertFromPaste' &&
      input.selectionStart === input.value.length;
    update({ allowInline });
  });

  function hasInline() {
    return input.selectionStart < input.selectionEnd && input.selectionEnd === input.value.length &&
      input.value.length > typed.length;
  }

  function acceptInline() {
    typed = input.value;
    input.setSelectionRange(typed.length, typed.length);
    update({ allowInline: false });
  }

  function select(i) {
    if (!rows.length) return;
    selected = Math.max(0, Math.min(rows.length - 1, i));
    const row = rows[selected];
    if (selected === 0) {
      // Back to what was typed, with its completion.
      input.value = typed;
      update({ allowInline: true });
      return;
    }
    input.value = row.type === 'search' ? row.text : display(row.url);
    render();
  }

  // -------------------------------------------------------------------------
  // Going somewhere

  async function go(row, { newTab = false, background = false } = {}) {
    if (!row) return;
    if (!tabId) tabId = (await chrome.tabs.getCurrent())?.id;
    if (row.type === 'site') {
      const target = await siteSearchUrl(row.text);
      if (target.url) await openUrl(target.url, { background: newTab && background });
      else await chrome.search.query(newTab ? { text: target.query, disposition: 'NEW_TAB' } : { text: target.query, tabId });
      if (newTab) {
        input.select();
        close();
      } else {
        exitSite();
        input.value = typed = '';
        close();
      }
      return;
    }
    if (row.incognito) {
      await window.bookmarksBar.openWindow([row.url], { incognito: true });
      return;
    }
    if (row.type === 'search') {
      if (!row.text) return;
      if (engine.url) await openUrl(searchUrl(row.text), { background: newTab && background });
      else if (newTab) await chrome.search.query({ text: row.text, disposition: 'NEW_TAB' });
      else await chrome.search.query({ text: row.text, tabId });
      if (engine.url && !newTab) {
        input.value = typed = '';
        close();
      }
    } else {
      // A new tab, not this one: see openUrl() in newtab.js.
      await openUrl(row.url, { background: newTab && background });
    }
    if (newTab) {
      input.select();
      close();
    } else if (row.type !== 'search') {
      input.value = typed = '';
      close();
    }
  }

  form.addEventListener('submit', (e) => e.preventDefault());

  async function removeRow(i) {
    const row = rows[i];
    if (!row) return;
    if (row.host) {
      hiddenHosts.add(row.host);
      await chrome.storage.local.set({ [HIDDEN_KEY]: [...hiddenHosts] });
      typed = input.value = typed; // drop the completion
      update({ allowInline: true });
      return;
    }
    if (row.type === 'history') {
      await chrome.history.deleteUrl({ url: row.url });
      rows.splice(i, 1);
      if (selected >= rows.length) selected = rows.length - 1;
      if (selected === i && i > 0) select(selected);
      render();
      hostsAt = 0;
      refreshIndexIfStale();
    }
  }

  input.addEventListener('keydown', (e) => {
    const open = !list.hidden;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        if (!open && typed.trim()) return update({ allowInline: false });
        select(selected + (e.key === 'ArrowDown' ? 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (e.isComposing) return;
        go(rows[selected] || (site ? { type: 'site', text: typed.trim() } : typed.trim() && defaultRow()),
          { newTab: e.altKey || e.metaKey || e.ctrlKey });
        break;
      case 'Escape':
        e.stopPropagation();
        if (selected > 0) select(0);
        else if (hasInline()) {
          input.value = typed;
          inlineHost = null;
          close();
        } else if (open) close();
        else if (input.value) {
          input.value = typed = '';
          close();
        } else if (site) exitSite();
        break;
      case 'Tab': {
        // Tab after a domain: search that site.
        const host = !site && !e.shiftKey && hostOfText();
        if (host) {
          e.preventDefault();
          enterSite(host);
        } else if (hasInline()) {
          e.preventDefault();
          acceptInline();
        }
        break;
      }
      case 'ArrowRight':
      case 'End':
        if (hasInline() && !e.shiftKey) {
          e.preventDefault();
          acceptInline();
        }
        break;
      case 'Delete':
      case 'Backspace':
        // Backspace at the start of the field removes the site chip.
        if (e.key === 'Backspace' && site && !e.shiftKey && input.selectionStart === 0 && input.selectionEnd === 0) {
          e.preventDefault();
          exitSite();
          update({ allowInline: false });
          break;
        }
        if (e.shiftKey && open && (rows[selected]?.type === 'history' || rows[selected]?.host)) {
          e.preventDefault();
          removeRow(selected);
        }
        break;
    }
  });

  // Mouse: keep the focus in the field, open rows, × removes.
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.ob-opt');
    if (!li) return;
    const i = Number(li.dataset.index);
    if (e.target.closest('.ob-remove')) return removeRow(i);
    go(rows[i], { newTab: e.ctrlKey || e.metaKey, background: !e.shiftKey });
  });
  list.addEventListener('auxclick', (e) => {
    const li = e.target.closest('.ob-opt');
    if (li && e.button === 1 && !e.target.closest('.ob-remove')) go(rows[Number(li.dataset.index)], { newTab: true, background: true });
  });

  input.addEventListener('blur', () => setTimeout(() => document.activeElement !== input && close(), 0));
  input.addEventListener('focus', () => {
    SiteSearch.preload();
    refreshIndexIfStale();
    if (typed.trim()) update({ allowInline: false });
  });

  // -------------------------------------------------------------------------
  // Focus: whenever this tab gets focus, the cursor goes to the field.

  const busy = () => document.querySelector('dialog[open], .bm-context');

  function grabFocus() {
    if (busy() || document.visibilityState !== 'visible') return;
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    input.select();
  }

  window.addEventListener('focus', grabFocus);
  document.addEventListener('visibilitychange', grabFocus);
  window.addEventListener('pageshow', grabFocus);

  // Typing anywhere else on the page goes to the field.
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    const t = e.target;
    if (t === input || busy() || t.closest?.('input, textarea, select, [contenteditable]')) return;
    window.bookmarksBar?.closeMenus();
    input.focus({ preventScroll: true });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.shortcuts || changes[HIDDEN_KEY]) hostsAt = 0;
    if (changes[ENGINE_KEY]) setEngine(changes[ENGINE_KEY].newValue);
  });

  // -------------------------------------------------------------------------
  // Search engine setting (Edit → Search engine…)

  const seDialog = document.getElementById('se-dialog');
  const seSelect = document.getElementById('se-select');
  const seCustom = document.getElementById('se-custom');
  const seUrl = document.getElementById('se-url');
  const seName = document.getElementById('se-name');

  function setPlaceholder() {
    if (site) return showChip();
    input.placeholder = engine.url ? `Search ${engine.name} or type a URL` : 'Search or type a URL';
  }

  function setEngine(value) {
    engine = value && typeof value.url === 'string' ? value : ENGINES[0];
    setPlaceholder();
  }

  seSelect.replaceChildren(
    ...ENGINES.map((e, i) => new Option(e.url ? e.name : 'Browser default (slower)', String(i))),
    new Option('Custom…', 'custom')
  );

  function syncCustom() {
    seCustom.hidden = seSelect.value !== 'custom';
    seUrl.required = !seCustom.hidden;
  }
  seSelect.addEventListener('change', syncCustom);

  document.getElementById('open-search-engine').addEventListener('click', () => {
    const i = ENGINES.findIndex((e) => e.url === engine.url);
    seSelect.value = i >= 0 ? String(i) : 'custom';
    seName.value = i >= 0 ? '' : engine.name;
    seUrl.value = i >= 0 ? '' : engine.url;
    syncCustom();
    seDialog.showModal();
  });
  document.getElementById('se-cancel').addEventListener('click', () => seDialog.close());

  document.getElementById('se-form').addEventListener('submit', (e) => {
    e.preventDefault();
    let value;
    if (seSelect.value === 'custom') {
      const url = seUrl.value.trim();
      if (!/^https?:\/\/.+%s/i.test(url)) {
        seUrl.setCustomValidity('Use a full http(s) address containing %s where the search goes.');
        seUrl.reportValidity();
        return;
      }
      value = { name: seName.value.trim() || new URL(url.replace(/%s/g, 'x')).hostname.replace(/^www\./, ''), url };
    } else {
      value = ENGINES[Number(seSelect.value)];
    }
    chrome.storage.local.set({ [ENGINE_KEY]: value });
    seDialog.close();
  });
  seUrl.addEventListener('input', () => seUrl.setCustomValidity(''));

  chrome.storage.local.get(ENGINE_KEY).then((data) => setEngine(data[ENGINE_KEY]));

  buildIndex().catch(console.error);
  grabFocus();
})();
