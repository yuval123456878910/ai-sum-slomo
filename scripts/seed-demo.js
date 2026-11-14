// Fills the local database with FICTIONAL sample findings so the UI can be previewed
// without spending OpenRouter credits. Do not run this on the Render service.
import { load, save, uid } from '../src/store.js';

const db = load();
const scanId = uid();
const now = new Date();
const ago = (h) => new Date(now - h * 3600_000).toISOString();

const sample = [
  ['Galil Polymers (demo)', 'גליל פולימרים (דמו)', 'plastics', ['packaging'], 'family', 'Karmiel industrial zone', 8, 'both',
    'Bank lowered credit line after loss of a European irrigation customer; night shift cut at the molding plant.',
    [['bank', 'Credit line cut by ₪18M'], ['fewer_shifts', 'Night shift stopped, 40 workers on leave'], ['lost_export', 'Main EU drip contract not renewed']],
    ['EU export customer', 'Drip-part orders down ~35%', ['Karmiel mold makers', 'Resin distributor']]],
  ['Negev Metal Works (demo)', 'מתכת הנגב (דמו)', 'metal', [], 'kibbutz', 'Western Negev', 5, 'business',
    'Aluminum profile supplier raised prices; changed tender terms squeeze margins.',
    [['raw_materials', 'Profile prices up 12%'], ['tender', 'Late-delivery penalties added to public tender']],
    ['Aluminum supplier', 'Margin squeeze on tender', ['Coating subcontractors']]],
  ['Sharon Cold Foods (demo)', 'שרון מזון קפוא (דמו)', 'food', [], 'private', 'Kadima', 3, 'real_estate',
    'Cold-storage operator delays supplier payments after a port disruption.',
    [['shipping', 'Containers held at foreign port for 3 weeks'], ['debt', 'Suppliers shortened credit to 30 days']],
    ['Foreign port', 'Inventory gap & cash squeeze', ['Refrigeration contractors']]],
];

db.findings.unshift(...sample.map(([company, he, sector, other, type, loc, score, dealType, headline, sigs, chain], i) => ({
  id: uid(), key: company.toLowerCase(), scanId, scanSector: sector, foundAt: ago(i * 3), firstSeen: ago(i * 3), seenCount: 1,
  status: i === 1 ? 'update' : 'new', starred: false, dismissed: false,
  company, companyHe: he, companyType: type, location: loc, primarySector: sector, otherSectors: other, headline,
  signals: sigs.map(([t, d], j) => ({ type: t, detail: d, date: ago(24 * (j + 1)).slice(0, 10) })),
  indirect: ['export_customer_shock'],
  chain: { hitLink: chain[0], mechanism: chain[1], subcontractors: chain[2], spread: 'Sample text — fictional company.' },
  deal: { score, type: dealType, assets: 'Plant and land (sample)', rationale: 'Sample rationale — fictional company for UI preview.' },
  novelty: { isNew: true, earliest: ago(72).slice(0, 10), why: 'Demo record' },
  confidence: 'medium',
  sources: [{ title: 'Example source (demo)', url: 'https://example.com', publisher: 'example.com', date: ago(24).slice(0, 10) }],
})));
db.scans.unshift({ id: scanId, trigger: 'demo', startedAt: ago(1), finishedAt: ago(0.8), status: 'done', model: 'demo',
  sectors: Object.fromEntries(['plastics', 'food', 'packaging', 'chemicals', 'metal'].map((s) => [s, { status: 'done', count: sample.filter((x) => x[2] === s).length, notes: 'Demo notes.' }])),
  findingIds: [] });
save();
console.log('Seeded 3 fictional demo findings.');
