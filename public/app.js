const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

/* ---------------- language ---------------- */
let lang = (() => {
  try { return localStorage.getItem('uiLang') || (navigator.language?.startsWith('he') ? 'he' : 'en'); } catch { return 'en'; }
})();
const dict = () => window.I18N[lang] || window.I18N.en;
function t(key, ...args) {
  const v = dict()[key] ?? window.I18N.en[key] ?? key;
  return typeof v === 'string' ? v.replace(/\{(\d)\}/g, (_, i) => args[i] ?? '') : v;
}
const tMap = (group, key) => dict()[group]?.[key] ?? window.I18N.en[group]?.[key] ?? String(key ?? '').replace(/_/g, ' ');
const locale = () => (lang === 'he' ? 'he-IL' : 'en-GB');
const fmtIL = (iso, opts = { dateStyle: 'medium', timeStyle: 'short' }) => (iso ? new Intl.DateTimeFormat(locale(), { timeZone: 'Asia/Jerusalem', ...opts }).format(new Date(iso)) : '');
const shortDate = (iso) => fmtIL(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function applyStatic() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  document.title = t('appName');
  $$('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $$('[data-i18n-html]').forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  $$('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  $('#langBtn').textContent = lang === 'he' ? 'English' : 'עברית';
}
function setLang(l) {
  lang = l;
  try { localStorage.setItem('uiLang', l); } catch {}
  applyStatic();
  renderAll();
}

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
const sectorName = (id) => dict().sectors?.[id] || state.status?.sectors.find((s) => s.id === id)?.name || id;
const sectorScope = (s) => dict().scopes?.[s.id] || s.scope;
const scoreColor = (v) => (v >= 7 ? '#49111c' : v >= 4 ? '#5e503f' : '#a9927d');

/* ---------------- status ---------------- */
function renderStatus() {
  const s = state.status;
  if (!s) return;
  const pill = $('#statusPill');
  pill.className = 'pill';
  if (s.running) {
    const done = Object.values(s.running.sectors).filter((x) => x.status === 'done' || x.status === 'error').length;
    const total = Object.keys(s.running.sectors).length;
    const cur = Object.entries(s.running.sectors).find(([, v]) => v.status === 'running');
    pill.classList.add('running');
    pill.textContent = t('pillScanning', cur ? sectorName(cur[0]) : '', done, total);
  } else if (!s.settings.scheduleEnabled) {
    pill.classList.add('off');
    pill.textContent = t('pillOff');
  } else {
    pill.textContent = t('pillNext', fmtIL(s.nextRuns[0], { weekday: 'short', hour: '2-digit', minute: '2-digit' }));
  }
  $('#runBtn').disabled = !!s.running;
  $('#runBtn').textContent = s.running ? t('running') : t('runNow');
  $('#banner').innerHTML = s.key.set ? '' :
    `<div class="banner"><span>${t('noKeyBanner')}</span><button class="btn small primary" data-goto="settings">${t('openSettings')}</button></div>`;
}
async function loadStatus() {
  state.status = await api('/api/status');
  renderStatus();
  return state.status;
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
  const period = state.filters.scanId ? t('inScan') : t({ 1: 'd1', 7: 'd7', 30: 'd30', '': 'dAll' }[state.filters.days]).toLowerCase();
  $('#stats').innerHTML = `
    <div class="stat"><div class="n">${uniq}</div><div class="l">${esc(t('statCompanies', period))}</div></div>
    <div class="stat"><div class="n">${all.filter((x) => x.status === 'new').length}</div><div class="l">${t('statNew')}</div></div>
    <div class="stat hot"><div class="n">${all.filter((x) => x.deal.score >= 7).length}</div><div class="l">${t('statHot')}</div></div>
    <div class="stat"><div class="n">${last ? `${Object.values(last.sectors).filter((v) => v.status === 'done').length}/${Object.keys(last.sectors).length}` : '–'}</div>
      <div class="l">${last ? esc(t('statLast', shortDate(last.startedAt))) : t('statNoScans')}</div></div>`;

  const counts = Object.fromEntries((s?.sectors || []).map((x) => [x.id, 0]));
  for (const x of all) counts[x.primarySector] = (counts[x.primarySector] || 0) + 1;
  $('#sectorChips').innerHTML =
    `<button class="chip ${!state.filters.sector ? 'on' : ''}" data-sector="">${t('all')}<em>${all.length}</em></button>` +
    (s?.sectors || []).map((x) => `<button class="chip ${state.filters.sector === x.id ? 'on' : ''}" data-sector="${x.id}">${esc(sectorName(x.id))}<em>${counts[x.id] || 0}</em></button>`).join('');

  const sf = $('#scanFilter');
  sf.hidden = !state.filters.scanId;
  if (state.filters.scanId) sf.innerHTML = `${t('oneScan')} <button class="btn link" id="clearScan">${t('showAllScans')}</button>`;

  const key = (x) => x.foundAt.slice(0, 13) + String(x.deal.score).padStart(2, '0');
  const list = filtered().sort((a, b) => key(b).localeCompare(key(a)));
  $('#findings').innerHTML = list.length ? list.map(card).join('') :
    `<div class="empty"><h3>${state.findings.length ? t('emptyFilterT') : t('emptyT')}</h3><p>${state.findings.length ? t('emptyFilterP') : t('emptyP')}</p></div>`;
}

function card(x) {
  const he = lang === 'he' && x.companyHe;
  const title = he ? x.companyHe : x.company;
  const subtitle = he ? x.company : x.companyHe;
  const sig = x.signals.slice(0, 5).map((s) => `<li><time>${esc(s.date || '—')}</time><span><span class="st">${esc(tMap('signal', s.type))}</span>${esc(s.detail)}</span></li>`).join('');
  const subs = x.chain.subcontractors?.length ? x.chain.subcontractors.join(', ') : x.chain.spread;
  return `
  <article class="card ${x.dismissed ? 'dismissed' : ''}" data-id="${x.id}">
    <div class="card-top">
      <div>
        <div class="co">${esc(title)}</div>
        ${subtitle ? `<div class="he" dir="auto">${esc(subtitle)}</div>` : ''}
        <div class="tags">
          <span class="tag primary">${esc(sectorName(x.primarySector))}</span>
          ${x.otherSectors.map((o) => `<span class="tag">${t('also')} ${esc(sectorName(o))}</span>`).join('')}
          <span class="tag">${esc(tMap('companyType', x.companyType))}</span>
          ${x.status === 'new' ? `<span class="tag new">${t('isNew')}</span>` : `<span class="tag">${t('update', x.seenCount)}</span>`}
          ${x.confidence === 'low' ? `<span class="tag conf-low">${t('lowConf')}</span>` : ''}
        </div>
      </div>
      <div class="score" title="${t('dealTip')}"><div class="ring" style="--v:${x.deal.score};--sc:${scoreColor(x.deal.score)}"><b>${x.deal.score}</b></div><small>${t('deal')}</small></div>
    </div>
    ${x.headline ? `<p class="headline" dir="auto">${esc(x.headline)}</p>` : ''}
    ${sig ? `<ul class="sig" dir="auto">${sig}</ul>` : ''}
    ${x.chain.hitLink || x.chain.mechanism ? `<div class="chain" dir="auto"><div><b>${t('hitLink')}</b>${esc(x.chain.hitLink)}</div><div><b>${t('effect')}</b>${esc(x.chain.mechanism)}</div><div><b>${t('spreadsTo')}</b>${esc(subs)}</div></div>` : ''}
    <details>
      <summary>${t('details', x.sources.length)}</summary>
      <div class="body" dir="auto">
        <p><b>${t('dealLabel', esc(tMap('dealType', x.deal.type)))}</b> ${esc(x.deal.rationale)}</p>
        ${x.deal.assets ? `<p><b>${t('assets')}</b> ${esc(x.deal.assets)}</p>` : ''}
        ${x.chain.spread ? `<p><b>${t('spread')}</b> ${esc(x.chain.spread)}</p>` : ''}
        ${x.indirect?.length ? `<p><b>${t('indirect')}</b> ${esc(x.indirect.join(', ').replace(/_/g, ' '))}</p>` : ''}
        <p><b>${t('isItNew')}</b> ${x.novelty.isNew ? t('yes') : t('notClearly')}${x.novelty.earliest ? ` · ${esc(t('firstReported', x.novelty.earliest))}` : ''}${x.novelty.why ? ` · ${esc(x.novelty.why)}` : ''}</p>
        <ol class="sources">${x.sources.map((s) => `<li><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer" dir="auto">${esc(s.title || hostOf(s.url))}</a> <span class="muted small">${esc(s.publisher || hostOf(s.url))}${s.date ? ' · ' + esc(s.date) : ''}</span></li>`).join('')}</ol>
      </div>
    </details>
    <div class="foot">
      <span>${esc(x.location)}${x.location ? ' · ' : ''}${esc(t('found', shortDate(x.foundAt)))}</span>
      <span class="actions">
        <button class="icon-btn ${x.starred ? 'on' : ''}" data-act="star">${x.starred ? t('starred') : t('star')}</button>
        <button class="icon-btn" data-act="dismiss">${x.dismissed ? t('restore') : t('dismiss')}</button>
      </span>
    </div>
  </article>`;
}

/* ---------------- scans ---------------- */
let scansCache = [];
async function loadScans() {
  scansCache = await api('/api/scans');
  renderScans();
}
function renderScans() {
  $('#scans').innerHTML = scansCache.length ? scansCache.map((s) => {
    const mins = s.finishedAt ? Math.round((Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 60000) : null;
    const mail = s.email?.sent ? ` · ✉ ${esc(t('emailSentTo', s.email.to.join(', ')))}` : s.email?.error ? ` · <span class="msg bad">✉ ${esc(t('emailFailed', s.email.error))}</span>` : '';
    return `
    <div class="scan">
      <div class="scan-head">
        <h3>${fmtIL(s.startedAt, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</h3>
        <span class="scan-meta"><span class="badge ${s.status}">${esc(tMap('status', s.status))}</span> · ${esc(tMap('trigger', s.trigger))} · <span dir="ltr">${esc(s.model || '')}</span> · ${t('findingsN', s.findingCount)}${mins != null ? ` · ${t('minutes', mins)}` : ''}${mail}</span>
      </div>
      <div class="sector-row">${Object.entries(s.sectors).map(([id, v]) => `<span class="sstat ${v.status}" title="${esc(v.error || '')}">${esc(sectorName(id))}: ${v.status === 'done' ? v.count : esc(tMap('status', v.status))}</span>`).join('')}</div>
      ${s.error ? `<p class="msg bad" dir="ltr">${esc(s.error)}</p>` : ''}
      <div class="notes"><button class="btn link" data-scan="${s.id}">${t('viewFindings')}</button> · <button class="btn link" data-notes="${s.id}">${t('sectorNotes')}</button><div class="notes-body" id="notes-${s.id}"></div></div>
    </div>`;
  }).join('') : `<div class="empty"><h3>${t('noScansT')}</h3><p>${t('noScansP')}</p></div>`;
}

async function showNotes(id) {
  const box = $(`#notes-${id}`);
  if (box.innerHTML) return (box.innerHTML = '');
  const s = await api(`/api/scans/${id}`);
  box.innerHTML = Object.entries(s.sectors).map(([sid, v]) => `
    <details open><summary>${esc(sectorName(sid))}</summary><div class="body" dir="auto">
      ${v.error ? `<p class="msg bad" dir="ltr">${esc(v.error)}</p>` : ''}
      <p>${esc(v.notes || t('noNotes'))}</p>
      ${v.citations?.length ? `<ol class="sources">${v.citations.map((c) => `<li><a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener noreferrer">${esc(c.title || hostOf(c.url))}</a></li>`).join('')}</ol>` : ''}
    </div></details>`).join('');
}

/* ---------------- settings ---------------- */
function renderSettings() {
  const s = state.status;
  if (!s) return;
  const k = $('#keyStatus');
  k.className = 'key-status ' + (s.key.set ? 'ok' : 'bad');
  k.textContent = s.key.set ? t('keyOk', s.key.source === 'env' ? t('keyEnv') : t('keyUi'), s.key.hint) : t('keyNone');
  $('#keyClear').hidden = s.key.source !== 'settings';
  const note = $('#keyTempNote');
  if (note) note.hidden = !s.uiKeyIsTemporary;

  $('#modelChosen').textContent = s.settings.model;
  $('#resolvedModel').textContent = s.resolvedModel;
  $('#webMax').value = s.settings.webMaxResults;
  const research = s.settings.research || 'free';
  $$('input[name=research]').forEach((r) => (r.checked = r.value === research));
  $('#webMaxField').hidden = research !== 'web';
  renderModelList();
  if (!state.models.length) api('/api/models').then((m) => { state.models = m; renderModelList(); }).catch(() => {});

  $('#schedOn').checked = s.settings.scheduleEnabled;
  $('#sectorChecks').innerHTML = s.sectors.map((x) => `<label class="check"><input type="checkbox" value="${x.id}" ${s.settings.sectors.includes(x.id) ? 'checked' : ''}/> <span><b>${esc(sectorName(x.id))}</b> <span class="muted small">${esc(sectorScope(x))}</span></span></label>`).join('');

  $$('input[name=uiLang]').forEach((r) => (r.checked = r.value === lang));
  $$('input[name=outLang]').forEach((r) => (r.checked = r.value === (s.settings.language || 'en')));

  const e = s.settings.email || {};
  const p = $('#emailProvider');
  p.className = 'key-status ' + (s.emailProvider ? 'ok' : 'bad');
  p.textContent = s.emailProvider ? t('emailProviderOk', s.emailProvider === 'brevo' ? 'Brevo' : 'Resend') : t('emailProviderNone');
  $('#emailOn').checked = !!e.enabled;
  $('#emailTo').value = e.to || '';
  $('#emailFrom').value = e.from || '';
  $('#emailFrom').placeholder = s.emailFromEnv || 'alerts@example.com';
  $('#emailOnlyNew').checked = !!e.onlyNew;
  $('#emailEmpty').checked = !!e.sendEmpty;
  $('#emailMin').value = e.minScore || 0;
  $('#emailMinVal').textContent = e.minScore || 0;
}

function renderModelList() {
  const needle = $('#modelFilter').value.trim().toLowerCase();
  const cur = state.status.settings.model;
  const opts = [{ id: 'auto', name: t('autoOption') }, ...state.models]
    .filter((m) => m.id === cur || m.id === 'auto' || !needle || (m.id + m.name).toLowerCase().includes(needle))
    .slice(0, 300);
  if (!opts.some((m) => m.id === cur)) opts.unshift({ id: cur, name: cur });
  $('#modelSelect').innerHTML = opts.map((m) => `<option value="${esc(m.id)}" ${m.id === cur ? 'selected' : ''}>${esc(m.id === 'auto' ? m.name : m.id)}${m.promptPrice != null ? `  ($${m.promptPrice.toFixed(2)} / $${m.completionPrice.toFixed(2)} per 1M)` : ''}</option>`).join('');
}

const flash = (el, text, ok = true) => { el.textContent = text; el.className = 'msg ' + (ok ? 'ok' : 'bad'); };
const putSettings = (body) => api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
async function afterSave(msgEl) { await loadStatus(); renderSettings(); flash(msgEl, t('saved')); }

/* ---------------- wiring ---------------- */
let currentTab = 'findings';
function showTab(tab) {
  currentTab = tab;
  $$('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${tab}`));
  if (tab === 'scans') loadScans();
  if (tab === 'settings') renderSettings();
  if (tab === 'findings') loadFindings();
  history.replaceState(null, '', '#' + tab);
}
function renderAll() {
  renderStatus();
  if (currentTab === 'findings') renderFindings();
  if (currentTab === 'scans') renderScans();
  if (currentTab === 'settings') renderSettings();
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('button, .chip');
  if (!el) return;
  if (el.dataset.tab) return showTab(el.dataset.tab);
  if (el.dataset.goto) return showTab(el.dataset.goto);
  if ('sector' in el.dataset) { state.filters.sector = el.dataset.sector; return renderFindings(); }
  if (el.id === 'clearScan') { state.filters.scanId = ''; return loadFindings(); }
  if (el.dataset.scan) { state.filters.scanId = el.dataset.scan; return showTab('findings'); }
  if (el.dataset.notes) return showNotes(el.dataset.notes);
  if (el.dataset.act) {
    const id = el.closest('.card').dataset.id;
    const f = state.findings.find((x) => x.id === id);
    const body = el.dataset.act === 'star' ? { starred: !f.starred } : { dismissed: !f.dismissed };
    await api(`/api/findings/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    if ('starred' in body) state.findings.filter((x) => x.key === f.key).forEach((x) => (x.starred = body.starred));
    else f.dismissed = body.dismissed;
    return renderFindings();
  }
});

$('#langBtn').addEventListener('click', () => setLang(lang === 'he' ? 'en' : 'he'));

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
$$('input[name=research]').forEach((r) => r.addEventListener('change', () => ($('#webMaxField').hidden = !(r.value === 'web' && r.checked))));
$('#emailMin').addEventListener('input', (e) => ($('#emailMinVal').textContent = e.target.value));

$('#keyTest').addEventListener('click', async () => {
  flash($('#keyMsg'), t('testing'));
  try {
    const r = await api('/api/key/test', { method: 'POST', body: JSON.stringify({ key: $('#keyInput').value }) });
    flash($('#keyMsg'), t('keyWorks', r.label ? ` (${r.label})` : '', Number(r.usage || 0).toFixed(2), r.limit != null ? ` / $${r.limit}` : ''));
  } catch (err) { flash($('#keyMsg'), err.message, false); }
});
$('#keySave').addEventListener('click', async () => {
  const key = $('#keyInput').value.trim();
  if (!key) return flash($('#keyMsg'), t('pasteFirst'), false);
  await putSettings({ openrouterKey: key });
  $('#keyInput').value = '';
  await afterSave($('#keyMsg'));
});
$('#keyClear').addEventListener('click', async () => {
  await putSettings({ openrouterKey: '' });
  await loadStatus(); renderSettings();
  flash($('#keyMsg'), t('keyRemoved'));
});
$('#modelSave').addEventListener('click', async () => {
  const research = $('input[name=research]:checked')?.value || 'free';
  await putSettings({ model: $('#modelSelect').value || 'auto', research, webMaxResults: $('#webMax').value });
  await afterSave($('#modelMsg'));
});
$('#schedSave').addEventListener('click', async () => {
  const sectors = $$('#sectorChecks input:checked').map((i) => i.value);
  if (!sectors.length) return flash($('#schedMsg'), t('pickSector'), false);
  await putSettings({ sectors, scheduleEnabled: $('#schedOn').checked });
  await afterSave($('#schedMsg'));
});
$('#langSave').addEventListener('click', async () => {
  const out = $('input[name=outLang]:checked')?.value || 'en';
  const ui = $('input[name=uiLang]:checked')?.value || lang;
  await putSettings({ language: out });
  if (ui !== lang) setLang(ui);
  await afterSave($('#langMsg'));
});
const emailBody = () => ({
  enabled: $('#emailOn').checked,
  to: $('#emailTo').value,
  from: $('#emailFrom').value,
  onlyNew: $('#emailOnlyNew').checked,
  sendEmpty: $('#emailEmpty').checked,
  minScore: Number($('#emailMin').value),
});
$('#emailSave').addEventListener('click', async () => {
  try {
    await putSettings({ email: emailBody() });
    await afterSave($('#emailMsg'));
  } catch (err) { flash($('#emailMsg'), err.message, false); }
});
$('#emailTest').addEventListener('click', async () => {
  const b = emailBody();
  if (!b.to.trim()) return flash($('#emailMsg'), t('needTo'), false);
  flash($('#emailMsg'), t('sending'));
  try {
    const r = await api('/api/email/test', { method: 'POST', body: JSON.stringify({ to: b.to, from: b.from }) });
    flash($('#emailMsg'), t('sentTo', r.to.join(', ')));
  } catch (err) { flash($('#emailMsg'), err.message, false); }
});

let timer;
async function poll() {
  clearTimeout(timer);
  const wasRunning = !!state.status?.running;
  const s = await loadStatus().catch(() => null);
  if (s && wasRunning && !s.running) { loadFindings(); if (currentTab === 'scans') loadScans(); }
  else if (s?.running && currentTab === 'findings') loadFindings();
  timer = setTimeout(poll, s?.running ? 5000 : 60000);
}

(async () => {
  applyStatic();
  await loadStatus();
  showTab(['findings', 'scans', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'findings');
  poll();
})();
