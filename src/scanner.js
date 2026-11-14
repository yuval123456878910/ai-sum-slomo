// Runs the five sector scans one after another and stores the findings.
import { getDb, save, flush, uid } from './store.js';
import { SECTORS, SECTOR_IDS, sectorById } from './sectors.js';
import { SYSTEM_PROMPT, sectorPrompt } from './prompts.js';
import { chat, resolveModel } from './openrouter.js';

let running = null;
export const currentScan = () => running;

export function getApiKey() {
  const ui = getDb().settings.openrouterKey;
  if (ui) return { key: ui, source: 'settings' };
  if (process.env.OPENROUTER_API_KEY) return { key: process.env.OPENROUTER_API_KEY, source: 'env' };
  return { key: '', source: null };
}

export const israelToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', dateStyle: 'short' }).format(new Date());

// Normalize names so "Plasson Industries Ltd." and "Plasson" match.
export function companyKey(name = '') {
  return name
    .toLowerCase()
    .replace(/["'`׳״.,()]/g, ' ')
    .replace(/\b(ltd|limited|inc|corp|corporation|group|holdings|industries|industry|co|company|plc|the)\b/g, ' ')
    .replace(/בע\s*מ|בעמ|תעשיות|קבוצת/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fenced ? fenced[1] : text;
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('Model did not return JSON');
  body = body.slice(a, b + 1);
  try {
    return JSON.parse(body);
  } catch {
    return JSON.parse(body.replace(/,\s*([}\]])/g, '$1')); // trailing commas
  }
}

const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const clampScore = (n) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)));

function normalize(f, sectorId) {
  const primary = SECTOR_IDS.includes(f.primary_sector) ? f.primary_sector : sectorId;
  return {
    company: String(f.company || '').trim(),
    companyHe: f.company_he || '',
    companyType: f.company_type || 'other',
    location: f.location || '',
    primarySector: primary,
    otherSectors: arr(f.other_sectors).filter((s) => SECTOR_IDS.includes(s) && s !== primary),
    headline: f.headline || '',
    signals: arr(f.stress_signals).map((s) => ({ type: s.type || 'other', detail: s.detail || '', date: s.date || '' })),
    indirect: arr(f.indirect_drivers),
    chain: {
      hitLink: f.chain?.hit_link || '',
      mechanism: f.chain?.mechanism || '',
      subcontractors: arr(f.chain?.subcontractors),
      spread: f.chain?.spread || '',
    },
    deal: {
      score: clampScore(f.deal_potential?.score),
      type: f.deal_potential?.type || 'none',
      assets: f.deal_potential?.assets || '',
      rationale: f.deal_potential?.rationale || '',
    },
    novelty: {
      isNew: f.novelty?.is_new !== false,
      earliest: f.novelty?.earliest_report_date || '',
      why: f.novelty?.why_new || '',
    },
    confidence: f.confidence || 'medium',
    sources: arr(f.sources).filter((s) => s && s.url),
  };
}

function mergeInto(target, add, sectorId) {
  if (sectorId !== target.primarySector && !target.otherSectors.includes(sectorId)) target.otherSectors.push(sectorId);
  for (const s of add.otherSectors) if (s !== target.primarySector && !target.otherSectors.includes(s)) target.otherSectors.push(s);
  const seen = new Set(target.signals.map((s) => s.detail));
  for (const s of add.signals) if (!seen.has(s.detail)) target.signals.push(s);
  const urls = new Set(target.sources.map((s) => s.url));
  for (const s of add.sources) if (!urls.has(s.url)) target.sources.push(s);
  target.deal.score = Math.max(target.deal.score, add.deal.score);
}

export function startScan({ trigger = 'manual', sectors } = {}) {
  if (running) throw Object.assign(new Error('A scan is already running'), { status: 409 });
  const db = getDb();
  const ids = (sectors?.length ? sectors : db.settings.sectors).filter((s) => SECTOR_IDS.includes(s));
  if (!ids.length) throw Object.assign(new Error('No sectors selected'), { status: 400 });

  const scan = {
    id: uid(),
    trigger,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    model: null,
    sectors: Object.fromEntries(ids.map((id) => [id, { status: 'queued' }])),
    findingIds: [],
  };
  db.scans.unshift(scan);
  save();
  running = scan;
  // Render free instances sleep after ~15 min without inbound HTTP traffic.
  // Outgoing API calls don't count, so ping our own public URL while scanning.
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  const keepAwake = selfUrl ? setInterval(() => fetch(`${selfUrl}/healthz`).catch(() => {}), 4 * 60_000) : null;
  runScan(scan, ids)
    .catch((e) => {
      scan.status = 'error';
      scan.error = e.message;
    })
    .finally(async () => {
      clearInterval(keepAwake);
      scan.finishedAt = new Date().toISOString();
      running = null;
      save();
      await flush();
      console.log(`[scan ${scan.id}] ${scan.status} — ${scan.findingIds.length} findings`);
    });
  return scan;
}

async function runScan(scan, ids) {
  const db = getDb();
  const { key } = getApiKey();
  if (!key) throw new Error('No OpenRouter API key. Set OPENROUTER_API_KEY in Render or add one in Settings.');
  const model = await resolveModel(db.settings.model);
  scan.model = model;
  console.log(`[scan ${scan.id}] ${scan.trigger} • ${model} • ${ids.join(', ')}`);

  const since = Date.now() - 60 * 86400_000;
  const recent = db.findings.filter((f) => Date.parse(f.foundAt) > since);
  const latestByKey = new Map();
  for (const f of db.findings) {
    const prev = latestByKey.get(f.key);
    if (!prev || prev.foundAt < f.foundAt) latestByKey.set(f.key, f);
  }
  const knownLines = [...new Map(recent.map((f) => [f.key, f])).values()]
    .slice(0, 150)
    .map((f) => `- ${f.company} [${f.primarySector}] — ${f.headline || f.signals?.[0]?.detail || ''} (${f.foundAt.slice(0, 10)})`);

  const assigned = new Map(); // key -> finding (this run)
  const today = israelToday();

  for (const id of ids) {
    const sector = sectorById(id);
    const st = scan.sectors[id];
    st.status = 'running';
    st.startedAt = new Date().toISOString();
    save();
    try {
      const assignedLines = [...assigned.values()].map((f) => `- ${f.company} → ${f.primarySector}`);
      const res = await chat({
        key,
        model,
        webMaxResults: db.settings.webMaxResults,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: sectorPrompt({ sector, today, known: knownLines, assignedThisRun: assignedLines }) },
        ],
      });
      const parsed = parseJson(res.content);
      let added = 0;
      for (const raw of arr(parsed.findings)) {
        const f = normalize(raw, id);
        if (!f.company) continue;
        const k = companyKey(f.company) || companyKey(f.companyHe);
        if (assigned.has(k)) {
          mergeInto(assigned.get(k), f, id);
          continue;
        }
        const prior = latestByKey.get(k);
        if (prior) {
          // keep a company's primary sector stable across runs
          if (prior.primarySector !== f.primarySector) {
            if (!f.otherSectors.includes(f.primarySector)) f.otherSectors.push(f.primarySector);
            f.primarySector = prior.primarySector;
            f.otherSectors = f.otherSectors.filter((s) => s !== f.primarySector);
          }
        }
        const record = {
          id: uid(),
          key: k,
          scanId: scan.id,
          scanSector: id,
          foundAt: new Date().toISOString(),
          firstSeen: prior?.firstSeen || new Date().toISOString(),
          seenCount: (prior?.seenCount || 0) + 1,
          status: prior ? 'update' : 'new',
          starred: prior?.starred || false,
          dismissed: false,
          ...f,
        };
        assigned.set(k, record);
        db.findings.unshift(record);
        scan.findingIds.push(record.id);
        added++;
      }
      Object.assign(st, {
        status: 'done',
        count: added,
        notes: parsed.sector_notes || '',
        citations: res.citations.slice(0, 40),
        usage: res.usage,
      });
    } catch (e) {
      Object.assign(st, { status: 'error', error: e.message });
      console.error(`[scan ${scan.id}] ${id} failed:`, e.message);
      if (e.fatal) {
        scan.error = `${e.message} — check the key's credit/limit at https://openrouter.ai/settings/keys`;
        for (const [sid, s] of Object.entries(scan.sectors)) if (s.status === 'queued') Object.assign(s, { status: 'error', error: 'skipped (key error)' });
        st.finishedAt = new Date().toISOString();
        save();
        break;
      }
    }
    st.finishedAt = new Date().toISOString();
    save();
  }

  const states = Object.values(scan.sectors).map((s) => s.status);
  scan.status = states.every((s) => s === 'done') ? 'done' : states.every((s) => s === 'error') ? 'error' : 'partial';
}

export { SECTORS };
