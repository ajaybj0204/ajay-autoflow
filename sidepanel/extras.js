/* Ajay AutoFlow - extra features for the side panel
 *  - crash recovery / resume an unfinished run
 *  - scene import from CSV or Google Sheets, with prompt templates
 *  - saved projects (+ sub-folder per project)
 *  - time estimate, run report, retry failed only, CSV shot list, caption .txt files
 *  - desktop notification + sound when a batch ends
 *  - self-check of the Flow page
 *  - Hinglish interface
 * Uses the globals from app.js (settings, start, parsePrompts, promptParts, toast, $ ...). */
'use strict';

const RUN_KEY = 'aws_run';
const PROJECTS_KEY = 'aws_projects';

/* ---------------- shared helpers ---------------- */
const sanitizeName = (s) => String(s || '').replace(/[/\\?%*:|"<>]/g, '-').replace(/^[-.]+|[-.]+$/g, '').trim();
const slug = (s) => sanitizeName(s).replace(/\s+/g, '-').slice(0, 60);

// Same rules as content/flow.js, so captions and the report match the downloaded files
function promptTagOf(prompt) {
  const s = String(prompt || '').trim();
  let m = s.match(/^[([]?#+\s*([a-zA-Z0-9_.:\-]+)[)\]]?/);
  if (m && sanitizeName(m[1])) return sanitizeName(m[1]);
  m = s.match(/#([a-zA-Z0-9_.:\-]+)/);
  return m && sanitizeName(m[1]) ? sanitizeName(m[1]) : null;
}
function fileStemOf(text, promptIndex, isVideo) {
  const type = isVideo ? 'video' : 'image';
  if (settings.fileNamingSystem === 'simple') return `${promptIndex} ${type}`;
  return promptTagOf(text) || `${promptIndex} ${type}`;
}
const fmtDuration = (ms) => {
  if (ms == null) return '–';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};
const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
function downloadText(filename, text, mime = 'text/plain') {
  const url = `data:${mime};charset=utf-8,` + encodeURIComponent(text);
  return chrome.downloads.download({ url, filename: filename.replace(/^[/\\]+/, ''), conflictAction: 'uniquify', saveAs: false });
}

/* ---------------- Hinglish interface ---------------- */
const I18N_HI = {
  resumeTitle: 'Adhoora run mila', resumeBtn: 'Jahan ruka tha wahan se chalayein', discardBtn: 'Hata dein',
  projectsTitle: 'Project', projectLoad: 'Saved projects', projectName: 'Project ka naam',
  projectSave: 'Prompts + settings save karein', projectLoadBtn: 'Kholein', projectDelete: 'Delete',
  projectHint: 'Is project ki files apne alag sub-folder mein jayengi (Settings → Auto download).',
  metaHint: 'Tip: prompt ki pehli lines mein <b>voice: Puck</b>, <b>model: Veo 3.1 - Fast</b> ya <b>ratio: 9:16</b> likh kar sirf us prompt ki setting badlein.',
  importScenes: 'Scenes import (CSV / Sheets)',
  importHint: 'Google Sheets se table copy karke ya CSV paste karein. Pehli row = column ke naam: <b>tag</b> (ya timecode), <b>prompt</b>, <b>character</b>, <b>voice</b>, <b>model</b>, <b>ratio</b>. Baaki columns template mein {column} se use karein.',
  templateLabel: 'Template (optional)', importReplace: 'Prompts badlein', importAppend: 'Aakhir mein jodein', close: 'Band karein',
  reportTitle: 'Run report', retryFailed: 'Sirf fail wale dobara', exportCsv: 'Shot list (CSV) export', saveCaptions: 'Caption files save karein',
  subfolderSetting: 'Har project ka alag sub-folder', captionSetting: 'Har clip ke saath caption .txt',
  alertsTitle: 'Batch khatam hone par', notifySetting: 'Desktop notification', soundSetting: 'Awaaz bajayein',
  languageTitle: 'Bhasha', languageLabel: 'Panel ki bhasha',
  selfCheckTitle: 'Self-check', selfCheckHint: 'Google Flow update ke baad check karein ki AutoFlow kaun se buttons dhoondh pa raha hai. Pehle Flow project kholein.',
  selfCheckBtn: 'Flow page check karein',
  // existing parts of the panel
  'tab:control': 'Control', 'tab:settings': 'Settings', 'tab:logs': 'Logs',
  'title:Mode': 'Mode', 'title:Generation': 'Generation', 'title:Prompts': 'Prompts', 'title:Queue': 'Queue',
  'title:Images': 'Images', 'title:Voice (speaker)': 'Awaaz (speaker)', 'title:Characters': 'Characters',
  'btn:startBtn': 'AutoFlow shuru karein', 'btn:stopBtn': 'Rokein', 'btn:clearBtn': 'Saaf karein',
  'text:queueEmpty': 'Abhi kuch nahi chal raha.'
};
const enCache = new Map();
function setLabel(el, html) {
  if (!enCache.has(el)) enCache.set(el, el.innerHTML);
  el.innerHTML = html;
}
// Replace only the first text of an element, keeping child counters/badges
function setFirstText(el, text) {
  const node = Array.from(el.childNodes).find((n) => n.nodeType === 3 && n.nodeValue.trim());
  if (!node) return;
  if (!enCache.has(node)) enCache.set(node, node.nodeValue);
  node.nodeValue = text + ' ';
}
function applyLanguage() {
  const hi = settings.uiLang === 'hi';
  document.documentElement.lang = hi ? 'hi-Latn' : 'en';
  if (!hi) {
    enCache.forEach((orig, el) => { if (el.nodeType === 3) el.nodeValue = orig; else el.innerHTML = orig; });
    return;
  }
  $$('[data-i18n]').forEach((el) => { const v = I18N_HI[el.dataset.i18n]; if (v) setLabel(el, v); });
  $$('.tab').forEach((t) => { const v = I18N_HI['tab:' + t.dataset.tab]; if (v) setFirstText(t, v); });
  $$('.card-title').forEach((t) => {
    const node = Array.from(t.childNodes).find((n) => n.nodeType === 3 && n.nodeValue.trim());
    const v = node && I18N_HI['title:' + (enCache.get(node) || node.nodeValue).trim()];
    if (v) setFirstText(t, v);
  });
  ['startBtn', 'clearBtn'].forEach((id) => { const el = document.getElementById(id); const v = I18N_HI['btn:' + id]; if (el && v) setLabel(el, v); });
  const qe = $('#queueEmpty'); if (qe) setLabel(qe, I18N_HI['text:queueEmpty']);
}

/* ---------------- notifications ---------------- */
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [660, 880, 1046].forEach((f, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.35);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.4);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch (e) {}
}
function notifyDone(title, message) {
  if (settings.notifySound) playChime();
  if (!settings.notifyOnDone || !chrome.notifications) return;
  chrome.notifications.create(`af-${Date.now()}`, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title, message, priority: 1 });
}

/* ---------------- run state (crash recovery) ---------------- */
let run = null; // { groupId, tabId, prompts, indices, done, failed, folder, project, isVideo, startedAt, finished }
const saveRun = () => chrome.storage.local.set({ [RUN_KEY]: run });

function onStart({ groupId, tabId, prompts, payloads, folder }) {
  run = {
    groupId, tabId, prompts, folder,
    indices: payloads.map((p) => p.promptIndex),
    texts: Object.fromEntries(payloads.map((p) => [p.promptIndex, p.prompt])),
    isVideo: isVideoMode(),
    project: settings.currentProject || '',
    done: [], failed: {}, durations: {}, startedAt: Date.now(), finished: false
  };
  saveRun();
  $('#resumeCard').classList.add('hidden');
  $('#reportCard').classList.add('hidden');
}

let notifiedGroup = null;
function onStatus(d) {
  if (!run || run.groupId !== d.id) return;
  (d.results || []).forEach((r) => {
    if (r.success && r.downloadComplete) { if (!run.done.includes(r.promptIndex)) run.done.push(r.promptIndex); delete run.failed[r.promptIndex]; }
    else if (!r.success) run.failed[r.promptIndex] = r.error || 'Failed';
    if (r.durationMs) run.durations[r.promptIndex] = r.durationMs;
  });
  const finished = ['completed', 'cancelled', 'error'].includes(d.status);
  if (finished) run.finished = d.status !== 'cancelled' || run.done.length + Object.keys(run.failed).length >= run.indices.length;
  saveRun();
  renderEta(d);
  if (finished && notifiedGroup !== d.id) {
    notifiedGroup = d.id;
    const ok = run.done.length, bad = Object.keys(run.failed).length;
    renderReport();
    if (settings.writeCaptions && ok) saveCaptions(true);
    const label = d.status === 'completed' ? 'Batch finished' : d.status === 'cancelled' ? 'Batch stopped' : 'Batch stopped with an error';
    notifyDone(`AutoFlow: ${label}`, `${ok} done${bad ? `, ${bad} failed` : ''} of ${run.indices.length} prompts.`);
  }
}

/* ---------------- time estimate ---------------- */
function renderEta(d) {
  const el = $('#queueEta');
  if (!el) return;
  if (!['running', 'queued'].includes(d.status)) { el.textContent = ''; return; }
  if (d.isPaused) { el.textContent = 'Paused. Press Resume to continue.'; return; }
  const durs = Object.values(run.durations);
  // Until something finishes, use a rough guess per type of job
  const avg = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : (run.isVideo ? 120000 : 40000);
  const finishedCount = (d.results || []).filter((r) => r.downloadComplete || !r.success).length;
  const remaining = Math.max(0, d.totalCount - finishedCount);
  const parallel = Math.max(1, Number(settings.concurrentPrompts) || 1);
  let ms = (remaining * avg) / parallel;
  if (d.currentStartedAt) ms = Math.max(0, ms - Math.min(avg, Date.now() - d.currentStartedAt));
  if (!remaining) { el.textContent = ''; return; }
  const mins = Math.max(1, Math.round(ms / 60000));
  el.textContent = `≈ ${mins} min left${durs.length ? '' : ' (rough guess until the first prompt finishes)'}`;
}

/* ---------------- run report ---------------- */
function renderReport() {
  if (!run) return;
  const card = $('#reportCard');
  const rows = run.indices.map((n) => {
    const text = run.texts[n] || '';
    const status = run.done.includes(n) ? 'done' : run.failed[n] ? 'failed' : 'not run';
    return { n, text, status, file: fileStemOf(text, n, run.isVideo), time: run.durations[n], error: run.failed[n] || '' };
  });
  const ok = rows.filter((r) => r.status === 'done').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const skipped = rows.length - ok - failed;
  $('#reportSummary').textContent = `${ok} done · ${failed} failed${skipped ? ` · ${skipped} not run` : ''} · total time ${fmtDuration(Date.now() - run.startedAt)}`;
  $('#reportTable').innerHTML =
    '<table><thead><tr><th>#</th><th>File</th><th>Status</th><th>Time</th></tr></thead><tbody>' +
    rows.map((r) => `<tr class="${r.status.replace(' ', '-')}"><td>${r.n}</td><td title="${escapeHtml(r.text)}">${escapeHtml(r.file)}</td><td>${r.status}${r.error ? ` <span class="muted" title="${escapeHtml(r.error)}">ⓘ</span>` : ''}</td><td>${fmtDuration(r.time)}</td></tr>`).join('') +
    '</tbody></table>';
  $('#retryFailedBtn').classList.toggle('hidden', !(failed + skipped));
  $('#retryFailedBtn').textContent = settings.uiLang === 'hi' ? I18N_HI.retryFailed : `Retry ${failed + skipped} failed / not run`;
  card.classList.remove('hidden');
}

function exportReport() {
  if (!run) return toast('Run something first.', true);
  const head = ['#', 'File name', 'Status', 'Time (s)', 'Prompt', 'Error'];
  const lines = run.indices.map((n) => {
    const text = run.texts[n] || '';
    const status = run.done.includes(n) ? 'done' : run.failed[n] ? 'failed' : 'not run';
    return [n, fileStemOf(text, n, run.isVideo), status, run.durations[n] ? Math.round(run.durations[n] / 1000) : '', text, run.failed[n] || ''];
  });
  const csv = '﻿' + [head, ...lines].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const name = `${run.folder ? run.folder + '/' : ''}shot-list-${new Date(run.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
  downloadText(name, csv, 'text/csv').then(() => toast('Shot list saved to Downloads')).catch((e) => toast(String(e), true));
}

async function saveCaptions(silent) {
  if (!run || !run.done.length) return silent || toast('No finished clips yet.', true);
  for (const n of run.done) {
    const text = (run.texts[n] || '').replace(/^[([]?#+\s*[a-zA-Z0-9_.:\-]+[)\]]?\s*/, '');
    const stem = fileStemOf(run.texts[n], n, run.isVideo);
    await downloadText(`${run.folder ? run.folder + '/' : ''}${stem}.txt`, text).catch(() => {});
  }
  if (!silent) toast(`Saved ${run.done.length} caption file(s)`);
}

function retryRemaining() {
  if (!run) return;
  const remaining = run.indices.filter((n) => !run.done.includes(n));
  if (!remaining.length) return toast('Nothing left to retry.');
  start({ onlyIndices: remaining });
}

/* ---------------- resume after a crash ---------------- */
async function checkUnfinished() {
  const st = await chrome.storage.local.get(RUN_KEY);
  const saved = st[RUN_KEY];
  if (!saved || saved.finished) return;
  run = saved;
  // Still running in the Flow tab? Then it isn't lost: just follow it.
  try {
    if (saved.tabId) {
      const r = await sendToTab(saved.tabId, { type: 'GET_QUEUE_STATE' });
      if (r && (r.groups || []).some((g) => g.id === saved.groupId && ['running', 'queued'].includes(g.status))) return;
    }
  } catch (e) { /* tab gone */ }
  const left = saved.indices.filter((n) => !saved.done.includes(n)).length;
  if (!left) return;
  $('#resumeText').textContent = `${saved.done.length} of ${saved.indices.length} prompts finished before it stopped${saved.project ? ` (project "${saved.project}")` : ''}. ${left} left.`;
  $('#resumeCard').classList.remove('hidden');
}
async function resumeRun() {
  if (!run) return;
  // Put the original prompts back if the list was changed
  if (parsePrompts($('#prompts').value).join('\n\n') !== run.prompts.join('\n\n')) {
    $('#prompts').value = run.prompts.join('\n\n');
    saveForm(); renderPrompts();
  }
  const remaining = run.indices.filter((n) => !run.done.includes(n));
  $('#resumeCard').classList.add('hidden');
  await start({ onlyIndices: remaining });
}

/* ---------------- scene import (CSV / Google Sheets) + templates ---------------- */
function parseTable(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!src) return [];
  const delim = src.split('\n')[0].includes('\t') ? '\t' : ',';
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && !cell) q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell); rows.push(row);
  const head = rows.shift().map((h) => h.trim().toLowerCase());
  return rows.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}
const pick = (row, names) => { for (const n of names) if (row[n]) return row[n]; return ''; };
function rowToPrompt(row, template) {
  let body = template
    ? template.replace(/\{([^}]+)\}/g, (_, k) => row[k.trim().toLowerCase()] || '')
    : pick(row, ['prompt', 'scene', 'description', 'text']);
  body = body.replace(/\s+/g, ' ').trim();
  if (!body) return null;
  const character = pick(row, ['character', 'char', '@character']).replace(/^@+/, '');
  if (character && !new RegExp(`@${character.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(body)) body = `@${character} ${body}`;
  const tag = pick(row, ['tag', 'timecode', 'time', 'tc', 'shot']);
  if (tag) body = `#${tag.replace(/^#+/, '').replace(/\s+/g, '')} ${body}`;
  const meta = [];
  const voice = pick(row, ['voice', 'speaker']); if (voice) meta.push(`voice: ${voice}`);
  const model = pick(row, ['model']); if (model) meta.push(`model: ${model}`);
  const ratio = pick(row, ['ratio', 'aspect', 'aspect ratio']); if (ratio) meta.push(`ratio: ${ratio}`);
  return [...meta, body].join('\n');
}
function importedPrompts() {
  const rows = parseTable($('#importText').value);
  const tpl = $('#importTemplate').value.trim();
  return rows.map((r) => rowToPrompt(r, tpl)).filter(Boolean);
}
function updateImportPreview() {
  const list = importedPrompts();
  $('#importPreview').textContent = list.length ? `${list.length} scene(s) ready` : 'No rows yet';
}
function applyImport(replace) {
  const list = importedPrompts();
  if (!list.length) return toast('Nothing to import. Paste a table with a header row first.', true);
  const existing = replace ? [] : parsePrompts($('#prompts').value);
  $('#prompts').value = existing.concat(list).join('\n\n');
  $('#rangeTo')._auto = true;
  saveForm(); renderPrompts();
  $('#importBox').classList.add('hidden');
  toast(`Imported ${list.length} scene(s)`);
}

/* ---------------- saved projects ---------------- */
const PROJECT_SETTINGS = ['mode', 'agentType', 'aspectRatio', 'outputCount', 'model', 'imageModel', 'defaultVideoOption', 'defaultImageOption', 'defaultSpeaker', 'autoAddVoiceBySpeaker', 'enableCharacterControl', 'defaultCharacters'];
let projects = {};
async function loadProjects() {
  const st = await chrome.storage.local.get(PROJECTS_KEY);
  projects = st[PROJECTS_KEY] || {};
  const sel = $('#projectSelect');
  sel.innerHTML = '<option value="">— none —</option>';
  Object.keys(projects).sort((a, b) => projects[b].savedAt - projects[a].savedAt).forEach((name) => {
    sel.add(new Option(`${name} (${parsePrompts(projects[name].prompts).length} prompts)`, name));
  });
  sel.value = projects[settings.currentProject] ? settings.currentProject : '';
  $('#projectName').value = settings.currentProject || '';
}
async function saveProject() {
  const name = $('#projectName').value.trim();
  if (!name) return toast('Give the project a name first.', true);
  projects[name] = {
    prompts: $('#prompts').value,
    settings: Object.fromEntries(PROJECT_SETTINGS.map((k) => [k, settings[k]])),
    savedAt: Date.now()
  };
  await chrome.storage.local.set({ [PROJECTS_KEY]: projects });
  settings.currentProject = name; saveSettings();
  await loadProjects();
  toast(`Saved "${name}"`);
}
async function loadProject() {
  const name = $('#projectSelect').value;
  if (!name || !projects[name]) return toast('Pick a saved project.', true);
  const p = projects[name];
  $('#prompts').value = p.prompts || '';
  Object.assign(settings, p.settings || {});
  settings.currentProject = name;
  saveSettings(); saveForm();
  bindSettings(); fillVoiceSelect(); refreshUI();
  $('#projectName').value = name;
  toast(`Loaded "${name}"`);
}
async function deleteProject() {
  const name = $('#projectSelect').value;
  if (!name || !projects[name]) return toast('Pick a saved project.', true);
  if (!confirm(`Delete project "${name}"? Your downloaded files are not touched.`)) return;
  delete projects[name];
  await chrome.storage.local.set({ [PROJECTS_KEY]: projects });
  if (settings.currentProject === name) { settings.currentProject = ''; saveSettings(); }
  await loadProjects();
  toast('Project deleted');
}
function folderFor(base) {
  const root = String(base || '').trim();
  const sub = settings.projectSubfolder && settings.currentProject ? slug(settings.currentProject) : '';
  return [root, sub].filter(Boolean).join('/');
}

/* ---------------- self-check ---------------- */
async function selfCheck() {
  const box = $('#selfCheckResult');
  const tab = await getActiveTab();
  if (!tab || !isFlowUrl(tab.url)) return toast('Open a Google Flow project in this tab first.', true);
  box.innerHTML = '<span class="muted small">Checking…</span>';
  try {
    const r = await sendToTab(tab.id, { type: 'SELF_CHECK' });
    const missing = r.rows.filter((x) => !x.found);
    box.innerHTML = '<table><tbody>' + r.rows.map((x) => `<tr class="${x.found ? 'done' : 'failed'}"><td>${x.found ? '✅' : '❌'}</td><td>${escapeHtml(x.label)}</td><td class="muted">${escapeHtml(x.key)}</td></tr>`).join('') + '</tbody></table>' +
      `<p class="hint">${missing.length ? `${missing.length} control(s) not found. If you're inside a project and a run fails, Google may have changed these. Update them under Advanced → custom selectors (key names shown above).` : 'All main controls found.'} ${r.menuKeys} more controls only appear inside menus and are checked during a run.</p>`;
  } catch (e) { box.innerHTML = ''; toast(e.message, true); }
}

/* ---------------- wiring ---------------- */
window.afHooks = { onStart, onStatus, folderFor };

async function initExtras() {
  applyLanguage();
  document.querySelector('[data-setting="uiLang"]').addEventListener('change', () => setTimeout(applyLanguage, 0));

  $('#resumeRunBtn').addEventListener('click', resumeRun);
  $('#discardRunBtn').addEventListener('click', async () => { run = null; await chrome.storage.local.remove(RUN_KEY); $('#resumeCard').classList.add('hidden'); });

  $('#openImportBtn').addEventListener('click', () => { $('#importBox').classList.toggle('hidden'); updateImportPreview(); });
  $('#importCloseBtn').addEventListener('click', () => $('#importBox').classList.add('hidden'));
  $('#importText').addEventListener('input', updateImportPreview);
  $('#importTemplate').addEventListener('input', updateImportPreview);
  $('#csvInput').addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; $('#importText').value = await f.text(); e.target.value = ''; updateImportPreview(); });
  $('#importReplaceBtn').addEventListener('click', () => applyImport(true));
  $('#importAppendBtn').addEventListener('click', () => applyImport(false));

  $('#projectSaveBtn').addEventListener('click', saveProject);
  $('#projectLoadBtn').addEventListener('click', loadProject);
  $('#projectDeleteBtn').addEventListener('click', deleteProject);
  $('#projectSelect').addEventListener('change', (e) => { if (e.target.value) $('#projectName').value = e.target.value; });

  $('#retryFailedBtn').addEventListener('click', retryRemaining);
  $('#exportReportBtn').addEventListener('click', exportReport);
  $('#saveCaptionsBtn').addEventListener('click', () => saveCaptions(false));
  $('#selfCheckBtn').addEventListener('click', selfCheck);

  await loadProjects();
  checkUnfinished();
}
// app.js may finish starting before this file loads, so handle both orders
if (window.__afReady) initExtras(); else window.addEventListener('af-ready', initExtras, { once: true });
