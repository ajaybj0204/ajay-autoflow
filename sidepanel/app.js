/* Ajay AutoFlow - side panel */
'use strict';

const FLOW_URL = 'https://flow.google.com/';
const SETTINGS_KEY = 'aws_settings';
const FORM_KEY = 'aws_form';
const CHARS_KEY = 'aws_scanned_characters';
const SELECTORS_KEY = 'aws_custom_selectors';
const VOICES_KEY = 'aws_scanned_voices';
const CHUNK = 1024 * 1024;

const DEFAULTS = {
  mode: 'textToVideo',
  agentType: 'agentAutomationToImage',
  aspectRatio: '16:9',
  outputCount: 2,
  agentOutputCount: 2,
  concurrentPrompts: 1,
  promptDelaySecondsMin: 0,
  promptDelaySecondsMax: 20,
  model: 'Veo 3.1 - Lite',
  imageModel: 'Nano Banana 2.1',
  defaultVideoOption: '8s',
  defaultImageOption: 'new-image',
  imageToVideoMaxImagesPerPrompt: 1,
  componentsToVideoMaxImagesPerPrompt: 3,
  imageToImageMaxImagesPerPrompt: 3,
  agentMaxImagesPerPrompt: 3,
  maxRetries: 1,
  autoDownloadVideoQuality: '720',
  autoDownloadImageQuality: '1k',
  autoAddCharacterImages: false,
  autoAddVoiceBySpeaker: false,
  defaultSpeaker: 'none',
  enableCharacterControl: false,
  defaultCharacters: [],
  autoChangeFileName: true,
  fileNamingSystem: 'prompt_tag',
  folderName: 'ajay-autoflow',
  socialYouTubeUrl: 'https://www.youtube.com/@ExploreX-00',
  socialFacebookUrl: '',
  zoomOutWhileRunning: true
};

const IMAGE_MODELS = ['Nano Banana Pro', 'Nano Banana 2.1', 'Nano Banana 2.1 Light'];
const VIDEO_MODELS = ['Veo 3.1 - Lite', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality', 'Omni 1.1 Flash'];

/* Built-in voice library: the 30 Gemini preset voices that Flow's voice picker is built on
 * ([name, gender, style]). Use "Sync voices from Flow" to replace / extend this list with
 * exactly what your Flow account shows (including custom voices you created). */
const BUILTIN_VOICES = [
  ['Achernar', 'Female', 'Soft'], ['Achird', 'Male', 'Friendly'], ['Algenib', 'Male', 'Gravelly'], ['Algieba', 'Male', 'Smooth'],
  ['Alnilam', 'Male', 'Firm'], ['Aoede', 'Female', 'Breezy'], ['Autonoe', 'Female', 'Bright'], ['Callirrhoe', 'Female', 'Easy-going'],
  ['Charon', 'Male', 'Informative'], ['Despina', 'Female', 'Smooth'], ['Enceladus', 'Male', 'Breathy'], ['Erinome', 'Female', 'Clear'],
  ['Fenrir', 'Male', 'Excitable'], ['Gacrux', 'Female', 'Mature'], ['Iapetus', 'Male', 'Clear'], ['Kore', 'Female', 'Firm'],
  ['Laomedeia', 'Female', 'Upbeat'], ['Leda', 'Female', 'Youthful'], ['Orus', 'Male', 'Firm'], ['Puck', 'Male', 'Upbeat'],
  ['Pulcherrima', 'Female', 'Forward'], ['Rasalgethi', 'Male', 'Informative'], ['Sadachbia', 'Male', 'Lively'], ['Sadaltager', 'Male', 'Knowledgeable'],
  ['Schedar', 'Male', 'Even'], ['Sulafat', 'Female', 'Warm'], ['Umbriel', 'Male', 'Easy-going'], ['Vindemiatrix', 'Female', 'Gentle'],
  ['Zephyr', 'Female', 'Bright'], ['Zubenelgenubi', 'Male', 'Casual']
];
let VOICES = BUILTIN_VOICES.slice();
let scannedVoices = [];
function mergeVoices() {
  const map = new Map(BUILTIN_VOICES.map((v) => [v[0].toLowerCase(), v]));
  scannedVoices.forEach((n) => { if (!map.has(n.toLowerCase())) map.set(n.toLowerCase(), [n, 'Flow', 'from your Flow']); });
  VOICES = Array.from(map.values()).sort((a, b) => a[0].localeCompare(b[0]));
}
const escRe = (s) => String(s).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
// whole-word, case-insensitive (so "Kore" never matches "Korean", "Ali" never matches "Alice")
const hasWord = (text, word) => new RegExp(`(^|[^\\w])@?${escRe(word)}(?![\\w])`, 'i').test(text);

const MODE_INFO = {
  textToVideo: { video: true, images: false, voice: true, chars: true, hint: 'Write a description, Flow makes the full video.' },
  imageToVideo: { video: true, images: true, maxKey: 'imageToVideoMaxImagesPerPrompt', maxOpts: 2, voice: false, chars: true, hint: 'Each prompt animates its own start frame (1st image = prompt 1, 2nd = prompt 2...).' },
  componentsToVideo: { video: true, images: true, maxKey: 'componentsToVideoMaxImagesPerPrompt', maxOpts: 10, voice: true, chars: true, hint: 'Use images as ingredients (characters, objects, places) inside the video.' },
  textToImage: { video: false, images: false, voice: false, chars: true, hint: 'Generate images from text.' },
  imageToImage: { video: false, images: true, maxKey: 'imageToImageMaxImagesPerPrompt', maxOpts: 10, voice: false, chars: true, hint: 'Edit / transform your images with a prompt.' },
  agentAutomation: { video: null, images: true, maxKey: 'agentMaxImagesPerPrompt', maxOpts: 10, voice: true, chars: true, optionalImages: true, hint: 'Flow agent creates the images / videos for each prompt.' }
};

/* ---------------- state ---------------- */
let settings = { ...DEFAULTS };
let images = [];          // {id, name, base64, type}
let scannedChars = [];
let logs = [];
let unseenLogs = 0;
let activeGroupId = null;
let lastStatus = null;
let flowTabId = null;

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), isErr ? 6000 : 2600);
}

/* ---------------- storage ---------------- */
async function loadAll() {
  const st = await chrome.storage.local.get([SETTINGS_KEY, FORM_KEY, CHARS_KEY, SELECTORS_KEY, VOICES_KEY]);
  settings = { ...DEFAULTS, ...(st[SETTINGS_KEY] || {}) };
  if (!Array.isArray(settings.defaultCharacters)) settings.defaultCharacters = [];
  // migrate old image model values (v1.0.x) to the current Flow labels
  const IMG_MODEL_MIGRATE = {
    '🍌 Nano Banana Pro': 'Nano Banana Pro', '🍌 Nano Banana 2.1': 'Nano Banana 2.1', '🍌 Nano Banana 2': 'Nano Banana 2.1',
    '🍌 Nano Banana 2 Light': 'Nano Banana 2.1 Light', '🍌 Nano Banana 2 Lite': 'Nano Banana 2.1 Light', 'Nano Banana 2 Light': 'Nano Banana 2.1 Light'
  };
  if (IMG_MODEL_MIGRATE[settings.imageModel]) settings.imageModel = IMG_MODEL_MIGRATE[settings.imageModel];
  if (!IMAGE_MODELS.includes(settings.imageModel)) settings.imageModel = DEFAULTS.imageModel;
  const VID_MODEL_MIGRATE = { 'Veo 3.1 - Lite [Lower Priority]': 'Veo 3.1 - Lite', 'Omni Flash': 'Omni 1.1 Flash' };
  if (VID_MODEL_MIGRATE[settings.model]) settings.model = VID_MODEL_MIGRATE[settings.model];
  if (!VIDEO_MODELS.includes(settings.model)) settings.model = DEFAULTS.model;
  scannedChars = (Array.isArray(st[CHARS_KEY]) ? st[CHARS_KEY] : []).map((c) => String(c).replace(/^@+/, '').trim()).filter(Boolean);
  scannedVoices = Array.isArray(st[VOICES_KEY]) ? st[VOICES_KEY] : [];
  mergeVoices();
  const form = st[FORM_KEY] || {};
  $('#prompts').value = form.prompts || '';
  $('#customSelectors').value = st[SELECTORS_KEY] || '';
}
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.local.set({ [SETTINGS_KEY]: settings }), 150);
}
function saveForm() { chrome.storage.local.set({ [FORM_KEY]: { prompts: $('#prompts').value } }); }

/* ---------------- settings <-> form ---------------- */
function numeric(key) { return typeof DEFAULTS[key] === 'number'; }
function bindSettings() {
  $$('[data-setting]').forEach((el) => {
    const key = el.dataset.setting;
    const v = settings[key];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : String(v);
    if (el.tagName === 'SELECT' && el.value !== String(v) && el.options.length) {
      // value no longer in list -> fall back to default
      el.value = String(DEFAULTS[key]);
      settings[key] = numeric(key) ? Number(el.value) : el.value;
    }
    if (el._bound) return;
    el._bound = true;
    el.addEventListener('change', () => {
      const key = el.dataset.setting;
      let val = el.type === 'checkbox' ? el.checked : el.value;
      if (numeric(key)) val = Number(val) || 0;
      settings[key] = val;
      if (key === 'promptDelaySecondsMax' && settings.promptDelaySecondsMax < settings.promptDelaySecondsMin) settings.promptDelaySecondsMin = settings.promptDelaySecondsMax;
      saveSettings();
      refreshUI();
    });
  });
}

/* ---------------- Ajay's social links ---------------- */
// Only show a clickable link if the saved URL belongs to the expected service.
function safeSocialUrl(raw, sites) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
    const hostname = parsed.hostname.toLowerCase();
    if (!sites.some((s) => hostname === s || hostname.endsWith('.' + s))) return '';
    return parsed.href;
  } catch (_err) { return ''; }
}
function refreshBrandLinks() {
  const fields = [
    { key: 'socialYouTubeUrl', sites: ['youtube.com', 'youtu.be'], header: 'brandYouTubeHeader', footer: 'brandYouTubeFooter', status: 'youtubeLinkStatus', platform: 'YouTube' },
    { key: 'socialFacebookUrl', sites: ['facebook.com', 'fb.com', 'fb.watch'], header: 'brandFacebookHeader', footer: 'brandFacebookFooter', status: 'facebookLinkStatus', platform: 'Facebook' }
  ];
  let anyVisible = false;
  for (const f of fields) {
    const value = String(settings[f.key] || '').trim();
    const url = safeSocialUrl(value, f.sites);
    for (const id of [f.header, f.footer]) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (url) el.setAttribute('href', url);
      else el.removeAttribute('href');
      el.classList.toggle('hidden', !url);
    }
    const hint = document.getElementById(f.status);
    if (hint) {
      hint.textContent = !value ? 'Not set — button hidden.' : url ? 'Saved — link is active.' : 'Invalid link: enter a complete HTTPS ' + f.platform + ' URL.';
      hint.classList.toggle('good', !!url);
      hint.classList.toggle('bad', !!value && !url);
    }
    if (url) anyVisible = true;
  }
  const container = document.getElementById('brandSocialHeader');
  if (container) container.classList.toggle('hidden', !anyVisible);
}

/* ---------------- mode UI ---------------- */
function currentInfo() { return MODE_INFO[settings.mode] || MODE_INFO.textToVideo; }
function isVideoMode() {
  const info = currentInfo();
  if (settings.mode === 'agentAutomation') return settings.agentType === 'agentAutomationToVideo';
  return !!info.video;
}

function refreshUI() {
  refreshBrandLinks();
  const info = currentInfo();
  $$('#modes .chip').forEach((c) => c.classList.toggle('active', c.dataset.mode === settings.mode));
  $('#modeHint').textContent = info.hint;
  $('#agentTypeRow').classList.toggle('hidden', settings.mode !== 'agentAutomation');
  $$('#agentTypeRow .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.agent === settings.agentType));
  const video = isVideoMode();
  $$('.video-only').forEach((e) => e.classList.toggle('hidden', !video));
  $$('.image-only').forEach((e) => e.classList.toggle('hidden', video));
  $('#chainHint').classList.toggle('hidden', !(String(video ? settings.defaultVideoOption : settings.defaultImageOption).includes('concat')));
  $('#imagesCard').classList.toggle('hidden', !info.images);
  $('#voiceCard').classList.toggle('hidden', !(info.voice && (settings.mode !== 'agentAutomation' || video)));
  $('#charCard').classList.toggle('hidden', !info.chars);

  // output count selector shows agent count in agent mode
  const oc = $('#q_outputCount');
  oc.dataset.setting = settings.mode === 'agentAutomation' ? 'agentOutputCount' : 'outputCount';
  oc.value = String(settings[oc.dataset.setting]);

  // max images per prompt
  if (info.images) {
    const sel = $('#maxImagesPerPrompt');
    const cur = settings[info.maxKey] || 1;
    sel.innerHTML = '';
    for (let i = 1; i <= info.maxOpts; i++) sel.add(new Option(String(i), String(i)));
    sel.value = String(Math.min(cur, info.maxOpts));
    const omni = String(settings.model).toLowerCase().includes('omni');
    $('#imageInput').accept = (settings.mode === 'componentsToVideo' || settings.mode === 'agentAutomation') && omni ? 'image/*,video/*' : 'image/*';
  }
  $('#autoAddVoiceBySpeaker').checked = !!settings.autoAddVoiceBySpeaker;
  $('#defaultSpeaker').disabled = !!settings.autoAddVoiceBySpeaker;
  renderChars();
  renderThumbs();
  renderPrompts();
}

/* ---------------- prompts logic ---------------- */
const parsePrompts = (t) => (t ? t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean) : []);
function promptOption(i, total) {
  const def = isVideoMode() ? settings.defaultVideoOption : settings.defaultImageOption;
  if (total > 0 && i === total - 1 && def.includes('-concat')) return def.split('-concat')[0];
  return def;
}
const isConcat = (i, total) => promptOption(i, total).includes('concat');
const isAfterConcat = (i, total) => i > 0 && isConcat(i - 1, total);
const stem = (n) => String(n || '').replace(/\.[^/.]+$/, '');

function imagesPerPrompt(prompts) {
  const info = currentInfo();
  if (!info.images || !images.length) return prompts.map(() => []);
  const max = Number(settings[info.maxKey] || 1);
  const out = [];
  let ptr = 0;
  for (let i = 0; i < prompts.length; i++) {
    if (isAfterConcat(i, prompts.length)) { out.push([]); continue; }
    const p = prompts[i].toLowerCase();
    let picked = [];
    if (settings.autoAddCharacterImages) {
      picked = images.filter((im) => { const s = stem(im.name).toLowerCase(); return s && p.includes(s); }).slice(0, max);
    } else if (settings.mode === 'imageToVideo') {
      // each prompt gets its own frame(s), in order
      picked = images.slice(ptr, ptr + max); ptr += max;
    } else {
      const n = Math.min(max, images.length);
      const seen = new Set();
      for (let k = 0; k < n; k++) { const im = images[ptr % images.length]; ptr++; if (!seen.has(im.id)) { seen.add(im.id); picked.push(im); } }
    }
    out.push(picked);
  }
  return out;
}
function speakerFor(prompt) {
  if (settings.autoAddVoiceBySpeaker) {
    // longest name first, whole word only
    const v = VOICES.slice().sort((a, b) => b[0].length - a[0].length).find(([n]) => hasWord(prompt, n));
    if (v) return v[0];
  }
  return settings.defaultSpeaker && settings.defaultSpeaker !== 'none' ? settings.defaultSpeaker : null;
}
/* Characters for a prompt:
 * - "@Name" of a scanned character is ALWAYS picked (with or without auto mode)
 * - auto mode ON: plain "Name" (no @) is picked too, and unknown "@Word" is tried as a character
 * - characters clicked in the panel are always added */
function charactersFor(prompt) {
  const found = [];
  const add = (c) => { if (c && !found.some((x) => x.toLowerCase() === c.toLowerCase())) found.push(c); };
  const byLen = scannedChars.slice().sort((a, b) => b.length - a.length);
  // longest names first; a matched name is blanked out so "@Ali Khan" does not also add "Ali"
  let work = prompt;
  byLen.forEach((c) => {
    const re = new RegExp(`@${escRe(c)}(?![\\w])`, 'gi');
    if (re.test(work)) { add(c); work = work.replace(re, ' '); }
  });
  if (settings.enableCharacterControl) {
    byLen.forEach((c) => {
      const re = new RegExp(`(^|[^\\w@])${escRe(c)}(?![\\w])`, 'gi');
      if (re.test(work)) { add(c); work = work.replace(re, '$1 '); }
    });
    const isVoice = (w) => VOICES.some(([n]) => n.toLowerCase() === w.toLowerCase());
    (prompt.match(/(^|\s)@([A-Za-z0-9_][\w-]{0,39})/g) || []).forEach((m) => { const w = m.trim().slice(1); if (!isVoice(w) && !found.some((x) => w.toLowerCase().startsWith(x.toLowerCase()))) add(w); });
  }
  settings.defaultCharacters.forEach(add);
  return found.length ? found : null;
}

function renderPrompts() {
  const prompts = parsePrompts($('#prompts').value);
  $('#promptCount').textContent = `${prompts.length}`;
  const from = $('#rangeFrom'), to = $('#rangeTo');
  from.max = to.max = Math.max(1, prompts.length);
  if (Number(to.value) > prompts.length || Number(to.value) < 1 || to._auto !== false) to.value = Math.max(1, prompts.length);
  if (Number(from.value) > prompts.length) from.value = 1;
  const info = currentInfo();
  const per = imagesPerPrompt(prompts);
  const list = $('#promptList');
  list.innerHTML = '';
  prompts.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'p-row';
    row.dataset.idx = String(i + 1);
    const tags = [];
    if (info.images && per[i] && per[i].length) tags.push(`<span class="tag img">${per[i].length} img: ${per[i].map((x) => escapeHtml(stem(x.name))).join(', ')}</span>`);
    if (info.images && !info.optionalImages && !isAfterConcat(i, prompts.length) && (!per[i] || !per[i].length)) tags.push('<span class="tag err">no image</span>');
    if (isAfterConcat(i, prompts.length)) tags.push('<span class="tag chain">uses previous result</span>');
    if (info.voice && (settings.mode !== 'agentAutomation' || isVideoMode())) { const sp = speakerFor(p); if (sp) tags.push(`<span class="tag voice">voice: ${sp}</span>`); }
    const ch = charactersFor(p); if (ch) tags.push(`<span class="tag char">@${ch.map(escapeHtml).join(', @')}</span>`);
    row.innerHTML = `<div class="p-num">${i + 1}</div><div class="p-body"><div class="p-text" title="${escapeHtml(p)}">${escapeHtml(p)}</div><div class="p-meta">${tags.join('')}</div></div>`;
    list.appendChild(row);
  });
  if (lastStatus) applyStatusToRows(lastStatus);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------------- images ---------------- */
function readFile(file) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
}
async function addFiles(files) {
  for (const f of files) {
    if (!/^image\/|^video\//.test(f.type)) continue;
    const base64 = await readFile(f);
    images.push({ id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: f.name, base64, type: f.type });
  }
  refreshUI();
}
function renderThumbs() {
  const box = $('#thumbs');
  box.innerHTML = '';
  $('#imgCount').textContent = images.length ? `(${images.length})` : '';
  images.forEach((im) => {
    const d = document.createElement('div');
    d.className = 'thumb';
    d.innerHTML = (im.type.startsWith('video/') ? `<video src="${im.base64}" muted></video>` : `<img src="${im.base64}" alt="">`) +
      `<span class="nm" title="${escapeHtml(im.name)}">${escapeHtml(im.name)}</span><button class="x" title="Remove">&times;</button>`;
    d.querySelector('.x').addEventListener('click', () => { images = images.filter((x) => x.id !== im.id); refreshUI(); });
    box.appendChild(d);
  });
}

/* ---------------- characters ---------------- */
function renderChars() {
  const box = $('#charList');
  box.innerHTML = '';
  if (!scannedChars.length) { box.innerHTML = '<span class="muted small">No characters scanned yet. Open a Flow project and press Scan.</span>'; return; }
  scannedChars.forEach((c) => {
    const b = document.createElement('span');
    b.className = 'char' + (settings.defaultCharacters.includes(c) ? ' active' : '');
    b.textContent = '@' + c;
    b.title = settings.enableCharacterControl ? 'Auto mode: added when its name is in the prompt' : 'Click to always add this character';
    b.addEventListener('click', () => {
      if (settings.enableCharacterControl) return;
      const i = settings.defaultCharacters.indexOf(c);
      if (i >= 0) settings.defaultCharacters.splice(i, 1); else settings.defaultCharacters.push(c);
      saveSettings(); refreshUI();
    });
    box.appendChild(b);
  });
}

/* ---------------- Flow tab connection ---------------- */
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0];
}
const isFlowUrl = (u) => !!u && (u.includes('flow.google.com') || u.includes('labs.google/fx'));
function sendToTab(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      const le = chrome.runtime.lastError;
      if (le) reject(new Error(/Receiving end|establish connection/i.test(le.message || '') ? 'Flow page is not connected. Reload the Google Flow tab (F5) and try again.' : le.message));
      else resolve(res);
    });
  });
}
async function checkPage() {
  const tab = await getActiveTab();
  const box = $('#pageStatus'), txt = $('#pageStatusText'), btn = $('#openFlowBtn');
  if (tab && isFlowUrl(tab.url)) {
    flowTabId = tab.id;
    try {
      await sendToTab(tab.id, { type: 'PING' });
      box.classList.add('on'); box.classList.remove('off');
      txt.textContent = 'Connected to Google Flow';
      btn.classList.add('hidden');
      sendToTab(tab.id, { type: 'GET_QUEUE_STATE' }).catch(() => {});
    } catch (e) {
      box.classList.remove('on'); box.classList.add('off');
      txt.textContent = 'Flow tab found but not connected';
      btn.textContent = 'Reload Flow tab'; btn.dataset.act = 'reload'; btn.classList.remove('hidden');
    }
  } else {
    flowTabId = null;
    box.classList.remove('on'); box.classList.add('off');
    txt.textContent = 'Open Google Flow in this tab to start';
    btn.textContent = 'Open Google Flow'; btn.dataset.act = 'open'; btn.classList.remove('hidden');
  }
}

/* ---------------- start / stop ---------------- */
async function sendImages(tabId, list) {
  for (const im of list) {
    const data = { base64: im.base64, name: im.name };
    const json = JSON.stringify(data);
    const total = Math.ceil(json.length / CHUNK);
    if (total <= 1) await sendToTab(tabId, { type: 'PREPARE_IMAGE', id: im.id, data });
    else for (let k = 0; k < total; k++) await sendToTab(tabId, { type: 'PREPARE_IMAGE_CHUNK', id: im.id, chunk: json.slice(k * CHUNK, (k + 1) * CHUNK), chunkIndex: k, totalChunks: total });
  }
}

async function start() {
  const prompts = parsePrompts($('#prompts').value);
  if (!prompts.length) return toast('Add at least one prompt first.', true);
  const tab = await getActiveTab();
  if (!tab || !isFlowUrl(tab.url)) return toast('Open Google Flow (flow.google.com) in the current tab first.', true);

  const info = currentInfo();
  const total = prompts.length;
  const anyConcat = prompts.some((_, i) => isConcat(i, total));
  const per = imagesPerPrompt(prompts);
  const mode = settings.mode === 'agentAutomation' ? settings.agentType : settings.mode;
  const video = isVideoMode();

  if (info.images && !info.optionalImages) {
    const missing = prompts.map((_, i) => (!isAfterConcat(i, total) && (!per[i] || !per[i].length) ? i + 1 : null)).filter(Boolean);
    const allowNoImg = settings.mode === 'componentsToVideo' && (settings.enableCharacterControl || settings.defaultCharacters.length);
    if (missing.length && !allowNoImg) return toast(`These prompts have no image: ${missing.join(', ')}. Add images (or name them like words in the prompt).`, true);
  }

  const outputCount = anyConcat ? 1 : Number(settings.mode === 'agentAutomation' ? settings.agentOutputCount : settings.outputCount);
  const concurrent = anyConcat || settings.mode === 'agentAutomation' ? 1 : Number(settings.concurrentPrompts);
  const payloads = prompts.map((p, i) => ({
    prompt: p,
    mode,
    images: info.images ? per[i] : [],
    speaker: info.voice && (settings.mode !== 'agentAutomation' || video) ? speakerFor(p) : null,
    characters: charactersFor(p),
    aspectRatio: settings.aspectRatio,
    outputCount,
    model: video ? settings.model : settings.imageModel,
    videoOption: video ? promptOption(i, total) : undefined,
    promptIndex: i + 1,
    autoDownloadResourceQuality: video ? settings.autoDownloadVideoQuality : settings.autoDownloadImageQuality,
    isConcat: isConcat(i, total),
    maxRetries: Number(settings.maxRetries),
    autoChangeFileName: !!settings.autoChangeFileName,
    fileNamingSystem: settings.fileNamingSystem || 'prompt_tag',
    folderName: settings.folderName
  }));

  const from = Math.max(1, Number($('#rangeFrom').value) || 1);
  const to = Math.min(total, Number($('#rangeTo').value) || total);
  if (from > to) return toast('Range is wrong: "Run from" must be smaller than "to".', true);
  const slice = payloads.slice(from - 1, to);

  // send images once, refer to them by id
  const used = new Map();
  const finalPayloads = slice.map((p) => {
    const ids = (p.images || []).map((im) => { used.set(im.id, im); return im.id; });
    const { images: _drop, ...rest } = p;
    return ids.length ? { ...rest, imageIds: ids } : rest;
  });

  $('#startBtn').disabled = true;
  try {
    await sendImages(tab.id, Array.from(used.values()));
    const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await sendToTab(tab.id, {
      type: 'AUTO_FILL_FLOW', payloads: finalPayloads, groupId,
      concurrentPrompts: concurrent, promptDelaySecondsMin: Number(settings.promptDelaySecondsMin), promptDelaySecondsMax: Number(settings.promptDelaySecondsMax)
    });
    if (!res || !res.success) throw new Error((res && res.error) || 'Could not start');
    activeGroupId = res.groupId || groupId;
    lastStatus = null;
    $$('.p-row').forEach((r) => r.classList.remove('done', 'fail', 'running'));
    toast(`Started ${finalPayloads.length} prompt(s). Keep the Flow tab open.`);
    $('#stopBtn').classList.remove('hidden');
  } catch (e) {
    toast(e.message || String(e), true);
  } finally {
    $('#startBtn').disabled = false;
  }
}

async function stop() {
  if (!activeGroupId) return;
  const tab = await getActiveTab();
  const tabId = (tab && isFlowUrl(tab.url)) ? tab.id : flowTabId;
  if (!tabId) return toast('Flow tab not found', true);
  try { await sendToTab(tabId, { type: 'CANCEL_PROMPT_GROUP', groupId: activeGroupId }); toast('Stopping after the current step...'); }
  catch (e) { toast(e.message, true); }
}

/* ---------------- status from the Flow tab ---------------- */
function applyStatusToRows(d) {
  const map = {};
  (d.results || []).forEach((r) => { map[r.promptIndex] = r; });
  const running = d.currentPromptIndex != null && d.promptIndices ? d.promptIndices[d.currentPromptIndex] : null;
  $$('.p-row').forEach((row) => {
    const n = Number(row.dataset.idx);
    if (!d.promptIndices || !d.promptIndices.includes(n)) return;
    row.classList.remove('done', 'fail', 'running');
    const r = map[n];
    if (r) { if (r.success && r.downloadComplete) row.classList.add('done'); else if (!r.success) row.classList.add('fail'); else row.classList.add('running'); }
    if (running === n) row.classList.add('running');
  });
}
function onGroupStatus(d) {
  if (!d) return;
  if (activeGroupId && d.id !== activeGroupId && d.status !== 'running') return;
  activeGroupId = d.id;
  lastStatus = d;
  $('#queueEmpty').classList.add('hidden');
  $('#queueBox').classList.remove('hidden');
  const done = (d.results || []).filter((r) => r.downloadComplete || !r.success).length;
  const pct = d.totalCount ? Math.round((done / d.totalCount) * 100) : 0;
  $('#queueBar').style.width = pct + '%';
  $('#queueCount').textContent = `${done}/${d.totalCount} prompts`;
  const labels = { queued: 'Queued', running: d.isCancelling ? 'Stopping...' : 'Running', completed: 'Completed', cancelled: 'Stopped', error: 'Error' };
  $('#queueStatus').textContent = labels[d.status] || d.status;
  if (d.currentPromptIndex != null && d.promptPreviews) $('#currentLine').textContent = `Now: #${d.promptIndices[d.currentPromptIndex]} ${d.promptPreviews[d.currentPromptIndex]}`;
  const finished = ['completed', 'cancelled', 'error'].includes(d.status);
  $('#stopBtn').classList.toggle('hidden', finished);
  if (finished) {
    $('#currentLine').textContent = d.status === 'completed' ? `Done: ${(d.results || []).filter((r) => r.success).length} OK, ${(d.results || []).filter((r) => !r.success).length} failed` : '-';
    $('#currentPct').textContent = '';
    if (d.status === 'completed') toast('All prompts finished.');
  }
  applyStatusToRows(d);
}

/* ---------------- logs ---------------- */
function addLog(e) {
  logs.push(e);
  if (logs.length > 800) logs = logs.slice(-800);
  const box = $('#logs');
  const div = document.createElement('div');
  div.className = 'log ' + (e.level || 'info');
  div.innerHTML = `<span class="t">${new Date(e.timestamp || Date.now()).toLocaleTimeString()}</span>${escapeHtml(e.message || '')}`;
  box.appendChild(div);
  while (box.childNodes.length > 800) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
  if (!$('#tab-logs').classList.contains('active')) {
    unseenLogs++;
    const b = $('#logBadge'); b.textContent = String(Math.min(unseenLogs, 99)); b.classList.remove('hidden');
  }
}

function fillVoiceSelect() {
  const sp = $('#defaultSpeaker');
  const cur = settings.defaultSpeaker;
  sp.innerHTML = '';
  sp.add(new Option('None', 'none'));
  VOICES.forEach(([n, g, style]) => sp.add(new Option(g === 'Flow' ? `${n} (from Flow)` : `${n} (${g}, ${style})`, n)));
  sp.value = VOICES.some(([n]) => n === cur) ? cur : 'none';
  if (sp.value !== cur) { settings.defaultSpeaker = sp.value; saveSettings(); }
  const vc = $('#voiceCount');
  if (vc) vc.textContent = `${VOICES.length} voices${scannedVoices.length ? ` (${scannedVoices.length} synced from Flow)` : ' (built-in)'}`;
}

/* ---------------- wiring ---------------- */
function wire() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab));
    if (t.dataset.tab === 'logs') { unseenLogs = 0; $('#logBadge').classList.add('hidden'); }
  }));
  $$('#modes .chip').forEach((c) => c.addEventListener('click', () => { settings.mode = c.dataset.mode; saveSettings(); refreshUI(); }));
  $$('#agentTypeRow .seg-btn').forEach((b) => b.addEventListener('click', () => { settings.agentType = b.dataset.agent; saveSettings(); refreshUI(); }));
  $('#maxImagesPerPrompt').addEventListener('change', (e) => { settings[currentInfo().maxKey] = Number(e.target.value); saveSettings(); refreshUI(); });

  fillVoiceSelect();
  $('#scanVoicesBtn').addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab || !isFlowUrl(tab.url)) return toast('Open a Google Flow project first.', true);
    $('#scanVoicesBtn').disabled = true;
    try {
      const r = await sendToTab(tab.id, { type: 'SCAN_VOICES' });
      const list = (r && r.voices) || [];
      if (!list.length) { toast('Could not read voices from Flow - built-in list kept.', true); return; }
      scannedVoices = Array.from(new Set(list.map((v) => String(v).trim()).filter(Boolean)));
      await chrome.storage.local.set({ [VOICES_KEY]: scannedVoices });
      mergeVoices(); fillVoiceSelect(); bindSettings(); refreshUI();
      toast(`Synced ${scannedVoices.length} voice(s) from Flow`);
    } catch (e) { toast(e.message, true); }
    finally { $('#scanVoicesBtn').disabled = false; }
  });

  let t = null;
  $('#prompts').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { renderPrompts(); saveForm(); }, 250); });
  $('#rangeTo').addEventListener('input', (e) => { e.target._auto = false; });
  $('#txtInput').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $('#prompts').value = await f.text(); e.target.value = '';
    $('#rangeTo')._auto = true; renderPrompts(); saveForm();
  });

  $('#imageInput').addEventListener('change', async (e) => { await addFiles(Array.from(e.target.files)); e.target.value = ''; });
  const dz = $('#dropZone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => addFiles(Array.from(e.dataTransfer.files)));
  $('#clearImagesBtn').addEventListener('click', () => { images = []; refreshUI(); });

  $('#scanCharsBtn').addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab || !isFlowUrl(tab.url)) return toast('Open a Google Flow project first.', true);
    $('#scanCharsBtn').disabled = true;
    try {
      const r = await sendToTab(tab.id, { type: 'SCAN_CHARACTERS' });
      scannedChars = ((r && r.characters) || []).map((c) => String(c).replace(/^@+/, '').trim()).filter(Boolean);
      settings.defaultCharacters = settings.defaultCharacters.filter((c) => scannedChars.includes(c));
      await chrome.storage.local.set({ [CHARS_KEY]: scannedChars });
      saveSettings(); refreshUI();
      toast(scannedChars.length ? `Found ${scannedChars.length} character(s)` : 'No characters found in this project', !scannedChars.length);
    } catch (e) { toast(e.message, true); }
    finally { $('#scanCharsBtn').disabled = false; }
  });

  $('#startBtn').addEventListener('click', start);
  $('#stopBtn').addEventListener('click', stop);
  $('#clearBtn').addEventListener('click', () => { $('#prompts').value = ''; saveForm(); renderPrompts(); });

  $('#openFlowBtn').addEventListener('click', async (e) => {
    const tab = await getActiveTab();
    if (e.target.dataset.act === 'reload' && tab) chrome.tabs.reload(tab.id);
    else if (tab) chrome.tabs.update(tab.id, { url: FLOW_URL });
    else chrome.tabs.create({ url: FLOW_URL });
    setTimeout(checkPage, 2500);
  });

  $('#openDlSettings').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://settings/downloads' }));
  $('#saveSelectors').addEventListener('click', async () => {
    const raw = $('#customSelectors').value.trim();
    if (raw) { try { const o = JSON.parse(raw); if (typeof o !== 'object' || Array.isArray(o)) throw new Error(); } catch (e) { return toast('That is not valid JSON object.', true); } }
    await chrome.storage.local.set({ [SELECTORS_KEY]: raw });
    toast('Selectors saved. They apply to the next batch.');
  });
  $('#resetSelectors').addEventListener('click', async () => { $('#customSelectors').value = ''; await chrome.storage.local.set({ [SELECTORS_KEY]: '' }); toast('Custom selectors cleared.'); });
  $('#resetSettings').addEventListener('click', async () => {
    if (!confirm('Reset all settings to default?')) return;
    settings = { ...DEFAULTS };
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    bindSettings(); refreshUI(); toast('Settings reset.');
  });

  $('#copyLogs').addEventListener('click', async () => {
    const txt = logs.map((l) => `[${new Date(l.timestamp).toISOString()}] [${(l.level || 'info').toUpperCase()}] ${l.message}`).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Logs copied'); } catch (e) { toast('Could not copy', true); }
  });
  $('#clearLogs').addEventListener('click', () => { logs = []; $('#logs').innerHTML = ''; });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'ACTION_LOG') addLog(msg.data || {});
    else if (msg.type === 'PROMPT_GROUP_STATUS') onGroupStatus(msg.data);
    else if (msg.type === 'VIDEO_GENERATION_PROGRESS' && msg.data) {
      $('#currentPct').textContent = `#${msg.data.promptIndex}: ${msg.data.percentage}%`;
    }
  });
  chrome.tabs.onActivated.addListener(() => checkPage());
  chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === 'complete' || info.url) checkPage(); });
}

(async function init() {
  await loadAll();
  wire();
  bindSettings();
  refreshUI();
  checkPage();
})();
