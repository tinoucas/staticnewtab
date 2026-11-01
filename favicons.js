// Static New Tab — favicons.
//
// Icons come from the browser's favicon cache (chrome-extension://…/_favicon),
// which only knows sites you have visited in this browser. After importing
// bookmarks on a new computer it knows none, and Helium doesn't fall back to
// an online icon service. So when the cache only has its generic globe, the
// icon is loaded from the site itself: /favicon.ico, then
// /apple-touch-icon.png. The browser's HTTP cache keeps what was downloaded;
// sites without either are remembered for a week so they aren't asked again
// on every display. Requests go to the bookmarked sites only, never to a
// third-party icon service, and carry no referrer.
//
// Opt-in (Edit → Missing icons…, which asks for access to all websites):
// the page of each site without an icon is read once, without cookies, to
// find the icon it declares (<link rel="icon">, apple-touch-icon…). Found
// icons are saved on this computer (chrome.storage.local "siteIcons") and
// then shown with no network request at all.

function faviconUrl(pageUrl) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', '64');
  return u.toString();
}

function pixels(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c.toDataURL();
}

// The browser's generic globe, to recognise "no icon cached".
let genericIcon = null;
function genericIconPixels() {
  genericIcon ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(pixels(img));
    img.onerror = () => resolve(null);
    img.src = faviconUrl('https://static-new-tab.invalid/');
  });
  return genericIcon;
}

const Favicons = (() => {
  const MISS_KEY = 'favicon-misses'; // { origin: time of the last failed try }
  const FOUND_KEY = 'favicon-found'; // { origin: path that worked }
  const STORE_KEY = 'siteIcons'; // { origin: data URL } (opt-in, see above)
  const ALL_SITES = ['https://*/*', 'http://*/*'];
  const PATHS = ['/favicon.ico', '/apple-touch-icon.png'];
  const MISS_TTL = 7 * 24 * 3600 * 1000;
  const TIMEOUT = 10000;
  const MAX_PARALLEL = 6;
  const MAX_ICON_BYTES = 300 * 1024;

  const fromSite = new Map(); // origin -> Promise<src | null>
  const read = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key)) || {};
    } catch {
      return {};
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  };
  const misses = read(MISS_KEY);
  const found = read(FOUND_KEY);

  // Saved icons and the opt-in permission.
  let stored = {};
  let canFetch = false;
  const ready = Promise.all([
    chrome.storage.local.get(STORE_KEY).then((d) => (stored = d[STORE_KEY] || {})),
    chrome.permissions.contains({ origins: ALL_SITES }).then((v) => (canFetch = v)),
  ]).catch(() => {});

  const recheckPermission = () =>
    chrome.permissions.contains({ origins: ALL_SITES }).then((v) => {
      canFetch = v;
      if (v) {
        // Earlier misses may now be found.
        fromSite.clear();
        for (const k of Object.keys(misses)) delete misses[k];
        write(MISS_KEY, misses);
      }
    });
  chrome.permissions.onAdded?.addListener(recheckPermission);
  chrome.permissions.onRemoved?.addListener(recheckPermission);

  const originOf = (url) => {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
    } catch {
      return null;
    }
  };

  // Load an image, resolving true if it decoded into something visible.
  function tryLoad(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      const timer = setTimeout(() => done(false), TIMEOUT);
      function done(ok) {
        clearTimeout(timer);
        img.onload = img.onerror = null;
        resolve(ok);
      }
      img.onload = () => done(img.naturalWidth > 0);
      img.onerror = () => done(false);
      img.src = src;
    });
  }

  // A small queue so a big folder doesn't fire hundreds of requests at once.
  let running = 0;
  const waiting = [];
  function limited(fn) {
    return new Promise((resolve) => {
      const start = async () => {
        running += 1;
        try {
          resolve(await fn());
        } catch {
          resolve(null);
        } finally {
          running -= 1;
          waiting.shift()?.();
        }
      };
      if (running < MAX_PARALLEL) start();
      else waiting.push(start);
    });
  }

  // ---------------------------------------------------------------------
  // With access to all websites: read the page, find its declared icon.

  async function get(url, { asText = false } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal });
      if (!res.ok) return null;
      return { res, body: asText ? await res.text() : await res.blob() };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Icons a page declares, best first: a regular icon of 32px or more,
  // then apple-touch-icon (180px, good quality), then any icon.
  function declaredIcons(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html.slice(0, 300000), 'text/html');
    const links = [...doc.querySelectorAll('link[rel][href]')]
      .map((l) => {
        const rel = l.getAttribute('rel').toLowerCase().split(/\s+/);
        if (!rel.some((r) => r === 'icon' || r.startsWith('apple-touch-icon'))) return null;
        let href;
        try {
          href = new URL(l.getAttribute('href'), baseUrl).href;
        } catch {
          return null;
        }
        const size = Math.max(0, ...(l.getAttribute('sizes') || '').split(/\s+/).map((s) => parseInt(s, 10) || 0));
        const touch = rel.some((r) => r.startsWith('apple-touch-icon'));
        const score = !touch && size >= 32 ? 3 : touch ? 2 : 1;
        return { href, score, size };
      })
      .filter(Boolean);
    links.sort((a, b) => b.score - a.score || Math.abs(a.size - 64) - Math.abs(b.size - 64));
    return links.map((l) => l.href);
  }

  function toDataUrl(blob) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  }

  async function fetchIcon(pageUrl) {
    const origin = originOf(pageUrl);
    const candidates = [];
    const page = await get(pageUrl, { asText: true });
    if (page && /html/i.test(page.res.headers.get('content-type') || '')) {
      candidates.push(...declaredIcons(page.body, page.res.url));
    }
    const finalOrigin = page ? originOf(page.res.url) : null;
    for (const o of new Set([finalOrigin, origin].filter(Boolean))) {
      for (const path of PATHS) candidates.push(o + path);
    }
    for (const href of new Set(candidates)) {
      if (/^data:image\//.test(href)) return href;
      const icon = await get(href);
      if (!icon || icon.body.size === 0 || icon.body.size > MAX_ICON_BYTES) continue;
      const type = icon.body.type || '';
      if (type && !/^image\/|octet-stream|icon/i.test(type)) continue;
      const data = await toDataUrl(type ? icon.body : new Blob([icon.body], { type: 'image/x-icon' }));
      if (data && (await tryLoad(data))) return data;
    }
    return null;
  }

  let saveTimer = 0;
  function saveIcon(origin, data) {
    stored[origin] = data;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => chrome.storage.local.set({ [STORE_KEY]: stored }), 300);
  }

  // ---------------------------------------------------------------------

  function siteIcon(pageUrl, { force = false } = {}) {
    const origin = originOf(pageUrl);
    if (!origin) return Promise.resolve(null);
    if (stored[origin]) return Promise.resolve(stored[origin]);
    if (!force && fromSite.has(origin)) return fromSite.get(origin);
    if (!force && Date.now() - (misses[origin] || 0) < MISS_TTL) return Promise.resolve(null);

    const p = limited(async () => {
      if (canFetch) {
        const data = await fetchIcon(pageUrl);
        if (data) {
          saveIcon(origin, data);
          delete misses[origin];
          write(MISS_KEY, misses);
          return data;
        }
      } else {
        // The path that worked last time first (it's in the HTTP cache).
        const paths = found[origin] ? [found[origin], ...PATHS.filter((x) => x !== found[origin])] : PATHS;
        for (const path of paths) {
          if (await tryLoad(origin + path)) {
            if (found[origin] !== path) {
              found[origin] = path;
              write(FOUND_KEY, found);
            }
            if (misses[origin]) {
              delete misses[origin];
              write(MISS_KEY, misses);
            }
            return origin + path;
          }
        }
      }
      misses[origin] = Date.now();
      write(MISS_KEY, misses);
      return null;
    });
    fromSite.set(origin, p);
    return p;
  }

  // Images left without an icon, filled in if one is found later (e.g. by
  // the "Missing icons" scan, in this or another open New Tab).
  let pending = [];

  function fillPending() {
    pending = pending.filter((p) => {
      const data = stored[originOf(p.pageUrl)];
      if (!data) return p.img.isConnected || p.placeholder?.isConnected;
      if (p.placeholder?.isConnected) p.placeholder.replaceWith(p.img);
      p.img.src = data;
      p.img.style.visibility = '';
      return false;
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORE_KEY]) return;
    stored = changes[STORE_KEY].newValue || {};
    fillPending();
  });

  // Fill <img> with the best icon for pageUrl. It stays hidden until known.
  // onMissing() runs if there's no icon at all and may return the node it
  // put in the image's place; by default the browser's generic globe is
  // shown, as the browser itself does.
  function set(img, pageUrl, { onMissing } = {}) {
    img.referrerPolicy = 'no-referrer';
    img.style.visibility = 'hidden';
    const show = () => (img.style.visibility = '');
    const missing = () => {
      const entry = { img, pageUrl, placeholder: null };
      if (onMissing) entry.placeholder = onMissing() || null;
      else {
        img.src = faviconUrl(pageUrl);
        show();
      }
      pending.push(entry);
    };
    const fallback = async () => {
      await ready;
      const src = await siteIcon(pageUrl);
      if (!src) return missing();
      img.src = src;
      show();
    };

    // Only the browser-cache answer is checked; the later src changes (the
    // site's own icon can't be read back as pixels) must not run this again.
    let first = true;
    const onFirst = (fn) => () => {
      if (!first) return;
      first = false;
      fn();
    };
    img.addEventListener('load', onFirst(async () => {
      if (pixels(img) === (await genericIconPixels())) fallback();
      else show();
    }));
    img.addEventListener('error', onFirst(fallback));
    img.src = faviconUrl(pageUrl);
  }

  // Does the browser itself have an icon for this page?
  function browserHasIcon(pageUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = async () => resolve(pixels(img) !== (await genericIconPixels()));
      img.onerror = () => resolve(false);
      img.src = faviconUrl(pageUrl);
    });
  }

  // The opt-in scan: find and save icons for every page given (one per
  // site) that has none yet. onProgress(done, total).
  async function scan(pageUrls, onProgress = () => {}) {
    await ready;
    const bySite = new Map();
    for (const url of pageUrls) {
      const o = originOf(url);
      if (o && !stored[o] && !bySite.has(o)) bySite.set(o, url);
    }
    const todo = [];
    for (const url of bySite.values()) if (!(await browserHasIcon(url))) todo.push(url);

    let done = 0;
    let foundCount = 0;
    onProgress(0, todo.length);
    await Promise.all(todo.map((url) => siteIcon(url, { force: true }).then((src) => {
      if (src && src.startsWith('data:')) foundCount += 1;
      onProgress(++done, todo.length);
    })));
    clearTimeout(saveTimer);
    await chrome.storage.local.set({ [STORE_KEY]: stored });
    return { checked: todo.length, found: foundCount };
  }

  return {
    set,
    scan,
    ALL_SITES,
    hasAccess: () => chrome.permissions.contains({ origins: ALL_SITES }),
    forget: async () => {
      stored = {};
      await chrome.storage.local.remove(STORE_KEY);
    },
    savedCount: () => Object.keys(stored).length,
  };
})();
