// Free news collection: Google News RSS searches (Hebrew + English, Israel edition).
// No API key or cost. Results are headlines + publisher + date + link.

const DAYS = 14;

// Distress searches shared by all sectors (run once per scan).
const STRESS_QUERIES = {
  he: ['"הקפאת הליכים"', '"חדלות פירעון" חברה', '"הסדר חוב"', '"כונס נכסים"', 'פיטורים מפעל', 'סגירת מפעל',
    'קו ייצור נסגר', 'העברת ייצור לחו"ל', 'מכירת ציוד מפעל', 'שעבוד מפעל בנק', 'קיבוץ מפעל קשיים', 'יצואן ביטול הזמנות'],
  en: ['Israel factory layoffs', 'Israeli company insolvency proceedings', 'Israel manufacturer debt restructuring',
    'Israeli plant closure', 'Israel exporter lost contract'],
};

// Per-sector industry searches.
const SECTOR_QUERIES = {
  plastics: { he: ['מפעל פלסטיק', 'פולימרים תעשייה', 'הזרקת פלסטיק', 'חברת השקיה', 'מוצרי פלסטיק יצרנית'], en: ['Israel plastics manufacturer', 'Israeli irrigation company', 'Israel polymer plant'] },
  food: { he: ['מפעל מזון', 'יצרנית מזון', 'מפעל משקאות', 'בית קירור', 'חומרי גלם מזון'], en: ['Israel food manufacturer', 'Israeli food company', 'Israel cold storage'] },
  packaging: { he: ['תעשיית האריזה', 'מפעל קרטון', 'מפעל נייר', 'מפעל זכוכית', 'דפוס תעשייתי', 'מפעל תוויות'], en: ['Israel packaging company', 'Israeli paper mill', 'Israel cardboard factory'] },
  chemicals: { he: ['מפעל כימיקלים', 'דשנים', 'פטרוכימיה', 'מוצרי ניקוי יצרנית', 'מפעל צבעים', 'קוסמטיקה מפעל'], en: ['Israel chemicals plant', 'Israeli fertilizer company', 'Israel petrochemical'] },
  metal: { he: ['מפעל מתכת', 'פלדה מפעל', 'אלומיניום פרופילים', 'יציקה מפעל', 'עיבוד שבבי', 'מבני פלדה'], en: ['Israel steel manufacturer', 'Israeli aluminum company', 'Israel metal factory'] },
};

const decode = (s = '') =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .trim();
const tag = (xml, name) => decode((xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1]);

async function search(query, lang) {
  const q = encodeURIComponent(`${query} when:${DAYS}d`);
  const loc = lang === 'he' ? 'hl=he&gl=IL&ceid=IL:he' : 'hl=en-IL&gl=IL&ceid=IL:en';
  try {
    const res = await fetch(`https://news.google.com/rss/search?q=${q}&${loc}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StressRadar/1.0)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return xml.split('<item>').slice(1).map((it) => {
      const source = tag(it, 'source');
      let title = tag(it, 'title');
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      const d = new Date(tag(it, 'pubDate'));
      return { title, url: tag(it, 'link'), source, date: isNaN(d) ? '' : d.toISOString().slice(0, 10), query, lang };
    });
  } catch {
    return [];
  }
}

async function runAll(jobs, concurrency = 4) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (i < jobs.length) {
      const [q, lang] = jobs[i++];
      out.push(...(await search(q, lang)));
      await new Promise((r) => setTimeout(r, 250)); // be polite
    }
  }));
  return out;
}

// English results are noisy (world news), so keep only Israeli outlets for them.
const IL_SOURCES = /globes|calcalist|ctech|times of israel|jerusalem post|jpost|haaretz|themarker|ynet|i24|jns|israel hayom|bizportal|maariv|walla|n12|kan|israel21c|no camels|jewish press|arutz|israel national/i;

function dedupe(items) {
  const seen = new Set();
  return items
    .filter((a) => a.lang === 'he' || IL_SOURCES.test(a.source))
    .filter((a) => {
      const k = a.title.toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 80);
      if (!a.title || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function collectStressNews() {
  const jobs = [...STRESS_QUERIES.he.map((q) => [q, 'he']), ...STRESS_QUERIES.en.map((q) => [q, 'en'])];
  return dedupe(await runAll(jobs));
}

export async function collectSectorNews(sectorId) {
  const s = SECTOR_QUERIES[sectorId];
  if (!s) return [];
  return dedupe(await runAll([...s.he.map((q) => [q, 'he']), ...s.en.map((q) => [q, 'en'])]));
}

// Compact numbered list for the prompt. The model cites [n]; the app maps n back to the article.
export function formatArticles(list) {
  return list.map((a, i) => `[${i + 1}] ${a.date} | ${a.source} | ${a.title}`).join('\n');
}
