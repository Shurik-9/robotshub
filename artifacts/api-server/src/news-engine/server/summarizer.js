// Извлекающий саммаризатор без внешних API: 2–3 ключевых предложения из текста фида.
// Интерфейс совместим с будущим LLM-провайдером: summarize(title, text, settings) -> string.

const ABBR = /(\b(?:г|ул|др|пр|т|п|ст|рис|табл|мм|см|кг|руб|млрд|млн|ООО|АО|ЗАО|ПАО|НИИ|ТУ))\./g;

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    .replace(/&mdash;/g, '—').replace(/&hellip;/g, '…').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text) {
  const protectedText = text.replace(ABBR, '$1\u0001');
  const parts = protectedText.split(/(?<=[.!?…])\s+(?=[«"(]?\s*[А-ЯЁA-Z0-9])/);
  const out = [];
  for (const p of parts) {
    const s = p.replace(/\u0001/g, '.').trim();
    if (!s) continue;
    // слишком короткие обрывки приклеиваем к предыдущему
    if (out.length && s.length < 25) out[out.length - 1] += ' ' + s;
    else out.push(s);
  }
  return out;
}

function words(text) {
  return text.toLowerCase().match(/[a-zа-яё0-9][a-zа-яё0-9-]*/g) || [];
}

export function summarize(title, rawText, settings, maxChars) {
  const limit = maxChars || 420;
  const text = stripHtml(rawText);
  if (!text || text.length < 40) {
    return stripHtml(title).slice(0, limit - 1) + (stripHtml(title).length > limit - 1 ? '…' : '');
  }
  const include = (settings.include || []).map(w => w.toLowerCase());
  const core = (settings.core || []).map(w => w.toLowerCase());

  const sentences = splitSentences(text);
  if (sentences.length <= 2) {
    const joined = sentences.join(' ');
    return joined.length > limit ? joined.slice(0, limit - 1).replace(/\s\S*$/, '') + '…' : joined;
  }

  const scored = sentences.map((s, i) => {
    const low = s.toLowerCase();
    const w = new Set(words(low));
    let score = i === 0 ? 3 : i === 1 ? 1.6 : i === 2 ? 0.8 : 0;
    for (const k of core) if (low.includes(k)) score += 0.8;
    for (const k of include) if (w.has(k) || low.includes(k)) score += 0.6;
    // слишком длинные и слишком короткие — штраф
    if (s.length > 320) score -= 0.7;
    if (s.length < 45) score -= 0.5;
    // дисклеймеры и мусор в конец
    if (/(подпиш|реклам|читайте также|подробност|на правах рекламы)/i.test(s)) score -= 3;
    return { s, i, score };
  });

  const want = sentences.length > 6 ? 3 : 2;
  const picked = scored.slice().sort((a, b) => b.score - a.score).slice(0, want).sort((a, b) => a.i - b.i);

  let out = '';
  for (const p of picked) {
    if (out && (out + ' ' + p.s).length > limit) break;
    out = out ? out + ' ' + p.s : p.s;
  }
  if (!out) out = sentences[0];
  if (out.length > limit) out = out.slice(0, limit - 1).replace(/\s\S*$/, '') + '…';
  return out;
}
