// Static New Tab — search by image (drop an image on the New Tab page).
//
// Google → Google Lens, Bing → Bing visual search. The other engines in the
// list have no public way to search by an uploaded image, so they use Google
// Lens. Neither upload is an official API: they post the image the way the
// engines' own "search by image" buttons do, and could change.
//   Lens: multipart POST to https://lens.google.com/v3/upload, file in
//         "encoded_image"; a link: https://lens.google.com/uploadbyurl?url=…
//   Bing: multipart POST to https://www.bing.com/images/search?view=detailv2
//         &iss=sbiupload…, base64 image (no data: prefix) in "imageBin"
//         (as done by the open-source "Search by Image" extension);
//         a link: https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:…

const ImageSearch = (() => {
  const MAX_SIDE = 2000; // big photos are scaled down before upload
  const MAX_BYTES = 4 * 1024 * 1024;

  const SERVICES = {
    lens: {
      name: 'Google Lens',
      byUrl: (url) => `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(url)}`,
      form(image) {
        return {
          action: `https://lens.google.com/v3/upload?st=${Date.now()}`,
          fields: [{ name: 'encoded_image', file: image }],
        };
      },
    },
    bing: {
      name: 'Bing',
      byUrl: (url) => `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${encodeURIComponent(url)}`,
      form(image) {
        return {
          action: `https://www.bing.com/images/search?view=detailv2&iss=sbiupload&FORM=SBIHMP&sbifnm=${encodeURIComponent(image.name)}`,
          fields: [{ name: 'imageBin', value: image.dataUrl.slice(image.dataUrl.indexOf(',') + 1) }],
        };
      },
    },
  };

  // Which service matches the address bar's search engine setting.
  async function service() {
    const { searchEngine } = await chrome.storage.local.get('searchEngine');
    const url = searchEngine?.url || '';
    return /(^|\.)bing\.com\//.test(url.replace(/^https?:\/\//, '')) ? SERVICES.bing : SERVICES.lens;
  }

  function toDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  // Scale big images down (JPEG) so the upload is quick and fits in storage.
  async function prepare(file) {
    let blob = file;
    let name = file.name || 'image.jpg';
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      if (scale < 1 || file.size > MAX_BYTES || !/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
        const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
        canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
        blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
        name = name.replace(/\.[^.]*$/, '') + '.jpg';
      }
    } catch {
      // Not decodable here (e.g. some formats): send it as it is.
    }
    return { name, type: blob.type || 'image/jpeg', dataUrl: await toDataUrl(blob) };
  }

  return { service, prepare, SERVICES };
})();
