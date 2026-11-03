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
- **A plain page of your own** instead of the browser's New Tab page: an
  **address bar** with domain autocompletion, a **History** button (recently
  closed tabs), your **shortcuts**, a **bookmarks
  bar** and an optional **wallpaper**.

## Address bar

The address bar sits above your shortcuts, and the cursor is in it whenever
the pinned tab gets focus. Ctrl+T then typing just works, and typing anywhere
else on the page goes into it too.

- **Domains complete first.** Typing `gma` suggests `gmail.com` right in the
  field, with the completed part selected. Keep typing to ignore it, or press
  → / End to accept it (Tab searches that site, see below). Domains are ranked by how often you visit them
  (sites you typed count most), plus your bookmarks and shortcuts.
- **Suggestions below:** what Enter will do, a web search, matching bookmarks and pages from your history. Pick one
  with ↑ / ↓ or the mouse.
- **× on a suggestion** (or Shift+Delete on the selected one):
  - on a **history page**, deletes that page from your browser history;
  - on a **domain** completion, stops suggesting that domain here. Your
    history is left alone. The list is kept in the extension's storage.
- **Search engine:** Google by default. Change it under **Edit → Search
  engine…**: DuckDuckGo, Bing, Brave Search, Startpage, Kagi, Ecosia, Qwant,
  a custom URL (`%s` stands for your search), or *Browser default*. Searches
  open the engine's URL directly, which is as fast as typing an address.
  *Browser default* uses Helium's own engine through the browser's search
  API, which can take several seconds (Helium doesn't let extensions read
  which engine you picked).
- Alt+Enter, Ctrl/Cmd-click or middle-click opens in a new tab.
- Esc steps back: to what you typed, then closes the list, then clears the
  field.
- **Tab to search a site:** type a domain (`amazon.fr`, `x.com`,
  `aliexpress.com`…), or let it autocomplete, then press **Tab**. The domain
  becomes a chip and what you type next is searched on that site. The first
  suggestion shows **Tab · Search Amazon.fr** when the site's search is known.
  **Backspace** at the start of the field (or Esc on an empty field) removes the
  chip. Enter with nothing typed opens the site's home page.

  How each site is searched:
  1. A built-in list of about 9,000 sites (`data/site-search.json`), made from
     [Kagi's open-source bangs list](https://github.com/kagisearch/bangs) (MIT,
     see `data/LICENSE-bangs`). Rebuild it with `python3
     tools/build-site-search.py`.
  2. If the access to all websites is on (see *Missing icons…*), the site's own
     [OpenSearch](https://github.com/dewitt/opensearch) description: the
     standard browsers use to learn site searches. Found ones are remembered.
  3. Otherwise your search engine, limited to the site (`site:example.com …`).

## Your shortcuts

**Adding the page you're on:**

- Right-click the page → **Add this page to Static New Tab**, or right-click
  a link → **Add link to Static New Tab**.
- Or click the extension's **toolbar button**. Pin it via the puzzle-piece
  menu to keep it visible.
- Or press **Alt+Shift+S**. Change it at `chrome://extensions/shortcuts`.

The button shows ✓ when the page is added, or = when it's already a
shortcut. The tab's own right-click menu (on the tab strip) can't have this
entry: Chromium browsers don't let extensions add items there.

Click **Edit** (bottom right) to:

- **Add** a shortcut with the *Add shortcut* tile (name, URL, optional icon URL),
- **Edit** one by clicking it, or **remove** it with ×,
- **Reorder** by dragging tiles,
- **Export** everything (shortcuts, wallpaper, settings) to one
  `settings.json` file, and **Import** it back. See *Keeping your settings*.

Click **Done** or press Esc to finish. Changes show up at once in every open
New Tab, including the pinned tab in each window.

Icons are the site favicons the browser has already cached. When it has none
(a site you haven't visited in this browser yet, e.g. bookmarks imported on a
new computer), the icon is loaded from the site itself: `/favicon.ico`, then
`/apple-touch-icon.png`. This happens when the bookmark or shortcut is shown,
and the browser's cache keeps the result. Requests go to that site only, never
to a third-party icon service, and carry no referrer. Sites with neither file
show a letter (shortcuts) or a globe (bookmarks), and aren't asked again for a
week. After you visit a site, the browser's own icon is used.

**Missing icons…** (in Edit mode) finds the rest: some sites only list their
icon inside their page. After you allow access to all websites (Helium asks
when you click **Find icons**), the page of each bookmark or shortcut without
an icon is read once, without your cookies, to find the icon it declares. The
icon is then saved on this computer and shown without any further request.
With the access on, icons for new bookmarks are found the same way when
they're displayed. The same dialog can **Revoke access** (saved icons stay)
or **Forget saved icons**.

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
- **Right-click** a bookmark, folder or the bar (also inside the dropdowns):
  - Folders: **Open all in tabs**, **in a new window** or **in an incognito
    window**. Subfolders are included, and it asks first when that's more than
    15 tabs.
  - Bookmarks: open here, in a new tab, a new window or an incognito window.
  - New and incognito windows open with the same size and position as the
    window you're in, or maximized / fullscreen like it.
  - **Always open in incognito** (bookmarks and folders) marks it with a
    check mark. From then on it opens in an incognito window however you open
    it: click, middle-click, Open all, or from the address bar suggestions.
    On a folder it covers everything inside, subfolders included; the items
    inside then show the setting greyed out, since it can only be changed on
    the folder. Such bookmarks carry a small incognito icon. The setting is
    included in **Export**.
- **Middle-click a folder** to open everything in it: in tabs, or in an
  incognito window for bookmarks set to always open in incognito.
  - Edit, rename, copy the link, add a page or folder, delete (with **Undo**),
    or add a bookmark to your shortcuts. The built-in
  root folders (Other bookmarks…) can't be renamed or deleted.
- **Keyboard:** ↓ / Enter opens a folder, ↑ ↓ move through a menu, → opens a
  submenu, ← goes back, and Esc closes.
- The bar updates as soon as you add, move or rename a bookmark.

To hide the bar, click **Edit**, then **Hide bookmarks**. Bookmarklets
(`javascript:` bookmarks) are left out because they can't run from this page.

## History

The clock button right of the address bar opens a menu with:

- **Recently closed** tabs and windows (up to 15). Clicking one restores it
  with its back/forward history, like Ctrl+Shift+T.
- **Show full history**, which opens the browser's History page.

## Search by image

Drop an image on the pinned tab, either a file or an image dragged from a web
page, to search for it:

- With **Bing** as search engine: Bing visual search.
- With any other: **Google Lens**. DuckDuckGo, Brave Search, Startpage, Kagi,
  Ecosia and Qwant have no public way to search by an uploaded image.

A dropped file opens a new tab that sends it to the engine (big photos are
scaled down to 2000 px first), and that tab becomes the results page. An image
from a web page is searched by its address. Neither upload is an official API:
they send the image the way the engines' own "search by image" buttons do, so
they could break if an engine changes them.

## Wallpaper

Click **Edit**, then **Wallpaper…**, then **Choose image…**, or drop an image
file on that dialog.

- **Fill the page** crops the image to cover the whole tab. **Fit inside the
  page** shows all of it.
- **Dim** darkens the image so labels and the bookmarks bar stay readable.
- **Remove** goes back to the plain background.

The image stays on your computer, in the extension's own storage. Very large
photos are scaled down to your screen size (at least 2560 px) so the page
opens quickly. Animated GIFs and SVGs are kept as they are. Changes show up
in every open New Tab.

## Keeping your settings

Your shortcuts, wallpaper and settings live in the browser's storage for this
extension. They survive reloads and browser restarts, but they're wiped if the
extension is removed, or loaded from another folder (which gives it a new
extension ID). To make them permanent:

1. On the New Tab page, click **Edit**, then **Export**. This saves
   `settings.json` with your shortcuts, wallpaper image (with fit and dim),
   bookmarks-bar setting and the domains you hid from the address bar.
2. Move that file to the `defaults/` folder of the extension, so its path is
   `defaults/settings.json`.

Whenever the extension starts with empty storage, it loads everything from that
file. An install that already has data is never overwritten. Export again after
you change things.

`defaults/settings.json` is git-ignored and never committed: it stays on your
computer only, and `git pull` leaves it alone. If you clone this repository
again somewhere else, copy the file across.

**Import** (in Edit mode) restores a `settings.json` at any time. It also
accepts the older shortcut-only export.

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
- `history`: for address bar suggestions. The extension only deletes a page
  when you click × on it.
- `search`: to search with your default search engine from the address bar.
- `contextMenus`: for *Add this page / link to Static New Tab*.
- Optional, only if you use **Missing icons…**: access to all websites, to
  read sites' pages for their icon. It's never requested otherwise, and can be
  revoked from the same dialog.
- `storage`, `unlimitedStorage`: for your shortcuts, settings and wallpaper.
  The browser won't clear them to free up space.

Nothing is sent anywhere.

## How it works

The pinned tab shows the extension's page directly
(`chrome-extension://…/newtab.html`) instead of `chrome://newtab`. A
`chrome://newtab` page can never take the keyboard focus from the browser's
own address bar, but an extension page can. That's what lets the in-page
address bar get the cursor. The browser's address bar shows that extension URL
on the pinned tab.

Pages you open from the pinned tab (shortcuts, bookmarks, URLs typed in its
address bar) open in a new tab at the end of the strip, and the pinned tab
stays as it is. This matters for sign-ins: a site opened in a new tab
receives the same request as a URL typed in the browser's address bar,
including `SameSite=Strict` cookies. If the pinned tab navigated itself, the
browser would send it as a cross-site request without those cookies, and
sites like Google could treat you as half signed-out. Searches open the
search engine's URL the same way.

When you press `+` or Ctrl+T, the browser opens a new tab. The extension
closes it right away and switches to the pinned New Tab. Closing it before it
has finished loading keeps it out of *Recently closed*, so Ctrl+Shift+T still
reopens your last real tab.

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
