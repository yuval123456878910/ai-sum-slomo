// JSON store. Locally it is a file in DATA_DIR.
// On Render's free plan the disk is wiped whenever the service sleeps, so when
// GITHUB_TOKEN + GITHUB_REPO are set the database is also kept as db.json on a
// separate branch of the GitHub repo (default "data") and reloaded on boot.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SECTOR_IDS } from './sectors.js';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const FILE = path.join(DATA_DIR, 'db.json');

const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const GH_REPO = process.env.GITHUB_REPO || '';
const GH_BRANCH = process.env.GITHUB_DATA_BRANCH || 'data';
const GH_PATH = 'db.json';
const useGitHub = !!(GH_TOKEN && GH_REPO);

const MAX_SCANS = 300;
const MAX_FINDINGS = 3000;

const defaults = () => ({
  settings: {
    sectors: [...SECTOR_IDS],
    model: process.env.OPENROUTER_MODEL || 'auto',
    scheduleEnabled: true,
    research: 'free', // 'free' = Google News RSS + free model, 'web' = OpenRouter web search (paid)
    webMaxResults: 10,
    openrouterKey: '', // UI override; never written to GitHub
  },
  scans: [],
  findings: [],
});

let db = null;

/* ---------------- GitHub persistence ---------------- */
let ghSha = null;
let pushTimer = null;
let pushChain = Promise.resolve();

async function gh(p, opts = {}) {
  return fetch(`https://api.github.com/repos/${GH_REPO}${p}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'stress-radar',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
}

async function ensureBranch() {
  const r = await gh(`/git/ref/heads/${GH_BRANCH}`);
  if (r.ok) return;
  if (r.status !== 404) throw new Error(`GitHub ref check failed: ${r.status} ${await r.text()}`);
  const repo = await (await gh('')).json();
  const base = await (await gh(`/git/ref/heads/${repo.default_branch}`)).json();
  const c = await gh('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${GH_BRANCH}`, sha: base.object.sha }) });
  if (!c.ok && c.status !== 422) throw new Error(`GitHub branch create failed: ${c.status} ${await c.text()}`);
  console.log(`[store] created GitHub branch "${GH_BRANCH}"`);
}

async function ghLoad() {
  await ensureBranch();
  const meta = await gh(`/contents/${GH_PATH}?ref=${GH_BRANCH}`);
  if (meta.status === 404) return null;
  if (!meta.ok) throw new Error(`GitHub load failed: ${meta.status} ${await meta.text()}`);
  const j = await meta.json();
  ghSha = j.sha;
  if (j.content && j.encoding === 'base64') return JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
  // files over 1 MB come without inline content
  const raw = await gh(`/contents/${GH_PATH}?ref=${GH_BRANCH}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
  return JSON.parse(await raw.text());
}

async function ghPush() {
  const snapshot = { ...db, settings: { ...db.settings, openrouterKey: '' } };
  const content = Buffer.from(JSON.stringify(snapshot)).toString('base64');
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await gh(`/contents/${GH_PATH}`, {
      method: 'PUT',
      body: JSON.stringify({ message: 'data: update db.json', content, branch: GH_BRANCH, ...(ghSha ? { sha: ghSha } : {}) }),
    });
    if (r.ok) {
      ghSha = (await r.json()).content.sha;
      return;
    }
    if (r.status === 409 || r.status === 422) {
      // sha out of date — fetch the current one and retry
      const m = await gh(`/contents/${GH_PATH}?ref=${GH_BRANCH}`);
      ghSha = m.ok ? (await m.json()).sha : null;
      continue;
    }
    throw new Error(`GitHub save failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
}

function queuePush(delay = 8000) {
  if (!useGitHub) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushChain = pushChain.then(ghPush).catch((e) => console.error('[store]', e.message));
  }, delay);
}

export async function flush() {
  if (!useGitHub) return;
  clearTimeout(pushTimer);
  pushChain = pushChain.then(ghPush).catch((e) => console.error('[store]', e.message));
  await pushChain;
}

/* ---------------- public API ---------------- */
export async function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let raw = null;
  if (useGitHub) {
    raw = await ghLoad();
    console.log(`[store] loaded from GitHub ${GH_REPO}@${GH_BRANCH} (${raw ? 'existing' : 'new'})`);
  } else if (fs.existsSync(FILE)) {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  }
  const d = defaults();
  db = raw ? { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) } } : d;
  // A scan that was running when the process died will never finish.
  for (const s of db.scans) {
    if (s.status === 'running') {
      s.status = 'interrupted';
      s.finishedAt = s.finishedAt || new Date().toISOString();
    }
  }
  save();
  return db;
}

export function getDb() {
  if (!db) throw new Error('Store not loaded');
  return db;
}

export function save() {
  if (db.scans.length > MAX_SCANS) db.scans.length = MAX_SCANS;
  if (db.findings.length > MAX_FINDINGS) {
    db.findings.sort((a, b) => (b.foundAt || '').localeCompare(a.foundAt || ''));
    db.findings.length = MAX_FINDINGS;
  }
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, FILE);
  queuePush();
}

export const uid = () => crypto.randomBytes(6).toString('hex');
export const storageLabel = useGitHub ? `GitHub ${GH_REPO} (branch "${GH_BRANCH}")` : DATA_DIR;
export const usesGitHub = useGitHub;
