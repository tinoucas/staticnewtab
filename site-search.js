// Static New Tab — how to search a given site ("Tab to search").
//
// 1. data/site-search.json: one search URL per domain, built from Kagi's
//    open-source bangs list (MIT, see data/LICENSE-bangs and
//    tools/build-site-search.py). Covers ~9000 sites: amazon.fr, x.com,
//    aliexpress.com, youtube.com, wikipedia…
// 2. With the optional access to all websites (Edit → Missing icons…): the
//    site's own OpenSearch description, the standard browsers use to learn
//    site searches (<link rel="search" type="application/opensearchdescription+xml">).
//    Found ones are kept in chrome.storage.local "siteSearchFound".
// 3. Otherwise null: the caller falls back to "site:example.com …" with the
//    chosen search engine.

const SiteSearch = (() => {
  const FOUND_KEY = 'siteSearchFound'; // { host: [name, template] }
  const TIMEOUT = 6000;

  let table = null; // { "amazon.fr": ["Amazon.fr", "https://www.amazon.fr/s?k=%s"] }
  let tableLoad = null;
  let found = {};
  const tried = new Map(); // host -> Promise (OpenSearch lookups this session)

  chrome.storage.local.get(FOUND_KEY).then((d) => (found = d[FOUND_KEY] || {}));

  function preload() {
    tableLoad ??= fetch(chrome.runtime.getURL('data/site-search.json'))
      .then((r) => r.json())
      .then((t) => (table = t))
      .catch(() => (table = {}));
    return tableLoad;
  }

  const norm = (host) => host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');

  // "fr.aliexpress.com" → ["fr.aliexpress.com", "aliexpress.com"]
  function candidates(host) {
    const labels = norm(host).split('.');
    const out = [];
    for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'));
    return out;
  }

  const entry = (name, template, source) => ({ name, template, source });

  // What we already know, without waiting (table loaded, or found earlier).
  function known(host) {
    for (const h of candidates(host)) {
      if (found[h]) return entry(found[h][0], found[h][1], 'opensearch');
      if (table?.[h]) return entry(table[h][0], table[h][1], 'list');
    }
    return null;
  }

  async function hasAccess() {
    try {
      return await chrome.permissions.contains({ origins: ['https://*/*', 'http://*/*'] });
    } catch {
      return false;
    }
  }

  async function get(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal });
      return res.ok ? { url: res.url, text: await res.text() } : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function openSearch(host) {
    const page = await get(`https://${host}/`);
    if (!page) return null;
    const doc = new DOMParser().parseFromString(page.text.slice(0, 300000), 'text/html');
    const link = doc.querySelector('link[rel~="search" i][type="application/opensearchdescription+xml" i][href]');
    if (!link) return null;
    let descUrl;
    try {
      descUrl = new URL(link.getAttribute('href'), page.url).href;
    } catch {
      return null;
    }
    const desc = await get(descUrl);
    if (!desc) return null;
    const xml = new DOMParser().parseFromString(desc.text, 'application/xml');
    const url = [...xml.getElementsByTagName('Url')]
      .find((u) => (u.getAttribute('type') || '').toLowerCase() === 'text/html' && u.getAttribute('template'));
    if (!url) return null;
    // {searchTerms} is the query; optional {param?} placeholders are dropped.
    let template = url.getAttribute('template').replace(/\{searchTerms\}/g, '%s');
    template = template.replace(/[?&][^=&]+=\{[^}]+\?\}/g, '').replace(/\{[^}]+\?\}/g, '');
    if (!template.includes('%s') || /\{[^}]+\}/.test(template) || !/^https?:\/\//.test(template)) return null;
    const name = xml.getElementsByTagName('ShortName')[0]?.textContent.trim() || norm(host);
    return [name, template];
  }

  // The best search for host, or null (then search with "site:host").
  async function find(host) {
    await preload();
    const k = known(host);
    if (k) return k;
    const h = norm(host);
    if (!(await hasAccess())) return null;
    if (!tried.has(h)) {
      tried.set(h, openSearch(h).then(async (result) => {
        if (result) {
          found[h] = result;
          await chrome.storage.local.set({ [FOUND_KEY]: found });
        }
        return result;
      }).catch(() => null));
    }
    const result = await tried.get(h);
    return result ? entry(result[0], result[1], 'opensearch') : null;
  }

  // Fill a template: %s in the query string takes "+" for spaces, in the
  // path "%20".
  function urlFor(template, query) {
    const q = template.indexOf('?');
    const inQuery = q >= 0 && template.indexOf('%s') > q;
    const value = encodeURIComponent(query);
    return template.replace(/%s/g, inQuery ? value.replace(/%20/g, '+') : value);
  }

  return { preload, known, find, urlFor, norm };
})();
