// Upload page for search by image: opened in a new tab by the New Tab page
// with #<key>; the image waits in chrome.storage.session under that key.
// The form is posted from this tab, which then becomes the results page.

(async () => {
  const status = document.getElementById('status');
  const key = location.hash.slice(1);
  const data = key && (await chrome.storage.session.get(key))[key];
  if (!data) {
    // Back from the results: the image was already sent.
    status.textContent = 'This image search was already sent.';
    return;
  }
  await chrome.storage.session.remove(key);

  const preview = document.getElementById('preview');
  preview.src = data.dataUrl;
  preview.hidden = false;

  const service = await ImageSearch.service();
  status.textContent = `Searching with ${service.name}…`;

  const blob = await (await fetch(data.dataUrl)).blob();
  const file = new File([blob], data.name, { type: data.type });
  const { action, fields } = service.form({ ...data, file });

  const form = document.createElement('form');
  form.method = 'POST';
  form.enctype = 'multipart/form-data';
  form.action = action;
  for (const f of fields) {
    const input = document.createElement('input');
    input.name = f.name;
    if (f.file) {
      input.type = 'file';
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
    } else {
      input.type = 'hidden';
      input.value = f.value;
    }
    form.append(input);
  }
  document.body.append(form);
  form.submit();
})().catch((err) => {
  document.getElementById('status').textContent = `Couldn't search by image: ${err.message}`;
});
