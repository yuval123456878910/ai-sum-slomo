// Email the scan results. Uses an HTTP email API (Render's free plan blocks SMTP ports).
//   BREVO_API_KEY  — brevo.com free plan (300 emails/day); sender = an address you verified in Brevo
//   RESEND_API_KEY — resend.com free plan; without your own domain it can only send to your Resend account email
// EMAIL_FROM (env) or Settings → "From" sets the sender address.
import { sectorById } from './sectors.js';

const SECTOR_HE = { plastics: 'פלסטיק', food: 'מזון', packaging: 'אריזות', chemicals: 'כימיקלים', metal: 'מתכת' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');

export function emailProvider() {
  if (process.env.BREVO_API_KEY) return 'brevo';
  if (process.env.RESEND_API_KEY) return 'resend';
  return null;
}

const T = {
  en: {
    subject: (n, hot) => `Stress Radar: ${n} ${n === 1 ? 'company' : 'companies'}${hot ? `, ${hot} with deal score 7+` : ''}`,
    empty: 'No new findings in this scan.',
    intro: (date) => `Scan of ${date} (Israel time).`,
    deal: 'Deal', new: 'NEW', update: 'update', sources: 'Sources', open: 'Open Stress Radar', also: 'also',
    chain: 'Chain', test: '[Test] ',
  },
  he: {
    subject: (n, hot) => `מכ"ם מצוקה: ${n} חברות${hot ? `, ${hot} עם ציון עסקה 7+` : ''}`,
    empty: 'לא נמצאו ממצאים חדשים בסריקה זו.',
    intro: (date) => `סריקה מתאריך ${date} (שעון ישראל).`,
    deal: 'עסקה', new: 'חדש', update: 'עדכון', sources: 'מקורות', open: 'לפתיחת מכ"ם מצוקה', also: 'גם',
    chain: 'שרשרת', test: '[בדיקה] ',
  },
};

export function buildEmail({ scan, findings, lang = 'en', test = false }) {
  const t = T[lang] || T.en;
  const rtl = lang === 'he';
  const sectorName = (id) => (rtl ? SECTOR_HE[id] : sectorById(id)?.name) || id;
  const date = new Intl.DateTimeFormat(rtl ? 'he-IL' : 'en-GB', { timeZone: 'Asia/Jerusalem', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(scan?.startedAt || Date.now()));
  const list = [...findings].sort((a, b) => b.deal.score - a.deal.score);
  const hot = list.filter((f) => f.deal.score >= 7).length;
  const site = process.env.RENDER_EXTERNAL_URL || '';

  const cards = list.map((f) => {
    const color = f.deal.score >= 7 ? '#49111c' : f.deal.score >= 4 ? '#5e503f' : '#a9927d';
    const name = rtl && f.companyHe ? `${esc(f.companyHe)} <span style="color:#5e503f;font-weight:400">· ${esc(f.company)}</span>` : `${esc(f.company)}${f.companyHe ? ` <span style="color:#5e503f;font-weight:400">· ${esc(f.companyHe)}</span>` : ''}`;
    return `
    <tr><td style="padding:14px 16px;border:1px solid #ddd3c8;background:#fff">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font:600 17px Georgia,serif;color:#0a0908">${name}</td>
        <td width="56" align="center" style="font:700 18px Georgia,serif;color:#fff;background:${color};border-radius:3px">${f.deal.score}<div style="font:10px Arial;opacity:.85">${t.deal}</div></td>
      </tr></table>
      <div style="margin:6px 0;font:12px Arial;color:#5e503f">
        <b style="background:#49111c;color:#f2f4f3;padding:1px 6px;border-radius:2px">${esc(sectorName(f.primarySector))}</b>
        ${f.otherSectors.map((s) => `${t.also} ${esc(sectorName(s))}`).join(' · ')}
        · ${f.status === 'new' ? `<b>${t.new}</b>` : t.update} · ${esc(f.location)}
      </div>
      <p style="margin:6px 0;font:14px/1.5 Arial;color:#0a0908">${esc(f.headline)}</p>
      <ul style="margin:6px 0;padding-${rtl ? 'right' : 'left'}:18px;font:13px/1.5 Arial;color:#0a0908">
        ${f.signals.slice(0, 4).map((s) => `<li>${s.date ? `<span style="color:#5e503f">${esc(s.date)}</span> ` : ''}${esc(s.detail)}</li>`).join('')}
      </ul>
      ${f.chain.hitLink ? `<p style="margin:6px 0;font:12.5px Arial;color:#5e503f"><b>${t.chain}:</b> ${esc(f.chain.hitLink)} → ${esc(f.chain.mechanism)} → ${esc(f.chain.subcontractors.join(', ') || f.chain.spread)}</p>` : ''}
      ${f.deal.rationale ? `<p style="margin:6px 0;font:13px Arial;color:#0a0908"><b>${t.deal}:</b> ${esc(f.deal.rationale)}</p>` : ''}
      <p style="margin:6px 0 0;font:12px Arial">${t.sources}: ${f.sources.slice(0, 4).map((s) => `<a style="color:#49111c" href="${esc(safeUrl(s.url))}">${esc(s.publisher || s.title || 'link')}</a>`).join(' · ')}</p>
    </td></tr><tr><td height="10"></td></tr>`;
  }).join('');

  const html = `<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}" lang="${lang}"><body style="margin:0;background:#f2f4f3">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f3"><tr><td align="center" style="padding:20px 12px">
  <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%" dir="${rtl ? 'rtl' : 'ltr'}">
    <tr><td style="background:#0a0908;color:#f2f4f3;padding:16px 18px;font:700 20px Georgia,serif">${rtl ? 'מכ"ם מצוקה' : 'Stress Radar'}
      <div style="font:12px Arial;color:#c9bfb4;font-weight:400;margin-top:3px">${t.intro(esc(date))}</div></td></tr>
    <tr><td height="14"></td></tr>
    ${cards || `<tr><td style="font:14px Arial;color:#5e503f;padding:10px">${t.empty}</td></tr>`}
    ${site ? `<tr><td align="center" style="padding:10px"><a href="${esc(site)}" style="background:#49111c;color:#f2f4f3;padding:10px 18px;border-radius:3px;font:600 14px Arial;text-decoration:none">${t.open}</a></td></tr>` : ''}
  </table></td></tr></table></body></html>`;

  return { subject: (test ? t.test : '') + t.subject(list.length, hot), html };
}

export async function sendEmail({ to, from, subject, html }) {
  const recipients = String(to || '').split(/[,;\s]+/).map((s) => s.trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  if (!recipients.length) throw new Error('No valid recipient address');
  const sender = from || process.env.EMAIL_FROM;
  const provider = emailProvider();
  if (!provider) throw new Error('No email service configured. Add BREVO_API_KEY (or RESEND_API_KEY) in Render → Environment.');

  let res;
  if (provider === 'brevo') {
    if (!sender) throw new Error('Set the "From" address (must be a sender you verified in Brevo).');
    res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { email: sender, name: 'Stress Radar' }, to: recipients.map((email) => ({ email })), subject, htmlContent: html }),
      signal: AbortSignal.timeout(30_000),
    });
  } else {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: sender ? `Stress Radar <${sender}>` : 'Stress Radar <onboarding@resend.dev>', to: recipients, subject, html }),
      signal: AbortSignal.timeout(30_000),
    });
  }
  if (!res.ok) throw new Error(`${provider} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { provider, to: recipients };
}

// Called after every scan; never throws.
export async function emailScanResults(scan, db) {
  const e = db.settings.email || {};
  if (!e.enabled || !e.to) return null;
  const all = db.findings.filter((f) => scan.findingIds.includes(f.id));
  const findings = all.filter((f) => (!e.onlyNew || f.status === 'new') && f.deal.score >= (Number(e.minScore) || 0));
  if (!findings.length && !e.sendEmpty) return { skipped: 'nothing matched the email filters' };
  try {
    const { subject, html } = buildEmail({ scan, findings, lang: db.settings.language || 'en' });
    const r = await sendEmail({ to: e.to, from: e.from, subject, html });
    return { sent: true, count: findings.length, ...r };
  } catch (err) {
    console.error('[email]', err.message);
    return { sent: false, error: err.message };
  }
}
