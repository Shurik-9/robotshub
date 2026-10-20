// Сборщик: обходит включённые источники (RSS / Google News RSS),
// фильтрует по ядру темы, дедуплицирует, саммаризирует и складывает в items.
import Parser from 'rss-parser';
import { db, getSettings } from './db.js';
import { CFG } from './config.js';
import { summarize } from './summarizer.js';

const parser = new Parser({
  timeout: CFG.feedTimeoutMs,
  headers: { 'User-Agent': CFG.ua, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
  customFields: { item: [['source', 'source']] },
});

export const LAST_RUN = { id: null, state: 'idle', startedAt: null, finishedAt: null, stats: {}, log: [] };

function log(msg) {
  LAST_RUN.log.push(new Date().toISOString().slice(11, 19) + ' ' + msg);
  if (LAST_RUN.log.length > 300) LAST_RUN.log.shift();
}

function normalizeUrl(u) {
  try {
    const url = new URL(u.trim());
    for (const p of [...url.searchParams.keys()]) if (p.startsWith('utm_') || p === 'yclid' || p === 'gclid') url.searchParams.delete(p);
    url.hash = '';
    return url.toString();
  } catch { return (u || '').trim(); }
}

function titleKey(t) {
  return String(t || '').toLowerCase().replace(/[«»"'.,:;!?()\[\]{}]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// кластеризация заголовков: слова -> префиксы до 7 символов (компенсирует падежи),
// коэффициент перекрытия |A∩B|/min(|A|,|B|) ловит одинаковые новости у 10 ретрансляторов
function titleTokens(t) {
  return new Set((String(t).toLowerCase().match(/[a-zа-яё0-9]+/g) || [])
    .filter(w => w.length >= 3).map(w => w.slice(0, 7)));
}
const RECENT_TOKENS = (function () {
  let at = 0, cache = [];
  return {
    get() {
      const now = Date.now();
      if (now - at > 5000) {
        at = now;
        cache = db.prepare("SELECT title FROM items WHERE item_date > datetime('now','-6 days') ORDER BY id DESC LIMIT 400").all()
          .map(r => titleTokens(r.title));
      }
      return cache;
    },
    add(tokens) { cache.push(tokens); },
  };
})();
function looksDuplicate(rawTitle, threshold) {
  const a = titleTokens(rawTitle);
  if (!a.size) return false;
  for (const b of RECENT_TOKENS.get()) {
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    if (inter / Math.min(a.size, b.size) >= threshold) return true;
  }
  return false;
}

function detectCategory(textLow, categories) {
  for (const c of categories) {
    for (const kw of c.kw) if (textLow.includes(kw)) return c.key;
  }
  return 'other';
}

function matchModels(textLow, models) {
  const tags = [];
  for (const m of models || []) {
    if (textLow.includes(String(m).toLowerCase())) {
      tags.push({ label: m, url: '/solutions?q=' + encodeURIComponent(m) });
      if (tags.length >= 3) break;
    }
  }
  return tags;
}

function sourceNameOf(it, feedTitle) {
  let s = it.source;
  if (s) {
    if (typeof s === 'string') return s;
    if (s._ || s['#text'] || s.name) return s._ || s['#text'] || s.name;
  }
  const m = /<font[^>]*6f6f6f[^>]*>([^<]+)<\/font>/i.exec(it.description || '');
  if (m) return m[1].trim();
  try { return new URL(it.link).hostname.replace(/^www\./, ''); } catch { return feedTitle || 'Источник'; }
}

// Google News прячет настоящий URL внутри base64-идентификатора /articles/<id>
function decodeGoogleNewsUrl(link) {
  try {
    const m = /\/articles\/([^?/]+)/.exec(link || '');
    if (!m) return null;
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const s = Buffer.from(b64, 'base64').toString('latin1');
    const u = /(https?:\/\/[^\x00-\x1f\s"\\]+)/.exec(s);
    return u ? u[1] : null;
  } catch { return null; }
}

const ENRICH_UA = 'Mozilla/5.0 (compatible; RobotshubDigest/1.0; +https://robotshub.ru)';
async function fetchOgDescription(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { 'user-agent': ENRICH_UA, accept: 'text/html' }, redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 300000);
    const m = /<meta[^>]+(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']{40,700})["']/i.exec(html)
           || /<meta[^>]+content=["']([^"']{40,700})["'][^>]+(?:property=["']og:description["']|name=["']description["'])/i.exec(html);
    return m ? m[1] : null;
  } catch { return null; } finally { clearTimeout(t); }
}

async function fetchFeed(src) {
  // не-ASCII (кириллица в поисковых запросах) должен быть percent-encoded, иначе node http отклонит путь
  const url = /[^-]/.test(src.url) ? encodeURI(src.url) : src.url;
  const feed = await parser.parseURL(url);
  const feedTitle = feed.title || src.name;
  return (feed.items || []).map(it => ({
    title: (it.title || '').trim(),
    link: (it.link || '').trim(),
    date: it.isoDate || it.pubDate || null,
    text: it['content:encoded'] || it['content:encodedSnippet'] || it.contentSnippet || it.description || '',
    sourceName: sourceNameOf(it, feedTitle),
  }));
}

function processItem(it, src, settings, stats) {
  if (!it.title || !it.link) { stats.filtered++; return; }
  let rawTitle = it.title;
  if (src.type === 'gnews') {
    const m = rawTitle.match(/^(.*)\s+[-\u2013\u2014]\s+(\S[^\n]{2,44})$/);
    if (m && m[1].length > 15) {
      rawTitle = m[1].trim();
      // хвост-рубрика после последнего предложения («...робототехнику. Общество») — срезать
      rawTitle = rawTitle.replace(/([.!?])\s+[А-ЯЁ][а-яё]{2,24}\s*$/, '$1');
    }
  }
  const url = normalizeUrl(it.realUrl || it.link);
  const urlKey = url.toLowerCase();
  const tKey = titleKey(rawTitle);

  // дедупликация: точная по URL + кластерная по заголовкам
  if (db.prepare('SELECT 1 FROM items WHERE url=? LIMIT 1').get(urlKey)) { stats.dup++; return; }
  if (looksDuplicate(rawTitle, settings.dup_threshold || 0.55)) { stats.dup++; return; }

  const titleLow = rawTitle.toLowerCase();
  const fullLow = (rawTitle + ' ' + it.text).toLowerCase();

  // --- РЕЛЕВАНТНОСТЬ v2 ---
  // 1) Гео: Россия/СНГ обязательны — маркер в тексте, либо российский домен источника
  //    без явных иностранных маркеров.
  const foreignHit = /\b(taiwan|taipei|tokyo|beijing|washington|pentagon|kratos|boston dynamics|germany|france|london)\b/i.test(fullLow);
  const geoHit = (settings.geo || []).some(w => fullLow.includes(w))
    || /(^|[\s«"(])рф([,.!?;:\s»")]|$)/.test(fullLow);
  let srcHost = ''; try { srcHost = new URL(src.url).hostname.replace(/^www\./, ''); } catch {}
  const srcRu = /\.(ru|su|by|kz|uz|am)$/i.test(srcHost);
  if (!geoHit && !(srcRu && !foreignHit)) { stats.filtered++; return; }

  // 2) Стоп-слова: простые подстроки + регэкспы (СВО как отдельное слово и военные формулы)
  for (const w of settings.exclude || []) {
    if (fullLow.includes(w)) { stats.filtered++; return; }
  }
  for (const re of settings.rex || []) {
    try { if (new RegExp(re, 'i').test(fullLow)) { stats.filtered++; return; } } catch {}
  }

  // 3) Ядро темы: обязательно в заголовке; если только в тексте — запись почти всегда посторонняя.
  const coreInTitle = (settings.core || []).some(w => titleLow.includes(w));
  if (!coreInTitle) { stats.filtered++; return; }

  // 4) БПЛА/дрон/беспилот без гражданского контекста не публикуем: военная техника
  //    и геополитика дронов — не тема проекта.
  const AERIAL = ['бпла', 'дрон', 'беспилот'];
  const civilCore = (settings.core || []).filter(w => !AERIAL.some(a => w.includes(a) || a.includes(w)));
  const civilCoreHit = civilCore.some(w => titleLow.includes(w));
  const aerialTitle = AERIAL.some(w => titleLow.includes(w));
  if (aerialTitle && !civilCoreHit) {
    const civilCtx = (settings.civil || []).some(w => fullLow.includes(w));
    if (!civilCtx) { stats.filtered++; return; }
  }

  // 5) Окно свежести
  const winDays = settings.window_days || 10;
  let dt = new Date(it.date || Date.now());
  if (isNaN(dt)) dt = new Date();
  if ((Date.now() - dt.getTime()) > winDays * 86400000) { stats.old++; return; }

  // 6) Скоринг: порог отсекает «случайное слово в тексте»
  let score = 0;
  for (const w of settings.include || []) {
    if (titleLow.includes(w)) score += 3;
    else if (fullLow.includes(w)) score += 1;
  }
  const tags = matchModels(fullLow, settings.models);
  if (tags.length) score += 2;
  const textClean = String(it.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const rich = textClean.length >= 220 && textClean.toLowerCase() !== rawTitle.toLowerCase();
  if (rich) score += 3;
  if (score < 3) { stats.filtered++; return; }

  const catKey = detectCategory(fullLow, settings.categories || []);
  const thin = textClean.length < 140;
  let summary = thin ? '' : summarize(rawTitle, it.text, settings, CFG.maxSummaryChars);
  if (summary) {
    const re = new RegExp('^\\s*' + rawTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-\\u2013\\u2014:.]?\\s*');
    if (re.test(summary)) {
      const rest = summary.replace(re, '').trim();
      summary = rest.length >= 60 ? rest : '';
    } else {
      const sk = titleKey(summary);
      if (sk && sk.length >= 30 && tKey.startsWith(sk)) summary = '';
    }
  }
  // Подзаголовок обязателен: без него карточка не публикуется автоматически —
  // уходит в очередь модерации, где подзаголовок добавляет человек.
  const status = settings.auto_publish ? (summary ? 'published' : 'pending') : 'pending';

  try {
    db.prepare(`INSERT INTO items(source_id,source_name,source_url,url,url_key,title_key,title,summary,category,tags,item_date,score,status)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(src.id, it.sourceName || src.name, src.url, url, urlKey, tKey, rawTitle, summary, catKey,
           JSON.stringify(tags), dt.toISOString(), score, status);
    RECENT_TOKENS.add(titleTokens(rawTitle));
    stats.kept++;
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) stats.dup++;
    else { stats.errors++; log('insert error: ' + e.message); }
  }
}

export function startRun() {
  if (LAST_RUN.state === 'running') return null;
  const info = db.prepare('INSERT INTO runs(started_at) VALUES(?)').run(new Date().toISOString());
  LAST_RUN.id = info.lastInsertRowid;
  LAST_RUN.state = 'running';
  LAST_RUN.startedAt = new Date().toISOString();
  LAST_RUN.finishedAt = null;
  LAST_RUN.stats = { sources_ok: 0, sources_fail: 0, fetched: 0, kept: 0, dup: 0, filtered: 0, old: 0, enriched: 0, errors: 0 };
  LAST_RUN.log = [];
  runAsync().catch(e => { log('ФАТАЛЬНО: ' + e.message); LAST_RUN.state = 'error'; });
  return LAST_RUN.id;
}

async function runAsync() {
  const settings = getSettings();
  const sources = db.prepare('SELECT * FROM sources WHERE enabled=1 ORDER BY id').all();
  log(`Старт: ${sources.length} источников, окно ${settings.window_days} дн., автопубликация: ${settings.auto_publish ? 'вкл' : 'выкл'}`);

  for (const src of sources) {
    try {
      const items = await fetchFeed(src);
      LAST_RUN.stats.fetched += items.length;
      let kept0 = LAST_RUN.stats.kept;
      let budget = 80 - LAST_RUN.stats.enriched;
      for (const it of items) {
        // тонкая запись (у gnews в описании только заголовок): расшифровать URL и взять og:description
        if (budget > 0 && String(it.text || '').replace(/<[^>]+>/g, ' ').trim().length < 200) {
          const real = src.type === 'gnews' ? (decodeGoogleNewsUrl(it.link) || it.link) : it.link;
          const desc = await fetchOgDescription(real);
          if (desc) { it.text = desc; it.realUrl = real; LAST_RUN.stats.enriched++; budget--; }
          await new Promise(r => setTimeout(r, 400));
        }
        processItem(it, src, settings, LAST_RUN.stats);
      }
      const added = LAST_RUN.stats.kept - kept0;
      db.prepare("UPDATE sources SET last_status='ok', last_ok_at=?, last_count=? WHERE id=?")
        .run(new Date().toISOString(), added, src.id);
      LAST_RUN.stats.sources_ok++;
      log(`✔ ${src.name}: получено ${items.length}, добавлено ${added}`);
    } catch (e) {
      db.prepare("UPDATE sources SET last_status=? WHERE id=?").run('fail: ' + String(e.message).slice(0, 120), src.id);
      LAST_RUN.stats.sources_fail++;
      log(`✖ ${src.name}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 800)); // вежливая пауза
  }

  // дайджест: топ по скору/дате, но без потопа «эхо-камер» — жадная диверсификация.
  // Повторная история прячется, если уже выбрана похожая (перекрытие заголовков >= digest_diversity).
  const max = settings.max_per_run || 40;
  const diversity = settings.dup_threshold ? Math.min(settings.dup_threshold, 0.45) : 0.45;
  const cands = db.prepare(`SELECT id, title FROM items WHERE status='published' AND fetched_at > datetime('now','-1 hour')
                            ORDER BY score DESC, item_date DESC LIMIT 300`).all();
  const picked = [];
  const hidden = [];
  for (const c of cands) {
    const a = titleTokens(c.title);
    let similar = 0;
    for (const p of picked) {
      let inter = 0;
      for (const x of a) if (p.has(x)) inter++;
      if (inter / Math.min(a.size, p.size) >= diversity) similar++;
    }
    if (similar >= 2) hidden.push(c.id);          // уже есть 2 похожих — это ретрансляция
    else if (picked.length < max) { picked.push(a); }
    else hidden.push(c.id);                        // лимит дайджеста
  }
  for (const id of hidden) db.prepare("UPDATE items SET status='hidden' WHERE id=?").run(id);
  const st = LAST_RUN.stats;
  st.digest = picked.length;
  log(`Дайджест: отобрано ${picked.length}, спрятано как повторы/лимит: ${hidden.length}`);

  LAST_RUN.state = 'done';
  LAST_RUN.finishedAt = new Date().toISOString();
  db.prepare('UPDATE runs SET finished_at=?, stats=?, log=? WHERE id=?')
    .run(LAST_RUN.finishedAt, JSON.stringify(LAST_RUN.stats), LAST_RUN.log.join('\n'), LAST_RUN.id);
  log(`Готово: добавлено ${st.kept}, дубли ${st.dup}, отфильтровано ${st.filtered}, источников ok/fail: ${st.sources_ok}/${st.sources_fail}`);
}
