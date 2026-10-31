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

(() => {
  const input = document.getElementById('ob-input');
  const form = document.getElementById('ob-form');
  const list = document.getElementById('ob-list');
  const box = document.getElementById('omnibox');

  const HIDDEN_KEY = 'omniboxHiddenHosts';
  const MAX_HISTORY = 6;
  const MAX_BOOKMARKS = 3;
  const DAY = 24 * 3600 * 1000;

  let typed = '';         // what the user typed (without the inline completion)
  let inlineHost = null;  // { host, entry } completing the typed text
  let rows = [];
  let selected = 0;
  let seq = 0;
  let tabId = null;

  let hosts = new Map();  // "gmail.com" -> { score, https, http, real }
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
    ]);
    for (const h of history) add(h.url, (h.visitCount || 1) + 10 * (h.typedCount || 0));
    const walk = (n) => (n.url ? add(n.url, 20) : (n.children || []).forEach(walk));
    tree.forEach(walk);
    for (const s of stored.shortcuts || []) add(s.url, 50);

    hosts = map;
    hiddenHosts = new Set(stored[HIDDEN_KEY] || []);
    hostsAt = Date.now();
  }

  function refreshIndexIfStale() {
    if (Date.now() - hostsAt > 60 * 1000) buildIndex().catch(console.error);
  }

  function matchHost(text) {
    const t = stripScheme(text.toLowerCase());
    if (!t || /[\s/?#]/.test(t)) return null;
    let best = null;
    for (const [host, entry] of hosts) {
      if (!host.startsWith(t) || hiddenHosts.has(host)) continue;
      if (!best || entry.score > best.entry.score ||
          (entry.score === best.entry.score && host.length < best.host.length)) {
        best = { host, entry };
      }
    }
    return best && { ...best, typedLen: t.length };
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
    if (row.type === 'search') {
      const span = document.createElement('span');
      span.className = 'ob-icon-search';
      return span;
    }
    const img = document.createElement('img');
    img.alt = '';
    img.src = faviconUrl(row.url);
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
      main.textContent = row.type === 'search' ? row.text : row.main;
      if (row.type === 'nav') main.className = 'ob-url';
      text.append(main);
      const subText = row.type === 'search' ? 'Search the web' : row.sub;
      if (subText) {
        const sub = document.createElement('span');
        sub.className = 'ob-sub';
        sub.textContent = subText;
        text.append(sub);
      }
      li.append(iconFor(row), text);

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
    if (row.incognito) {
      await window.bookmarksBar.openWindow([row.url], { incognito: true });
      return;
    }
    if (row.type === 'search') {
      if (!row.text) return;
      if (newTab) await chrome.search.query({ text: row.text, disposition: 'NEW_TAB' });
      else await chrome.search.query({ text: row.text, tabId });
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
        go(rows[selected] || (typed.trim() && defaultRow()), { newTab: e.altKey || e.metaKey || e.ctrlKey });
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
        }
        break;
      case 'Tab':
        if (hasInline()) {
          e.preventDefault();
          acceptInline();
        }
        break;
      case 'ArrowRight':
      case 'End':
        if (hasInline() && !e.shiftKey) {
          e.preventDefault();
          acceptInline();
        }
        break;
      case 'Delete':
      case 'Backspace':
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
    if (area === 'local' && (changes.shortcuts || changes[HIDDEN_KEY])) hostsAt = 0;
  });

  buildIndex().catch(console.error);
  grabFocus();
})();
