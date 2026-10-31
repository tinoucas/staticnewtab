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
  - `history.js`: History button next to the address bar (reuses the
    bookmarks bar's menu system)
  - `wallpaper.js`: background image, stored in IndexedDB
  - `icon.svg`: favicon of the pinned tab
- The pinned tab is `chrome-extension://<id>/newtab.html` (opened directly,
  not through `chrome://newtab`) so the page can take the keyboard focus.
- Test with the pre-installed Playwright Chromium by loading the extension with
  `--disable-extensions-except` / `--load-extension` in a persistent context,
  and drive tabs through the service worker (`chrome.tabs.*`).
