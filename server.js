import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { load, getDb, save, dataDir } from './src/store.js';
import { SECTORS, SECTOR_IDS } from './src/sectors.js';
import { startScan, currentScan, getApiKey } from './src/scanner.js';
import { startScheduler, nextRuns, TZ } from './src/scheduler.js';
import { listModels, checkKey, resolveModel } from './src/openrouter.js';

load();
const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => res.send('ok'));

// Basic auth for everything else when ADMIN_PASSWORD is set (it is required on Render).
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASSWORD || '';
const safeEq = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
app.use((req, res, next) => {
  if (!PASS) return next();
  const [type, b64] = (req.headers.authorization || '').split(' ');
  if (type === 'Basic' && b64) {
    const [u, ...rest] = Buffer.from(b64, 'base64').toString().split(':');
    if (safeEq(u, USER) && safeEq(rest.join(':'), PASS)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Scanner"').status(401).send('Authentication required');
});

app.use(express.static(path.resolve('public')));

const keyHint = (k) => (k ? `…${k.slice(-4)}` : '');

app.get('/api/status', async (_req, res) => {
  const db = getDb();
  const { key, source } = getApiKey();
  const { openrouterKey, ...settings } = db.settings;
  res.json({
    running: currentScan(),
    nextRuns: nextRuns(2),
    timezone: TZ,
    key: { set: !!key, source, hint: keyHint(key) },
    settings,
    resolvedModel: await resolveModel(settings.model),
    sectors: SECTORS,
    counts: { findings: db.findings.length, scans: db.scans.length },
    lastScan: (() => {
      const s = db.scans.find((x) => x.status !== 'running');
      return s && { id: s.id, startedAt: s.startedAt, status: s.status, sectors: Object.fromEntries(Object.entries(s.sectors).map(([k, v]) => [k, { status: v.status }])) };
    })(),
    authEnabled: !!PASS,
    dataDir,
  });
});

app.get('/api/findings', (req, res) => {
  const { sector, minScore, days, q, scanId, starred, showDismissed, onlyNew } = req.query;
  let list = getDb().findings;
  if (scanId) list = list.filter((f) => f.scanId === scanId);
  if (sector) list = list.filter((f) => f.primarySector === sector || f.otherSectors?.includes(sector));
  if (minScore) list = list.filter((f) => f.deal.score >= Number(minScore));
  if (days) list = list.filter((f) => Date.parse(f.foundAt) > Date.now() - Number(days) * 86400_000);
  if (starred === '1') list = list.filter((f) => f.starred);
  if (onlyNew === '1') list = list.filter((f) => f.status === 'new');
  if (showDismissed !== '1') list = list.filter((f) => !f.dismissed);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((f) => JSON.stringify([f.company, f.companyHe, f.headline, f.location, f.signals, f.chain]).toLowerCase().includes(needle));
  }
  res.json(list.slice(0, 500));
});

app.patch('/api/findings/:id', (req, res) => {
  const db = getDb();
  const f = db.findings.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  for (const k of ['starred', 'dismissed']) if (k in req.body) f[k] = !!req.body[k];
  // starring applies to every record of the same company
  if ('starred' in req.body) for (const x of db.findings) if (x.key === f.key) x.starred = f.starred;
  save();
  res.json(f);
});

app.get('/api/scans', (_req, res) => {
  res.json(getDb().scans.slice(0, 100).map(({ sectors, findingIds, ...s }) => ({
    ...s,
    findingCount: findingIds.length,
    sectors: Object.fromEntries(Object.entries(sectors).map(([k, v]) => [k, { status: v.status, count: v.count, error: v.error }])),
  })));
});

app.get('/api/scans/:id', (req, res) => {
  const s = getDb().scans.find((x) => x.id === req.params.id);
  s ? res.json(s) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/scans', (req, res) => {
  try {
    res.status(202).json(startScan({ trigger: 'manual', sectors: req.body?.sectors }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.put('/api/settings', (req, res) => {
  const db = getDb();
  const b = req.body || {};
  const s = db.settings;
  if (Array.isArray(b.sectors)) s.sectors = b.sectors.filter((x) => SECTOR_IDS.includes(x));
  if (typeof b.model === 'string' && b.model.trim()) s.model = b.model.trim();
  if (typeof b.scheduleEnabled === 'boolean') s.scheduleEnabled = b.scheduleEnabled;
  if (b.webMaxResults) s.webMaxResults = Math.max(3, Math.min(25, Number(b.webMaxResults) || 10));
  if (typeof b.openrouterKey === 'string') s.openrouterKey = b.openrouterKey.trim(); // "" clears the override
  save();
  res.json({ ok: true });
});

app.get('/api/models', async (_req, res) => {
  try {
    res.json(await listModels());
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/key/test', async (req, res) => {
  const key = (req.body?.key || '').trim() || getApiKey().key;
  if (!key) return res.status(400).json({ error: 'No key to test' });
  try {
    res.json({ ok: true, ...(await checkKey(key)) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/export.csv', (_req, res) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['found_at', 'company', 'company_he', 'primary_sector', 'other_sectors', 'type', 'location', 'headline', 'deal_score', 'deal_type', 'status', 'confidence', 'signals', 'sources']];
  for (const f of getDb().findings.filter((x) => !x.dismissed)) {
    rows.push([f.foundAt, f.company, f.companyHe, f.primarySector, f.otherSectors.join('|'), f.companyType, f.location, f.headline, f.deal.score, f.deal.type, f.status, f.confidence,
      f.signals.map((s) => `${s.date} ${s.type}: ${s.detail}`).join(' | '), f.sources.map((s) => s.url).join(' | ')]);
  }
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="findings.csv"');
  res.send('﻿' + rows.map((r) => r.map(esc).join(',')).join('\n'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Scanner listening on :${port} (data: ${dataDir})${PASS ? '' : ' — WARNING: ADMIN_PASSWORD not set, site is open'}`);
  startScheduler();
});
