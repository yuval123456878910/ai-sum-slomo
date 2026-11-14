// Tiny JSON-file store. On Render, DATA_DIR points at a persistent disk.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SECTOR_IDS } from './sectors.js';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const FILE = path.join(DATA_DIR, 'db.json');

const MAX_SCANS = 400;
const MAX_FINDINGS = 6000;

const defaults = () => ({
  settings: {
    sectors: [...SECTOR_IDS],
    model: process.env.OPENROUTER_MODEL || 'auto',
    scheduleEnabled: true,
    webMaxResults: 10,
    openrouterKey: '', // optional override saved from the UI; env var is used when empty
  },
  scans: [],
  findings: [],
});

let db = null;

export function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const d = defaults();
    db = { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) } };
  } else {
    db = defaults();
    save();
  }
  // A scan that was running when the process died will never finish.
  for (const s of db.scans) {
    if (s.status === 'running') {
      s.status = 'interrupted';
      s.finishedAt = s.finishedAt || new Date().toISOString();
    }
  }
  return db;
}

export function getDb() {
  return db || load();
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
}

export const uid = () => crypto.randomBytes(6).toString('hex');
export const dataDir = DATA_DIR;
