/* Ajay AutoFlow - shared helpers (content script, isolated world) */
var AWS = window.AWS || {};
window.AWS = AWS;
(function () {
  'use strict';
  const $ = window.jQuery;
  AWS.$ = $;

  /* ---------- logging (shown in side panel "Logs" tab) ---------- */
  const fmt = (args) => args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a))).join(' ');
  const send = (level, args) => {
    const entry = { level, message: fmt(args), timestamp: Date.now() };
    try { chrome.runtime.sendMessage({ type: 'ACTION_LOG', data: entry }).catch(() => {}); } catch (e) {}
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)('[Ajay Flow]', entry.message);
  };
  AWS.log = (...a) => send('info', a);
  AWS.warn = (...a) => send('warn', a);
  AWS.error = (...a) => send('error', a);

  AWS.bg = (msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => { void chrome.runtime.lastError; resolve(res || null); });
    } catch (e) { resolve(null); }
  });

  /* ---------- timing ---------- */
  const CANCELLED = 'Cancelled';
  AWS.CANCELLED = CANCELLED;
  AWS.isCancelErr = (e) => String(e && e.message ? e.message : e).includes(CANCELLED);
  AWS.sleep = (ms, isCancelled, jitter) => {
    const total = jitter ? ms * (0.6 + 0.8 * Math.random()) : ms;
    return new Promise((resolve, reject) => {
      if (!isCancelled) return setTimeout(resolve, total);
      const start = Date.now();
      const iv = setInterval(() => {
        if (isCancelled()) { clearInterval(iv); reject(new Error(CANCELLED)); return; }
        if (Date.now() - start >= total) { clearInterval(iv); resolve(); }
      }, 50);
    });
  };
  const checkCancel = (isCancelled) => { if (isCancelled && isCancelled()) throw new Error(CANCELLED); };
  AWS.checkCancel = checkCancel;

  /* ---------- simple async mutex (one UI action sequence at a time) ---------- */
  class Mutex {
    constructor() { this.p = Promise.resolve(); }
    run(fn) {
      const next = this.p.then(() => fn());
      this.p = next.catch(() => {});
      return next;
    }
  }
  AWS.uiLock = new Mutex();

  /* ---------- selectors ---------- */
  AWS.selectors = Object.assign({}, window.AWS_DEFAULT_SELECTORS);
  AWS.loadSelectors = async () => {
    AWS.selectors = Object.assign({}, window.AWS_DEFAULT_SELECTORS);
    try {
      const st = await chrome.storage.local.get('aws_custom_selectors');
      const raw = st.aws_custom_selectors;
      if (raw && String(raw).trim()) {
        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (obj && typeof obj === 'object') Object.assign(AWS.selectors, obj);
      }
    } catch (e) { AWS.warn('Custom selectors JSON is invalid, using defaults'); }
    return AWS.selectors;
  };

  // split "a, b:has(c, d), e" on top-level commas only
  function splitTopLevel(sel) {
    const out = []; let depth = 0, quote = null, cur = '';
    for (const ch of String(sel)) {
      if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === '(' || ch === '[') depth++;
      if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  AWS.splitSelector = splitTopLevel;

  // Robust query: whole list first; if it throws (one invalid / unsupported part),
  // query each part separately and merge. Arrays are accepted too.
  AWS.q = (sel) => {
    if (!sel) return $();
    if (Array.isArray(sel)) sel = sel.join(', ');
    try { return $(sel); } catch (e) { /* fall through */ }
    let res = $();
    for (const part of splitTopLevel(sel)) { try { res = res.add($(part)); } catch (e) { /* skip bad part */ } }
    return res;
  };

  /* ---------- element readiness ---------- */
  AWS.isUsable = ($el) => {
    if (!$el || $el.length === 0) return false;
    const el = $el[0];
    if (!$el.is(':visible') || $el.is(':disabled')) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  };
  AWS.isVisibleEl = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  };
  // first visible element of a selector (not only the first element)
  AWS.firstVisible = (sel) => { const arr = AWS.q(sel).toArray(); return arr.find((e) => AWS.isVisibleEl(e)) || null; };
  AWS.allVisible = (sel) => AWS.q(sel).toArray().filter((e) => AWS.isVisibleEl(e));

  AWS.waitFor = async (sel, isCancelled, timeout = 5000, interval = 100, needVisible = true) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      checkCancel(isCancelled);
      const $el = AWS.q(sel);
      if (needVisible ? AWS.isUsable($el) || !!AWS.firstVisible(sel) : $el.length > 0) { await AWS.sleep(200, isCancelled); return $el; }
      await AWS.sleep(interval, isCancelled);
    }
    return null;
  };

  // wait until fn() returns a truthy value
  AWS.waitUntil = async (fn, isCancelled, timeout = 5000, interval = 150) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      checkCancel(isCancelled);
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      await AWS.sleep(interval, isCancelled);
    }
    return null;
  };

  AWS.waitGone = async (sel, isCancelled, timeout = 30000, interval = 200) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      checkCancel(isCancelled);
      if (!AWS.isUsable(AWS.q(sel))) return true;
      await AWS.sleep(interval, isCancelled);
    }
    return false;
  };

  /* ---------- trusted input through chrome.debugger ---------- */
  AWS.attachDebugger = () => AWS.bg({ type: 'DBG_ATTACH' });
  AWS.detachDebugger = () => AWS.bg({ type: 'DBG_DETACH' });
  AWS.typeText = async (text) => { if (!text) return true; const r = await AWS.bg({ type: 'DBG_INSERT_TEXT', text }); return !!(r && r.success); };
  // modifiers: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift
  AWS.pressKey = async (key, code, keyCode, modifiers) => {
    let text;
    let mods = modifiers;
    if (key === '@') { text = '@'; if (mods === undefined) mods = 8; }
    const r = await AWS.bg({ type: 'DBG_KEY', key, code, keyCode, text, modifiers: mods });
    return !!(r && r.success);
  };
  AWS.pressEscape = () => AWS.pressKey('Escape', 'Escape', 27);
  AWS.pressBackspace = async (n = 1) => { for (let i = 0; i < n; i++) { await AWS.pressKey('Backspace', 'Backspace', 8); await AWS.sleep(25); } };

  async function clickAtElement(kind, el, isCancelled, xRatio) {
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
    const r = el.getBoundingClientRect();
    const ratio = xRatio != null ? xRatio : (kind === 'click' ? 0.25 : 0.5);
    const x = Math.round(r.left + r.width * ratio);
    const y = Math.round(r.top + r.height / 2);
    const res = await AWS.bg({ type: kind === 'click' ? 'DBG_CLICK' : 'DBG_HOVER', x, y });
    if (!res || !res.success) {
      // fallback to synthetic events if debugger is unavailable
      if (kind === 'click') { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); el.click(); }
      else { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); }
    }
    await AWS.sleep(300, isCancelled);
  }

  async function pointerAction(kind, sel, label, isCancelled, timeout = 5000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      checkCancel(isCancelled);
      await AWS.sleep(interval, isCancelled);
      const $el = AWS.q(sel);
      let el = null;
      if (AWS.isUsable($el)) el = $el.get(0);
      else {
        const vis = $el.toArray().find((e) => AWS.isVisibleEl(e) && !e.disabled);
        if (vis) el = vis;
      }
      if (el) { await clickAtElement(kind, el, isCancelled); return true; }
    }
    checkCancel(isCancelled);
    throw new Error(AWS.q(sel).length === 0
      ? `${label} - element not found (${timeout}ms)`
      : `${label} - element found but not visible/ready (${timeout}ms)`);
  }
  AWS.click = (sel, label = 'Element', isCancelled, timeout, interval) => pointerAction('click', sel, label, isCancelled, timeout, interval);
  AWS.hover = (sel, label = 'Element', isCancelled, timeout, interval) => pointerAction('hover', sel, label, isCancelled, timeout, interval);
  AWS.clickIfPresent = async (sel, label, isCancelled) => {
    if (AWS.q(sel).length > 0) {
      try { await AWS.click(sel, label, isCancelled, 2500); return true; }
      catch (e) { if (AWS.isCancelErr(e)) throw e; AWS.warn(`${label}: ${e.message}`); return false; }
    }
    return false;
  };
  // click / hover a DOM element directly
  AWS.clickEl = async (el, label = 'Element', isCancelled, xRatio) => {
    if (!el || !AWS.isVisibleEl(el)) throw new Error(`${label} - element not visible`);
    await clickAtElement('click', el, isCancelled, xRatio);
    return true;
  };
  AWS.hoverEl = async (el, label = 'Element', isCancelled) => {
    if (!el || !el.isConnected) throw new Error(`${label} - element not found`);
    await clickAtElement('hover', el, isCancelled, 0.5);
    return true;
  };

  /* ---------- text / aria / icon based finding ---------- */
  AWS.CLICKABLE = 'button, a[href], [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], mat-list-item, mat-option, mat-radio-button, mat-slide-toggle, mat-chip, mat-chip-option, flow-menu-item, li, label';
  AWS.norm = (s) => String(s || '').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  const ICON_SEL = 'mat-icon, i, .material-icons, .material-symbols-outlined, .material-symbols-rounded, .google-symbols, span';
  // material icon ligature names inside an element (e.g. "edit", "more_vert")
  AWS.iconNames = (el) => {
    const set = new Set();
    if (!el) return set;
    const nodes = [el, ...el.querySelectorAll(ICON_SEL)];
    for (const n of nodes) {
      if (n.children && n.children.length) continue;
      const t = (n.textContent || '').trim();
      if (/^[a-z][a-z0-9_]{1,40}$/.test(t)) set.add(t);
    }
    return set;
  };
  // everything a human (or screen reader) can read on an element
  AWS.elText = (el) => {
    if (!el) return '';
    const parts = [el.innerText || el.textContent || '', el.getAttribute('aria-label') || '', el.getAttribute('title') || '', el.getAttribute('data-tooltip') || '', el.getAttribute('mattooltip') || ''];
    const img = el.tagName === 'IMG' ? el : null;
    if (img && img.alt) parts.push(img.alt);
    return AWS.norm(parts.join(' '));
  };
  const toRegexList = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]).map((r) => (r instanceof RegExp ? r : new RegExp(`\\b${String(r).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i')));

  /* findClickable({ within, text, icons, exclude, excludeIcons, selector, minScore })
   * Returns the best visible clickable element whose text/aria/title matches `text`
   * (regex or list) or that contains one of `icons` (exact ligature names). */
  AWS.findClickable = (opts = {}) => {
    const roots = opts.within ? (Array.isArray(opts.within) ? opts.within : [opts.within]) : [document];
    const textRes = toRegexList(opts.text);
    const exRes = toRegexList(opts.exclude);
    const icons = new Set(opts.icons || []);
    const exIcons = new Set(opts.excludeIcons || []);
    const sel = opts.selector || AWS.CLICKABLE;
    let best = null, bestScore = 0;
    const seen = new Set();
    for (const root of roots) {
      if (!root) continue;
      const list = root.querySelectorAll ? root.querySelectorAll(sel) : [];
      for (const el of list) {
        if (seen.has(el)) continue; seen.add(el);
        if (!AWS.isVisibleEl(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        const txt = AWS.elText(el);
        const ic = AWS.iconNames(el);
        if (exRes.some((r) => r.test(txt))) continue;
        if ([...ic].some((n) => exIcons.has(n))) continue;
        let score = 0;
        if (textRes.length && textRes.some((r) => r.test(txt))) score += 10;
        if (icons.size && [...ic].some((n) => icons.has(n))) score += 8;
        if (!score) continue;
        // prefer short, specific elements over big containers
        score += Math.max(0, 5 - Math.floor(txt.length / 25));
        if (score > bestScore) { bestScore = score; best = el; }
      }
    }
    return bestScore >= (opts.minScore || 1) ? best : null;
  };
  AWS.waitClickable = (opts, isCancelled, timeout = 4000) => AWS.waitUntil(() => AWS.findClickable(opts), isCancelled, timeout);

  /* ---------- name matching for menu / popover items ---------- */
  // 100 = exact, 80 = exact ignoring "@", 60 = starts with, 40 = contains as whole word
  AWS.nameScore = (candidate, name) => {
    const c = AWS.norm(candidate).replace(/^@+/, '');
    const n = AWS.norm(name).replace(/^@+/, '');
    if (!c || !n) return 0;
    if (c === n) return 100;
    const firstLine = c.split('\n')[0].trim();
    if (firstLine === n) return 90;
    if (c.startsWith(n + ' ') || firstLine.startsWith(n + ' ')) return 60;
    const re = new RegExp(`(^|[^a-z0-9])${n.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    if (re.test(c)) return 40;
    return 0;
  };
  // Inside `roots`, find the element that best shows `name` and return the element to click.
  AWS.findItemByName = (roots, name, opts = {}) => {
    const list = (Array.isArray(roots) ? roots : [roots]).filter(Boolean);
    const clickableSel = opts.clickable || '[role="option"], [role="menuitem"], [role="button"], button, mat-list-item, mat-option, li, flow-menu-item, [tabindex]';
    const avoidIcons = new Set(opts.avoidIcons || ['play_arrow', 'play_circle', 'pause', 'volume_up', 'more_vert', 'close', 'delete', 'edit', 'search']);
    let best = null, bestScore = 0, bestLen = 1e9;
    for (const root of list) {
      const nodes = root.querySelectorAll('*');
      for (const el of nodes) {
        if (!AWS.isVisibleEl(el)) continue;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) continue;
        let txt = '';
        if (el.tagName === 'IMG') txt = el.alt || el.title || '';
        else {
          const own = el.children.length === 0 ? (el.textContent || '') : '';
          txt = own || el.getAttribute('aria-label') || el.getAttribute('title') || '';
        }
        const sc = AWS.nameScore(txt, name);
        if (!sc) continue;
        const len = AWS.norm(txt).length;
        if (sc > bestScore || (sc === bestScore && len < bestLen)) { best = el; bestScore = sc; bestLen = len; }
      }
    }
    if (!best || bestScore < (opts.minScore || 40)) return null;
    // click the row / option that holds the label, but never a play / preview button
    let target = best.closest(clickableSel) || best;
    if (target && avoidIcons.size && [...AWS.iconNames(target)].some((n) => avoidIcons.has(n)) && target.tagName === 'BUTTON') target = best;
    return { el: target, label: best, score: bestScore };
  };

  /* ---------- prompt editor helpers ---------- */
  // place the caret at the very end of a contenteditable / textarea
  AWS.caretToEnd = (el) => {
    // Flow frequently replaces its rich-text editor while a popup is opening.
    // Never apply a Selection Range to a detached editor: Chrome will report
    // "addRange(): The given range isn't in document" and typing goes astray.
    if (!el || !el.isConnected) return false;
    try {
      const actual = (el.isContentEditable || el.matches('textarea, input'))
        ? el : (el.querySelector('[contenteditable="true"], textarea, input') || el);
      if (!actual.isConnected) return false;
      const doc = actual.ownerDocument;
      const root = actual.getRootNode();
      if (!doc || !root || (root !== doc && (!root.host || !root.host.isConnected))) return false;
      if (doc !== document) return false;
      if (!actual.isContentEditable && !actual.matches('textarea, input')) return false;
      actual.focus({ preventScroll: true });
      if (actual.matches('textarea, input')) {
        const n = actual.value.length;
        actual.setSelectionRange(n, n);
        return true;
      }
      const sel = (root.getSelection && root.getSelection()) || doc.getSelection();
      if (!sel || !actual.isConnected) return false;
      const range = doc.createRange();
      range.selectNodeContents(actual);
      range.collapse(false);
      // The editor may have been recreated between focus() and createRange().
      if (!actual.isConnected || !range.startContainer.isConnected) return false;
      sel.removeAllRanges();
      if (!actual.isConnected) return false;
      sel.addRange(range);
      doc.dispatchEvent(new Event('selectionchange'));
      return true;
    } catch (e) {
      // React/Angular editor rerenders are normal; caller can refind the editor.
      return false;
    }
  };
  AWS.editorText = (el) => (el ? (el.tagName === 'TEXTAREA' ? el.value : (el.innerText || el.textContent || '')) : '').replace(/\u00a0/g, ' ');

  /* ---------- "only re-configure when a setting changed" cache (5 min) ---------- */
  const TTL = 300000;
  const cache = new Map();
  AWS.settingsChanged = (pairs, commit = false) => {
    const changed = pairs.some(([k, v]) => {
      const c = cache.get(k);
      if (!c || Date.now() > c.exp) return true;
      if (commit) c.exp = Date.now() + TTL;
      return JSON.stringify(c.v) !== JSON.stringify(v);
    });
    if (changed && commit) pairs.forEach(([k, v]) => cache.set(k, { v, exp: Date.now() + TTL }));
    return changed;
  };
  AWS.resetSettingsCache = () => cache.clear();
  AWS.forgetSetting = (k) => cache.delete(k);

  /* ---------- prompt matching for image names / characters ----------
   * Each match also reports whether the user typed "@" right before the name
   * (hasAt) so the typing code never produces "@@" or a duplicate name. */
  const esc = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  function findMatches(text, names, key) {
    const found = [];
    if (!text || !names || !names.length) return found;
    names.forEach((rawName, idx) => {
      const name = String(rawName || '').replace(/^@+/, '').trim();
      if (!name) return;
      const word = /^\w/.test(name) && /\w$/.test(name);
      // optional "@" in front, name must be a whole word
      const re = new RegExp(word ? `(@?)(?<![\\w])${esc(name)}(?![\\w])` : `(@?)${esc(name)}`, 'gi');
      let m;
      while ((m = re.exec(text)) !== null) {
        const hasAt = m[1] === '@';
        found.push({ index: m.index, length: m[0].length, hasAt, nameLength: name.length, [key]: idx });
        if (m[0].length === 0) re.lastIndex++;
      }
    });
    // earliest first; on the same start prefer the longest name ("Ali Khan" over "Ali")
    found.sort((a, b) => a.index - b.index || b.length - a.length);
    const out = []; let end = 0;
    for (const f of found) if (f.index >= end) { out.push(f); end = f.index + f.length; }
    return out;
  }
  AWS.stripExt = (n) => String(n || '').replace(/\.[^/.]+$/, '');
  AWS.cleanCharName = (n) => String(n || '').replace(/^@+/, '').trim();
  // only "@Name" is a mention; "Yuna, what is this?" stays plain dialogue text
  const atOnly = (list) => list.filter((m) => m.hasAt);
  AWS.imageMatches = (text, images) => atOnly(findMatches(text, (images || []).map((i) => AWS.stripExt(i && i.name)), 'imageIndex'));
  AWS.characterMatches = (text, chars) => atOnly(findMatches(text, (chars || []).map(AWS.cleanCharName), 'characterIndex'));

  /* ---------- last frame of a video (for "concat"/extend chains) ---------- */
  AWS.extractLastFrame = (videos) => {
    if (!videos || !videos.length) return Promise.resolve(null);
    const src = videos[videos.length - 1].currentSrc || videos[videos.length - 1].src;
    if (!src) return Promise.resolve(null);
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous'; v.preload = 'auto'; v.muted = true;
      const done = (val) => { clearTimeout(t); resolve(val); };
      const t = setTimeout(() => done(null), 30000);
      v.addEventListener('loadedmetadata', () => { v.currentTime = Math.max(0, v.duration - 0.05); });
      v.addEventListener('seeked', () => {
        try {
          const c = document.createElement('canvas');
          c.width = v.videoWidth; c.height = v.videoHeight;
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          done(c.toDataURL('image/jpeg', 0.95));
        } catch (e) { AWS.warn('Could not read last frame:', e); done(null); }
      });
      v.addEventListener('error', () => done(null));
      v.src = src; v.load();
    });
  };

  /* ---------- misc ---------- */
  AWS.isFlowPage = (u) => {
    const url = u || window.location.href;
    return url.includes('flow.google.com') || url.includes('labs.google/fx');
  };
  AWS.blobToDataUrl = async (url) => {
    const blob = await (await fetch(url)).blob();
    return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
  };
  // any image URL (blob:, data:, same-origin or Google storage) -> data URL
  AWS.urlToDataUrl = async (url) => {
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    try { return await AWS.blobToDataUrl(url); } catch (e) { /* CORS -> ask background */ }
    const r = await AWS.bg({ type: 'FETCH_AS_DATAURL', url });
    return r && r.success ? r.dataUrl : null;
  };
})();
