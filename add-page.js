// Static New Tab — add the current page (or a link) as a shortcut.
// Entry points: page and link right-click menus, the toolbar button, and
// the "add-page" keyboard shortcut (Alt+Shift+S by default).
// Loaded by background.js via importScripts.

const AddPage = (() => {
  const MENU_PAGE = 'add-page';
  const MENU_LINK = 'add-link';
  const ADDABLE = /^(https?|file):/i;

  // Add a shortcut. Returns 'added', 'exists' or 'invalid'.
  async function add(url, name = '') {
    if (!url || !ADDABLE.test(url)) return 'invalid';
    const { shortcuts = [] } = await chrome.storage.local.get('shortcuts');
    const same = (a, b) => a.replace(/\/$/, '') === b.replace(/\/$/, '');
    if (shortcuts.some((s) => same(s.url, url))) return 'exists';
    await chrome.storage.local.set({ shortcuts: [...shortcuts, { name: name.trim(), url }] });
    return 'added';
  }

  // Brief feedback on the toolbar button for that tab.
  async function badge(tabId, result) {
    if (tabId == null) return;
    const look = {
      added: ['✓', '#2f9e44', 'Added to Static New Tab'],
      exists: ['=', '#868e96', 'Already in Static New Tab'],
      invalid: ['✕', '#c92a2a', "This page can't be added"],
    }[result];
    try {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: look[1] });
      await chrome.action.setBadgeText({ tabId, text: look[0] });
      await chrome.action.setTitle({ tabId, title: look[2] });
      setTimeout(() => {
        chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
        chrome.action.setTitle({ tabId, title: 'Add this page to Static New Tab' }).catch(() => {});
      }, 2500);
    } catch {
      // Tab closed meanwhile.
    }
  }

  async function addTab(tab) {
    if (!tab) return 'invalid';
    const result = await add(tab.url, tab.title || '');
    await badge(tab.id, result);
    return result;
  }

  function createMenus() {
    chrome.contextMenus.removeAll(() => {
      const patterns = ['http://*/*', 'https://*/*', 'file:///*'];
      chrome.contextMenus.create({
        id: MENU_PAGE,
        title: 'Add this page to Static New Tab',
        contexts: ['page'],
        documentUrlPatterns: patterns,
      });
      chrome.contextMenus.create({
        id: MENU_LINK,
        title: 'Add link to Static New Tab',
        contexts: ['link'],
        targetUrlPatterns: patterns,
      });
    });
  }

  chrome.runtime.onInstalled.addListener(createMenus);

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === MENU_PAGE) {
      await addTab({ ...tab, url: info.pageUrl || tab?.url });
    } else if (info.menuItemId === MENU_LINK) {
      // Chromium doesn't give the link's text: the shortcut shows its domain
      // until renamed.
      const result = await add(info.linkUrl, info.selectionText || '');
      await badge(tab?.id, result);
    }
  });

  chrome.action.onClicked.addListener((tab) => addTab(tab));

  chrome.commands.onCommand.addListener(async (command, tab) => {
    if (command !== 'add-page') return;
    tab ??= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    await addTab(tab);
  });

  return { add, addTab };
})();
