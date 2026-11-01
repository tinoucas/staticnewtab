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
  const PATHS = ['/favicon.ico', '/apple-touch-icon.png'];
  const MISS_TTL = 7 * 24 * 3600 * 1000;
  const TIMEOUT = 10000;
  const MAX_PARALLEL = 6;

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
        } finally {
          running -= 1;
          waiting.shift()?.();
        }
      };
      if (running < MAX_PARALLEL) start();
      else waiting.push(start);
    });
  }

  function siteIcon(pageUrl) {
    let origin;
    try {
      const u = new URL(pageUrl);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return Promise.resolve(null);
      origin = u.origin;
    } catch {
      return Promise.resolve(null);
    }
    if (fromSite.has(origin)) return fromSite.get(origin);
    if (Date.now() - (misses[origin] || 0) < MISS_TTL) return Promise.resolve(null);

    const p = limited(async () => {
      // The path that worked last time first (it's in the HTTP cache).
      const paths = found[origin] ? [found[origin], ...PATHS.filter((p) => p !== found[origin])] : PATHS;
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
      misses[origin] = Date.now();
      write(MISS_KEY, misses);
      return null;
    });
    fromSite.set(origin, p);
    return p;
  }

  // Fill <img> with the best icon for pageUrl. It stays hidden until known.
  // onMissing() runs if there's no icon at all; by default the browser's
  // generic globe is shown, as the browser itself does.
  function set(img, pageUrl, { onMissing } = {}) {
    img.referrerPolicy = 'no-referrer';
    img.style.visibility = 'hidden';
    const show = () => (img.style.visibility = '');
    const missing = () => {
      if (onMissing) onMissing();
      else {
        img.src = faviconUrl(pageUrl);
        show();
      }
    };
    const fallback = async () => {
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

  return { set };
})();
