// Scans at 07:00 and 19:00 Israel time (DST handled by the time zone).
// On Render's free plan the service sleeps, so GitHub Actions also calls
// POST /api/cron around those times to wake it; tryScheduledRun() makes sure
// each slot runs once, whichever trigger arrives first.
import cron from 'node-cron';
import { getDb } from './store.js';
import { startScan, currentScan } from './scanner.js';

export const TZ = 'Asia/Jerusalem';
export const HOURS = [7, 19];
const WINDOW_HOURS = 2; // a slot can still start up to 2h late (wake-up / Actions delays)

const israelHour = (d = new Date()) =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(d));

export function tryScheduledRun(reason, { force = false } = {}) {
  const db = getDb();
  if (!db.settings.scheduleEnabled && !force) return { started: false, reason: 'schedule disabled' };
  if (currentScan()) return { started: false, reason: 'scan already running', scanId: currentScan().id };
  if (!force) {
    const hour = israelHour();
    const slot = HOURS.find((h) => hour >= h && hour < h + WINDOW_HOURS);
    if (slot === undefined) return { started: false, reason: `outside scan window (Israel hour ${hour})` };
    // the slot counts as done only if a scheduled scan started inside it (at or after HH:00 today)
    const now = new Date();
    const minute = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, minute: '2-digit' }).format(now));
    const slotStart = now.getTime() - ((hour - slot) * 60 + minute) * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();
    const last = db.scans.find((s) => s.trigger === 'scheduled' && Date.parse(s.startedAt) >= slotStart);
    if (last) return { started: false, reason: 'this slot already ran', scanId: last.id };
  }
  try {
    // a forced run (GitHub "Run workflow" button) is manual: it must not use up the 07:00/19:00 slot
    const scan = startScan({ trigger: force ? 'manual' : 'scheduled' });
    console.log(`[schedule] started via ${reason}`);
    return { started: true, scanId: scan.id };
  } catch (e) {
    return { started: false, reason: e.message };
  }
}

export function startScheduler() {
  cron.schedule(`0 ${HOURS.join(',')} * * *`, () => console.log('[schedule]', tryScheduledRun('cron')), { timezone: TZ });
  console.log(`[schedule] scans at ${HOURS.map((h) => `${String(h).padStart(2, '0')}:00`).join(' & ')} ${TZ}`);
  // Catch-up after a restart/wake-up inside a slot window.
  setTimeout(() => {
    const r = tryScheduledRun('startup');
    if (r.started) console.log('[schedule] catch-up scan started');
  }, 20_000);
}

// Next run times, as ISO strings, for the UI.
export function nextRuns(count = 2) {
  const out = [];
  const now = Date.now();
  for (let h = 0; h < 72 && out.length < count; h++) {
    const t = new Date(Math.ceil(now / 3600_000) * 3600_000 + h * 3600_000);
    if (HOURS.includes(israelHour(t))) out.push(t.toISOString());
  }
  return out;
}
