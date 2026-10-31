// Static New Tab — History button next to the address bar.
// Its menu lists recently closed tabs/windows (restored with their
// back/forward history) and a link to the full history page. Entries are
// read each time the menu opens.

(() => {
  const button = document.querySelector('.bm-history');
  const MAX_CLOSED = 15;
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

  async function load() {
    const closed = await recentlyClosed().catch(() => []);
    return [
      { kind: 'header', title: 'Recently closed' },
      ...(closed.length ? closed : [{ kind: 'note', title: 'Nothing closed recently' }]),
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
  button.addEventListener('click', (e) => window.bookmarksBar.toggleMenu(button, e.detail === 0));
})();
