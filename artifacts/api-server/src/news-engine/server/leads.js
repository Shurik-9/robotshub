// Этап 3: лиды «Запросить КП».
// Публичная форма (/lead) + API. Поток: заявка -> админ проверяет -> передаёт вендору ->
// вендор видит лид в кабинете. ПДн передаются вендору только после явного «Передать»
// (красная линия стратегии: не передавать персональные данные вне оферты).
import express from 'express';
import path from 'node:path';
import { db } from './db.js';
import { CFG } from './config.js';
import { getSolution } from './catalog.js';
import { requireUser, requireAdmin } from './cabinet.js';

const hits = new Map();
function rateLimit(maxPerHour, windowMs = 3600000) {
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || '?';
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
    if (arr.length >= maxPerHour) return res.status(429).json({ error: 'Слишком много заявок с одного адреса — попробуйте позже' });
    arr.push(now); hits.set(ip, arr); next();
  };
}

function orgForSolution(solutionId) {
  const row = db.prepare(`SELECT org_id FROM solution_claims WHERE solution_id=? AND status='approved' LIMIT 1`)
    .get(solutionId);
  return row ? row.org_id : null;
}

function leadView(row) {
  let contact = {};
  try { contact = JSON.parse(row.contact || '{}'); } catch {}
  const sol = getSolution(row.solution_id);
  return {
    id: row.id, solution_id: row.solution_id,
    solution_name: sol ? sol.name : '(решение удалено из каталога)',
    org_id: row.org_id, org_name: row.org_name || null,
    status: row.status, given_at: row.given_at, created_at: row.created_at,
    name: contact.name || '', company: contact.company || '',
    email: contact.email || '', phone: contact.phone || '', message: contact.message || '',
  };
}

export function createLeadsRouter() {
  const r = express.Router();

  /* ===== публичное: отправка лида ===== */
  r.post('/api/leads', rateLimit(10), (req, res) => {
    const b = req.body || {};
    if (String(b.website || '')) return res.json({ ok: true });   // honeypot — ботам молча «успех»
    const solutionId = String(b.solution_id || '').slice(0, 64);
    const sol = getSolution(solutionId);
    if (!sol) return res.status(404).json({ error: 'Решение не найдено' });
    const name = String(b.name || '').trim().slice(0, 120);
    const email = String(b.email || '').toLowerCase().trim().slice(0, 160);
    const phone = String(b.phone || '').trim().slice(0, 40);
    const company = String(b.company || '').trim().slice(0, 160);
    const message = String(b.message || '').trim().slice(0, 2000);
    if (name.length < 2) return res.status(400).json({ error: 'Укажите имя' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Укажите корректный e-mail' });
    const contact = JSON.stringify({ name, company, email, phone, message });
    const orgId = orgForSolution(solutionId);
    const info = db.prepare('INSERT INTO leads(solution_id,org_id,contact) VALUES(?,?,?)').run(solutionId, orgId, contact);
    db.prepare('INSERT INTO events(solution_id,type) VALUES(?,?)').run(solutionId, 'lead');
    res.json({ ok: true, id: info.lastInsertRowid });
  });

  /* ===== публичное: краткие данные решения для формы заявки (только публичные поля каталога) ===== */
  r.get('/api/cabinet/public/solution', (req, res) => {
    const sol = getSolution(String(req.query.id || ''));
    if (!sol) return res.status(404).json({ error: 'Решение не найдено' });
    const price = sol.price_rub ? Math.round(sol.price_rub).toLocaleString('ru-RU') + ' ₽ (с НДС, без доставки и ПНР)' : null;
    res.json({ name: sol.name || '', price, img: /^https?:\/\//.test(String(sol.img || '')) ? sol.img : null });
  });

  /* ===== страница заявки ===== */
  r.get('/lead', (_req, res) => res.sendFile(path.join(CFG.publicDir, 'lead.html')));

  /* ===== админ: очередь лидов ===== */
  r.get('/api/leads/admin', requireAdmin, (req, res) => {
    const st = ['new', 'given', 'closed', 'spam', 'all'].includes(req.query.status) ? req.query.status : 'all';
    const where = st === 'all' ? '1=1' : 'l.status=?';
    const args = st === 'all' ? [] : [st];
    const rows = db.prepare(`
      SELECT l.*, o.name org_name
      FROM leads l LEFT JOIN orgs o ON o.id = l.org_id
      WHERE ${where} ORDER BY l.id DESC LIMIT 200`).all(...args);
    res.json({ items: rows.map(leadView) });
  });

  r.post('/api/leads/admin/:id/give', requireAdmin, (req, res) => {
    const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Лид не найден' });
    if (!lead.org_id) return res.status(409).json({ error: 'У решения нет закреплённой организации — сначала закрепите карточку за вендором' });
    db.prepare(`UPDATE leads SET status='given', given_at=? WHERE id=?`).run(new Date().toISOString(), lead.id);
    res.json({ ok: true });
  });
  r.post('/api/leads/admin/:id/status', requireAdmin, (req, res) => {
    const lead = db.prepare('SELECT id FROM leads WHERE id=?').get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Лид не найден' });
    const st = String(req.body?.status || '');
    if (!['new', 'closed', 'spam'].includes(st)) return res.status(400).json({ error: 'Недопустимый статус' });
    db.prepare('UPDATE leads SET status=? WHERE id=?').run(st, req.params.id);
    res.json({ ok: true });
  });
  r.delete('/api/leads/admin/:id', requireAdmin, (req, res) => {
    const lead = db.prepare('SELECT id FROM leads WHERE id=?').get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Лид не найден' });
    db.prepare('DELETE FROM leads WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  /* ===== вендор: переданные лиды ===== */
  r.get('/api/cabinet/leads', requireUser, (req, res) => {
    const rows = db.prepare(`
      SELECT l.*, o.name org_name
      FROM leads l LEFT JOIN orgs o ON o.id = l.org_id
      WHERE l.org_id=? AND l.status IN ('given','closed')
      ORDER BY l.id DESC LIMIT 100`).all(req.u.org_id);
    res.json({ items: rows.map(leadView) });
  });

  return r;
}
