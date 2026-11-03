// Static New Tab — drop an image on the page to search by image
// (image-search.js). A file is posted to the service, which opens its results
// in a new tab; an image dragged from another page is searched by its address.

(() => {
  const hint = document.getElementById('drop-hint');
  let internal = false; // a drag that started on this page (tiles, bookmarks)
  let depth = 0;

  document.addEventListener('dragstart', () => (internal = true));
  document.addEventListener('dragend', () => (internal = false));

  const wallpaperDialogOpen = () => document.getElementById('wp-dialog')?.open;
  const types = (e) => [...(e.dataTransfer?.types || [])];
  const looksLikeImage = (e) => {
    const t = types(e);
    return t.includes('Files') || t.includes('text/uri-list') || t.includes('text/html');
  };
  const ours = (e) => !internal && !wallpaperDialogOpen() && looksLikeImage(e);

  function setHint(on) {
    hint.hidden = !on;
  }

  document.addEventListener('dragenter', async (e) => {
    if (!ours(e)) return;
    depth += 1;
    if (depth === 1) {
      hint.querySelector('.drop-service').textContent = (await ImageSearch.service()).name;
      setHint(true);
    }
  });
  document.addEventListener('dragleave', (e) => {
    if (!ours(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) setHint(false);
  });
  document.addEventListener('dragover', (e) => {
    if (!ours(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  // The address of an image dragged from a web page.
  function imageUrl(dt) {
    const html = dt.getData('text/html');
    if (html) {
      const img = new DOMParser().parseFromString(html, 'text/html').querySelector('img[src]');
      const src = img?.getAttribute('src');
      if (src && /^https?:\/\//i.test(src)) return src;
    }
    const uri = dt.getData('text/uri-list').split(/\r?\n/).find((l) => l && !l.startsWith('#'));
    if (uri && /^https?:\/\/.+\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?.*)?$/i.test(uri)) return uri;
    return null;
  }

  document.addEventListener('drop', async (e) => {
    if (!ours(e)) return;
    e.preventDefault();
    depth = 0;
    setHint(false);
    const dt = e.dataTransfer;
    const file = [...dt.files].find((f) => f.type.startsWith('image/'));
    try {
      if (file) {
        const [svc, image] = await Promise.all([ImageSearch.service(), ImageSearch.prepare(file)]);
        ImageSearch.submit(svc, image);
        return;
      }
      const url = imageUrl(dt);
      if (url) await openUrl((await ImageSearch.service()).byUrl(url));
    } catch (err) {
      alert(`Couldn't search by image: ${err.message}`);
    }
  });
})();
