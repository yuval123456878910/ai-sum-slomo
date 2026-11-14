// OpenRouter client: chat completions with the web-search plugin, model list, key check.
const BASE = 'https://openrouter.ai/api/v1';

const headers = (key) => ({
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': process.env.RENDER_EXTERNAL_URL || 'http://localhost',
  'X-Title': 'IL Industrial Stress Scanner',
});

let modelCache = { at: 0, list: [] };

export async function listModels() {
  if (Date.now() - modelCache.at < 6 * 3600_000 && modelCache.list.length) return modelCache.list;
  const res = await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`OpenRouter /models ${res.status}`);
  const j = await res.json();
  const list = (j.data || []).map((m) => ({
    id: m.id,
    name: m.name,
    created: m.created || 0,
    context: m.context_length,
    promptPrice: Number(m.pricing?.prompt || 0) * 1e6, // USD per 1M tokens
    completionPrice: Number(m.pricing?.completion || 0) * 1e6,
  }));
  list.sort((a, b) => b.created - a.created);
  modelCache = { at: Date.now(), list };
  return list;
}

// Free models to prefer for "auto" in free mode, strongest first (only ones OpenRouter still lists are used).
const FREE_PREFERENCE = [/^nvidia\/nemotron-3-ultra/, /^google\/gemma-4-31b/, /^nvidia\/nemotron-3\.5-super/, /^thinkingmachines\/inkling/, /^inclusionai\/ling/, /^baidu\/ernie/];

// Returns [primary, ...fallbacks]. OpenRouter tries the next one if a model is down or rate-limited.
// "auto" = best free models in free mode, newest Claude Sonnet in web-search mode.
export async function resolveModels(model, research = 'free') {
  if (model && model !== 'auto') return [model];
  let list = [];
  try {
    list = await listModels();
  } catch {
    /* use fallbacks below */
  }
  if (research === 'free') {
    const free = list.filter((m) => m.id.endsWith(':free') && (m.context || 0) >= 100_000);
    const picked = [];
    for (const re of FREE_PREFERENCE) {
      const m = free.find((x) => re.test(x.id));
      if (m && !picked.includes(m.id)) picked.push(m.id);
    }
    for (const m of free) if (picked.length < 3 && !picked.includes(m.id)) picked.push(m.id);
    return picked.length ? picked.slice(0, 3) : ['google/gemma-4-31b-it:free'];
  }
  const sonnet = list.find((m) => /^anthropic\/claude-sonnet/.test(m.id) && !/:/.test(m.id));
  return [sonnet?.id || 'anthropic/claude-sonnet-4.5'];
}
export const resolveModel = async (model, research) => (await resolveModels(model, research))[0];

export async function chat({ key, models, messages, web = false, webMaxResults = 10 }) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({
      model: models[0],
      ...(models.length > 1 ? { models } : {}),
      messages,
      ...(web ? { plugins: [{ id: 'web', max_results: webMaxResults }] } : {}),
      temperature: 0.2,
      max_tokens: 12000,
    }),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 400);
    try { msg = JSON.parse(text).error?.message || msg; } catch {}
    // 401 bad key, 402 no credits, 403 key limit reached: every other call would fail the same way
    throw Object.assign(new Error(`OpenRouter ${res.status}: ${msg}`), { fatal: [401, 402, 403].includes(res.status) });
  }
  const j = JSON.parse(text);
  if (j.error) throw new Error(`OpenRouter: ${j.error.message || JSON.stringify(j.error)}`);
  const msg = j.choices?.[0]?.message || {};
  const citations = (msg.annotations || [])
    .filter((a) => a.type === 'url_citation' && a.url_citation?.url)
    .map((a) => ({ url: a.url_citation.url, title: a.url_citation.title || '' }));
  return { content: msg.content || '', citations, usage: j.usage || null, model: j.model || models[0] };
}

export async function checkKey(key) {
  for (const p of ['/key', '/auth/key']) {
    const res = await fetch(BASE + p, { headers: headers(key), signal: AbortSignal.timeout(20_000) });
    if (res.status === 404) continue;
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
    const d = j.data || {};
    return { label: d.label, usage: d.usage, limit: d.limit, limitRemaining: d.limit_remaining, isFreeTier: d.is_free_tier };
  }
  throw new Error('Key endpoint not found');
}
