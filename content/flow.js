/* Ajay AutoFlow - Google Flow automation steps (v1.1.0) */
(function () {
  'use strict';
  const A = window.AWS;
  const $ = A.$;
  const S = () => A.selectors;
  const tpl = (t, key, val) => String(t).split(`{${key}}`).join(String(val));
  const isAgentMode = (cfg) => !!(cfg && String(cfg.mode || '').includes('agentAutomation'));

  // jQuery .find / .closest that survive one bad selector part
  const findIn = (root, sel) => {
    if (!root || !sel) return [];
    try { return $(root).find(sel).toArray(); } catch (e) { /* split */ }
    let out = [];
    for (const p of A.splitSelector(sel)) { try { out = out.concat($(root).find(p).toArray()); } catch (e) {} }
    return out;
  };
  const closestAny = (el, sel) => {
    if (!el || !sel) return null;
    for (const p of A.splitSelector(sel)) { try { const c = $(el).closest(p)[0]; if (c) return c; } catch (e) {} }
    return null;
  };

  /* =====================================================================
   * Tiles: find / identify / status
   * ===================================================================== */
  const mediaSrc = ($tile) => {
    if (!$tile || !$tile.length) return null;
    const v = $tile.find('video')[0];
    if (v && (v.currentSrc || v.src)) return v.currentSrc || v.src;
    const i = $tile.find('img')[0];
    if (i && (i.currentSrc || i.src)) return i.currentSrc || i.src;
    return null;
  };

  const tileStatus = ($tile) => {
    const videos = $tile.find('video').toArray();
    const images = $tile.find('img').toArray();
    const hasResource = videos.length > 0 || images.length > 0;
    const $pct = $tile.find('div').filter(function () { return /^\d+%$/.test($(this).text().trim()); });
    const queued = $tile.find(S().tileOnQueue).length > 0;
    const hasPercentage = $pct.length > 0 || queued;
    let percent = 0;
    if ($pct.length) { const m = $pct.first().text().trim().match(/^(\d+)%$/); if (m) percent = parseInt(m[1], 10); }
    return { videos, images, hasResource, hasPercentage, percent, isGenerating: hasPercentage || !hasResource };
  };

  const resolveTile = (ref) => {
    const $items = A.q(S().outputItems);
    const n = $items.length;
    let index = -1;
    if (ref.anchor) {
      for (let i = 0; i < n; i++) if (mediaSrc($items.eq(i)) === ref.anchor) { index = i - ref.offset; break; }
    }
    if (index < 0) index = n - ref.fromEnd;
    return tpl(S().tileByIndexTemplate, 'index', Math.max(0, index));
  };
  A.resolveTile = resolveTile;

  function gridSnapshot() {
    const $items = A.q(S().outputItems);
    const srcs = new Set();
    let leadingPending = 0, counting = true;
    for (let i = 0; i < $items.length; i++) {
      const s = mediaSrc($items.eq(i));
      if (s) { srcs.add(s); counting = false; } else if (counting) leadingPending++;
    }
    return { srcs, leadingPending, count: $items.length };
  }
  A.gridSnapshot = gridSnapshot;

  /* =====================================================================
   * Prompt editor
   * ===================================================================== */
  const inAgentPanel = (el) => !!closestAny(el, S().agentPanel);
  function getEditor(preferAgent) {
    const eds = A.allVisible(S().promptTextarea);
    const uniq = eds.filter((e) => !eds.some((o) => o !== e && e.contains(o)));
    if (!uniq.length) return null;
    if (preferAgent) return uniq.find(inAgentPanel) || uniq[uniq.length - 1];
    return uniq.find((e) => !inAgentPanel(e)) || uniq[0];
  }
  A.getEditor = getEditor;

  async function focusEditorEnd(editor, isCancelled) {
    // Flow can detach the prompt input during a menu selection; reacquire it.
    const preferAgent = !!(editor && editor.isConnected && inAgentPanel(editor));
    let live = editor && editor.isConnected && A.isVisibleEl(editor) ? editor : getEditor(preferAgent);
    if (!live) return false;
    const active = document.activeElement;
    if (!active || !(active === live || live.contains(active))) {
      await A.clickEl(live, 'Prompt box', isCancelled, 0.5).catch(() => {});
    }
    // A click can itself cause a React/Angular rerender, invalidating live.
    live = getEditor(preferAgent) || live;
    let placed = A.caretToEnd(live);
    if (!placed) {
      await A.sleep(150, isCancelled);
      live = getEditor(preferAgent);
      if (!live) return false;
      placed = A.caretToEnd(live);
    }
    if (!placed) return false;
    await A.pressKey('End', 'End', 35, 2).catch(() => {}); // Ctrl+End
    await A.sleep(120, isCancelled);
    return true;
  }

  const chipCount = (editor) => findIn(editor, S().promptChipInEditor).length;
  const visiblePopovers = (editor) => A.allVisible(S().mentionPopover)
    .filter((p) => !(editor && (p.contains(editor) || editor.contains(p))))
    .filter((p, i, arr) => !arr.some((o) => o !== p && o.contains(p)));
  const fallbackRoots = () => Array.from(document.querySelectorAll('.cdk-overlay-container, [popover], [role="listbox"], [role="menu"], [role="dialog"]')).filter(A.isVisibleEl);

  const KIND = {
    character: { text: [/\bcharacters?\b/i], icons: ['accessibility_new', 'person', 'face', 'groups', 'person_pin'], sel: () => S().selectUploadCharacterType },
    voice: { text: [/\bvoices?\b/i, /\bspeakers?\b/i], icons: ['voice_selection', 'record_voice_over', 'graphic_eq', 'mic', 'voice_chat', 'campaign'], sel: () => S().selectSpeakerType },
    image: { text: [/\bimages?\b/i, /\bmedia\b/i, /\buploads?\b/i, /\bassets?\b/i], icons: ['drive_folder_upload', 'image', 'photo', 'photo_library', 'perm_media'], sel: () => S().selectUploadImageType }
  };

  async function findNamedItem(editor, name, isCancelled, timeout) {
    return A.waitUntil(() => {
      const roots = visiblePopovers(editor);
      return A.findItemByName(roots.length ? roots : fallbackRoots(), name, { minScore: 60 });
    }, isCancelled, timeout);
  }

  async function clickKindTab(editor, kind, isCancelled) {
    const k = KIND[kind];
    if (!k) return false;
    const viaSel = A.firstVisible(k.sel());
    if (viaSel) { await A.clickEl(viaSel, `${kind} type`, isCancelled).catch(() => {}); return true; }
    const roots = visiblePopovers(editor);
    if (!roots.length) return false;
    const el = A.findClickable({ within: roots, text: k.text, icons: k.icons });
    if (el) { await A.clickEl(el, `${kind} type`, isCancelled).catch(() => {}); return true; }
    return false;
  }

  /* ---------- Uploads section (reference images the user uploaded to Flow) ---------- */
  const UPLOADS_TAB_TEXT = [/^\s*(my\s+)?uploads?\s*$/i, /^\s*uploaded\b/i, /^\s*images?\s*$/i, /^\s*media\s*$/i, /^\s*assets?\s*$/i, /^\s*files?\s*$/i];
  const UPLOADS_TAB_ICONS = ['drive_folder_upload', 'upload', 'upload_file', 'cloud_upload', 'photo_library', 'perm_media', 'image', 'imagesmode', 'collections'];
  const NOT_UPLOADS = [/character/i, /voice/i, /speaker/i, /\bsort\b/i, /search/i, /^\s*upload\s+(a\s+)?(new\s+)?(image|file|media|video)/i];

  // Switch the open add/@ popup to the Uploads/Images tab. Never the Characters tab.
  async function clickUploadsTab(editor, isCancelled) {
    const roots = visiblePopovers(editor);
    const inPop = (el) => !roots.length || roots.some((r) => r.contains(el));
    let el = A.allVisible(S().uploadsTabInAddMenu).find((e) => inPop(e) && !NOT_UPLOADS.some((r) => r.test(A.elText(e))));
    if (!el && roots.length) {
      el = A.findClickable({ within: roots, selector: '[role="tab"], mat-list-item, button, [role="button"], [role="menuitem"], mat-chip, mat-chip-option, li', text: UPLOADS_TAB_TEXT, icons: UPLOADS_TAB_ICONS, exclude: NOT_UPLOADS, excludeIcons: ['accessibility_new', 'record_voice_over', 'voice_selection', 'play_arrow'] });
    }
    if (!el) return false;
    if (el.getAttribute('aria-selected') === 'true') return true;
    await A.clickEl(el, 'Uploads tab', isCancelled, 0.4).catch(() => {});
    await A.sleep(500, isCancelled);
    return true;
  }

  // "DRAGON_VILLAGE.jpg", "dragon village", "Dragon-Village" -> "dragon village"
  const assetKey = (t) => A.norm(A.stripExt(String(t || '').split('\n')[0].trim())).replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Exact-name item in the open popup (img alt / label / aria / title). No "first result" guessing.
  function uploadedItemByName(editor, name) {
    const want = assetKey(name);
    if (!want) return null;
    const pops = visiblePopovers(editor);
    const roots = pops.length ? pops : fallbackRoots();
    for (const root of roots) {
      for (const el of root.querySelectorAll('img, [aria-label], [title], span, div, p, label')) {
        if (!A.isVisibleEl(el) || el.tagName === 'INPUT' || el.isContentEditable) continue;
        if (el.tagName !== 'IMG' && el.children.length && !el.getAttribute('aria-label') && !el.getAttribute('title')) continue;
        const txt = el.tagName === 'IMG' ? (el.alt || el.title || '') : (el.children.length ? (el.getAttribute('aria-label') || el.getAttribute('title') || '') : (el.textContent || el.getAttribute('aria-label') || ''));
        if (assetKey(txt) !== want) continue;
        if (el.closest('button') && [...A.iconNames(el.closest('button'))].some((n) => ['more_vert', 'delete', 'edit', 'play_arrow', 'close'].includes(n))) continue;
        return el.closest(S().uploadedAssetItem) || el.closest('[role="option"], mat-list-item, [role="button"], [tabindex], li') || el;
      }
    }
    return null;
  }
  // fallback: label that starts with the name ("DRAGON_VILLAGE (1)", "DRAGON_VILLAGE copy") - only if exactly one such item
  function uploadedItemByPrefix(editor, name) {
    const want = assetKey(name);
    if (!want) return null;
    const pops = visiblePopovers(editor);
    const hits = new Set();
    for (const root of (pops.length ? pops : fallbackRoots())) {
      for (const el of root.querySelectorAll('img, [aria-label], [title], span, div, p, label')) {
        if (!A.isVisibleEl(el) || el.tagName === 'INPUT') continue;
        const txt = el.tagName === 'IMG' ? (el.alt || el.title || '') : (el.children.length ? (el.getAttribute('aria-label') || el.getAttribute('title') || '') : (el.textContent || ''));
        const k = assetKey(txt);
        if (k && k !== want && (k.startsWith(want + ' ') || k.startsWith(want + '('))) hits.add(el.closest(S().uploadedAssetItem) || el.closest('[role="option"], mat-list-item, [role="button"], [tabindex], li') || el);
      }
    }
    return hits.size === 1 ? [...hits][0] : null;
  }
  const findUploadedByName = (editor, name, isCancelled, timeout) => A.waitUntil(() => uploadedItemByName(editor, name), isCancelled, timeout);

  /* "@" mention -> pick the item from Flow's popup -> verify a chip was inserted.
   * Never types "@@". If nothing can be picked, the plain name is left in the prompt. */
  async function mention(name, kind, cfg, isCancelled) {
    name = A.cleanCharName(name);
    if (!name) return false;
    const label = kind.charAt(0).toUpperCase() + kind.slice(1);
    let editor = getEditor(isAgentMode(cfg));
    if (!editor) { A.warn(`${label} @${name}: prompt box not found`); return false; }
    if (!(await focusEditorEnd(editor, isCancelled))) {
      A.warn(`${label} @${name}: prompt box was replaced; retry after reopening Google Flow`);
      return false;
    }
    editor = getEditor(isAgentMode(cfg)) || editor;
    const chipsBefore = chipCount(editor);
    const textBefore = A.editorText(editor).replace(/\s+$/, '');

    // 1) type "@" exactly once
    await A.pressKey('@', 'Digit2', 50);
    await A.sleep(350, isCancelled);
    let t = A.editorText(editor).replace(/\s+$/, '');
    if (!t.endsWith('@') && !visiblePopovers(editor).length) { await A.typeText('@'); await A.sleep(350, isCancelled); }

    // 2) let the popup open, choose the right category if Flow shows one
    await A.waitUntil(() => visiblePopovers(editor).length > 0, isCancelled, 2000);
    if (kind !== 'image') await clickKindTab(editor, kind, isCancelled);
    else await clickUploadsTab(editor, isCancelled); // references live in the Uploads section, not Characters

    // 3) type the name (filters the list) and look for the exact item
    const search = A.firstVisible(S().searchUploadedImage);
    if (search && document.activeElement === search) await A.typeText(name);
    else {
      if (!(await focusEditorEnd(editor, isCancelled))) {
        A.warn(`${label} @${name}: editor changed while searching; could not enter mention safely`);
        return false;
      }
      await A.typeText(name);
    }
    await A.sleep(700, isCancelled);
    let item = await findNamedItem(editor, name, isCancelled, 3500);

    // multi-word names: some popups stop filtering at a space -> keep only the first word
    if (!item && /\s/.test(name)) {
      const first = name.split(/\s+/)[0];
      await A.pressBackspace(name.length - first.length);
      await A.sleep(600, isCancelled);
      item = await findNamedItem(editor, name, isCancelled, 2500);
    }
    // category tab might only be clickable after the popup filled up
    if (!item && kind !== 'image' && await clickKindTab(editor, kind, isCancelled)) item = await findNamedItem(editor, name, isCancelled, 2500);
    if (!item && kind === 'image') {
      const up = await findUploadedByName(editor, name, isCancelled, 2500);
      if (up) item = { el: up };
    }
    // Never silently pick the first/random character. A mismatched Flow
    // character would break face consistency in the user's image sequence.
    let target = item ? item.el : null;

    const verified = () => {
      const now = A.editorText(editor).replace(/\s+$/, '');
      const leftover = new RegExp(`@\\s*${name.split(/\s+/)[0].replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}[\\w ]*$`, 'i').test(now);
      return chipCount(editor) > chipsBefore || (!leftover && now !== textBefore && !visiblePopovers(editor).length);
    };

    if (target) {
      await A.clickEl(target, `${label}: ${name}`, isCancelled, 0.4).catch((e) => A.warn(e.message));
      await A.sleep(600, isCancelled);
      if (!verified() && visiblePopovers(editor).length) {
        await A.pressKey('Enter', 'Enter', 13); // select highlighted item (popup is still open, so this cannot submit)
        await A.sleep(600, isCancelled);
      }
    }
    // No exact match: do not press Enter. It may select the wrong reference
    // (or submit the unfinished prompt) on newer Flow interfaces.

    if (verified()) {
      if (visiblePopovers(editor).length) { await A.pressEscape(); await A.sleep(200, isCancelled); }
      await focusEditorEnd(editor, isCancelled);
      A.log(`${label} @${name} selected`);
      return true;
    }

    // cleanup: remove "@query" text that is still there and keep the plain name
    if (visiblePopovers(editor).length) { await A.pressEscape(); await A.sleep(200, isCancelled); }
    await focusEditorEnd(editor, isCancelled);
    const now = A.editorText(editor).replace(/\s+$/, '');
    const m = now.match(/@[^@]*$/);
    if (m && m[0].length <= name.length + 2) await A.pressBackspace(m[0].length);
    if (kind !== 'voice') await A.typeText(name);
    A.warn(`${label} @${name} not found in Flow's picker${kind !== 'voice' ? '; using plain text instead' : ''}. For characters: check the character exists in Flow, then click Scan characters from Flow in AutoFlow.`);
    return false;
  }
  A.mention = mention;

  /* =====================================================================
   * Voice (speaker)
   * ===================================================================== */
  const VOICE_AVOID_ICONS = ['play_arrow', 'play_circle', 'pause', 'pause_circle', 'volume_up', 'more_vert', 'edit', 'delete', 'close'];

  function voiceAttached(name) {
    const editor = getEditor(false);
    for (const box of A.allVisible(S().ingredientArea)) {
      for (const el of box.querySelectorAll('*')) {
        if (el.children.length || !A.isVisibleEl(el)) continue;
        if (editor && editor.contains(el) && !el.closest('[contenteditable="false"]')) continue; // plain prompt text
        if (A.nameScore(el.textContent || '', name) >= 90) return true;
      }
    }
    return false;
  }

  // The "+" next to the prompt (chat) box at the BOTTOM - never the upload button at the top of the page
  function bottomAddButton() {
    const editor = getEditor(false);
    const boxes = A.allVisible(S().promptBoxContainer).filter((b) => !editor || b.contains(editor));
    const inBox = (e) => boxes.some((b) => b.contains(e));
    const cands = new Set(A.allVisible(S().addImageButton).filter(inBox));
    const extra = boxes.length && A.findClickable({ within: boxes, icons: ['add', 'add_2', 'add_circle'], text: [/^add$/i, /add media/i, /add ingredient/i] });
    if (extra) cands.add(extra);
    if (!cands.size) return null;
    // lowest on screen = the one beside the chat box
    return [...cands].sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
  }
  let activePanel = null; // the panel opened by the bottom "+"
  async function openAddMenu(isCancelled) {
    const el = bottomAddButton();
    if (!el) { A.warn('"+" button next to the prompt box not found'); return false; }
    const before = new Set(visiblePopovers(null));
    await A.clickEl(el, 'Open add menu (prompt box +)', isCancelled, 0.5);
    const ok = !!(await A.waitUntil(() => visiblePopovers(null).length > 0, isCancelled, 2500));
    const pops = visiblePopovers(null);
    activePanel = pops.find((p) => !before.has(p)) || pops[pops.length - 1] || null;
    return ok;
  }

  async function typeInSearch(text, isCancelled) {
    const input = A.firstVisible(S().searchUploadedImage) || visiblePopovers(null).map((p) => p.querySelector('input')).find((i) => i && A.isVisibleEl(i));
    if (!input) return false;
    await A.clickEl(input, 'Search box', isCancelled, 0.5).catch(() => {});
    input.focus();
    try { input.select(); } catch (e) {}
    if (input.value) await A.pressBackspace(1);
    const ok = await A.typeText(text);
    if (!ok || input.value !== text) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await A.sleep(700, isCancelled);
    return true;
  }

  // Character first, then voice. Never throws (except Cancel) so the prompt step does not fail.
  async function selectSpeaker(name, cfg, isCancelled) {
    if (!name) return true;
    try {
      if (voiceAttached(name)) { A.log(`Voice ${name} already attached`); return true; }
      // Path A: "+" add menu -> Voice -> search -> pick
      if (await openAddMenu(isCancelled)) {
        await clickKindTab(null, 'voice', isCancelled);
        if (!(await searchUploads(name, isCancelled))) A.log('Voice search box not shown - checking the voice list directly');
        const item = await A.waitUntil(() => A.findItemByName(visiblePopovers(null), name, { minScore: 60, avoidIcons: VOICE_AVOID_ICONS }), isCancelled, 4000);
        if (item) {
          await A.clickEl(item.label || item.el, `Voice ${name}`, isCancelled, 0.4);
          await A.sleep(700, isCancelled);
          if (visiblePopovers(null).length) {
            // some builds need a confirm button after picking a voice
            const confirm = A.findClickable({ within: visiblePopovers(null), text: [/^(select|use|add|done|apply|ok)$/i, /use (this )?voice/i, /select voice/i] });
            if (confirm) { await A.clickEl(confirm, 'Confirm voice', isCancelled, 0.5); await A.sleep(500, isCancelled); }
          }
          if (visiblePopovers(null).length) { await A.pressEscape(); await A.sleep(200, isCancelled); }
          A.log(`Voice ${name} selected${voiceAttached(name) ? ' (verified)' : ''}`);
          return true;
        }
        dumpUploadsPanel(`voice ${name}`);
        A.warn(`Voice ${name} not found in the add menu, trying @mention`);
        await A.pressEscape(); await A.sleep(300, isCancelled);
      }
      // Path B: "@" mention with the voice category
      return await mention(name, 'voice', cfg, isCancelled);
    } catch (e) {
      if (A.isCancelErr(e)) throw e;
      A.warn(`Voice ${name} could not be selected: ${e.message || e}`);
      try { await A.pressEscape(); } catch (x) {}
      return false;
    }
  }
  A.selectSpeaker = selectSpeaker;

  // read the voice names Flow shows in its voice library (side panel "Scan voices")
  A.scanVoices = async function () {
    await A.attachDebugger();
    if (!(await openAddMenu())) return [];
    await clickKindTab(null, 'voice');
    await A.sleep(800);
    const names = new Set();
    const collect = () => {
      for (const p of visiblePopovers(null)) {
        const rows = p.querySelectorAll('[role="option"], mat-list-item, flow-menu-item, li, div.cdk-virtual-scroll-content-wrapper > div');
        rows.forEach((r) => {
          const first = String(r.innerText || '').split('\n').map((x) => x.trim()).filter((x) => x && !/^[a-z_]+$/.test(x))[0] || '';
          if (/^[A-Z][A-Za-z' .-]{1,30}$/.test(first) && !/^(voices?|characters?|images?|search|upload|create|new voice|sort)/i.test(first)) names.add(first);
        });
      }
    };
    collect();
    const vp = visiblePopovers(null).map((p) => p.querySelector('cdk-virtual-scroll-viewport, [class*="scroll"]')).find(Boolean);
    if (vp) for (let i = 0; i < 40; i++) { vp.scrollTop += Math.max(100, vp.clientHeight - 40); await A.sleep(250); collect(); if (vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 2) break; }
    await A.pressEscape();
    return Array.from(names);
  };

  /* =====================================================================
   * Project / UI setup
   * ===================================================================== */
  async function createProject(isCancelled) {
    const $b = await A.waitFor(S().createProjectButton, isCancelled, 8000);
    if (!$b || !$b.length) { A.warn('Create project button not found'); return false; }
    await A.click(S().createProjectButton, 'Create project button', isCancelled);
    await A.sleep(5000, isCancelled);
    return true;
  }

  async function backToProjectIfNeeded(isCancelled) {
    const href = window.location.href;
    if (href.includes('/trash') || href.includes('/characters') || /\/edit\//.test(href)) {
      const ok = await A.clickIfPresent(S().backProjectButton, 'Back to project', isCancelled);
      if (!ok) history.back();
      await A.sleep(1500, isCancelled);
    }
  }

  let uiConfigured = false;
  async function configureUiMode(isCancelled) {
    const s = S();
    await A.clickIfPresent(s.selectAllItemMode, 'All items view', isCancelled);
    if (uiConfigured) return true;
    await A.clickIfPresent(s.configureUIModeButton, 'Open view settings', isCancelled);
    await A.clickIfPresent(s.selectGridModeOption, 'Grid view', isCancelled);
    await A.clickIfPresent(s.selectSizeGridModeOption, 'Grid size', isCancelled);
    await A.clickIfPresent(s.selectShowTextModeOption, 'Show text toggle', isCancelled);
    await A.clickIfPresent(s.selectClearPromptModeOption, 'Clear prompt toggle', isCancelled);
    await A.clickIfPresent(s.closeConfigureUIModeButton, 'Close view settings', isCancelled);
    uiConfigured = true;
    return true;
  }

  /* =====================================================================
   * Agent mode
   * ===================================================================== */
  const AGENT_ICONS = ['smart_toy', 'robot_2', 'robot', 'support_agent', 'assistant', 'neurology'];
  function findAgentToggle() {
    const viaSel = A.allVisible(S().agentToggle).find((e) => !inAgentPanel(e) || /agent/i.test(A.elText(e)));
    if (viaSel) return viaSel;
    return A.findClickable({ text: [/^agent$/i, /\bagent mode\b/i, /\bflow agent\b/i, /\bagent\b/i], icons: AGENT_ICONS, exclude: [/\bagents\b/i, /settings/i, /session/i, /history/i] });
  }
  function readToggleState(el) {
    if (!el) return null;
    const nodes = [el, ...el.querySelectorAll('[role="switch"], [aria-pressed], [aria-checked], input[type="checkbox"]')];
    for (const n of nodes) {
      const p = n.getAttribute('aria-pressed') || n.getAttribute('aria-checked');
      if (p === 'true') return true;
      if (p === 'false') return false;
      if (n.tagName === 'INPUT') return !!n.checked;
    }
    const cls = String(el.className || '') + ' ' + String((el.parentElement && el.parentElement.className) || '');
    if (/\b(checked|selected|active|is-active|mat-mdc-slide-toggle-checked|mdc-switch--checked|toggled|on)\b/.test(cls)) return true;
    return null;
  }
  function agentState() {
    const t = findAgentToggle();
    const st = readToggleState(t);
    if (st !== null) return st;
    if (A.firstVisible(S().agentPanel)) return true;
    return null;
  }

  async function setAgentMode(cfg, isCancelled) {
    const want = isAgentMode(cfg);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const st = agentState();
      if (st === want || (st === null && !want)) return true;
      const el = want
        ? (A.firstVisible(S().enableAgentModeButton) || findAgentToggle())
        : (A.firstVisible(S().disableAgentModeButton) || findAgentToggle());
      if (!el) {
        if (!want) return true;
        throw new Error('Agent toggle not found in Flow (update "agentToggle" in Custom selectors)');
      }
      await A.clickEl(el, want ? 'Enable agent mode' : 'Disable agent mode', isCancelled, 0.5);
      await A.sleep(1500, isCancelled);
      if (st === null) { A.log('Agent toggle clicked (state could not be read, assuming it switched)'); return true; }
    }
    const fin = agentState();
    if (fin !== want && fin !== null) {
      if (want) throw new Error('Could not turn ON Flow agent mode');
      A.warn('Could not turn OFF Flow agent mode');
    }
    return true;
  }

  // "never ask before generating" - optional; a failure here is only a warning
  async function configureAgent(cfg, isCancelled) {
    try {
      const panel = A.firstVisible(S().agentPanel);
      const optSel = S().neverAskAgentSettingButton;
      const NEVER = [/never ask/i, /don'?t ask/i, /do not ask/i, /without asking/i, /never confirm/i, /auto[- ]?(generate|run|approve)/i, /always generate/i, /\bnever\b/i];
      const findOption = () => A.firstVisible(optSel) || A.findClickable({ text: NEVER, selector: 'mat-radio-button, [role="radio"], [role="menuitemradio"], [role="option"], mat-option, label, button, li' });
      if (!findOption()) {
        const gear = A.firstVisible(S().agentSettingsButton)
          || (panel && A.findClickable({ within: panel, icons: ['settings', 'tune', 'more_vert', 'more_horiz'], text: [/agent settings/i, /^settings$/i] }));
        if (gear) await A.clickEl(gear, 'Agent settings', isCancelled, 0.5);
        else if (A.firstVisible(S().configButton)) await A.click(S().configButton, 'Settings button', isCancelled);
        await A.sleep(700, isCancelled);
        const askRow = !findOption() && A.findClickable({ text: [/ask before/i, /confirm before/i, /approval/i, /confirmation/i] });
        if (askRow) { await A.clickEl(askRow, 'Ask-before setting', isCancelled, 0.5); await A.sleep(500, isCancelled); }
      }
      const opt = await A.waitUntil(findOption, isCancelled, 2500);
      if (!opt) { A.warn('Agent "never ask" option not found - agent confirmations will be auto-accepted instead'); await A.pressEscape(); return true; }
      await A.clickEl(opt, 'Agent: never ask', isCancelled, 0.3);
      await A.sleep(400, isCancelled);
      const save = A.firstVisible(S().saveAgentSettings) || A.findClickable({ text: [/^(save|done|apply|ok|confirm)$/i], selector: 'button' });
      if (save) await A.clickEl(save, 'Save agent settings', isCancelled, 0.5);
      else await A.pressEscape();
      await A.sleep(500, isCancelled);
      return true;
    } catch (e) {
      if (A.isCancelErr(e)) throw e;
      A.warn('Agent settings could not be set:', e);
      try { await A.pressEscape(); } catch (x) {}
      return true;
    }
  }

  // When the agent asks "Shall I generate...?" press its confirm button (agent panel only)
  async function autoConfirmAgent(isCancelled) {
    const panel = A.firstVisible(S().agentPanel);
    if (!panel) return false;
    const btn = A.findClickable({
      within: panel,
      selector: 'button, [role="button"]',
      text: [/^(generate|create|confirm|yes|approve|continue|proceed|run|go ahead|start|looks good)\b/i, /generate (it|them|now|images?|videos?)/i],
      exclude: [/cancel/i, /\bno\b/i, /stop/i, /\bedit\b/i, /settings/i, /new session/i]
    });
    if (!btn || btn.dataset.awsConfirmed) return false;
    btn.dataset.awsConfirmed = '1';
    await A.clickEl(btn, 'Agent confirm', isCancelled, 0.5).catch(() => {});
    A.log('Agent asked for confirmation - confirmed');
    return true;
  }

  async function clickOption(selector, label, isCancelled) {
    const $o = await A.waitFor(selector, isCancelled);
    if ($o && $o.length) { await A.click(selector, label, isCancelled); return true; }
    A.warn(`Option not found: ${label}`);
    return false;
  }

  /* =====================================================================
   * Model picker: exact / most-specific match + aliases + read-back check.
   * "Nano Banana 2.1" never picks a Light/Pro model and "Veo 3.1 - Lite"
   * prefers the exact item over "Lite [Lower Priority]".
   * ===================================================================== */
  const normModel = (t) => String(t || '')
    .toLowerCase()
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\blite\b/g, 'light')
    .replace(/(\d)\s*\.\s*(\d)/g, '$1.$2')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const modelTokens = (t) => normModel(t).split(' ').filter(Boolean);
  const EXCLUSIVE = ['light', 'pro', 'fast', 'quality', 'lower', 'priority', 'ultra'];
  function modelScore(optionText, wanted) {
    const o = normModel(optionText), w = normModel(wanted);
    if (!o || !w) return -1;
    if (o === w) return 1000;
    const ot = modelTokens(optionText), wt = modelTokens(wanted);
    if (!wt.every((x) => ot.includes(x))) return -1;
    if (ot.some((x) => EXCLUSIVE.includes(x) && !wt.includes(x))) return -1;
    return 500 - (ot.length - wt.length);
  }
  const MODEL_ALIASES = {
    'nano banana 2.1 light': ['Nano Banana 2 Light', 'Nano Banana Light'],
    'nano banana 2.1': ['Nano Banana 2'],
    'nano banana pro': ['Nano Banana Pro'],
    'veo 3.1 light': ['Veo Light'],
    'veo 3.1 fast': ['Veo Fast'],
    'veo 3.1 quality': ['Veo Quality'],
    'omni 1.1 flash': ['Gemini Omni Flash 1.1', 'Omni Flash 1.1', 'Gemini Omni Flash', 'Omni Flash']
  };
  const modelCandidates = (model) => [model, ...(MODEL_ALIASES[normModel(model)] || [])];
  A.modelScore = modelScore;
  A.normModel = normModel;

  async function selectModel(model, isCancelled) {
    const s = S();
    const itemsSel = s.modelItems || 'flow-menu-item button';
    const cands = modelCandidates(model);
    for (let attempt = 1; attempt <= 2; attempt++) {
      await A.click(s.modelSelectButton, 'Model dropdown', isCancelled);
      await A.waitFor(itemsSel, isCancelled);
      let best = null, bestScore = -1;
      const seen = [];
      const opts = A.allVisible(itemsSel);
      for (let ci = 0; ci < cands.length && !best; ci++) {
        for (const el of opts) {
          const txt = (el.innerText || el.textContent || '').trim();
          if (ci === 0) seen.push(txt.replace(/\s+/g, ' '));
          const sc = modelScore(txt, cands[ci]);
          if (sc > bestScore) { bestScore = sc; best = el; }
        }
      }
      if (!best) {
        A.warn(`Model "${model}" not found in Flow menu. Options seen: ${seen.join(' | ')}`);
        await A.pressEscape().catch(() => {});
        return false;
      }
      const picked = (best.innerText || best.textContent || '').trim().replace(/\s+/g, ' ');
      await A.clickEl(best, `Model ${picked}`, isCancelled);
      await A.sleep(400, isCancelled);
      const shown = (A.q(s.modelSelectButton).first().text() || '').replace(/arrow_drop_down/g, '').trim().replace(/\s+/g, ' ');
      const okShown = cands.some((c) => modelScore(shown, c) >= 0 || normModel(shown).includes(normModel(c)))
        || modelScore(shown, picked) >= 0 || normModel(picked).includes(normModel(shown));
      const shownLooksLikeModel = /banana|veo|omni|imagen/i.test(shown);
      if (okShown || !shownLooksLikeModel) {
        A.log(`Model selected: "${picked}" (wanted "${model}")${okShown && shownLooksLikeModel ? ' - verified' : ''}`);
        return true;
      }
      A.warn(`Model check failed: Flow shows "${shown}" but wanted "${model}" (try ${attempt}/2)`);
    }
    A.error(`Could not set model "${model}" - please check Flow manually`);
    return false;
  }
  A.selectModel = selectModel;

  /* =====================================================================
   * Configure video / image
   * ===================================================================== */
  async function configureVideo(cfg, isCancelled) {
    const s = S();
    try {
      if (cfg.outputPreviousPrompt && cfg.outputPreviousPrompt.extractedFrame) {
        cfg.mode = 'imageToVideo';
        cfg.images = cfg.images || [];
        cfg.images.unshift({ base64: cfg.outputPreviousPrompt.extractedFrame, name: `last-frame-${Date.now()}.jpg` });
        A.log('Last frame of previous video added as start frame');
      }
      await A.click(s.configButton, 'Settings button', isCancelled);
      if (A.settingsChanged([['mode', cfg.mode]], true) || cfg.mode === 'imageToVideo') {
        await A.click(s.selectVideoMode, 'Video mode', isCancelled);
        if (cfg.mode === 'textToVideo') await A.click(s.textToVideoModeOption, 'Text to Video', isCancelled);
        else if (cfg.mode === 'imageToVideo') await A.click(s.componentToVideoModeOption, 'Frame to Video', isCancelled);
        else if (cfg.mode === 'componentsToVideo') await A.click(s.componentToVideoModeOption, 'Ingredients to Video', isCancelled);
      }
      if (A.settingsChanged([['aspectRatio', cfg.aspectRatio]], true)) {
        await clickOption(tpl(s.aspectRatioTemplate, 'aspectRatio', String(cfg.aspectRatio).split(':').join('_')), `Aspect ratio ${cfg.aspectRatio}`, isCancelled);
      }
      if (A.settingsChanged([['outputCount', cfg.outputCount]], true)) {
        await clickOption(tpl(s.outputCountTemplate, 'outputCount', cfg.outputCount), `Outputs x${cfg.outputCount}`, isCancelled);
      }
      if (A.settingsChanged([['model', cfg.model]], true)) {
        if (!(await selectModel(cfg.model, isCancelled))) A.forgetSetting('model');
      }
      if (cfg.videoOption && A.settingsChanged([['videoOption', cfg.videoOption]], true)) {
        const len = String(cfg.videoOption).split('-')[0];
        const sel = tpl(s.videoLengthTemplate, 'videoLength', len);
        if (A.q(sel).length > 0) await A.click(sel, `Duration ${len}`, isCancelled);
      }
      await A.click(s.configButtonActived, 'Close settings', isCancelled);
      // the voice is now picked AFTER the characters, while typing the prompt (see fillAndSubmit)
      return true;
    } catch (e) {
      if (A.isCancelErr(e)) throw e;
      A.error('Configure video failed:', e);
      return false;
    }
  }

  async function configureImage(cfg, isCancelled) {
    const s = S();
    try {
      await A.click(s.configButton, 'Settings button', isCancelled);
      if (A.settingsChanged([['mode', cfg.mode]], true)) await A.click(s.selectImageMode, 'Image mode', isCancelled);
      if (A.settingsChanged([['aspectRatio', cfg.aspectRatio]], true)) {
        await clickOption(tpl(s.aspectRatioTemplate, 'aspectRatio', String(cfg.aspectRatio).split(':').join('_')), `Aspect ratio ${cfg.aspectRatio}`, isCancelled);
      }
      if (A.settingsChanged([['outputCount', cfg.outputCount]], true)) {
        await clickOption(tpl(s.outputCountTemplate, 'outputCount', cfg.outputCount), `Outputs x${cfg.outputCount}`, isCancelled);
      }
      if (A.settingsChanged([['model', cfg.model]], true)) {
        if (!(await selectModel(cfg.model, isCancelled))) A.forgetSetting('model');
      }
      await A.click(s.configButtonActived, 'Close settings', isCancelled);
      return true;
    } catch (e) {
      if (A.isCancelErr(e)) throw e;
      A.error('Configure image failed:', e);
      return false;
    }
  }

  /* =====================================================================
   * Chain: edit previous image
   *  1) hover previous tile -> "Add to prompt" / "Edit" control (Flow attaches it)
   *  2) tile "more" menu -> Add to prompt / Edit
   *  3) guaranteed fallback: upload the previous image itself as the reference
   * Returns 'attached' | 'editor' | 'uploaded' | null
   * ===================================================================== */
  const ADD_TO_PROMPT = { text: [/add to prompt/i, /use in prompt/i, /add to (the )?prompt box/i, /use as (an )?ingredient/i, /add as ingredient/i, /\breuse\b/i, /use image/i], icons: ['add_photo_alternate', 'prompt_suggestion', 'input', 'move_up'] };
  const EDIT = { text: [/^edit$/i, /edit image/i, /edit with/i, /open in editor/i, /\bedit\b/i], icons: ['edit', 'edit_square', 'brush', 'draw', 'stylus', 'ink_pen', 'auto_fix', 'auto_fix_high'] };
  const TILE_EXCLUDE_ICONS = ['more_vert', 'download', 'favorite', 'favorite_border', 'delete', 'thumb_up', 'thumb_down', 'flag', 'share'];
  const ingredientCount = () => A.allVisible(S().ingredientArea).reduce((n, box) => n + box.querySelectorAll('img, video').length, 0) + (getEditor(false) ? chipCount(getEditor(false)) : 0);
  const inEditorView = (url0) => window.location.href !== url0 || /\/edit\//.test(window.location.href);

  async function tryTileControl(tile, isCancelled, url0, ingBefore) {
    const editLink = findIn(tile, S().tileEditLink).find(A.isVisibleEl);
    const addBtn = findIn(tile, S().tileAddToPromptButton).find(A.isVisibleEl);
    const order = [
      addBtn,
      A.findClickable({ within: tile, ...ADD_TO_PROMPT, excludeIcons: TILE_EXCLUDE_ICONS }),
      editLink,
      A.findClickable({ within: tile, ...EDIT, excludeIcons: TILE_EXCLUDE_ICONS })
    ].filter(Boolean);
    for (const el of order) {
      await A.clickEl(el, 'Previous image: ' + (A.elText(el).slice(0, 30) || 'control'), isCancelled, 0.5).catch(() => {});
      await A.sleep(1500, isCancelled);
      if (ingredientCount() > ingBefore) return 'attached';
      if (inEditorView(url0)) return 'editor';
      await A.hoverEl(tile, 'Previous image tile', isCancelled).catch(() => {});
      await A.sleep(300, isCancelled);
    }
    return null;
  }

  async function attachPreviousImage(cfg, isCancelled) {
    const prev = cfg.outputPreviousPrompt || {};
    if (!prev.nextPromptEditImage) return null;
    const url0 = window.location.href;
    const ingBefore = ingredientCount();
    let tile = null;
    if (prev.tileRefs && prev.tileRefs.length) tile = A.q(resolveTile(prev.tileRefs[0])).first()[0] || null;

    if (tile) {
      try {
        await A.hoverEl(tile, 'Previous image tile', isCancelled);
        await A.sleep(600, isCancelled);
        let how = await tryTileControl(tile, isCancelled, url0, ingBefore);
        if (how) return how;
        const more = findIn(tile, S().moreOptionsButtonInHoverTile).find(A.isVisibleEl);
        if (more) {
          await A.clickEl(more, 'Tile menu', isCancelled, 0.5);
          await A.sleep(600, isCancelled);
          const item = A.findClickable({ selector: '[role="menuitem"], flow-menu-item, mat-list-item, button, li', text: [...ADD_TO_PROMPT.text, ...EDIT.text], icons: [...ADD_TO_PROMPT.icons, ...EDIT.icons], exclude: [/download/i, /delete/i] });
          if (item) {
            await A.clickEl(item, 'Menu: ' + A.elText(item).slice(0, 30), isCancelled, 0.4);
            await A.sleep(1500, isCancelled);
            if (ingredientCount() > ingBefore) return 'attached';
            if (inEditorView(url0)) return 'editor';
          } else await A.pressEscape();
        }
      } catch (e) { if (A.isCancelErr(e)) throw e; A.warn('Edit-previous controls failed:', e); }
    }

    // fallback: upload the previous result as the reference image for this prompt
    const src = prev.imageSrc || (tile ? mediaSrc($(tile)) : null);
    const data = await A.urlToDataUrl(src).catch(() => null);
    if (data) {
      cfg.images = [{ base64: data, name: `prev-image-${cfg.promptIndex}-${Date.now()}.png` }, ...(cfg.images || [])];
      return 'uploaded';
    }
    A.warn('Previous image could not be attached - this prompt will create a new image');
    return null;
  }

  async function leaveEditorView(isCancelled) {
    await A.sleep(3000, isCancelled);
    if (A.q(S().outputItems).length) return;
    const done = A.firstVisible(S().downloadDoneButton) || A.firstVisible(S().backProjectButton)
      || A.findClickable({ icons: ['arrow_back', 'close'], text: [/^back$/i, /^done$/i, /^close$/i] });
    if (done) await A.clickEl(done, 'Back to grid', isCancelled, 0.5).catch(() => {});
    else history.back();
    if (!(await A.waitFor(S().outputItems, isCancelled, 8000, 200, false))) { history.back(); await A.sleep(2000, isCancelled); }
  }

  /* =====================================================================
   * New tiles after submit (agent: longer wait + auto-confirm)
   * ===================================================================== */
  async function waitForNewTiles(cfg, isCancelled, before) {
    const want = cfg.outputCount || 1;
    const agent = isAgentMode(cfg);
    const maxTries = agent ? 360 : 60; // agent ~3 min, normal ~30s
    const snap = before || { srcs: new Set(), leadingPending: 0 };
    for (let r = 0; r < maxTries; r++) {
      if (isCancelled && isCancelled()) return { success: false, tileRefs: [] };
      if (agent && r % 4 === 0) await autoConfirmAgent(isCancelled).catch(() => {});
      const $items = A.q(S().outputItems);
      const n = $items.length;
      let oldIdx = -1;
      for (let i = 0; i < n; i++) { const s = mediaSrc($items.eq(i)); if (s && snap.srcs.has(s)) { oldIdx = i; break; } }
      const fresh = oldIdx === -1 ? n : oldIdx;
      const enough = fresh >= snap.leadingPending + want;
      if (r % 4 === 0) A.log(`Looking for new tiles... ${Math.min(fresh, want)}/${want} (${r + 1}/${maxTries})`);
      if (enough || (r >= (agent ? 120 : 20) && fresh > snap.leadingPending)) {
        const count = Math.min(want, fresh);
        const anchor = oldIdx >= 0 ? mediaSrc($items.eq(oldIdx)) : null;
        const refs = [];
        for (let k = 0; k < count; k++) refs.push({ anchor, offset: anchor ? oldIdx - k : 0, fromEnd: n - k });
        return { success: true, tileRefs: refs };
      }
      await A.sleep(500, isCancelled);
    }
    A.warn('Could not find the new tiles');
    return { success: false, tileRefs: [] };
  }

  /* =====================================================================
   * Upload images / videos (frames, ingredients, references)
   * ===================================================================== */
  function waitDocEvent(name, ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { document.removeEventListener(name, h); resolve(false); }, ms);
      const h = () => { clearTimeout(t); document.removeEventListener(name, h); resolve(true); };
      document.addEventListener(name, h);
    });
  }

  async function searchAsset(name, isCancelled) {
    if (!(await typeInSearch(name, isCancelled))) A.warn('Search box not found in add menu');
  }

  // first visible asset in the open list (used only right after a fresh upload, list sorted by latest)
  const firstAssetSrc = () => { const f = A.firstVisible(S().firstFoundedItemSelector); const im = f && f.querySelector('img'); return im ? (im.currentSrc || im.src || '') : ''; };

  async function scrollAssetList(isCancelled) {
    const pops = visiblePopovers(null);
    const box = pops.map((p) => p.querySelector('.cdk-virtual-scroll-viewport, cdk-virtual-scroll-viewport, [class*="scroll"], [class*="asset-list"]')).find((e) => e && e.scrollHeight > e.clientHeight);
    if (!box) return false;
    const before = box.scrollTop;
    box.scrollTop = before + box.clientHeight * 0.9;
    box.dispatchEvent(new Event('scroll', { bubbles: true }));
    await A.sleep(400, isCancelled);
    return box.scrollTop !== before;
  }

  // Look for the reference by exact name in Flow's Uploads section. true = attached.
  async function pickFromUploads(name, isCancelled, waitMs) {
    let item = await findUploadedByName(null, name, isCancelled, waitMs);
    for (let k = 0; !item && k < 8 && (await scrollAssetList(isCancelled)); k++) item = uploadedItemByName(null, name);
    if (!item) item = uploadedItemByPrefix(null, name);
    if (!item) return false;
    await A.clickEl(item, `Select ${name}`, isCancelled, 0.4).catch((e) => A.warn(e.message));
    await A.sleep(500, isCancelled);
    if (visiblePopovers(null).length) { await A.pressEscape(); await A.sleep(200, isCancelled); }
    return true;
  }

  async function openUploadsPanel(idx, isVideo, isCancelled) {
    const s = S();
    if (!(await openAddMenu(isCancelled))) { A.warn(`Upload panel (${idx + 1}) did not open from the prompt box +`); return false; }
    await A.sleep(400, isCancelled);
    const ok = (await clickUploadsTab(null, isCancelled)) || (await A.clickIfPresent(isVideo ? s.selectUploadVideoType : s.selectUploadImageType, 'Upload type', isCancelled));
    if (!ok) A.warn('Uploads tab not found in add menu (Characters tab is NOT used for references)');
    return ok;
  }

  // Diagnostic: write what the Uploads panel really shows into the Logs (to repair selectors from a real Flow run)
  function dumpUploadsPanel(name) {
    try {
      const pops = visiblePopovers(null);
      const short = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      A.log(`[diag] "${name}": popups open=${pops.length}, file inputs on page=${document.querySelectorAll('input[type="file"]').length}`);
      if (!pops.length) return;
      const tabs = A.allVisible('[role="tab"], mat-list-item, mat-chip, mat-chip-option').filter((e) => pops.some((p) => p.contains(e)))
        .map((e) => `${short(A.elText(e) || [...A.iconNames(e)].join('/'))}${e.getAttribute('aria-selected') === 'true' || e.classList.contains('selected') || e.classList.contains('active') ? '*' : ''}`);
      A.log(`[diag] tabs/menu: ${tabs.slice(0, 10).join(' | ') || '(none)'}`);
      const inputs = pops.flatMap((p) => [...p.querySelectorAll('input')]).filter(A.isVisibleEl).map((i) => `${i.type}:${short(i.placeholder || i.getAttribute('aria-label'))}`);
      A.log(`[diag] inputs: ${inputs.join(' | ') || '(none)'}`);
      const imgs = pops.flatMap((p) => [...p.querySelectorAll('img')]).filter(A.isVisibleEl);
      const labels = imgs.slice(0, 12).map((im) => {
        const row = im.closest(S().uploadedAssetItem) || im.closest('[role="option"], mat-list-item, [tabindex], li') || im.parentElement;
        return short(im.alt || im.title || (row && (row.getAttribute('aria-label') || row.getAttribute('title') || row.textContent)) || '(no name)');
      });
      A.log(`[diag] items with picture=${imgs.length}: ${labels.join(' | ') || '(none)'}`);
      const btns = pops.flatMap((p) => [...p.querySelectorAll('button, [role="button"]')]).filter(A.isVisibleEl).map((b) => short(A.elText(b) || [...A.iconNames(b)].join('/'))).filter(Boolean);
      A.log(`[diag] buttons: ${btns.slice(0, 12).join(' | ')}`);
    } catch (e) { A.warn(`[diag] failed: ${e.message}`); }
  }

  // The real "Upload" button - never a tab (the Uploads tab also has an upload icon)
  function findUploadButton() {
    const all = visiblePopovers(null);
    const pops = activePanel && activePanel.isConnected && A.isVisibleEl(activePanel) ? [activePanel] : all;
    if (!pops.length) return null; // never search the whole page (top Upload button)
    const isTab = (e) => e.getAttribute('role') === 'tab' || !!e.closest('[role="tablist"]') || e.hasAttribute('aria-selected');
    const inPop = (e) => pops.some((p) => p.contains(e));
    const viaSel = A.allVisible(S().uploadMediaButton).filter((e) => !isTab(e) && inPop(e));
    if (viaSel.length) return viaSel[viaSel.length - 1];
    const cands = pops.flatMap((p) => [...p.querySelectorAll('button, [role="button"], label')]).filter((e) => A.isVisibleEl(e) && !isTab(e));
    return cands.find((e) => /\bupload\b/i.test(A.elText(e)) && !/character|voice/i.test(A.elText(e)))
      || cands.find((e) => [...A.iconNames(e)].some((n) => ['upload', 'upload_file', 'cloud_upload', 'file_upload', 'add_photo_alternate'].includes(n)))
      || null;
  }

  // Put the file straight into Flow's <input type=file> (used when the picker click was not captured)
  function injectIntoFileInput(img, mime) {
    const inputs = [...document.querySelectorAll('input[type="file"]')];
    const input = inputs.find((i) => !i.accept || /image|video|\*/.test(i.accept)) || inputs[0];
    if (!input) return false;
    try {
      let b64 = img.base64.includes(',') ? img.base64.split(',')[1] : img.base64;
      const bin = atob(b64); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], img.name || 'upload.jpg', { type: mime }));
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (e) { A.warn(`Direct file input failed: ${e.message}`); return false; }
  }

  // Search box may sit behind a search icon in the Uploads panel: open it, then type
  async function searchUploads(name, isCancelled) {
    if (await typeInSearch(name, isCancelled)) return true;
    const pops = visiblePopovers(null);
    const btn = pops.length && A.findClickable({ within: pops, selector: 'button, [role="button"], mat-icon, [aria-label]', icons: ['search', 'manage_search'], text: [/^\s*search\s*$/i] });
    if (!btn) return false;
    await A.clickEl(btn, 'Open search', isCancelled, 0.4).catch(() => {});
    await A.sleep(500, isCancelled);
    return typeInSearch(name, isCancelled);
  }

  // After a name search: if exactly ONE picture item is left in the list, that is the file (Flow often shows thumbnails only)
  function singleFilteredItem() {
    const pops = visiblePopovers(null);
    const rows = new Set();
    for (const p of pops) for (const im of p.querySelectorAll('img')) {
      if (!A.isVisibleEl(im)) continue;
      rows.add(im.closest(S().uploadedAssetItem) || im.closest('[role="option"], mat-list-item, [tabindex], li') || im);
    }
    return rows.size === 1 ? [...rows][0] : null;
  }

  // Each file is sent to Flow's Upload button at most once per session (no repeated clicking)
  const uploadTried = new Set();

  async function uploadImage(cfg, idx, isCancelled) {
    const s = S();
    const img = cfg.images && cfg.images[idx];
    if (!img || !img.base64) { A.warn('No image data'); return false; }
    if (!bottomAddButton()) { A.warn('Add (+) button next to the prompt box not found, skipping upload'); return false; }
    const isVideo = img.base64.startsWith('data:video/') || /\.(mp4|webm|mov|avi|mkv|3gp|flv|wmv)$/i.test(img.name || '');
    const name = A.stripExt(img.name || '');
    document.documentElement.setAttribute('data-aws-upload-active', 'true');
    try {
      // 1) Uploads section -> search by name -> exact match only
      await openUploadsPanel(idx, isVideo, isCancelled);
      if (await A.waitFor(s.sortOptionsButton, isCancelled, 1500)) {
        await A.click(s.sortOptionsButton, 'Sort', isCancelled).catch(() => {});
        await A.clickIfPresent(s.sortLatestOption, 'Sort: latest', isCancelled);
      }
      const searched = await searchUploads(name, isCancelled);
      if (!searched) A.log('Search box not shown - checking the Uploads list directly');
      if (await pickFromUploads(name, isCancelled, 5000)) {
        A.log(`"${name}" found in Flow Uploads - selected (no re-upload)`);
        return true;
      }
      if (searched) {
        await A.sleep(1000, isCancelled);
        const only = singleFilteredItem();
        if (only) {
          await A.clickEl(only, `Select ${name}`, isCancelled, 0.4).catch((e) => A.warn(e.message));
          await A.sleep(500, isCancelled);
          if (visiblePopovers(null).length) { await A.pressEscape(); await A.sleep(200, isCancelled); }
          A.log(`"${name}" found in Flow Uploads (only search result) - selected (no re-upload)`);
          return true;
        }
      }
      const key = assetKey(name);
      if (uploadTried.has(key)) {
        dumpUploadsPanel(name);
        A.warn(`"${name}" not found in Flow Uploads and was already uploaded once - not clicking Upload again, continuing`);
        if (visiblePopovers(null).length) { await A.pressEscape(); await A.sleep(200, isCancelled); }
        return false;
      }
      uploadTried.add(key);

      // 2) not in Flow yet -> upload once
      dumpUploadsPanel(name);
      A.log(`"${name}" not in Flow Uploads - uploading it once`);
      const before = firstAssetSrc();
      let mime = 'image/jpeg';
      const m = img.base64.match(/^data:([^;]+);/);
      if (m) mime = m[1];
      const captured = waitDocEvent('AWS_FILE_INPUT_CAPTURED', 4000);
      const upBtn = findUploadButton();
      if (upBtn) await A.clickEl(upBtn, 'Upload button', isCancelled, 0.4).catch((e) => A.warn(e.message));
      else A.warn('Upload button not found in Uploads panel');
      if (upBtn && (await captured)) {
        document.dispatchEvent(new CustomEvent('AWS_UPLOAD_FILE_DATA', { detail: JSON.stringify({ base64: img.base64, filename: img.name, mimeType: mime }) }));
      } else if (injectIntoFileInput(img, mime)) {
        A.log('File picker not captured - file put directly into Flow file input');
      } else {
        A.warn(`Could not start upload for "${name}" (no file picker / file input found) - skipping, see [diag] lines`);
        if (visiblePopovers(null).length) { await A.pressEscape(); await A.sleep(200, isCancelled); }
        return false;
      }
      await A.sleep(2000, isCancelled);
      if (A.q(s.agreeTermUploadedVideoButton).length > 0) {
        await A.click(s.agreeTermUploadedVideoButton, 'Agree upload terms', isCancelled);
        await A.sleep(1000, isCancelled);
      }

      // 3) wait (max 60s) for the uploaded item: exact name first, newest new item as fallback
      for (let t = 0; t < 60; t++) {
        if (!visiblePopovers(null).length) { await openUploadsPanel(idx, isVideo, isCancelled); await typeInSearch(name, isCancelled); }
        if (uploadedItemByName(null, name)) {
          await pickFromUploads(name, isCancelled, 500);
          A.log(`"${name}" uploaded and selected`);
          return true;
        }
        const now = firstAssetSrc();
        if (t >= 8 && now && now !== before) {
          await A.click(s.firstFoundedItemSelector, `Select ${name} (newest upload)`, isCancelled);
          A.log(`"${name}" uploaded - selected newest item`);
          return true;
        }
        if (t % 10 === 9) A.log(`Waiting for upload "${name}" (${t + 1}s)`);
        await A.sleep(1000, isCancelled);
      }
      A.warn(`"${name}" did not appear in Flow Uploads after 60s`);
      dumpUploadsPanel(name);
      return false;
    } finally {
      document.documentElement.removeAttribute('data-aws-upload-active');
    }
  }

  /* =====================================================================
   * Submit: always the Generate button next to the prompt box we typed in.
   * Enter is used only if no button exists. Verified, retried once.
   * ===================================================================== */
  const SUBMIT_ICONS = ['arrow_forward', 'arrow_upward', 'send', 'north', 'arrow_right_alt'];
  function findSubmitButton(editor) {
    let node = editor;
    for (let lvl = 0; node && lvl < 10; lvl++, node = node.parentElement) {
      const viaSel = findIn(node, S().submitButton).find((b) => A.isVisibleEl(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
      if (viaSel) return viaSel;
      const viaText = A.findClickable({ within: node, selector: 'button, [role="button"]', icons: SUBMIT_ICONS, text: [/^generate$/i, /^create$/i, /^send$/i, /\bgenerate\b/i], exclude: [/\badd\b/i, /upload/i, /settings/i, /\bmore\b/i, /voice/i] });
      if (viaText) return viaText;
    }
    return A.firstVisible(S().submitButton);
  }

  async function submitPrompt(editor, isCancelled) {
    const s = S();
    const textBefore = A.editorText(editor).trim();
    const countBefore = A.q(s.outputItems).length;
    const pendingBefore = A.q(s.tileOnQueue).length;
    const submitted = () => {
      const now = A.editorText(editor).trim();
      if (!editor.isConnected || now !== textBefore) return true;
      if (A.q(s.outputItems).length !== countBefore || A.q(s.tileOnQueue).length > pendingBefore) return true;
      if (A.isUsable(A.q(s.stopButton))) return true;
      const b = findSubmitButton(editor);
      return !b; // button became disabled / disappeared after sending
    };
    for (let attempt = 1; attempt <= 2; attempt++) {
      const btn = await A.waitUntil(() => findSubmitButton(editor), isCancelled, 6000);
      if (btn) await A.clickEl(btn, 'Generate button', isCancelled, 0.5);
      else {
        A.warn('Generate button not found - checking editor before pressing Enter');
        if (!(await focusEditorEnd(editor, isCancelled))) return false;
        await A.pressKey('Enter', 'Enter', 13);
      }
      if (await A.waitUntil(submitted, isCancelled, 5000, 250)) { A.log('Prompt submitted'); return true; }
      A.warn(`Prompt did not submit (try ${attempt}/2)`);
    }
    return false;
  }

  /* =====================================================================
   * Prompt typing (+ @mentions for images / characters), voice, submit
   * ===================================================================== */
  const mentionImage = (fileName, cfg, isCancelled) => mention(A.stripExt(fileName), 'image', cfg, isCancelled);
  const mentionCharacter = (name, cfg, isCancelled) => mention(name, 'character', cfg, isCancelled);
  const wantsVoice = (cfg) => !!cfg.speaker && (String(cfg.mode).includes('ToVideo'));

  async function fillAndSubmit(cfg, isCancelled) {
    const s = S();
    try {
      const agent = isAgentMode(cfg);
      await A.waitUntil(() => getEditor(agent), isCancelled, 6000);
      const editor = getEditor(agent);
      if (!editor) { A.error('Prompt box not found'); return false; }
      if (!(await focusEditorEnd(editor, isCancelled))) {
        A.warn('Prompt editor is not ready; refresh the Google Flow project tab and try again');
        return false;
      }
      await A.sleep(600, isCancelled, true);

      const isFrame = cfg.mode === 'imageToVideo' || !!(cfg.outputPreviousPrompt && cfg.outputPreviousPrompt.extractedFrame);
      const agentImg = cfg.mode === 'agentAutomationToImage' || cfg.mode === 'agentAutomation';
      const agentVid = cfg.mode === 'agentAutomationToVideo';
      let text = cfg.prompt;
      if (agentImg || agentVid) {
        text = cfg._chainHow
          ? `Edit the attached image (keep everything else the same), aspect ratio ${cfg.aspectRatio}, model: ${cfg.model}. Edit: ${cfg.prompt}`
          : `Create for me ${cfg.outputCount} ${agentVid ? 'videos' : 'images'}, aspect ratio ${cfg.aspectRatio}, model: ${cfg.model} with prompt: ${cfg.prompt}`;
      }

      const imgM = isFrame ? [] : A.imageMatches(text, cfg.images);
      const chrM = A.characterMatches(text, cfg.characters);
      const all = [
        ...imgM.map((m) => ({ ...m, type: 'image', target: m.imageIndex })),
        ...chrM.map((m) => ({ ...m, type: 'character', target: m.characterIndex }))
      ].sort((a, b) => a.index - b.index || b.length - a.length);
      const inline = []; let end = 0;
      for (const m of all) if (m.index >= end) { inline.push(m); end = m.index + m.length; }

      const usedChars = new Set();
      const usedImgs = new Set();
      if (inline.length && cfg.characters && cfg.characters.length) {
        const atIdx = new Set(chrM.map((m) => m.characterIndex));
        const escRe = (x) => x.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        for (let i = 0; i < cfg.characters.length; i++) {
          const n = A.cleanCharName(cfg.characters[i]);
          if (!n || atIdx.has(i) || !new RegExp(`(?<![\\w@])${escRe(n)}(?![\\w])`, 'i').test(text)) continue;
          await mentionCharacter(cfg.characters[i], cfg, isCancelled); await A.typeText(' '); usedChars.add(i); await A.sleep(200, isCancelled);
        }
      }
      if (inline.length) {
        A.log(`${inline.length} @mention(s) found in prompt`);
        let pos = 0;
        for (const m of inline) {
          A.checkCancel(isCancelled);
          const before = text.substring(pos, m.index); // never includes the "@" or the name
          let typed = before;
          if (m.type === 'image' && !m.hasAt) {
            // image written as a normal word: keep the word, add the chip after it (old behaviour)
            typed += text.substr(m.index, m.length) + ' ';
          } else if (typed && !/\s$/.test(typed)) typed += ' ';
          if (typed && /^ /.test(typed) && /\s$/.test(A.editorText(editor))) typed = typed.slice(1); // chip already added a space
          if (typed) { await A.typeText(typed); await A.sleep(100, isCancelled); }
          if (m.type === 'image') { await mentionImage(cfg.images[m.target].name, cfg, isCancelled); usedImgs.add(m.target); }
          else { await mentionCharacter(cfg.characters[m.target], cfg, isCancelled); usedChars.add(m.target); }
          pos = m.index + m.length;
        }
        if (pos < text.length) {
          let rest = text.substring(pos);
          if (/^ /.test(rest) && /\s$/.test(A.editorText(editor))) rest = rest.slice(1);
          await A.typeText(rest); await A.sleep(100, isCancelled);
        }
      } else {
        if (!isFrame && cfg.images && cfg.images.length) {
          for (let i = 0; i < cfg.images.length; i++) if (cfg.images[i].name) { await mentionImage(cfg.images[i].name, cfg, isCancelled); await A.typeText(' '); usedImgs.add(i); await A.sleep(200, isCancelled); }
        }
        if (cfg.characters && cfg.characters.length) {
          for (let i = 0; i < cfg.characters.length; i++) if (cfg.characters[i]) { await mentionCharacter(cfg.characters[i], cfg, isCancelled); await A.typeText(' '); usedChars.add(i); await A.sleep(200, isCancelled); }
        }
        await A.typeText(text);
      }
      A.log(`Prompt typed: ${text.substring(0, 60)}...`);
      await A.sleep(600, isCancelled, true);

      // voice AFTER the character(s), so Character + Voice stay together
      if (wantsVoice(cfg)) {
        A.log(`Selecting voice: ${cfg.speaker}`);
        const ok = await selectSpeaker(cfg.speaker, cfg, isCancelled);
        if (!ok) A.warn(`Voice ${cfg.speaker} not selected - video will use the character's own / default voice`);
        await focusEditorEnd(getEditor(agent) || editor, isCancelled);
      }

      const ok = await submitPrompt(getEditor(agent) || editor, isCancelled);
      if (!ok) { A.error('Prompt could not be submitted'); return false; }
      await A.sleep(2000, isCancelled);
      await A.waitGone(s.stopButton, isCancelled, 900000);
      return true;
    } catch (e) {
      if (A.isCancelErr(e)) throw e;
      A.error('Filling prompt failed:', e);
      return false;
    }
  }

  /* =====================================================================
   * One prompt: create project -> configure -> attach/upload -> type -> submit -> locate tiles
   * ===================================================================== */
  A._fillAndSubmit = fillAndSubmit; // used by self-tests
  A._setAgentMode = setAgentMode;
  A._attachPreviousImage = attachPreviousImage;
  A.runPrompt = async function (cfg, isCancelled) {
    const steps = [
      { name: 'Create Project', status: 'pending' },
      { name: 'Configure', status: 'pending' },
      { name: 'Fill Prompt', status: 'pending' },
      { name: 'Locate Tiles', status: 'pending' }
    ];
    const fail = (i, err) => { steps[i].status = 'error'; steps[i].error = err; return { success: false, steps, error: err }; };
    const s = S();
    try {
      await A.attachDebugger();
      if (window.location.href.includes('/project/')) {
        steps[0].status = 'completed'; steps[0].name = 'Create Project (skipped)';
        await backToProjectIfNeeded(isCancelled);
      } else {
        A.log('Step 1: creating a new Flow project');
        steps[0].status = 'running';
        if (!(await createProject(isCancelled))) return fail(0, 'Failed to create project');
        steps[0].status = 'completed';
      }

      steps[1].status = 'running';
      try { await setAgentMode(cfg, isCancelled); }
      catch (e) { if (A.isCancelErr(e)) throw e; return fail(1, e.message || 'Agent mode failed'); }
      if (A.settingsChanged([['uiMode', 'open']], true)) { A.log('Setting up grid view'); await configureUiMode(isCancelled); }

      const prev = cfg.outputPreviousPrompt || {};
      if (isAgentMode(cfg)) {
        if (A.settingsChanged([['neverAskAgent', 'true']], true)) {
          A.log('Step 2: configuring agent');
          await configureAgent(cfg, isCancelled);
        }
      } else if ((cfg.mode.includes('ToVideo') && A.settingsChanged([['mode', cfg.mode], ['aspectRatio', cfg.aspectRatio], ['model', cfg.model], ['videoOption', cfg.videoOption], ['outputCount', cfg.outputCount]])) || prev.extractedFrame || cfg.mode === 'imageToVideo') {
        A.log('Step 2: configuring video settings');
        if (!(await configureVideo(cfg, isCancelled))) return fail(1, 'Failed to configure video');
      } else if (cfg.mode.includes('ToImage') && A.settingsChanged([['mode', cfg.mode], ['aspectRatio', cfg.aspectRatio], ['model', cfg.model], ['outputCount', cfg.outputCount]])) {
        A.log('Step 2: configuring image settings');
        if (!(await configureImage(cfg, isCancelled))) return fail(1, 'Failed to configure image');
      }

      // Chain: edit previous image
      let editorSnap = null;
      if (prev.nextPromptEditImage) {
        editorSnap = gridSnapshot();
        const how = await attachPreviousImage(cfg, isCancelled);
        cfg._chainHow = how;
        const msg = { attached: 'attached to the prompt', editor: 'opened in Flow editor', uploaded: 'uploaded as reference' }[how];
        A.log(msg ? `Previous image ${msg} - this prompt edits it` : 'Previous image not attached');
        if (how !== 'editor') editorSnap = null;
      }
      steps[1].status = 'completed';

      if (cfg.images && cfg.images.length) {
        for (let i = 0; i < cfg.images.length; i++) {
          A.log(`Uploading ${i + 1}/${cfg.images.length}: ${cfg.images[i].name}`);
          (await uploadImage(cfg, i, isCancelled)) ? A.log(`Upload ${i + 1} ready`) : A.warn(`Upload ${i + 1} failed, continuing`);
        }
        if (cfg.mode === 'imageToVideo') {
          await A.click(s.configButton, 'Settings button', isCancelled);
          await A.click(s.imageToVideoModeOption, 'Frame to Video', isCancelled);
          await A.click(s.configButtonActived, 'Close settings', isCancelled);
        }
      }

      A.log('Step 3: typing prompt');
      steps[2].status = 'running';
      const before = editorSnap || gridSnapshot();
      if (!(await fillAndSubmit(cfg, isCancelled))) return fail(2, 'Failed to fill prompt');
      if (cfg._chainHow === 'editor') await leaveEditorView(isCancelled);
      steps[2].status = 'completed';

      A.log('Step 4: locating new tiles');
      steps[3].status = 'running';
      await A.sleep(500, isCancelled);
      const t = await waitForNewTiles(cfg, isCancelled, before);
      if (!t.success) return fail(3, 'Could not find new tiles');
      steps[3].status = 'completed';
      return { success: true, steps, tileRefs: t.tileRefs };
    } catch (e) {
      if (A.isCancelErr(e)) { A.log('Cancelled'); return { success: false, steps, cancelled: true, error: 'Cancelled' }; }
      A.error('Prompt automation failed:', e);
      return { success: false, steps, error: String(e && e.message ? e.message : e) };
    }
  };

  /* =====================================================================
   * Wait for results + auto download
   * ===================================================================== */
  async function waitForResults(refs, cfg, isCancelled) {
    const isVideo = cfg.mode.includes('ToVideo');
    const want = cfg.outputCount || refs.length;
    const maxPolls = 450; // ~15+ minutes
    for (let poll = 0; poll < maxPolls; poll++) {
      if (isCancelled && isCancelled()) return { success: false };
      const present = refs.map((r) => A.q(resolveTile(r)).first()).filter(($t) => $t.length > 0);
      if (!present.length) { A.log(`Tiles not in view yet (${poll + 1})`); await A.sleep(2000); continue; }
      let videos = [], images = [], pctSum = 0;
      const errors = [];
      for (let k = 0; k < refs.length; k++) {
        let sel = resolveTile(refs[k]);
        let $t = A.q(sel).first();
        if ($t.length && isVideo) await A.uiLock.run(() => A.hover(sel, 'Tile', isCancelled, 1500).catch(() => {}));
        let st = $t.length ? tileStatus($t) : { hasPercentage: false, hasResource: false };
        for (let r = 0; r < 3 && !st.hasPercentage && !st.hasResource; r++) {
          if (r > 0) await A.sleep(1000);
          sel = resolveTile(refs[k]);
          $t = A.q(sel).first();
          if (!$t.length) continue;
          if (isVideo) await A.uiLock.run(() => A.hover(sel, 'Tile', isCancelled, 1500).catch(() => {}));
          st = tileStatus($t);
        }
        if (st.hasPercentage) pctSum += st.percent;
        else if (st.hasResource) { videos = videos.concat(st.videos); images = images.concat(st.images); pctSum += 100; }
        else { A.warn(`Tile ${k + 1} shows no progress and no result (failed?)`); errors.push(refs[k]); }
      }
      const pct = Math.round(pctSum / refs.length);
      const ready = (isVideo ? videos : images).slice(0, want);
      A.log(`Generating: ${pct}% - ${ready.length}/${want} ready${errors.length ? `, ${errors.length} failed` : ''}`);
      const done = ready.length + errors.length >= want;
      try {
        chrome.runtime.sendMessage({ type: 'VIDEO_GENERATION_PROGRESS', data: { groupId: cfg.groupId, promptIndex: cfg.promptIndex, percentage: done ? 100 : pct, status: done ? 'completed' : 'generating', prompt: cfg.prompt } }).catch(() => {});
      } catch (e) {}
      if (done) return { success: true, resources: ready, errorRefs: errors };
      await A.sleep(2000);
    }
    A.warn('Generation did not finish in time');
    return { success: false };
  }

  const sanitize = (s) => s.replace(/[/\\?%*:|"<>]/g, '-').replace(/^[-.]+|[-.]+$/g, '').trim();
  // Tag chars: letters, digits, _ . - and ":" so time codes like #0:04 or #1:05-1:10 work
  // (":" is not allowed in file names, so it becomes "-": #0:04 -> 0-04.mp4)
  function promptTag(prompt) {
    if (!prompt) return null;
    const s = String(prompt).trim();
    let m = s.match(/^[([]?#+\s*([a-zA-Z0-9_.:\-]+)[)\]]?/);
    if (m && m[1] && sanitize(m[1])) return sanitize(m[1]);
    const first = s.split(/[\r\n]+/)[0] || '';
    m = first.match(/#([a-zA-Z0-9_.:\-]+)/);
    if (m && m[1] && sanitize(m[1])) return sanitize(m[1]);
    m = s.match(/#([a-zA-Z0-9_.:\-]+)/);
    if (m && m[1] && sanitize(m[1])) return sanitize(m[1]);
    return null;
  }
  function fileStem(cfg, isVideo, i, total) {
    const type = isVideo ? 'video' : 'image';
    const suffix = total > 1 ? `_${i + 1}` : '';
    if (cfg.fileNamingSystem === 'simple') return `${cfg.promptIndex} ${type}${suffix}`;
    const tag = promptTag(cfg.prompt);
    return tag ? `${tag}${suffix}` : `${cfg.promptIndex} ${type}${suffix}`;
  }
  A.fileStem = fileStem;
  A.promptTag = promptTag;

  A.downloadPrompt = async function (refs, cfg, isCancelled) {
    const s = S();
    try {
      const res = await waitForResults(refs, cfg, isCancelled);
      if (!res.success) {
        if (isCancelled && isCancelled()) return { success: false, cancelled: true };
        A.warn(`Prompt ${cfg.promptIndex} generation failed`);
        return { success: false, error: 'Generation failed' };
      }
      const okRefs = refs.filter((r) => !res.errorRefs.includes(r));
      if (!okRefs.length) return { success: false, error: 'All tiles failed' };

      const chainOutput = async () => {
        if (cfg.isConcat && cfg.mode.includes('ToVideo')) {
          const frame = await A.extractLastFrame(res.resources);
          return frame ? { extractedFrame: frame } : {};
        }
        if (cfg.isConcat && (cfg.mode.includes('ToImage') || cfg.mode === 'agentAutomation')) {
          const first = res.resources && res.resources[0];
          const imageSrc = first ? (first.currentSrc || first.src || null) : null;
          return { nextPromptEditImage: true, tileRefs: okRefs, imageSrc };
        }
        return {};
      };

      const quality = cfg.autoDownloadResourceQuality;
      if (quality === 'no-download') { A.log(`Prompt ${cfg.promptIndex}: download off`); return { success: true, ...(await chainOutput()) }; }

      const folder = (cfg.folderName || '').trim();
      const isVideo = cfg.mode.includes('ToVideo');
      const autoName = cfg.autoChangeFileName !== false;

      if (quality === '1080' || quality === '2k' || quality === '4k') {
        const optSel = quality === '2k' ? s.quality2KOption : quality === '4k' ? s.quality4KOption : s.quality1080Option;
        const retries = cfg.maxRetries || 3;
        for (let k = 0; k < okRefs.length; k++) {
          const stem = fileStem(cfg, isVideo, k, okRefs.length);
          await A.bg({ type: 'SET_FOLDER_NAME', folderName: folder, prefix: `${stem}_`, autoChangeFileName: autoName });
          const mark = await A.bg({ type: 'DOWNLOAD_COUNTER' });
          let ok = false;
          for (let a = 1; a <= retries && !ok; a++) {
            try {
              await A.uiLock.run(async () => {
                A.log(`Tile ${k + 1}/${okRefs.length}: downloading ${quality} (try ${a}/${retries})`);
                const tile = resolveTile(okRefs[k]);
                await A.hover(tile, `Tile ${k + 1}`, isCancelled);
                if (await A.waitFor(`${tile} ${s.moreOptionsButtonInHoverTile}`, isCancelled)) await A.click(`${tile} ${s.moreOptionsButtonInHoverTile}`, 'More options', isCancelled);
                if (await A.waitFor(s.downloadButtonInHoverTile, isCancelled)) await A.hover(s.downloadButtonInHoverTile, 'Download menu', isCancelled);
                await A.click(optSel, `${quality} option`, isCancelled);
              });
              ok = true;
              A.log(`Tile ${k + 1}: ${quality} download requested`);
            } catch (e) {
              if (A.isCancelErr(e)) throw e;
              A.warn(`Tile ${k + 1} try ${a} failed:`, e);
              try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (x) {}
              if (a < retries) await A.sleep(1000, isCancelled);
            }
          }
          if (!ok) { A.error(`Tile ${k + 1}: all download tries failed`); continue; }
          if (autoName && mark && typeof mark.count === 'number') {
            // wait (max 3 min) until Flow actually starts the file, so the name is applied to the right file
            for (let w = 0; w < 180; w++) {
              const now = await A.bg({ type: 'DOWNLOAD_COUNTER' });
              if (now && now.count > mark.count) break;
              await A.sleep(1000, isCancelled);
            }
          }
        }
        return { success: true, ...(await chainOutput()) };
      }

      // direct download of the generated file (720p video / 1K image)
      A.log(`Downloading ${res.resources.length} file(s) for prompt ${cfg.promptIndex}`);
      for (let k = 0; k < res.resources.length; k++) {
        let src = res.resources[k].currentSrc || res.resources[k].src;
        if (!src) { A.warn(`File ${k + 1} has no source, skipping`); continue; }
        try {
          if (src.startsWith('blob:')) src = await A.blobToDataUrl(src);
          let filename, dir;
          if (autoName) {
            filename = `${fileStem(cfg, isVideo, k, res.resources.length)}.${isVideo ? 'mp4' : 'png'}`;
            dir = folder;
          } else {
            filename = src.startsWith('data:') ? `${cfg.promptIndex}_${k + 1}.${isVideo ? 'mp4' : 'png'}` : (new URL(src).pathname.split('/').pop() || `${cfg.promptIndex}_${k + 1}.png`);
            dir = '';
          }
          const r = await A.bg({ type: 'DOWNLOAD_RESOURCE', url: src, filename, folder: dir, autoChangeFileName: autoName });
          if (!r || !r.success) throw new Error((r && r.error) || 'Download failed');
          A.log(`Saved ${dir ? dir + '/' : ''}${filename}`);
          await A.sleep(500, isCancelled);
        } catch (e) {
          if (A.isCancelErr(e)) throw e;
          A.error(`Download ${k + 1} failed:`, e);
        }
      }
      return { success: true, ...(await chainOutput()) };
    } catch (e) {
      if (A.isCancelErr(e)) return { success: false, cancelled: true, error: 'Cancelled' };
      A.error('Download step failed:', e);
      return { success: false, error: String(e && e.message ? e.message : e) };
    }
  };

  /* =====================================================================
   * Characters scan (for @character mentions)
   * ===================================================================== */
  A.scanCharacters = async function () {
    const s = S();
    await A.attachDebugger();
    let tab = A.firstVisible(s.charactersTabButton);
    if (!tab) tab = A.findClickable({ text: [/^characters?$/i], icons: ['accessibility_new'] });
    if (!tab && !window.location.href.includes('/characters')) return [];
    if (tab) await A.clickEl(tab, 'Characters tab', undefined, 0.5);
    await A.waitFor(s.charactersNameSelector, undefined, 6000);
    let names = A.q(s.charactersNameSelector).map((i, el) => $(el).attr('alt') || $(el).text().trim() || '').get();
    if (!names.length) {
      // fallback: names written under character tiles / images
      names = Array.from(document.querySelectorAll('[class*="character"] img[alt]')).map((i) => i.alt);
    }
    names = names.map((n) => A.cleanCharName(String(n).split('\n')[0])).filter((n) => n && n.length <= 40);
    return Array.from(new Set(names));
  };
})();
