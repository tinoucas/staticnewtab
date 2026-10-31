# Working on this repo

- Commit and push directly to `main`. No feature branches or pull requests
  needed.
- This is an unpacked Chromium MV3 extension (Helium is the target browser).
  There is no build step: `manifest.json`, `background.js` (pinned-tab logic),
  `newtab.*` (shortcut page) and `bookmarks.js` / `bookmarks-edit.js` (bookmarks bar
  and its right-click menu) and `wallpaper.js` (background image, stored in
  IndexedDB)
  are loaded as-is.
- Test with the pre-installed Playwright Chromium by loading the extension with
  `--disable-extensions-except` / `--load-extension` in a persistent context,
  and drive tabs through the service worker (`chrome.tabs.*`).
