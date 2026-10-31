// Static New Tab — keeps one New Tab page pinned in every normal window.
//
// Rules:
//  1. Every normal window has exactly one "managed" tab: a pinned New Tab page.
//  2. When the managed tab navigates somewhere real (typed URL, search,
//     shortcut click), it is unpinned, moved to the end of the tab strip
//     (where Ctrl+T / "+" would have put it) and a fresh pinned New Tab
//     is created in the background.
//  3. When a fresh, unpinned New Tab appears ("+", Ctrl+T), it is closed at
//     once and the pinned one is shown instead. Closing it before it has
//     loaded keeps it out of "Recently closed", so Ctrl+Shift+T still
//     reopens your last real tab. In a window without a pinned New Tab yet
//     (e.g. a new window), it is replaced by a pinned one.

const STORAGE_KEY = 'managed';

// URLs that are a New Tab page wherever they show up.
const NTP_RE = /^(chrome|edge|brave|vivaldi):\/\/(newtab|new-tab-page)\b|^chrome-search:\/\/local-ntp/;
// Browser-internal URLs a New Tab page can land on while it first loads
// (e.g. another extension's New Tab override).
const INTERNAL_RE = /^(chrome|chrome-extension|chrome-search|chrome-untrusted|about|edge|brave|vivaldi):/;

// The pinned tab shows this extension page directly (not chrome://newtab):
// a chrome://newtab page can never take keyboard focus from the browser's
// address bar, an extension page can, so its own address bar gets the cursor.
const OWN_URL = chrome.runtime.getURL('newtab.html');
const isOwnPage = (url) => !!url && url.startsWith(OWN_URL);
const isNtpUrl = (url) => !!url && (NTP_RE.test(url) || isOwnPage(url));
const tabUrl = (tab) => tab.pendingUrl || tab.url || '';

// windowId -> { tabId, settled, home: [urls] }
//   settled: the tab finished its first load; before that, internal URLs
//            the tab passes through are recorded as "home" instead of
//            being treated as navigation.
let managed = null;

async function load() {
  if (managed) return;
  const data = await chrome.storage.session.get(STORAGE_KEY);
  managed = data[STORAGE_KEY] || {};
}

function save() {
  return chrome.storage.session.set({ [STORAGE_KEY]: managed });
}

// Run handlers one at a time so that bursts of tab events
// (new window, session restore) cannot interleave.
let chain = Promise.resolve();
function run(label, fn) {
  chain = chain
    .then(load)
    .then(fn)
    .catch((err) => console.warn(`[static-new-tab] ${label}:`, err));
  return chain;
}

const exists = (promise) => promise.then(() => true, () => false);

async function isNormalWindow(windowId) {
  try {
    const win = await chrome.windows.get(windowId);
    return win.type === 'normal';
  } catch {
    return false;
  }
}

function entryFor(tab) {
  const m = managed[tab.windowId];
  return m && m.tabId === tab.id ? m : null;
}

function isManagedTabId(tabId) {
  return Object.values(managed).some((m) => m.tabId === tabId);
}

function manage(tab) {
  managed[tab.windowId] = {
    tabId: tab.id,
    settled: tab.status === 'complete',
    home: [tabUrl(tab)].filter(Boolean),
  };
}

// Manage a pinned tab, switching an old-style chrome://newtab one to our page.
async function adopt(tab) {
  manage(tab);
  if (!isOwnPage(tabUrl(tab))) await chrome.tabs.update(tab.id, { url: OWN_URL }).catch(() => {});
}

function isHome(m, url) {
  return isNtpUrl(url) || m.home.includes(url) || (!m.settled && INTERNAL_RE.test(url));
}

// Make sure the window has a live managed tab; adopt a pinned New Tab if
// one is already there, otherwise create one in the background.
async function ensure(windowId) {
  const m = managed[windowId];
  if (m && (await exists(chrome.tabs.get(m.tabId)))) return;
  delete managed[windowId];
  if (!(await isNormalWindow(windowId))) {
    await save();
    return;
  }

  const pinned = await chrome.tabs.query({ windowId, pinned: true });
  const ntps = pinned.filter((t) => isNtpUrl(tabUrl(t)));
  if (ntps.length) {
    await adopt(ntps[0]);
    // Extra pinned New Tabs are duplicates (e.g. after a crash restore).
    const extra = ntps.slice(1).map((t) => t.id);
    if (extra.length) await chrome.tabs.remove(extra).catch(() => {});
  } else {
    const tab = await chrome.tabs.create({ windowId, url: OWN_URL, pinned: true, active: false });
    manage(tab);
  }
  await save();
}

async function reconcile() {
  managed = {};
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  for (const win of windows) await ensure(win.id);
  await save();
}

// A New Tab page appeared in a window.
async function onNewTab(tab) {
  if (isManagedTabId(tab.id) || !isNtpUrl(tabUrl(tab))) return;
  if (!(await isNormalWindow(tab.windowId))) return;

  const old = managed[tab.windowId];
  const oldTab = old && (await chrome.tabs.get(old.tabId).catch(() => null));

  if (tab.pinned) {
    // A restored pinned New Tab: adopt it, or drop it if we already have one.
    if (oldTab) await chrome.tabs.remove(tab.id).catch(() => {});
    else {
      await adopt(tab);
      await save();
    }
    return;
  }

  // "+" / Ctrl+T: show the pinned New Tab instead.
  if (oldTab) {
    await chrome.tabs.remove(tab.id).catch(() => {});
    await chrome.tabs.update(oldTab.id, { active: true });
    return;
  }

  // First New Tab of a window: replace it with a pinned page of our own
  // (created first, so the window never runs out of tabs).
  const pinned = await chrome.tabs.create({ windowId: tab.windowId, url: OWN_URL, pinned: true, active: true });
  manage(pinned);
  await save();
  await chrome.tabs.remove(tab.id).catch(() => {});
}

// The managed tab left the New Tab page: release it as a regular tab.
async function release(tab) {
  delete managed[tab.windowId];
  await save();
  await chrome.tabs.update(tab.id, { pinned: false });
  await chrome.tabs.move(tab.id, { index: -1 });
  await ensure(tab.windowId);
}

// ---------------------------------------------------------------------------
// Event wiring (must be registered synchronously at top level for MV3).

chrome.runtime.onInstalled.addListener(() => run('installed', reconcile));
chrome.runtime.onStartup.addListener(() => run('startup', reconcile));

chrome.tabs.onCreated.addListener((tab) => run('tab created', () => onNewTab(tab)));

chrome.tabs.onUpdated.addListener((tabId, change, tab) =>
  run('tab updated', async () => {
    const m = entryFor(tab);
    if (!m) return;

    if (change.pinned === false) {
      // Unpinned by hand: let it go and pin a new one.
      delete managed[tab.windowId];
      await ensure(tab.windowId);
      return;
    }

    if (change.url) {
      if (!isHome(m, change.url)) return release(tab);
      if (!m.home.includes(change.url)) m.home.push(change.url);
    }
    if (change.status === 'complete' && !m.settled) {
      m.settled = true;
      if (isHome(m, tab.url) && !m.home.includes(tab.url)) m.home.push(tab.url);
    }
    await save();
  })
);

chrome.tabs.onRemoved.addListener((tabId, { windowId, isWindowClosing }) =>
  run('tab removed', async () => {
    if (managed[windowId]?.tabId !== tabId) return;
    delete managed[windowId];
    if (isWindowClosing) await save();
    else await ensure(windowId); // closed by hand: bring it back
  })
);

chrome.tabs.onDetached.addListener((tabId, { oldWindowId }) =>
  run('tab detached', async () => {
    if (managed[oldWindowId]?.tabId !== tabId) return;
    delete managed[oldWindowId];
    await ensure(oldWindowId);
  })
);

chrome.tabs.onAttached.addListener((tabId) =>
  run('tab attached', async () => {
    const tab = await chrome.tabs.get(tabId);
    await onNewTab(tab);
  })
);

// Give a new window a moment to receive its first tab, so a Ctrl+N
// New Tab is adopted instead of us creating one and then swapping.
chrome.windows.onCreated.addListener(
  (win) => setTimeout(() => run('window created', () => ensure(win.id)), 300),
  { windowTypes: ['normal'] }
);

chrome.windows.onRemoved.addListener((windowId) =>
  run('window removed', async () => {
    if (!managed[windowId]) return;
    delete managed[windowId];
    await save();
  })
);
