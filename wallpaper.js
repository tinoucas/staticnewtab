// Static New Tab — wallpaper.
// The image is kept in this extension's IndexedDB (it never leaves the
// computer); its display settings live in chrome.storage.local so every
// open New Tab updates together.

(() => {
  const SETTINGS_KEY = 'wallpaper'; // { id, fit, dim } — absent when none
  const DB_NAME = 'static-new-tab';
  const STORE = 'files';
  const FILE_KEY = 'wallpaper';

  const layer = document.getElementById('wallpaper');
  const dialog = document.getElementById('wp-dialog');
  const preview = document.getElementById('wp-preview');
  const none = document.getElementById('wp-none');
  const fileInput = document.getElementById('wp-file');
  const fitSelect = document.getElementById('wp-fit');
  const dimInput = document.getElementById('wp-dim');
  const dimValue = document.getElementById('wp-dim-value');
  const removeBtn = document.getElementById('wp-remove');

  const DEFAULTS = { fit: 'cover', dim: 20 };
  let settings = null;
  let shownId = null;
  let objectUrl = null;

  // -------------------------------------------------------------------------
  // IndexedDB

  function db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idb(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  const readImage = () => idb('readonly', (s) => s.get(FILE_KEY));
  const writeImage = (blob) => idb('readwrite', (s) => s.put(blob, FILE_KEY));
  const deleteImage = () => idb('readwrite', (s) => s.delete(FILE_KEY));

  // -------------------------------------------------------------------------
  // Import

  // Scale very large photos down (to the screen size, at least 2560 px) so
  // the page opens fast.
  async function prepare(file) {
    if (!file.type.startsWith('image/')) throw new Error('That file is not an image.');
    if (/gif|svg/.test(file.type)) return file; // keep animation / vectors
    const max = Math.max(2560, Math.round(Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1)));
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      return file;
    }
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 6e6) return file;
    const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
  }

  async function setImage(file) {
    const blob = await prepare(file);
    await writeImage(blob);
    await chrome.storage.local.set({
      [SETTINGS_KEY]: { ...DEFAULTS, ...settings, id: Date.now() },
    });
  }

  async function removeImage() {
    await deleteImage();
    await chrome.storage.local.remove(SETTINGS_KEY);
  }

  function update(patch) {
    if (!settings) return;
    chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, ...patch } });
  }

  // -------------------------------------------------------------------------
  // Display

  async function apply() {
    const root = document.documentElement.style;
    if (!settings) {
      document.body.classList.remove('has-wallpaper');
      shownId = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      root.removeProperty('--wp-image');
      syncDialog();
      return;
    }

    root.setProperty('--wp-fit', settings.fit === 'contain' ? 'contain' : 'cover');
    root.setProperty('--wp-dim', String((settings.dim ?? DEFAULTS.dim) / 100));

    if (shownId !== settings.id) {
      const blob = await readImage();
      if (!blob) {
        settings = null;
        return apply();
      }
      const url = URL.createObjectURL(blob);
      // Decode before showing so the image fades in whole.
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {});
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = url;
      shownId = settings.id;
      root.setProperty('--wp-image', `url("${url}")`);
    }
    document.body.classList.add('has-wallpaper');
    syncDialog();
  }

  function syncDialog() {
    const s = settings || DEFAULTS;
    preview.style.backgroundImage = settings && objectUrl ? `url("${objectUrl}")` : '';
    preview.style.backgroundSize = s.fit === 'contain' ? 'contain' : 'cover';
    none.hidden = !!settings;
    removeBtn.disabled = !settings;
    fitSelect.value = s.fit;
    fitSelect.disabled = !settings;
    dimInput.value = s.dim;
    dimInput.disabled = !settings;
    dimValue.textContent = `${s.dim}%`;
  }

  // -------------------------------------------------------------------------
  // UI

  document.getElementById('open-wallpaper').addEventListener('click', () => {
    syncDialog();
    dialog.showModal();
  });
  document.getElementById('wp-choose').addEventListener('click', () => fileInput.click());
  removeBtn.addEventListener('click', () => removeImage().catch((e) => alert(e.message)));
  fitSelect.addEventListener('change', () => update({ fit: fitSelect.value }));
  dimInput.addEventListener('input', () => {
    dimValue.textContent = `${dimInput.value}%`;
    document.documentElement.style.setProperty('--wp-dim', String(dimInput.value / 100));
  });
  dimInput.addEventListener('change', () => update({ dim: Number(dimInput.value) }));

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (file) setImage(file).catch((e) => alert(`Couldn't use that image: ${e.message}`));
  });

  // Drop an image file anywhere on the page.
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    document.body.classList.add('drop-target');
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) document.body.classList.remove('drop-target');
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    document.body.classList.remove('drop-target');
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (file) setImage(file).catch((err) => alert(`Couldn't use that image: ${err.message}`));
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(SETTINGS_KEY in changes)) return;
    settings = changes[SETTINGS_KEY].newValue || null;
    apply().catch(console.error);
  });

  chrome.storage.local.get(SETTINGS_KEY).then((data) => {
    settings = data[SETTINGS_KEY] || null;
    apply().catch(console.error);
  });
})();
