// Runs the scan at 07:00 and 19:00 Israel time (DST handled by the time zone).
import cron from 'node-cron';
import { getDb } from './store.js';
import { startScan, currentScan } from './scanner.js';

export const TZ = 'Asia/Jerusalem';
export const HOURS = [7, 19];

function israelNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { hour: Number(parts.hour), minute: Number(parts.minute) };
}

function fire(reason) {
  const db = getDb();
  if (!db.settings.scheduleEnabled) return console.log(`[schedule] skipped (${reason}): schedule disabled`);
  if (currentScan()) return console.log(`[schedule] skipped (${reason}): scan already running`);
  try {
    startScan({ trigger: 'scheduled' });
  } catch (e) {
    console.error('[schedule] failed to start:', e.message);
  }
}

export function startScheduler() {
  cron.schedule(`0 ${HOURS.join(',')} * * *`, () => fire('cron'), { timezone: TZ });
  console.log(`[schedule] scans at ${HOURS.map((h) => `${String(h).padStart(2, '0')}:00`).join(' & ')} ${TZ}`);

  // Catch-up: if the service restarted (deploy, crash) within 2h after a slot and that slot never ran.
  const { hour } = israelNow();
  const slot = HOURS.find((h) => hour >= h && hour < h + 2);
  if (slot !== undefined) {
    const last = getDb().scans.find((s) => s.trigger === 'scheduled');
    const recent = last && Date.now() - Date.parse(last.startedAt) < 3 * 3600_000;
    if (!recent) setTimeout(() => fire('catch-up'), 15_000);
  }
}

// Next run times, as ISO strings, for the UI.
export function nextRuns(count = 2) {
  const out = [];
  const now = Date.now();
  for (let h = 0; h < 72 && out.length < count; h++) {
    const t = new Date(Math.ceil(now / 3600_000) * 3600_000 + h * 3600_000);
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(t));
    if (HOURS.includes(hour)) out.push(t.toISOString());
  }
  return out;
}
