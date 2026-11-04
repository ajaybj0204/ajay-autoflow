/* Storyboard planner: a table of scenes that exports to Ajay AutoFlow (CSV or ready-to-paste prompts).
 * Uses the same format the extension understands: "#tag" for file names, "@Character",
 * and "voice: / model: / ratio:" lines at the top of a prompt. Saved in localStorage only. */
'use strict';

const KEY = 'autoflow-planner-v1';
const $ = (s) => document.querySelector(s);
let state = { template: '', model: '', ratio: '', scenes: [] };

const blank = () => ({ tag: '', prompt: '', character: '', voice: '' });
const EXAMPLE = {
  template: '{prompt}, cinematic, warm morning light',
  model: 'Veo 3.1 - Fast',
  ratio: '9:16',
  scenes: [
    { tag: '0:00', prompt: 'Wide shot of a quiet Bengaluru street at dawn, steam rising from a tea stall', character: '', voice: '' },
    { tag: '0:08', prompt: 'buys filter coffee and smiles at the stall owner', character: 'Ravi', voice: 'Puck' },
    { tag: '0:16', prompt: 'checks his phone as the first drops of rain fall', character: 'Ravi', voice: 'Puck' },
    { tag: '0:24', prompt: 'runs to catch a yellow auto-rickshaw, laughing', character: 'Ravi', voice: '' }
  ]
};

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.scenes)) state = s; } catch (e) {}
  if (!state.scenes.length) state.scenes = [blank()];
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- building prompts (same rules as the extension's importer) ---------- */
function promptFor(s) {
  let body = state.template.trim()
    ? state.template.replace(/\{([^}]+)\}/g, (_, k) => s[k.trim().toLowerCase()] || '')
    : s.prompt;
  body = String(body || '').replace(/\s+/g, ' ').trim();
  if (!s.prompt.trim()) return null;
  const ch = s.character.trim().replace(/^@+/, '');
  if (ch && !new RegExp('@' + ch.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'i').test(body)) body = `@${ch} ${body}`;
  const tag = s.tag.trim().replace(/^#+/, '').replace(/\s+/g, '');
  if (tag) body = `#${tag} ${body}`;
  const meta = [];
  if (s.voice.trim()) meta.push(`voice: ${s.voice.trim()}`);
  if (state.model) meta.push(`model: ${state.model}`);
  if (state.ratio) meta.push(`ratio: ${state.ratio}`);
  return [...meta, body].join('\n');
}
const allPrompts = () => state.scenes.map(promptFor).filter(Boolean);

/* ---------- rendering ---------- */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function render() {
  $('#template').value = state.template;
  $('#model').value = state.model;
  $('#ratio').value = state.ratio;
  const box = $('#scenes');
  box.innerHTML = state.scenes.map((s, i) => `
    <div class="scene" data-i="${i}">
      <span class="num">${i + 1}</span>
      <input class="tagcell" data-k="tag" value="${esc(s.tag)}" placeholder="0:${String(i * 8).padStart(2, '0')}" aria-label="Scene ${i + 1} timecode" />
      <textarea class="promptcell" data-k="prompt" rows="2" placeholder="What happens in this scene" aria-label="Scene ${i + 1} description">${esc(s.prompt)}</textarea>
      <input class="charcell" data-k="character" value="${esc(s.character)}" placeholder="Character" aria-label="Scene ${i + 1} character" />
      <input class="voicecell" data-k="voice" value="${esc(s.voice)}" placeholder="Voice" aria-label="Scene ${i + 1} voice" />
      <button class="del" title="Remove scene" aria-label="Remove scene ${i + 1}">✕</button>
    </div>`).join('');
  update();
}
function update() {
  const list = allPrompts();
  $('#preview').textContent = list.length ? list.join('\n\n') : 'Add a scene to see the prompts AutoFlow will run.';
  const chars = new Set(state.scenes.map((s) => s.character.trim()).filter(Boolean));
  $('#stats').textContent = `${list.length} scene(s)${chars.size ? ` · characters: ${[...chars].join(', ')}` : ''}`;
  save();
}

/* ---------- export ---------- */
const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
function tableRows() {
  const head = ['tag', 'prompt', 'character', 'voice', 'model', 'ratio'];
  const rows = state.scenes.filter((s) => s.prompt.trim()).map((s) => {
    const prompt = state.template.trim() ? state.template.replace(/\{([^}]+)\}/g, (_, k) => s[k.trim().toLowerCase()] || '').replace(/\s+/g, ' ').trim() : s.prompt.trim();
    return [s.tag.trim(), prompt, s.character.trim().replace(/^@+/, ''), s.voice.trim(), state.model, state.ratio];
  });
  return [head, ...rows];
}
function downloadCsv() {
  const rows = tableRows();
  if (rows.length < 2) return toast('Add at least one scene first.');
  const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'autoflow-storyboard.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('CSV downloaded. In AutoFlow: Import scenes → Open .csv');
}
async function copyText(text, ok) {
  try { await navigator.clipboard.writeText(text); toast(ok); }
  catch (e) { toast('Copy failed. Select the preview text and copy it.'); }
}

/* ---------- events ---------- */
document.addEventListener('DOMContentLoaded', () => {
  load(); render();
  $('#scenes').addEventListener('input', (e) => {
    const row = e.target.closest('.scene'); if (!row || !e.target.dataset.k) return;
    state.scenes[Number(row.dataset.i)][e.target.dataset.k] = e.target.value;
    update();
  });
  $('#scenes').addEventListener('click', (e) => {
    if (!e.target.classList.contains('del')) return;
    state.scenes.splice(Number(e.target.closest('.scene').dataset.i), 1);
    if (!state.scenes.length) state.scenes.push(blank());
    render();
  });
  $('#scenes').addEventListener('keydown', (e) => {
    // Ctrl/Cmd + Enter in the last scene adds a new one
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('#addRow').click(); }
  });
  $('#addRow').addEventListener('click', () => {
    state.scenes.push(blank()); render();
    const last = document.querySelectorAll('.scene .promptcell'); last[last.length - 1].focus();
  });
  $('#sample').addEventListener('click', () => {
    if (state.scenes.some((s) => s.prompt.trim()) && !confirm('Replace your scenes with the example?')) return;
    state = JSON.parse(JSON.stringify(EXAMPLE)); render(); toast('Example loaded');
  });
  $('#clearAll').addEventListener('click', () => {
    if (!confirm('Clear all scenes?')) return;
    state = { template: '', model: '', ratio: '', scenes: [blank()] }; render();
  });
  $('#template').addEventListener('input', (e) => { state.template = e.target.value; update(); });
  $('#model').addEventListener('change', (e) => { state.model = e.target.value; update(); });
  $('#ratio').addEventListener('change', (e) => { state.ratio = e.target.value; update(); });
  $('#downloadCsv').addEventListener('click', downloadCsv);
  $('#copyPrompts').addEventListener('click', () => { const t = allPrompts().join('\n\n'); if (!t) return toast('Add at least one scene first.'); copyText(t, 'Prompts copied. Paste them into AutoFlow.'); });
  $('#copyTable').addEventListener('click', () => copyText(tableRows().map((r) => r.join('\t')).join('\n'), 'Table copied. Paste into Google Sheets.'));
});
