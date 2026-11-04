/* Ajay AutoFlow - runs in the page (MAIN world).
 * While an upload is active, Flow's hidden <input type=file>.click() is captured instead of opening
 * the OS file dialog; the extension then fills that input with the user's image/video. */
(function () {
  'use strict';
  if (window.__awsUploadHook) return;
  window.__awsUploadHook = true;

  const ACTIVE_ATTR = 'data-aws-upload-active';
  let pendingInput = null;
  const nativeClick = HTMLInputElement.prototype.click;

  HTMLInputElement.prototype.click = function (...args) {
    if (this.type !== 'file' || document.documentElement.getAttribute(ACTIVE_ATTR) !== 'true') {
      return nativeClick.apply(this, args);
    }
    pendingInput = this;
    document.dispatchEvent(new CustomEvent('AWS_FILE_INPUT_CAPTURED'));
  };

  // Some builds call showPicker() instead of click()
  if (HTMLInputElement.prototype.showPicker) {
    const nativePicker = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = function (...args) {
      if (this.type !== 'file' || document.documentElement.getAttribute(ACTIVE_ATTR) !== 'true') {
        return nativePicker.apply(this, args);
      }
      pendingInput = this;
      document.dispatchEvent(new CustomEvent('AWS_FILE_INPUT_CAPTURED'));
    };
  }

  document.addEventListener('AWS_UPLOAD_FILE_DATA', (ev) => {
    let data = ev.detail;
    try { if (typeof data === 'string') data = JSON.parse(data); } catch (e) { data = null; }
    const input = pendingInput || document.querySelector('input[type="file"]');
    if (!data || !input) return;
    try {
      let b64 = data.base64 || '';
      if (b64.includes(',')) b64 = b64.split(',')[1];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], data.filename || 'upload.jpg', { type: data.mimeType || 'image/jpeg' });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      document.dispatchEvent(new CustomEvent('AWS_UPLOAD_DONE'));
    } catch (e) {
      document.dispatchEvent(new CustomEvent('AWS_UPLOAD_ERROR', { detail: String(e) }));
    } finally {
      pendingInput = null;
    }
  });
})();
