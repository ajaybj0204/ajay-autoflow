/* Ajay AutoFlow - prompt queue, download queue and messaging (content script) */
(function () {
  'use strict';
  const A = window.AWS;
  if (A.__queueLoaded) return;
  A.__queueLoaded = true;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const groups = [];        // prompt groups waiting / running
  const downloadQueue = []; // submitted prompts waiting for results + download
  let activeGroupId = null;
  const preparedImages = {};
  const imageChunks = {};

  const setZoom = async (z) => {
    try {
      const st = await chrome.storage.local.get('aws_settings');
      const s = st.aws_settings || {};
      if (s.zoomOutWhileRunning === false) return;
    } catch (e) {}
    A.bg({ type: 'SET_ZOOM', zoomFactor: z });
  };

  const publish = (g) => {
    try {
      chrome.runtime.sendMessage({
        type: 'PROMPT_GROUP_STATUS',
        data: {
          id: g.id, status: g.status, processedCount: g.processedCount, totalCount: g.totalCount, createdAt: g.createdAt,
          isCancelling: !!g.isCancelling, isPaused: !!g.isPaused, isActive: activeGroupId === g.id,
          results: g.results.map((r) => ({ index: r.index, promptIndex: r.promptIndex, success: r.success, downloadComplete: r.downloadComplete, error: r.error,
            durationMs: g.doneAt[r.index] && g.startedAt[r.index] ? g.doneAt[r.index] - g.startedAt[r.index] : null })),
          currentStartedAt: g.currentPromptIndex != null ? g.startedAt[g.currentPromptIndex] || null : null,
          currentPromptIndex: g.currentPromptIndex,
          promptPreviews: g.payloads.map((p) => String((p && p.prompt) || '').substring(0, 70)),
          promptIndices: g.payloads.map((p) => p.promptIndex),
          retryCountByIndex: { ...g.retryCountByIndex }
        }
      }).catch(() => {});
    } catch (e) {}
  };
  const snapshot = () => groups.map((g) => ({ id: g.id, status: g.status }));

  /* ---------- picking the next prompt (respects concat chains) ---------- */
  function canStart(g, idx) {
    if (idx === 0) return true;
    if (g.payloads[idx - 1].isConcat) return g.finishedIndexes.has(idx - 1);
    return true;
  }
  function nextIndex(g) {
    for (let k = 0; k < g.pending.length; k++) {
      const idx = g.pending[k];
      if (canStart(g, idx)) { g.pending.splice(k, 1); return idx; }
    }
    return null;
  }

  /* ---------- submit worker: types and sends prompts ---------- */
  async function submitWorker(g) {
    for (;;) {
      if (g.isCancelling) return;
      // Paused: finish what's running, but don't start another prompt until resumed
      if (g.isPaused) { await wait(500); continue; }
      if (g.processedCount >= g.totalCount && g.pending.length === 0) return;
      // limit how many prompts generate at the same time
      if (downloadQueue.filter((d) => d.groupId === g.id).length >= g.concurrentPrompts) { await wait(500); continue; }
      const idx = nextIndex(g);
      if (idx === null) { if (g.pending.length === 0) return; await wait(500); continue; }

      const payload = g.payloads[idx] || {};
      const cfg = JSON.parse(JSON.stringify(payload));
      const dMin = g.delayMin || 0, dMax = Math.max(g.delayMax || 0, dMin);
      if (g.submittedOnce && dMax > 0) {
        const secs = dMin >= dMax ? dMin : dMin + Math.random() * (dMax - dMin);
        A.log(`Waiting ${Math.round(secs)}s before next prompt`);
        let waited = 0;
        while (waited < secs * 1000) {
          g.delayRemainingSeconds = Math.ceil(secs - waited / 1000);
          await wait(1000); waited += 1000;
          if (g.isCancelling) return;
        }
        g.delayRemainingSeconds = 0;
      }
      g.submittedOnce = true;
      try {
        const tries = g.retryCountByIndex[idx] || 0;
        g.currentPromptIndex = idx;
        g.startedAt[idx] = Date.now();
        publish(g);
        A.log(`Prompt ${cfg.promptIndex}: starting`);
        const res = await A.uiLock.run(() => A.runPrompt(cfg, () => !!g.isCancelling));
        g.currentPromptIndex = undefined;
        if (!res.success && !res.cancelled && tries < (cfg.maxRetries != null ? cfg.maxRetries : 1)) {
          g.retryCountByIndex[idx] = tries + 1;
          A.warn(`Prompt ${cfg.promptIndex}: retry ${tries + 1}`);
          if (!g.pending.includes(idx)) g.pending.unshift(idx);
          publish(g);
          continue;
        }
        g.results = g.results.filter((r) => r.index !== idx);
        g.results.push({ index: idx, promptIndex: cfg.promptIndex, success: res.success, downloadComplete: !res.success, error: res.error, cancelled: !!g.isCancelling });
        if (res.success && res.tileRefs && res.tileRefs.length) {
          downloadQueue.push({ groupId: g.id, index: idx, tileRefs: res.tileRefs, config: cfg, retryCount: g.downloadRetryCountByIndex[idx] || 0 });
        } else {
          g.finishedIndexes.add(idx);
          g.doneAt[idx] = Date.now();
        }
        g.processedCount += 1;
        publish(g);
        if (g.isCancelling) return;
      } catch (e) {
        g.currentPromptIndex = undefined;
        g.finishedIndexes.add(idx);
        g.results.push({ index: idx, promptIndex: cfg.promptIndex, success: false, downloadComplete: true, error: e && e.message ? e.message : 'Unknown error' });
        g.processedCount += 1;
        publish(g);
        if (g.isCancelling) return;
      }
    }
  }

  function markDownloaded(item, g) {
    const r = g.results.find((x) => x.index === item.index);
    if (r) r.downloadComplete = true;
    g.finishedIndexes.add(item.index);
    g.doneAt[item.index] = Date.now();
    publish(g);
  }
  function markDownloadFailed(item, g, err) {
    g.results = g.results.filter((x) => x.index !== item.index);
    g.results.push({ index: item.index, promptIndex: item.config.promptIndex, success: false, downloadComplete: true, error: err || 'Download failed' });
    g.finishedIndexes.add(item.index);
    g.doneAt[item.index] = Date.now();
    publish(g);
  }
  function retryAfterFailedGeneration(item, g) {
    const max = item.config.maxRetries != null ? item.config.maxRetries : 1;
    if (item.retryCount < max && g.status === 'running' && !g.isCancelling) {
      g.downloadRetryCountByIndex[item.index] = (g.downloadRetryCountByIndex[item.index] || 0) + 1;
      g.retryCountByIndex[item.index] = (g.retryCountByIndex[item.index] || 0) + 1;
      g.results = g.results.filter((x) => x.index !== item.index);
      g.processedCount = Math.max(0, g.processedCount - 1);
      if (!g.pending.includes(item.index)) g.pending.unshift(item.index);
      A.warn(`Prompt ${item.config.promptIndex}: generation failed, re-sending`);
      publish(g);
      return;
    }
    markDownloadFailed(item, g, `Failed after ${max} retries`);
  }

  /* ---------- download worker ---------- */
  (async function downloadLoop() {
    for (;;) {
      if (!downloadQueue.length) { await wait(1000); continue; }
      const item = downloadQueue[0];
      const g = groups.find((x) => x.id === item.groupId);
      const cancelled = () => !g || !!g.isCancelling;
      try {
        const res = await A.downloadPrompt(item.tileRefs, item.config, cancelled);
        if (g) {
          if (res.success) {
            if (res.extractedFrame !== undefined || res.nextPromptEditImage !== undefined) {
              const next = item.index + 1;
              if (next < g.payloads.length) {
                g.payloads[next] = { ...g.payloads[next], outputPreviousPrompt: { extractedFrame: res.extractedFrame, nextPromptEditImage: res.nextPromptEditImage, tileRefs: res.tileRefs, imageSrc: res.imageSrc || null } };
              }
            }
            markDownloaded(item, g);
          } else if (res.cancelled) {
            markDownloadFailed(item, g, res.error || 'Cancelled');
          } else {
            retryAfterFailedGeneration(item, g);
          }
        }
      } catch (e) {
        if (g) markDownloadFailed(item, g, String(e));
      }
      downloadQueue.shift();
    }
  })();

  /* ---------- group runner ---------- */
  async function runGroup(g) {
    await A.loadSelectors();
    A.resetSettingsCache();
    for (;;) {
      if (g.isCancelling) {
        g.status = 'cancelled';
        groups.shift(); publish(g); g.reply({ success: false, cancelled: true, results: g.results });
        activeGroupId = null; setZoom(1);
        return;
      }
      if (g.pending.length) await submitWorker(g).catch((e) => A.error('Worker error:', e));
      while (downloadQueue.some((d) => d.groupId === g.id)) await wait(200);
      if (!g.pending.length || g.isCancelling) {
        if (g.isCancelling) continue;
        g.status = 'completed';
        groups.shift(); publish(g);
        A.log(`Batch finished: ${g.results.filter((r) => r.success).length}/${g.totalCount} prompts OK`);
        g.reply({ success: g.results.every((r) => r.success), results: g.results });
        activeGroupId = null; setZoom(1);
        return;
      }
    }
  }

  (async function groupLoop() {
    for (;;) {
      if (!groups.length) { await wait(1000); continue; }
      const g = groups[0];
      if (g.status === 'cancelled') { groups.shift(); publish(g); continue; }
      activeGroupId = g.id; g.status = 'running'; publish(g); setZoom(0.5);
      try { await runGroup(g); }
      catch (e) {
        g.status = 'error'; if (groups[0] === g) groups.shift(); publish(g);
        g.reply({ success: false, error: e && e.message ? e.message : 'Unknown error' });
        setZoom(1);
      }
      if (!groups.length) await A.detachDebugger();
    }
  })();

  function enqueue(msg) {
    const id = msg.groupId || `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payloads = (msg.payloads || []).map((p) => {
      const out = { ...p, groupId: id };
      if (Array.isArray(p.imageIds)) { out.images = p.imageIds.map((k) => preparedImages[k]).filter(Boolean); delete out.imageIds; }
      return out;
    });
    const g = {
      id, payloads, status: 'queued', createdAt: Date.now(),
      concurrentPrompts: Math.max(1, msg.concurrentPrompts || 1),
      delayMin: msg.promptDelaySecondsMin || 0, delayMax: msg.promptDelaySecondsMax || 0,
      processedCount: 0, totalCount: payloads.length, isCancelling: false,
      results: [], pending: payloads.map((_, i) => i), finishedIndexes: new Set(),
      retryCountByIndex: {}, downloadRetryCountByIndex: {}, startedAt: {}, doneAt: {}, isPaused: false, reply: () => {}
    };
    groups.push(g);
    publish(g);
    A.log(`Queued ${payloads.length} prompt(s)`);
    return id;
  }

  function cancel(groupId) {
    const i = groups.findIndex((g) => g.id === groupId);
    if (i === -1) return { success: false, error: 'Group not found' };
    const g = groups[i];
    if (g.status === 'queued') { g.status = 'cancelled'; groups.splice(i, 1); publish(g); return { success: true, cancelled: true }; }
    if (g.status === 'running') { g.isCancelling = true; publish(g); A.log('Stopping...'); return { success: true, cancelling: true }; }
    return { success: false, error: 'Already finished' };
  }

  function setPaused(groupId, paused) {
    const g = groups.find((x) => x.id === groupId);
    if (!g || g.status !== 'running') return { success: false, error: 'Nothing running' };
    g.isPaused = paused;
    A.log(paused ? 'Paused: the current prompt finishes, then AutoFlow waits' : 'Resumed');
    publish(g);
    return { success: true, paused };
  }

  /* ---------- self-check: which Flow controls can AutoFlow find on this page? ---------- */
  // Controls that should be visible on an open Flow project (others only exist inside menus)
  const CORE_CONTROLS = {
    promptTextarea: 'Prompt box',
    submitButton: 'Generate button',
    configButton: 'Prompt settings button',
    addImageButton: 'Add image / ingredient button',
    promptBoxContainer: 'Prompt area',
    agentToggle: 'Agent toggle',
    charactersTabButton: 'Characters section'
  };
  function selfCheck() {
    const sel = A.selectors || {};
    const rows = Object.entries(CORE_CONTROLS).map(([key, label]) => {
      let found = 0;
      try { found = A.q(sel[key]).filter((_, el) => A.isVisibleEl(el)).length; } catch (e) {}
      return { key, label, found };
    });
    const menuKeys = Object.keys(sel).filter((k) => !CORE_CONTROLS[k] && !/Template$/.test(k)).length;
    return { onFlow: A.isFlowPage(), url: location.href, rows, menuKeys };
  }

  /* ---------- messages from the side panel ---------- */
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    switch (msg && msg.type) {
      case 'PING':
        reply({ ok: true, isFlowPage: A.isFlowPage(), url: location.href });
        return false;
      case 'CHECK_FLOW_PAGE':
        reply({ isFlowPage: A.isFlowPage() });
        return false;
      case 'PREPARE_IMAGE':
        if (msg.id && msg.data) { preparedImages[msg.id] = msg.data; reply({ success: true }); }
        else reply({ success: false, error: 'Missing image' });
        return false;
      case 'PREPARE_IMAGE_CHUNK': {
        const key = 'img-' + msg.id;
        if (!imageChunks[key]) imageChunks[key] = { parts: new Array(msg.totalChunks).fill(null) };
        const c = imageChunks[key];
        c.parts[msg.chunkIndex] = msg.chunk;
        const got = c.parts.filter((p) => p !== null).length;
        if (got === msg.totalChunks) {
          try { preparedImages[msg.id] = JSON.parse(c.parts.join('')); delete imageChunks[key]; reply({ success: true }); }
          catch (e) { reply({ success: false, error: 'Bad image chunks' }); }
        } else reply({ success: true, received: got });
        return false;
      }
      case 'AUTO_FILL_FLOW': {
        const id = enqueue(msg);
        reply({ success: true, groupId: id });
        return false;
      }
      case 'PAUSE_PROMPT_GROUP':
        reply(setPaused(msg.groupId, true));
        return false;
      case 'RESUME_PROMPT_GROUP':
        reply(setPaused(msg.groupId, false));
        return false;
      case 'SELF_CHECK':
        A.loadSelectors().then(() => reply(selfCheck())).catch((e) => reply({ error: String(e) }));
        return true;
      case 'CANCEL_PROMPT_GROUP':
        reply(cancel(msg.groupId));
        return false;
      case 'GET_QUEUE_STATE':
        groups.forEach(publish);
        reply({ groups: snapshot() });
        return false;
      case 'SCAN_VOICES':
        A.loadSelectors().then(() => A.uiLock.run(() => A.scanVoices()))
          .then((v) => reply({ voices: v || [] }))
          .catch((e) => reply({ voices: [], error: String(e && e.message ? e.message : e) }));
        return true;
      case 'SCAN_CHARACTERS':
        A.loadSelectors().then(() => A.scanCharacters())
          .then((c) => reply({ characters: c }))
          .catch((e) => reply({ characters: [], error: String(e && e.message ? e.message : e) }));
        return true;
      default:
        return false;
    }
  });

  if (A.isFlowPage()) {
    A.loadSelectors();
    A.log('Ajay AutoFlow ready on this page');
  }
})();
