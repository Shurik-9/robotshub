import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.js';

export const escapeMarkup = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

export const newsPath = id => `/news/${encodeURIComponent(String(id))}`;

export function renderNewsSitemap(items) {
  const paths = [...new Set(items.map(item => newsPath(item.id)))];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map(p => `  <url><loc>${escapeMarkup(new URL(p, CFG.siteUrl).href)}</loc></url>`).join('\n')}
</urlset>
`;
}

// Reuse the news feed's styles so article pages remain part of the same site.
const feedHtml = fs.readFileSync(path.join(CFG.publicDir, 'news.html'), 'utf8');
const styles = feedHtml.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? '';

export function renderNewsArticle(item) {
  const title = escapeMarkup(item.title);
  const summary = escapeMarkup(item.summary);
  const canonical = escapeMarkup(new URL(newsPath(item.id), CFG.siteUrl).href);
  let source;
  try {
    const url = new URL(item.url);
    if (['https:', 'http:'].includes(url.protocol)) source = escapeMarkup(url.href);
  } catch { /* Invalid legacy source URLs must not become executable links. */ }
  return `<!DOCTYPE html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | Железный аргумент</title>
<meta name="description" content="${summary}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${summary}">
<meta property="og:url" content="${canonical}">
${styles}
<link rel="stylesheet" href="/brand/brand.css">
</head><body>
<header class="topbar"><div class="wrap topbar-in">
<a class="site-brand" href="/" aria-label="Центр подбора роботизации «Железный аргумент»"><img src="/brand/logo.jpg" alt="" width="40" height="40"><span><strong>Железный аргумент</strong><small>Центр подбора роботизации</small></span></a>
<a class="navlink" href="/news">Все новости →</a>
</div></header>
<main class="wrap"><article class="hero">
<h1>${title}</h1>
<p class="hero-sub">${summary}</p>
<p class="card-foot">Источник: ${source ? `<a href="${source}" target="_blank" rel="noopener nofollow">${escapeMarkup(item.source_name || 'Оригинальная публикация')} →</a>` : escapeMarkup(item.source_name)}</p>
</article></main>
<footer><div class="wrap foot-note">Короткое саммари со ссылкой на первоисточник. Права на оригинальный текст принадлежат его издателю.</div></footer>
</body></html>`;
}
