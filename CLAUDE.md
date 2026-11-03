# Working on this repo

- Commit and push directly to `main`. No feature branches or pull requests
  needed.
- This is an unpacked Chromium MV3 extension (Helium is the target browser).
  There is no build step; these files are loaded as-is:
  - `manifest.json`
  - `background.js`: pinned-tab logic
  - `newtab.html` / `newtab.css` / `newtab.js`: the New Tab page and shortcuts
  - `bookmarks.js`: bookmarks bar and its dropdown menu system
  - `bookmarks-edit.js`: right-click menu for bookmarks
  - `omnibox.js`: the in-page address bar (inline domain completion,
    suggestions)
  - `site-search.js`: how to search a site for "Tab to search" in the
    address bar: `data/site-search.json` (built from Kagi's MIT bangs list by
    `tools/build-site-search.py`), else the site's OpenSearch description
    (needs the optional all-sites access), else `site:` with the chosen engine
  - `history.js`: History button (recently closed) next to the address bar (reuses the
    bookmarks bar's menu system)
  - `favicons.js`: icons for tiles, bookmarks and suggestions: the
    browser's favicon cache first, else the site's /favicon.ico or
    /apple-touch-icon.png (use `Favicons.set(img, url)`); with the optional
    all-sites permission (Edit → Missing icons…), the icon the site's page
    declares, saved in chrome.storage.local "siteIcons"
  - `wallpaper.js`: background image, stored in IndexedDB (drop an image on the
    wallpaper dialog; dropped on the page, an image starts a search by image)
  - `image-drop.js` / `image-search.js` / `image-search.html` +
    `image-search-page.js`: search by image. Google Lens, or Bing visual
    search when Bing is the chosen engine; a file is handed to the upload
    page through chrome.storage.session and posted from that new tab
  - `icon.svg`: favicon of the pinned tab; `icons/*.png` (rendered from it):
    extension and toolbar icons
  - `add-page.js`: "Add this page / link to Static New Tab" (right-click
    menus, toolbar button, Alt+Shift+S); loaded by background.js
  - `settings.js`: export/import of all settings, and defaults from
    `defaults/settings.json` on a fresh install (also loaded by background.js
    via importScripts)
- `defaults/settings.json` holds the user's personal settings: it is
  git-ignored and the repo is public, so never commit it.
- The pinned tab is `chrome-extension://<id>/newtab.html` (opened directly,
  not through `chrome://newtab`) so the page can take the keyboard focus.
- Open pages from the page with `openUrl()` (newtab.js, chrome.tabs.create),
  never by navigating the pinned tab (links, chrome.tabs.update,
  location.href): those are sent as cross-site requests without SameSite=Strict
  cookies. Searches open the chosen engine's URL with `openUrl()` too;
  chrome.search.query (option "Browser default") takes seconds in Helium.
- Test with the pre-installed Playwright Chromium by loading the extension with
  `--disable-extensions-except` / `--load-extension` in a persistent context,
  and drive tabs through the service worker (`chrome.tabs.*`).
