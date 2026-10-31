# Static New Tab

A Chromium extension (built for [Helium](https://helium.computer), works in any
Chromium-based browser) that keeps a **New Tab page pinned** in every window.

- **Type a URL, search, or click a shortcut** in the pinned tab → it becomes a
  regular tab, moved to the end of the tab strip (where `+` / Ctrl+T would have
  put it), and a fresh pinned New Tab takes its place.
- **Press `+` or Ctrl+T** → no extra tab is left behind: you land on the pinned
  New Tab.
- **Close the pinned tab** → it comes back.
- **New windows** get their own pinned New Tab.
- **A plain shortcut page** instead of the browser's New Tab page, with your
  **bookmarks** below the shortcuts.

## Your shortcuts

Click **Edit** (bottom right) to:

- **Add** a shortcut with the *Add shortcut* tile (name, URL, optional icon URL),
- **Edit** one by clicking it, or **remove** it with ×,
- **Reorder** by dragging tiles,
- **Import / Export** the list as JSON, to back it up or move it to another
  browser.

Click **Done** or press Esc to finish. Changes show up at once in every open
New Tab, including the pinned tab in each window.

Icons are the site favicons the browser has already cached (the extension makes
no network request for them). A site you haven't visited yet shows its first
letter until you've been there once.

The JSON format is a plain list:

```json
[
  { "name": "Mail", "url": "https://mail.proton.me" },
  { "name": "GitHub", "url": "https://github.com", "icon": "https://github.com/favicon.ico" }
]
```

Ctrl/Cmd-click or middle-click a shortcut to open it in a new tab without
leaving the pinned one.

## Bookmarks

Below the shortcuts, each folder on your bookmarks bar gets its own card, and
loose bookmarks go in a *Bookmarks bar* card. *Other bookmarks* and *Mobile
bookmarks* follow, laid out the same way. Subfolders open and close inside
their card, and the page remembers which ones you left open. The section updates
as soon as you add, move or rename a bookmark.

To hide the section, click **Edit**, then **Hide bookmarks**.
Bookmarklets (`javascript:` bookmarks) are left out because they can't run
from this page.

## Install (unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions` in Helium.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick this folder.

Because it replaces the New Tab page, Helium may ask whether to keep the
change. Choose **Keep it**.

Permissions:

- `tabs` (shown as "Read your browsing history"): to see when the pinned tab
  leaves the New Tab page.
- `favicon`: to show the favicons the browser has already cached.
- `bookmarks`: to show your bookmarks (read-only; the extension never changes
  them).
- `storage`: for your shortcuts.

Nothing is sent anywhere.

## How it works

`+` doesn't close the new tab and jump back to the pinned one. Instead, **the
new tab takes over the pinned slot** and the old pinned New Tab is closed. The
result looks the same, but the keyboard focus stays in the address bar, so
Ctrl+T followed by typing still works. If the extension activated an existing
tab instead, focus would return to wherever it was last in that tab.

The pinned tab is tracked by ID. Your other pinned tabs (mail, chat…) are never
touched.

## Known limitations

- **A brief flicker.** Extensions can only react after the browser has created
  or navigated a tab, so for a split second you may see the tab appear unpinned,
  or the navigated tab jump from the pinned area to the end of the strip.
- **"Where it would have been" means the end of the strip.** This is where
  Chromium puts new tabs from `+` / Ctrl+T. If your browser opens new tabs next
  to the current one, change the `index: -1` in `release()` in `background.js`.
- **Closing the last tab no longer closes the window.** The pinned New Tab is
  still there. Close it, or the window, to finish.
- **Ctrl+1…8 shift by one.** The pinned tab now counts as a tab.
- **Back button.** A tab that started on the pinned New Tab can go *back* to the
  New Tab page, the same as a tab opened with Ctrl+T.
- **Restore after a crash** can briefly bring back an extra pinned New Tab. The
  extension removes duplicates.
- **Incognito** windows are left alone unless you allow the extension in
  incognito on `chrome://extensions`.
