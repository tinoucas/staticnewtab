// Static New Tab — settings backup, restore and defaults.
// Shared by the page and the background service worker (importScripts).
//
// A backup is one JSON file: shortcuts, display settings and the wallpaper
// image (as a data URL). Put it at defaults/settings.json in the extension
// folder and a fresh install (or the same folder loaded under a new
// extension ID) starts with it.

const Settings = (() => {
  const APP = 'static-new-tab';
  const DB_NAME = 'static-new-tab';
  const STORE = 'files';
  const WALLPAPER = 'wallpaper';
  const DEFAULTS_PATH = 'defaults/settings.json';
  // Plain settings copied as-is (the wallpaper is handled separately).
  const KEYS = ['shortcuts', 'showBookmarks', 'omniboxHiddenHosts'];

  // -------------------------------------------------------------------------
  // IndexedDB (the wallpaper image)

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

  const readImage = () => idb('readonly', (s) => s.get(WALLPAPER));
  const writeImage = (blob) => idb('readwrite', (s) => s.put(blob, WALLPAPER));
  const deleteImage = () => idb('readwrite', (s) => s.delete(WALLPAPER));

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  // -------------------------------------------------------------------------
  // Export / import

  async function exportAll() {
    const data = await chrome.storage.local.get([...KEYS, WALLPAPER]);
    const out = { app: APP, version: 1, exported: new Date().toISOString() };
    for (const k of KEYS) if (k in data) out[k] = data[k];
    if (data[WALLPAPER]) {
      const blob = await readImage();
      if (blob) {
        const { fit, dim } = data[WALLPAPER];
        out.wallpaper = { fit, dim, image: await blobToDataUrl(blob) };
      }
    }
    return out;
  }

  const isBackup = (obj) => obj && typeof obj === 'object' && obj.app === APP;

  async function importAll(obj) {
    if (!isBackup(obj)) throw new Error('Not a Static New Tab settings file.');
    const set = {};
    for (const k of KEYS) if (k in obj) set[k] = obj[k];

    if (obj.wallpaper?.image) {
      const blob = await (await fetch(obj.wallpaper.image)).blob();
      await writeImage(blob);
      set[WALLPAPER] = { fit: obj.wallpaper.fit || 'cover', dim: obj.wallpaper.dim ?? 20, id: Date.now() };
      await chrome.storage.local.set(set);
    } else {
      await chrome.storage.local.set(set);
      if ('wallpaper' in obj) {
        await deleteImage();
        await chrome.storage.local.remove(WALLPAPER);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Defaults for a fresh install

  async function applyDefaultsIfFresh() {
    const data = await chrome.storage.local.get(['initialized', 'shortcuts', WALLPAPER]);
    if (data.initialized) return false;
    // Existing data (installed before this feature): keep it.
    const fresh = !('shortcuts' in data) && !data[WALLPAPER];
    let applied = false;
    if (fresh) {
      try {
        const res = await fetch(chrome.runtime.getURL(DEFAULTS_PATH));
        if (res.ok) {
          await importAll(await res.json());
          applied = true;
        }
      } catch {
        // No defaults file, or not valid: start empty.
      }
    }
    await chrome.storage.local.set({ initialized: true });
    return applied;
  }

  return { exportAll, importAll, isBackup, applyDefaultsIfFresh, readImage, writeImage, deleteImage };
})();
