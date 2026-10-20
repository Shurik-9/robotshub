import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';

// All mutations target a disposable DB and a test-only token, never live news.
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'news-seo-'));
process.env.NEWS_DATA_DIR = dataDir;
process.env.ADMIN_TOKEN = 'news-seo-test-only';
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD = '';
const { createNewsRouter } = await import('../src/news-engine/server/router.js');
const { db } = await import('../src/news-engine/server/db.js');
const { renderNewsSitemap, escapeMarkup } = await import('../src/news-engine/server/news-seo.js');
const app = express();
app.use(express.json());
app.use(createNewsRouter());
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});
const get = url => fetch(base + url);
const mutate = (id, suffix, body, method = 'POST') => fetch(`${base}/api/news/items/${id}${suffix}`, {
  method, headers: { 'Content-Type': 'application/json', 'x-admin-token': 'news-seo-test-only' },
  body: body ? JSON.stringify(body) : undefined,
});
const locations = xml => [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);

test('only published local pages appear, and visibility changes on the next request', async () => {
  const insert = db.prepare('INSERT INTO items(title,summary,url,status,source_name,item_date) VALUES(?,?,?,?,?,?)');
  const published = Number(insert.run('Робот <script>alert(1)</script> & "новость"', 'Саммари <b>не HTML</b>', 'https://example.org/story?a=1&b=2', 'published', 'Источник & автор', '2026-01-01').lastInsertRowid);
  const pending = Number(insert.run('Pending', 'Summary', 'https://example.org/pending', 'pending', '', null).lastInsertRowid);
  const hidden = Number(insert.run('Hidden', 'Summary', 'https://example.org/hidden', 'hidden', '', null).lastInsertRowid);
  const draft = Number(insert.run('Draft', '', 'https://example.org/draft', 'draft', '', null).lastInsertRowid);
  const sitemap = await get('/news/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get('content-type'), /application\/xml.*utf-8/i);
  assert.equal(sitemap.headers.get('cache-control'), 'no-store');
  const xml = await sitemap.text();
  assert.deepEqual(locations(xml), [`https://robotshub.ru/news/${published}`]);
  assert.doesNotMatch(xml, /lastmod|example\.org|admin|cabinet/);
  const article = await get(`/news/${published}`);
  assert.equal(article.status, 200);
  const html = await article.text();
  assert.match(html, new RegExp(`rel="canonical" href="https://robotshub.ru/news/${published}"`));
  assert.match(html, /&lt;script&gt;alert/);
  assert.match(html, /href="https:\/\/example.org\/story\?a=1&amp;b=2"/);
  assert.doesNotMatch(html, /<script>alert|<b>не HTML/);
  for (const id of [pending, hidden, draft, 99999, '01', 'sitemap-invalid.xml']) {
    const response = await get(`/news/${id}`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
  }
  assert.equal((await mutate(pending, '/status', { status: 'published' })).status, 200);
  assert.equal((await get(`/news/${pending}`)).status, 200);
  assert.equal(locations(await (await get('/news/sitemap.xml')).text()).length, 2);
  assert.equal((await mutate(published, '/status', { status: 'hidden' })).status, 200);
  assert.equal((await get(`/news/${published}`)).status, 404);
  assert.deepEqual(locations(await (await get('/news/sitemap.xml')).text()), [`https://robotshub.ru/news/${pending}`]);
  assert.equal((await mutate(pending, '/status', { status: 'pending' })).status, 200);
  assert.deepEqual(locations(await (await get('/news/sitemap.xml')).text()), []);
  await mutate(pending, '/status', { status: 'published' });
  assert.equal((await mutate(pending, '', null, 'DELETE')).status, 200);
  assert.equal((await get(`/news/${pending}`)).status, 404);
  assert.deepEqual(locations(await (await get('/news/sitemap.xml')).text()), []);
  assert.equal((await get('/news')).status, 200);
  assert.equal((await get('/news/')).status, 200);
});

test('escaping, duplicate elimination, empty maps and safe source links', async () => {
  assert.equal(escapeMarkup('&<>"\''), '&amp;&lt;&gt;&quot;&apos;');
  const xml = renderNewsSitemap([{ id: 1 }, { id: 1 }, { id: 'a?x=1&y=2' }]);
  assert.equal(locations(xml).length, 2);
  assert.match(xml, /a%3Fx%3D1%26y%3D2/);
  assert.match(renderNewsSitemap([]), /<urlset[^>]*>\s*<\/urlset>/);
  const { renderNewsArticle } = await import('../src/news-engine/server/news-seo.js');
  assert.doesNotMatch(renderNewsArticle({ id: 1, title: 'Title', summary: 'Summary', url: 'javascript:alert(1)' }), /href="javascript:/);
});

test('main sitemap indexes both maps and retains catalog/case URLs, not private pages', () => {
  const root = new URL('../../robotshub/', import.meta.url);
  const read = name => readFileSync(new URL(name, root), 'utf8');
  const index = read('public/sitemap.xml');
  assert.match(index, /<sitemapindex /);
  assert.deepEqual(locations(index), ['https://robotshub.ru/sitemap-pages.xml', 'https://robotshub.ru/news/sitemap.xml']);
  const xml = read('public/sitemap-pages.xml');
  const urls = locations(xml);
  assert.equal(new Set(urls).size, urls.length);
  assert.doesNotMatch(xml, /lastmod|\/admin|\/cabinet|\/lead|\/api\//);
  for (const item of JSON.parse(read('src/data/solutions.json')).items) {
    assert.ok(urls.includes(`https://robotshub.ru/solutions/${encodeURIComponent(item.id)}`));
  }
  const caseArray = read('src/pages/cases.tsx').split('export const CASES: CaseStudy[] = [')[1].split('\n];')[0];
  for (const [, id] of caseArray.matchAll(/\bid:\s*["']([^"']+)["']/g)) {
    assert.ok(urls.includes(`https://robotshub.ru/cases/${id}`), `missing case ${id}`);
  }
  assert.ok(urls.includes('https://robotshub.ru/news'));
});
