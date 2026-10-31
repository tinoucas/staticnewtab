// Static New Tab — History button on the bookmarks bar.
// Its menu lists recently closed tabs/windows (restored with their
// back/forward history), recently visited pages, and a link to the full
// history page. Entries are read each time the menu opens.

(() => {
  const button = document.querySelector('.bm-history');
  const MAX_CLOSED = 10;
  const MAX_VISITED = 10;
  const isMac = /Mac/i.test(navigator.platform);

  const ownPages = chrome.runtime.getURL('');
  const isNewTab = (url) =>
    !url || /^chrome:\/\/(newtab|new-tab-page)\b/.test(url) || url.startsWith(ownPages);

  function ago(ms) {
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return 'now';
    if (min < 60) return `${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? 'yesterday' : `${d} days`;
  }

  async function recentlyClosed() {
    const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
    const nodes = [];
    for (const s of sessions) {
      if (nodes.length >= MAX_CLOSED) break;
      const when = ago((s.lastModified || 0) * 1000);
      if (s.tab) {
        if (isNewTab(s.tab.url)) continue;
        nodes.push({
          kind: 'action',
          title: s.tab.title || s.tab.url,
          url: s.tab.url,
          tooltip: `${s.tab.title || ''}\n${s.tab.url}`.trim(),
          meta: when,
          run: () => chrome.sessions.restore(s.tab.sessionId),
        });
      } else if (s.window) {
        const tabs = (s.window.tabs || []).filter((t) => !isNewTab(t.url));
        if (!tabs.length) continue;
        nodes.push({
          kind: 'action',
          icon: 'window',
          title: tabs.length === 1 ? `Window: ${tabs[0].title || tabs[0].url}` : `Window with ${tabs.length} tabs`,
          tooltip: tabs.map((t) => t.title || t.url).join('\n'),
          meta: when,
          run: () => chrome.sessions.restore(s.window.sessionId),
        });
      }
    }
    return nodes;
  }

  async function recentlyVisited() {
    const items = await chrome.history.search({
      text: '',
      startTime: Date.now() - 30 * 24 * 3600 * 1000,
      maxResults: 100,
    });
    const seen = new Set();
    return items
      .filter((h) => /^(https?|file):/i.test(h.url))
      .sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0))
      .filter((h) => !seen.has(h.url) && seen.add(h.url))
      .slice(0, MAX_VISITED)
      .map((h) => ({ kind: 'link', url: h.url, title: h.title || h.url, meta: ago(h.lastVisitTime) }));
  }

  async function load() {
    const [closed, visited] = await Promise.all([
      recentlyClosed().catch(() => []),
      recentlyVisited().catch(() => []),
    ]);
    return [
      { kind: 'header', title: 'Recently closed' },
      ...(closed.length ? closed : [{ kind: 'note', title: 'Nothing closed recently' }]),
      { kind: 'separator' },
      { kind: 'header', title: 'Recently visited' },
      ...(visited.length ? visited : [{ kind: 'note', title: 'No history yet' }]),
      { kind: 'separator' },
      {
        kind: 'action',
        icon: 'history',
        title: 'Show full history',
        meta: isMac ? '⌘Y' : 'Ctrl+H',
        run: () => chrome.tabs.create({ url: 'chrome://history/' }),
      },
    ];
  }

  button.bmLoad = load;
})();
