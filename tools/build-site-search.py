#!/usr/bin/env python3
"""Build data/site-search.json from Kagi's open-source bangs list (MIT).

    python3 tools/build-site-search.py [path/to/bangs.json]

Without an argument it downloads
https://raw.githubusercontent.com/kagisearch/bangs/main/data/bangs.json.

Many domains have several bangs (a subreddit, Google Shopping…); this keeps
one "main" search per domain: the entry named after the site itself, then
the shortest trigger, then the simplest URL. Output: {"amazon.fr":
["Amazon.fr", "https://www.amazon.fr/s?k=%s"], …} with keys lower-case and
without "www.".
"""
import json
import re
import sys
import urllib.request
from urllib.parse import urlsplit

SOURCE = 'https://raw.githubusercontent.com/kagisearch/bangs/main/data/bangs.json'
OUT = 'data/site-search.json'

# Sites whose bangs are all variants (e.g. one per language pair), with a
# general search added here.
OVERRIDES = {
    # Auto-detect the language, translate to your usual one.
    'translate.google.com': ['Google Translate', 'https://translate.google.com/?sl=auto&text=%s&op=translate'],
}


def load():
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding='utf-8') as f:
            return json.load(f)
    with urllib.request.urlopen(SOURCE) as r:
        return json.load(r)


def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def penalty(entry, domain):
    name, url = entry.get('s', ''), entry['u']
    parts = urlsplit(url.replace('{{{s}}}', 'QUERY'))
    label = domain.split('.')[-2] if domain.count('.') >= 1 else domain
    named_after_site = norm(label) in norm(name) or norm(label).startswith(norm(name) or '-')
    path_depth = len([p for p in parts.path.split('/') if p and 'QUERY' not in p])
    extra_params = len([p for p in parts.query.split('&') if p and 'QUERY' not in p])
    # The query is the whole value of a parameter (q=%s, not
    # q=subreddit:%s or q=!safeoff+%s).
    clean = any(p.split('=', 1)[-1] == 'QUERY' and p.split('=', 1)[0].lower() not in ('u', 'url')
                for p in parts.query.split('&'))
    return (
        0 if named_after_site else 1,
        0 if clean else 1 if 'QUERY' in parts.query else 2,
        1 if '(' in name else 0,  # "Reddit (subreddit)", "Wikipedia (FR)"…
        path_depth + extra_params,
        len(entry.get('t', '')),
        len(url),
    )


def main():
    best = {}
    for e in load():
        url, dom = e.get('u', ''), (e.get('d') or '').lower()
        if '{{{s}}}' not in url or not dom or not url.startswith(('https://', 'http://')):
            continue
        key = dom[4:] if dom.startswith('www.') else dom
        # The search must stay on the site it's listed for.
        host = (urlsplit(url.replace('{{{s}}}', 'x')).hostname or '').lower()
        if not (host == dom or host.endswith('.' + key) or host == key):
            continue
        cand = (penalty(e, key), e)
        if key not in best or cand[0] < best[key][0]:
            best[key] = cand
    out = {k: [e.get('s') or k, e['u'].replace('{{{s}}}', '%s')] for k, (_, e) in best.items()}
    out.update(OVERRIDES)
    out = dict(sorted(out.items()))
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(out)} sites written to {OUT}')


if __name__ == '__main__':
    main()
