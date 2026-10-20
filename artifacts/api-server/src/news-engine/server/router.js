import express from 'express';
import path from 'node:path';
import { CFG, requireToken } from './config.js';
import { db, getSettings, saveSettings, seedSources, migrateRulesV2, getPublishedNewsSitemapItems, getPublishedNewsItem } from './db.js';
import { renderNewsSitemap, renderNewsArticle } from './news-seo.js';
import { startRun, LAST_RUN } from './crawler.js';
import { createCabinetRouter } from './cabinet.js';
import { createLeadsRouter } from './leads.js';

export function createNewsRouter() {
  seedSources();
  migrateRulesV2();
  const r = express.Router();
  r.use(createCabinetRouter());   // этап 2: кабинеты вендоров/интеграторов
  r.use(createLeadsRouter());     // этап 3: лиды «Запросить КП»
  const CAT_OTHER = { key: 'other', label: 'Другое' };

  function catLabel(settings, key) {
    const c = (settings.categories || []).find(c => c.key === key);
    return c ? c.label : CAT_OTHER.label;
  }
  function publicItem(row, settings) {
    let tags = [];
    try { tags = JSON.parse(row.tags || '[]'); } catch {}
    return {
      id: row.id, title: row.title, summary: row.summary, url: row.url,
      source_name: row.source_name, source_url: row.source_url,
      item_date: row.item_date, category: row.category,
      category_label: catLabel(settings, row.category), tags,
    };
  }

  /* ---------- публичное API ---------- */
  r.get('/api/news', (req, res) => {
    const settings = getSettings();
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const cat = String(req.query.category || '');
    const q = String(req.query.q || '').trim();
    let where = "status='published'"; const args = [];
    if (cat && cat !== 'all') { where += ' AND category=?'; args.push(cat); }
    if (q) { where += ' AND (title LIKE ? OR summary LIKE ?)'; args.push('%' + q + '%', '%' + q + '%'); }
    const total = db.prepare(`SELECT COUNT(*) c FROM items WHERE ${where}`).get(...args).c;
    const rows = db.prepare(`SELECT * FROM items WHERE ${where} ORDER BY item_date DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, offset);
    res.json({ total, items: rows.map(x => publicItem(x, settings)) });
  });

  r.get('/api/news/meta', (_req, res) => {
    const settings = getSettings();
    const counts = db.prepare("SELECT category, COUNT(*) c FROM items WHERE status='published' GROUP BY category").all();
    const cats = (settings.categories || []).map(c => ({ key: c.key, label: c.label, count: 0 }));
    cats.push({ ...CAT_OTHER, count: 0 });
    for (const row of counts) {
      const c = cats.find(c => c.key === row.category);
      if (c) c.count += row.c;
    }
    res.json({ categories: cats.filter(c => c.count > 0) });
  });

  /* ---------- админ: сбор ---------- */
  r.post('/api/news/run', requireToken, (req, res) => {
    const id = startRun();
    if (!id) return res.status(409).json({ error: 'Сбор уже выполняется' });
    res.json({ runId: id });
  });
  r.get('/api/news/status', requireToken, (_req, res) => res.json(LAST_RUN));

  /* ---------- админ: модерация ---------- */
  r.get('/api/news/items', requireToken, (req, res) => {
    const state = ['pending', 'published', 'hidden', 'all'].includes(req.query.state) ? req.query.state : 'pending';
    const where = state === 'all' ? '1=1' : 'status=?';
    const rows = db.prepare(`SELECT * FROM items WHERE ${where} ORDER BY item_date DESC, id DESC LIMIT 150`)
      .all(...(state === 'all' ? [] : [state]));
    res.json({ items: rows });
  });
  r.post('/api/news/items/:id/status', requireToken, (req, res) => {
    const st = String(req.body.status || '');
    if (!['pending', 'published', 'hidden'].includes(st)) return res.status(400).json({ error: 'bad status' });
    if (st === 'published') {
      const item = db.prepare('SELECT summary FROM items WHERE id=?').get(req.params.id);
      if (item && !String(item.summary || '').trim()) {
        return res.status(409).json({ error: 'Нельзя опубликовать карточку без подзаголовка' });
      }
    }
    db.prepare('UPDATE items SET status=? WHERE id=?').run(st, req.params.id);
    res.json({ ok: true });
  });
  r.post('/api/news/items/:id/edit', requireToken, (req, res) => {
    const title = String(req.body.title || '').slice(0, 300);
    const summary = String(req.body.summary || '').slice(0, 1200);
    const item = db.prepare('SELECT status FROM items WHERE id=?').get(req.params.id);
    if (item?.status === 'published' && !summary.trim()) {
      return res.status(409).json({ error: 'У опубликованной карточки должен быть подзаголовок' });
    }
    db.prepare('UPDATE items SET title=?, summary=? WHERE id=?').run(title, summary, req.params.id);
    res.json({ ok: true });
  });
  r.delete('/api/news/items/:id', requireToken, (req, res) => {
    db.prepare('DELETE FROM items WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  /* ---------- админ: источники ---------- */
  r.get('/api/news/sources', requireToken, (_req, res) => {
    res.json({ sources: db.prepare('SELECT * FROM sources ORDER BY enabled DESC, id').all() });
  });
  r.post('/api/news/sources', requireToken, (req, res) => {
    const { name, url, type = 'rss', category = '' } = req.body || {};
    if (!name || !url) return res.status(400).json({ error: 'Нужны name и url' });
    if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: 'URL должен начинаться с http(s)://' });
    try {
      db.prepare('INSERT INTO sources(name,url,type,category) VALUES(?,?,?,?)').run(name, url, type === 'gnews' ? 'gnews' : 'rss', category);
      res.json({ ok: true });
    } catch (e) { res.status(409).json({ error: 'Такой источник уже есть' }); }
  });
  r.patch('/api/news/sources/:id', requireToken, (req, res) => {
    const { enabled } = req.body || {};
    if (enabled === undefined) return res.status(400).json({ error: 'передайте enabled' });
    db.prepare('UPDATE sources SET enabled=? WHERE id=?').run(enabled ? 1 : 0, req.params.id);
    res.json({ ok: true });
  });
  r.delete('/api/news/sources/:id', requireToken, (req, res) => {
    db.prepare('DELETE FROM sources WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  /* ---------- админ: настройки ---------- */
  r.get('/api/news/settings', requireToken, (_req, res) => {
    const s = getSettings();
    res.json({ auto_publish: s.auto_publish, window_days: s.window_days, max_per_run: s.max_per_run,
               dup_threshold: s.dup_threshold,
               include: s.include, exclude: s.exclude, core: s.core, models: s.models });
  });
  r.post('/api/news/settings', requireToken, (req, res) => {
    const patch = {};
    for (const k of ['auto_publish', 'window_days', 'max_per_run']) if (k in req.body) patch[k] = Number(req.body[k]) || 0;
    if ('dup_threshold' in req.body) patch.dup_threshold = Math.min(0.95, Math.max(0.3, Number(req.body.dup_threshold) || 0.55));
    for (const k of ['include', 'exclude', 'core', 'models']) if (k in req.body) patch[k] = String(req.body[k]).split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    saveSettings(patch);
    res.json({ ok: true });
  });

  /* ---------- статические страницы ---------- */
  // Must precede /news/:id; /news is already routed to this artifact.
  // No cached snapshot: publishing, hiding and deletion apply on the next GET.
  r.get('/news/sitemap.xml', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.type('application/xml').send(renderNewsSitemap(getPublishedNewsSitemapItems()));
  });
  r.get('/news/:id', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = req.params.id;
    const item = /^[1-9]\d*$/.test(id) ? getPublishedNewsItem(id) : undefined;
    if (!item) return res.status(404).set('X-Robots-Tag', 'noindex').send('Новость не найдена');
    res.type('html').send(renderNewsArticle(item));
  });
  r.get('/news', (_req, res) => res.sendFile(path.join(CFG.publicDir, 'news.html')));
  r.get('/admin-news', (_req, res) => res.sendFile(path.join(CFG.publicDir, 'admin-news.html')));

  return r;
}
