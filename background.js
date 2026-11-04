/* Ajay AutoFlow - background service worker */
'use strict';

const FLOW_PATTERNS = ['*://flow.google.com/*', '*://labs.google/fx/*'];

/* ---------------- Download naming state ---------------- */
let folderPrefix = '';          // "my-folder/"
let namePrefix = '';            // "tag_" used for files Flow downloads by itself (upscaled)
let autoRename = true;
let renameOffTimer = null;
const plannedNames = new Map(); // url -> "folder/file.ext"
let handledDownloads = 0;       // how many Flow media downloads we have named so far

const cleanSlashes = (s) => String(s || '').trim().replace(/^[/\\]+|[/\\]+$/g, '');

function onDeterminingFilename(item, suggest) {
  const url = item.url || '';
  const fromFlow = url.includes('google') || url.startsWith('data:') || url.startsWith('blob:') || url.includes('flow');
  const fromUs = !item.byExtensionId || item.byExtensionId === chrome.runtime.id;
  if (!fromFlow || !fromUs || !autoRename) return;

  const nameOrUrl = item.filename || url;
  const isVideo = /\.(mp4|webm|mov)$/i.test(nameOrUrl) || (item.mime || '').startsWith('video/');
  const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|jfif)$/i.test(nameOrUrl) || (item.mime || '').startsWith('image/') || url.startsWith('data:image');
  if (!isVideo && !isImage) return;
  handledDownloads++;

  if (plannedNames.has(url)) {
    suggest({ filename: plannedNames.get(url).replace(/^[/\\]+/, ''), conflictAction: 'uniquify' });
    plannedNames.delete(url);
    return;
  }
  const original = item.filename || '';
  const base = original.split(/[/\\]/).pop() || original;
  const ext = base.includes('.') ? '.' + base.split('.').pop() : (isVideo ? '.mp4' : '.png');
  let fn;
  if (namePrefix && namePrefix.trim()) fn = folderPrefix + namePrefix.trim().replace(/_+$/, '') + ext;
  else fn = folderPrefix + (base || 'download' + ext);
  suggest({ filename: fn.replace(/^[/\\]+/, ''), conflictAction: 'uniquify' });
}

function enableRename(on) {
  const has = chrome.downloads.onDeterminingFilename.hasListener(onDeterminingFilename);
  if (on && !has) chrome.downloads.onDeterminingFilename.addListener(onDeterminingFilename);
  if (!on && has) chrome.downloads.onDeterminingFilename.removeListener(onDeterminingFilename);
}
enableRename(true);

/* ---------------- Side panel ---------------- */
async function setupPanel() {
  try {
    await chrome.sidePanel.setOptions({ path: 'sidepanel/index.html', enabled: true });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) { /* older chrome */ }
}
setupPanel();

chrome.runtime.onInstalled.addListener(async (details) => {
  await setupPanel();
  if (details.reason === 'install') {
    // reload already-open Flow tabs so the content script gets injected
    try {
      const tabs = await chrome.tabs.query({ url: FLOW_PATTERNS });
      for (const t of tabs) if (t.id) chrome.tabs.reload(t.id).catch(() => {});
    } catch (e) {}
  }
});

/* ---------------- Debugger (trusted input) ---------------- */
const attached = new Set();
chrome.tabs.onRemoved.addListener((id) => attached.delete(id));
chrome.debugger.onDetach.addListener((src) => { if (src.tabId !== undefined) attached.delete(src.tabId); });

async function ensureAttached(tabId) {
  if (attached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (!/already attached/i.test(msg)) throw e;
  }
  attached.add(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {});
    await chrome.debugger.sendCommand({ tabId }, 'Network.setCacheDisabled', { cacheDisabled: true });
  } catch (e) {}
}
const cdp = (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params || {});

async function mouseMove(tabId, x, y) {
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', modifiers: 0 });
}
async function mouseClick(tabId, x, y) {
  await mouseMove(tabId, x, y);
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers: 0 });
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers: 0 });
}
async function keyPress(tabId, m) {
  const base = { key: m.key, code: m.code, windowsVirtualKeyCode: m.keyCode, nativeVirtualKeyCode: m.keyCode };
  if (m.text !== undefined) { base.text = m.text; base.unmodifiedText = m.text; }
  if (m.modifiers !== undefined) base.modifiers = m.modifiers;
  if (m.keyType) return cdp(tabId, 'Input.dispatchKeyEvent', { type: m.keyType, ...base });
  // keys that type a character use keyDown (+text); control keys (Enter, Escape, Backspace, End...)
  // use rawKeyDown so they never insert stray characters / new lines
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: m.text !== undefined ? 'keyDown' : 'rawKeyDown', ...base });
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

/* ---------------- Messages ---------------- */
const errText = (e) => (e && e.message) ? e.message : String(e);

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab && sender.tab.id;
  const needTab = () => { if (!tabId) { reply({ success: false, error: 'No tab id' }); return false; } return true; };

  switch (msg && msg.type) {
    case 'SET_ZOOM':
      if (!needTab()) return false;
      chrome.tabs.setZoom(tabId, msg.zoomFactor).then(() => reply({ success: true })).catch((e) => reply({ success: false, error: errText(e) }));
      return true;

    case 'DOWNLOAD_RESOURCE': {
      const { url, filename, folder, autoChangeFileName } = msg;
      const opts = { url, saveAs: false, conflictAction: 'uniquify' };
      if (autoChangeFileName !== false) {
        const f = cleanSlashes(folder);
        const n = String(filename || '').trim().replace(/^[/\\]+/, '');
        const dest = f ? `${f}/${n}` : n;
        if (dest) { plannedNames.set(url, dest); opts.filename = dest; }
      }
      chrome.downloads.download(opts, (id) => {
        const le = chrome.runtime.lastError;
        reply(!le && id ? { success: true, downloadId: id } : { success: false, error: le ? le.message : 'Download failed to start' });
      });
      return true;
    }

    case 'SET_FOLDER_NAME': {
      if (typeof msg.folderName === 'string') folderPrefix = msg.folderName.trim() ? cleanSlashes(msg.folderName) + '/' : '';
      if (typeof msg.prefix === 'string') namePrefix = msg.prefix.trim();
      if (typeof msg.autoChangeFileName === 'boolean') autoRename = msg.autoChangeFileName;
      if (renameOffTimer) { clearTimeout(renameOffTimer); renameOffTimer = null; }
      enableRename(autoRename);
      reply({ success: true });
      return false;
    }

    case 'DOWNLOAD_COUNTER':
      reply({ count: handledDownloads });
      return false;

    case 'OPEN_DOWNLOAD_SETTINGS':
      chrome.tabs.create({ url: 'chrome://settings/downloads' });
      reply({ success: true });
      return false;

    case 'PROMPT_GROUP_STATUS': {
      const st = msg.data && msg.data.status;
      if (st === 'completed' || st === 'cancelled' || st === 'error') {
        // reset custom prefix 5 minutes after a batch finishes (late upscaled downloads still get renamed)
        if (renameOffTimer) clearTimeout(renameOffTimer);
        renameOffTimer = setTimeout(() => { namePrefix = ''; renameOffTimer = null; }, 300000);
      }
      return false;
    }

    case 'FETCH_AS_DATAURL':
      (async () => {
        try {
          const r = await fetch(msg.url, { credentials: 'include' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const blob = await r.blob();
          const buf = new Uint8Array(await blob.arrayBuffer());
          let bin = '';
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
          reply({ success: true, dataUrl: `data:${blob.type || 'image/png'};base64,${btoa(bin)}` });
        } catch (e) { reply({ success: false, error: errText(e) }); }
      })();
      return true;

    case 'DBG_ATTACH':
      if (!needTab()) return false;
      ensureAttached(tabId).then(() => reply({ success: true })).catch((e) => reply({ success: false, error: errText(e) }));
      return true;

    case 'DBG_DETACH':
      if (!needTab()) return false;
      (async () => {
        try { if (attached.has(tabId)) await chrome.debugger.detach({ tabId }); } catch (e) {}
        attached.delete(tabId);
        reply({ success: true });
      })();
      return true;

    case 'DBG_INSERT_TEXT':
      if (!needTab()) return false;
      ensureAttached(tabId).then(() => cdp(tabId, 'Input.insertText', { text: msg.text }))
        .then(() => reply({ success: true })).catch((e) => reply({ success: false, error: errText(e) }));
      return true;

    case 'DBG_KEY':
      if (!needTab()) return false;
      ensureAttached(tabId).then(() => keyPress(tabId, msg))
        .then(() => reply({ success: true })).catch((e) => reply({ success: false, error: errText(e) }));
      return true;

    case 'DBG_HOVER':
      if (!needTab()) return false;
      ensureAttached(tabId).then(() => mouseMove(tabId, msg.x, msg.y))
        .then(() => reply({ success: true })).catch((e) => reply({ success: false, error: errText(e) }));
      return true;

    case 'DBG_CLICK':
      if (!needTab()) return false;
      ensureAttached(tabId).then(() => mouseClick(tabId, msg.x, msg.y))
        .then(() => reply({ success: true })).catch((e) => reply({ success: false, error: errText(e) }));
      return true;

    default:
      return false;
  }
});
