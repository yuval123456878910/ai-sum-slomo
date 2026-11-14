const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const fmtIL = (iso, opts = { dateStyle: 'medium', timeStyle: 'short' }) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', ...opts }).format(new Date(iso)) : '');

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

const state = {
  status: null,
  findings: [],
  filters: { sector: '', q: '', days: '7', minScore: 0, onlyNew: false, starred: false, showDismissed: false, scanId: '' },
  models: [],
};
const sectorName = (id) => state.status?.sectors.find((s) => s.id === id)?.name || id;
const scoreColor = (v) => (v >= 7 ? '#49111c' : v >= 4 ? '#5e503f' : '#a9927d');
const SIGNAL_LABEL = { lost_export: 'lost export', line_closure: 'line closed', fewer_shifts: 'fewer shifts', equipment_sale: 'equipment sale', raw_materials: 'raw materials' };

/* ---------------- status ---------------- */
async function loadStatus() {
  state.status = await api('/api/status');
  const s = state.status;
  const pill = $('#statusPill');
  pill.className = 'pill';
  if (s.running) {
    const done = Object.values(s.running.sectors).filter((x) => x.status === 'done' || x.status === 'error').length;
    const total = Object.keys(s.running.sectors).length;
    const cur = Object.entries(s.running.sectors).find(([, v]) => v.status === 'running');
    pill.classList.add('running');
    pill.textContent = `Scanning ${cur ? sectorName(cur[0]) : ''} · ${done}/${total}`;
  } else if (!s.settings.scheduleEnabled) {
    pill.classList.add('off');
    pill.textContent = 'Schedule off';
  } else {
    pill.textContent = `Next scan ${fmtIL(s.nextRuns[0], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · Israel`;
  }
  $('#runBtn').disabled = !!s.running;
  $('#runBtn').textContent = s.running ? 'Scan running…' : 'Run scan now';
  $('#banner').innerHTML = s.key.set ? '' :
    `<div class="banner"><span><b>No OpenRouter key yet.</b> Set <code>OPENROUTER_API_KEY</code> in Render, or paste a key in Settings.</span><button class="btn small primary" data-goto="settings">Open settings</button></div>`;
  return s;
}

/* ---------------- findings ---------------- */
async function loadFindings() {
  const p = new URLSearchParams({ showDismissed: '1' });
  if (state.filters.days && !state.filters.scanId) p.set('days', state.filters.days);
  if (state.filters.scanId) p.set('scanId', state.filters.scanId);
  state.findings = await api('/api/findings?' + p);
  renderFindings();
}

function filtered() {
  const f = state.filters;
  const needle = f.q.trim().toLowerCase();
  return state.findings.filter((x) =>
    (f.showDismissed || !x.dismissed) &&
    (!f.sector || x.primarySector === f.sector || x.otherSectors?.includes(f.sector)) &&
    x.deal.score >= f.minScore &&
    (!f.onlyNew || x.status === 'new') &&
    (!f.starred || x.starred) &&
    (!needle || JSON.stringify([x.company, x.companyHe, x.headline, x.location, x.signals, x.chain]).toLowerCase().includes(needle)));
}

function renderFindings() {
  const all = state.findings.filter((x) => !x.dismissed);
  const s = state.status;
  const last = s?.lastScan;
  const uniq = new Set(all.map((x) => x.key)).size;
  const periodLabel = state.filters.scanId ? 'in this scan' : ({ 1: 'last 24 hours', 7: 'last 7 days', 30: 'last 30 days', '': 'all time' })[state.filters.days];
  $('#stats').innerHTML = `
    <div class="stat"><div class="n">${uniq}</div><div class="l">Companies, ${periodLabel}</div></div>
    <div class="stat"><div class="n">${all.filter((x) => x.status === 'new').length}</div><div class="l">First time flagged</div></div>
    <div class="stat hot"><div class="n">${all.filter((x) => x.deal.score >= 7).length}</div><div class="l">Deal score 7+</div></div>
    <div class="stat"><div class="n">${last ? `${Object.values(last.sectors).filter((v) => v.status === 'done').length}/${Object.keys(last.sectors).length}` : '–'}</div>
      <div class="l">${last ? `Sectors in last scan · ${fmtIL(last.startedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'No scans yet'}</div></div>`;

  const counts = Object.fromEntries((s?.sectors || []).map((x) => [x.id, 0]));
  for (const x of all) counts[x.primarySector] = (counts[x.primarySector] || 0) + 1;
  $('#sectorChips').innerHTML =
    `<button class="chip ${!state.filters.sector ? 'on' : ''}" data-sector="">All<em>${all.length}</em></button>` +
    (s?.sectors || []).map((x) => `<button class="chip ${state.filters.sector === x.id ? 'on' : ''}" data-sector="${x.id}">${esc(x.name)}<em>${counts[x.id] || 0}</em></button>`).join('');

  const sf = $('#scanFilter');
  sf.hidden = !state.filters.scanId;
  if (state.filters.scanId) sf.innerHTML = `Showing one scan only. <button class="btn link" id="clearScan">Show all scans</button>`;

  const list = filtered().sort((a, b) => (b.foundAt.slice(0, 13) + String(b.deal.score).padStart(2, '0')).localeCompare(a.foundAt.slice(0, 13) + String(a.deal.score).padStart(2, '0')));
  $('#findings').innerHTML = list.length ? list.map(card).join('') :
    `<div class="empty"><h3>${state.findings.length ? 'Nothing matches these filters' : 'No findings yet'}</h3><p>${state.findings.length ? 'Try a lower deal score, another sector or a longer period.' : 'Add your OpenRouter key, then press <b>Run scan now</b>, or wait for the next scan at 07:00 / 19:00.'}</p></div>`;
}

function card(x) {
  const sig = x.signals.slice(0, 5).map((s) => `<li><time>${esc(s.date || '—')}</time><span><span class="st">${esc(SIGNAL_LABEL[s.type] || s.type)}</span>${esc(s.detail)}</span></li>`).join('');
  const subs = x.chain.subcontractors?.length ? x.chain.subcontractors.join(', ') : x.chain.spread;
  return `
  <article class="card ${x.dismissed ? 'dismissed' : ''}" data-id="${x.id}">
    <div class="card-top">
      <div>
        <div class="co">${esc(x.company)}</div>
        ${x.companyHe ? `<div class="he" dir="rtl">${esc(x.companyHe)}</div>` : ''}
        <div class="tags">
          <span class="tag primary">${esc(sectorName(x.primarySector))}</span>
          ${x.otherSectors.map((o) => `<span class="tag">also ${esc(sectorName(o))}</span>`).join('')}
          <span class="tag">${esc(x.companyType.replace('_', ' '))}</span>
          ${x.status === 'new' ? '<span class="tag new">NEW</span>' : `<span class="tag">update · seen ${x.seenCount}×</span>`}
          ${x.confidence === 'low' ? '<span class="tag conf-low">low confidence</span>' : ''}
        </div>
      </div>
      <div class="score" title="Deal potential 0–10"><div class="ring" style="--v:${x.deal.score};--sc:${scoreColor(x.deal.score)}"><b>${x.deal.score}</b></div><small>Deal</small></div>
    </div>
    ${x.headline ? `<p class="headline">${esc(x.headline)}</p>` : ''}
    ${sig ? `<ul class="sig">${sig}</ul>` : ''}
    ${x.chain.hitLink || x.chain.mechanism ? `<div class="chain"><div><b>Hit link</b>${esc(x.chain.hitLink)}</div><div><b>Effect</b>${esc(x.chain.mechanism)}</div><div><b>Spreads to</b>${esc(subs)}</div></div>` : ''}
    <details>
      <summary>Deal angle, novelty &amp; ${x.sources.length} source${x.sources.length === 1 ? '' : 's'}</summary>
      <div class="body">
        <p><b>Deal (${esc(x.deal.type.replace('_', ' '))}):</b> ${esc(x.deal.rationale)}</p>
        ${x.deal.assets ? `<p><b>Assets:</b> ${esc(x.deal.assets)}</p>` : ''}
        ${x.chain.spread ? `<p><b>How it could spread:</b> ${esc(x.chain.spread)}</p>` : ''}
        ${x.indirect?.length ? `<p><b>Indirect drivers:</b> ${esc(x.indirect.join(', ').replace(/_/g, ' '))}</p>` : ''}
        <p><b>Is it new?</b> ${x.novelty.isNew ? 'Yes' : 'Not clearly'}${x.novelty.earliest ? ` · first reported ${esc(x.novelty.earliest)}` : ''}${x.novelty.why ? ` · ${esc(x.novelty.why)}` : ''}</p>
        <ol class="sources">${x.sources.map((s) => `<li><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title || hostOf(s.url))}</a> <span class="muted small">${esc(s.publisher || hostOf(s.url))}${s.date ? ' · ' + esc(s.date) : ''}</span></li>`).join('')}</ol>
      </div>
    </details>
    <div class="foot">
      <span>${esc(x.location)}${x.location ? ' · ' : ''}found ${fmtIL(x.foundAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
      <span class="actions">
        <button class="icon-btn ${x.starred ? 'on' : ''}" data-act="star">${x.starred ? '★ Starred' : '☆ Star'}</button>
        <button class="icon-btn" data-act="dismiss">${x.dismissed ? 'Restore' : 'Dismiss'}</button>
      </span>
    </div>
  </article>`;
}

/* ---------------- scans ---------------- */
async function loadScans() {
  const scans = await api('/api/scans');
  $('#scans').innerHTML = scans.length ? scans.map((s) => `
    <div class="scan">
      <div class="scan-head">
        <h3>${fmtIL(s.startedAt, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</h3>
        <span class="scan-meta"><span class="badge ${s.status}">${s.status}</span> · ${s.trigger} · ${esc(s.model || '')} · ${s.findingCount} findings${s.finishedAt ? ` · ${Math.round((Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 60000)} min` : ''}</span>
      </div>
      <div class="sector-row">${Object.entries(s.sectors).map(([id, v]) => `<span class="sstat ${v.status}" title="${esc(v.error || '')}">${esc(sectorName(id))}: ${v.status === 'done' ? v.count : v.status}</span>`).join('')}</div>
      ${s.error ? `<p class="msg bad">${esc(s.error)}</p>` : ''}
      <div class="notes"><button class="btn link" data-scan="${s.id}">View findings</button> · <button class="btn link" data-notes="${s.id}">Sector notes</button><div class="notes-body" id="notes-${s.id}"></div></div>
    </div>`).join('') : '<div class="empty"><h3>No scans yet</h3><p>The first scheduled scan runs at 07:00 or 19:00 Israel time.</p></div>';
}

async function showNotes(id) {
  const box = $(`#notes-${id}`);
  if (box.innerHTML) return (box.innerHTML = '');
  const s = await api(`/api/scans/${id}`);
  box.innerHTML = Object.entries(s.sectors).map(([sid, v]) => `
    <details open><summary>${esc(sectorName(sid))}</summary><div class="body">
      ${v.error ? `<p class="msg bad">${esc(v.error)}</p>` : ''}
      <p>${esc(v.notes || 'No notes.')}</p>
      ${v.citations?.length ? `<ol class="sources">${v.citations.map((c) => `<li><a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener noreferrer">${esc(c.title || hostOf(c.url))}</a></li>`).join('')}</ol>` : ''}
    </div></details>`).join('');
}

/* ---------------- settings ---------------- */
function renderSettings() {
  const s = state.status;
  const k = $('#keyStatus');
  k.className = 'key-status ' + (s.key.set ? 'ok' : 'bad');
  k.textContent = s.key.set ? `✓ Key active (${s.key.source === 'env' ? 'from Render env var' : 'saved in Settings'}) ${s.key.hint}` : '✗ No key set';
  $('#keyClear').hidden = s.key.source !== 'settings';
  $('#modelChosen').textContent = s.settings.model;
  $('#resolvedModel').textContent = s.resolvedModel;
  $('#webMax').value = s.settings.webMaxResults;
  $('#schedOn').checked = s.settings.scheduleEnabled;
  $('#sectorChecks').innerHTML = s.sectors.map((x) => `<label class="check"><input type="checkbox" value="${x.id}" ${s.settings.sectors.includes(x.id) ? 'checked' : ''}/> <b>${esc(x.name)}</b> <span class="muted small">${esc(x.scope)}</span></label>`).join('');
  renderModelList();
  if (!state.models.length) api('/api/models').then((m) => { state.models = m; renderModelList(); }).catch(() => {});
}

function renderModelList() {
  const needle = $('#modelFilter').value.trim().toLowerCase();
  const cur = state.status.settings.model;
  const opts = [{ id: 'auto', name: 'auto: newest Claude Sonnet' }, ...state.models]
    .filter((m) => m.id === cur || m.id === 'auto' || !needle || (m.id + m.name).toLowerCase().includes(needle))
    .slice(0, 300);
  if (!opts.some((m) => m.id === cur)) opts.unshift({ id: cur, name: cur });
  $('#modelSelect').innerHTML = opts.map((m) => `<option value="${esc(m.id)}" ${m.id === cur ? 'selected' : ''}>${esc(m.id)}${m.promptPrice != null ? `  ($${m.promptPrice.toFixed(2)} / $${m.completionPrice.toFixed(2)} per 1M)` : ''}</option>`).join('');
}

const flash = (el, text, ok = true) => { el.textContent = text; el.className = 'msg ' + (ok ? 'ok' : 'bad'); };

/* ---------------- wiring ---------------- */
function showTab(tab) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${tab}`));
  if (tab === 'scans') loadScans();
  if (tab === 'settings') renderSettings();
  if (tab === 'findings') loadFindings();
  history.replaceState(null, '', '#' + tab);
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, .chip');
  if (!t) return;
  if (t.dataset.tab) return showTab(t.dataset.tab);
  if (t.dataset.goto) return showTab(t.dataset.goto);
  if ('sector' in t.dataset) { state.filters.sector = t.dataset.sector; return renderFindings(); }
  if (t.id === 'clearScan') { state.filters.scanId = ''; return loadFindings(); }
  if (t.dataset.scan) { state.filters.scanId = t.dataset.scan; return showTab('findings'); }
  if (t.dataset.notes) return showNotes(t.dataset.notes);
  if (t.dataset.act) {
    const id = t.closest('.card').dataset.id;
    const f = state.findings.find((x) => x.id === id);
    const body = t.dataset.act === 'star' ? { starred: !f.starred } : { dismissed: !f.dismissed };
    await api(`/api/findings/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    if ('starred' in body) state.findings.filter((x) => x.key === f.key).forEach((x) => (x.starred = body.starred));
    else f.dismissed = body.dismissed;
    return renderFindings();
  }
});

$('#runBtn').addEventListener('click', async () => {
  try {
    await api('/api/scans', { method: 'POST', body: JSON.stringify({}) });
    await loadStatus();
    poll();
  } catch (err) { alert(err.message); }
});

for (const id of ['q', 'days', 'minScore', 'onlyNew', 'starred', 'showDismissed']) {
  $('#' + id).addEventListener('input', (e) => {
    const el = e.target;
    state.filters[id] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
    if (id === 'minScore') $('#minScoreVal').textContent = el.value;
    id === 'days' ? loadFindings() : renderFindings();
  });
}

$('#modelFilter').addEventListener('input', renderModelList);
$('#keyTest').addEventListener('click', async () => {
  flash($('#keyMsg'), 'Testing…');
  try {
    const r = await api('/api/key/test', { method: 'POST', body: JSON.stringify({ key: $('#keyInput').value }) });
    flash($('#keyMsg'), `Key works${r.label ? ` (${r.label})` : ''}. Used $${Number(r.usage || 0).toFixed(2)}${r.limit != null ? ` of $${r.limit}` : ''}.`);
  } catch (err) { flash($('#keyMsg'), err.message, false); }
});
$('#keySave').addEventListener('click', async () => {
  const key = $('#keyInput').value.trim();
  if (!key) return flash($('#keyMsg'), 'Paste a key first.', false);
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ openrouterKey: key }) });
  $('#keyInput').value = '';
  await loadStatus(); renderSettings();
  flash($('#keyMsg'), 'Saved.');
});
$('#keyClear').addEventListener('click', async () => {
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ openrouterKey: '' }) });
  await loadStatus(); renderSettings();
  flash($('#keyMsg'), 'Saved key removed.');
});
$('#modelSave').addEventListener('click', async () => {
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ model: $('#modelSelect').value || 'auto', webMaxResults: $('#webMax').value }) });
  await loadStatus(); renderSettings();
  flash($('#modelMsg'), 'Saved.');
});
$('#schedSave').addEventListener('click', async () => {
  const sectors = $$('#sectorChecks input:checked').map((i) => i.value);
  if (!sectors.length) return flash($('#schedMsg'), 'Pick at least one sector.', false);
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ sectors, scheduleEnabled: $('#schedOn').checked }) });
  await loadStatus(); renderSettings();
  flash($('#schedMsg'), 'Saved.');
});

let timer;
async function poll() {
  clearTimeout(timer);
  const wasRunning = !!state.status?.running;
  const s = await loadStatus().catch(() => null);
  if (s && wasRunning && !s.running) { loadFindings(); if (!$('#view-scans').hidden) loadScans(); }
  else if (s?.running && !$('#view-findings').hidden) loadFindings();
  timer = setTimeout(poll, s?.running ? 5000 : 60000);
}

(async () => {
  await loadStatus();
  showTab(['findings', 'scans', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'findings');
  poll();
})();
