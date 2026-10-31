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
- **A plain shortcut page** instead of the browser's New Tab page, with a
  **bookmarks bar** and a **History** menu (recently closed tabs, recently
  visited pages) at the top.

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

The top of the page has a bar that works like the browser's own bookmarks bar.

- Bookmarks-bar items appear in a row. A bookmark with no title shows only its
  icon.
- Clicking a **folder** opens a dropdown menu, and **subfolders** open
  cascading submenus on hover. While a menu is open, hovering another folder
  switches to it.
- Bookmarks that don't fit go behind a **»** button.
- **Other bookmarks** (and Mobile bookmarks, if you have any) sit at the right
  end.
- **Right-click** a bookmark, folder or the bar to open (in a new tab or
  window, or open all), edit, rename, copy the link, add a page or folder,
  delete (with **Undo**), or add a bookmark to your shortcuts. The built-in
  root folders (Other bookmarks…) can't be renamed or deleted.
- **Keyboard:** ↓ / Enter opens a folder, ↑ ↓ move through a menu, → opens a
  submenu, ← goes back, and Esc closes.
- The bar updates as soon as you add, move or rename a bookmark.

To hide the bar, click **Edit**, then **Hide bookmarks**. Bookmarklets
(`javascript:` bookmarks) are left out because they can't run from this page.

## History

The clock button at the right end of the bar opens a menu with:

- **Recently closed** tabs and windows. Clicking one restores it with its
  back/forward history, like Ctrl+Shift+T.
- **Recently visited** pages. Clicking one opens it like a bookmark.
- **Show full history**, which opens the browser's History page.

The button stays even when the bookmarks are hidden.

## Wallpaper

Click **Edit**, then **Wallpaper…**, then **Choose image…**, or just drop an
image file anywhere on the page.

- **Fill the page** crops the image to cover the whole tab. **Fit inside the
  page** shows all of it.
- **Dim** darkens the image so labels and the bookmarks bar stay readable.
- **Remove** goes back to the plain background.

The image stays on your computer, in the extension's own storage. Very large
photos are scaled down to your screen size (at least 2560 px) so the page
opens quickly. Animated GIFs and SVGs are kept as they are. Changes show up
in every open New Tab.

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
- `bookmarks`: to show your bookmarks and edit them from the right-click
  menu. Nothing changes unless you choose an action.
- `sessions`: for the *Recently closed* list.
- `history`: for the *Recently visited* list. The extension only reads it.
- `storage`: for your shortcuts and settings.

Nothing is sent anywhere.

## How it works

When you press `+` or Ctrl+T, the browser opens a new tab. The extension
closes it right away and switches to the pinned New Tab. Closing it before it
has finished loading keeps it out of *Recently closed*, so Ctrl+Shift+T still
reopens your last real tab.

The pinned tab is tracked by ID. Your other pinned tabs (mail, chat…) are never
touched.

## Known limitations

- **Cursor after Ctrl+T.** On the pinned tab, the cursor goes back to where it
  was when you last left that tab. Normally that's the address bar, so you can
  type straight away. If you had clicked inside the pinned page (a bookmark
  menu, for example) and switched away without opening anything, the cursor
  stays in the page; press Ctrl+L or F6 to get to the address bar.

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
