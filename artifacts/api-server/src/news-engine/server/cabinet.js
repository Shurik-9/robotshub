// Этап 2: кабинеты вендоров/интеграторов.
// Auth (bcrypt + httpOnly-сессии в БД), заявки на карточки каталога,
// драфты правок с модерацией, статистика просмотров. Админ-API: токен ИЛИ сессия админа.
import express from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { CFG } from './config.js';
import { getSolution, searchSolutions, applyDraft, EDITABLE } from './catalog.js';
import path from 'node:path';

const COOKIE = 'rsh_session';
const DAY = 86400;

/* ---------- сессии ---------- */
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); // одна активная сессия
  const exp = new Date(Date.now() + 30 * DAY * 1000).toISOString();
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, userId, exp);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * DAY}`);
}
function currentUser(req) {
  const t = parseCookies(req)[COOKIE];
  if (!t) return null;
  const row = db.prepare(`
    SELECT s.expires_at, u.id uid, u.email, u.role, u.org_id,
           o.name org_name, o.type org_type, o.tariff
    FROM sessions s JOIN users u ON u.id = s.user_id JOIN orgs o ON o.id = u.org_id
    WHERE s.token = ?`).get(t);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) { db.prepare('DELETE FROM sessions WHERE token=?').run(t); return null; }
  return row;
}
export function requireUser(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Требуется вход' });
  req.u = u; next();
}
function isAdminReq(req) {
  if (CFG.adminToken && (req.headers['x-admin-token'] || '') === CFG.adminToken) return true;
  const u = currentUser(req);
  return !!(u && u.role === 'admin');
}
export function requireAdmin(req, res, next) {
  if (!isAdminReq(req)) return res.status(401).json({ error: 'Нет доступа' });
  next();
}

/* ---------- rate limit для /auth/*: 20 попыток / 5 мин / IP ---------- */
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || '?';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 5 * 60000);
  if (arr.length >= 20) return res.status(429).json({ error: 'Слишком много попыток — подождите пару минут' });
  arr.push(now); hits.set(ip, arr); next();
}

/* ---------- валидация payload правок ---------- */
function cleanPayload(b) {
  const p = []; const errs = [];
  const src = b || {};
  if (src.price_rub !== undefined) {
    const v = Number(src.price_rub);
    if (!isFinite(v) || v < 0 || v > 5e9) errs.push('price_rub: некорректная цена');
    else p.push(['price_rub', Math.round(v)]);
  }
  const limits = { description: 4000, case_study: 1500, scenario: 200, region: 120, industry: 120, img: 400 };
  for (const [k, lim] of Object.entries(limits)) {
    if (src[k] === undefined) continue;
    const v = String(src[k]).trim();
    if (v === '') continue;                     // пустое поле = «без изменений», а не «стереть»
    if (v.length > lim) errs.push(`${k}: не длиннее ${lim} знаков`);
    else if (k === 'img' && !/^https?:\/\//.test(v)) errs.push('img: только http(s):// ссылка');
    else p.push([k, v]);
  }
  if (src.bullets !== undefined) {
    if (!Array.isArray(src.bullets)) errs.push('bullets: ожидается список');
    else {
      const bl = src.bullets.map(x => String(x).trim()).filter(Boolean).slice(0, 8);
      if (bl.some(x => x.length > 220)) errs.push('bullets: пункт длиннее 220 знаков');
      else if (bl.length) p.push(['bullets', bl]);   // пустой список = «без изменений»
    }
  }
  if (!errs.length && !p.length) errs.push('Пустая правка');
  return { payload: Object.fromEntries(p), errs };
}

/* ---------- дифф драфта для админа ---------- */
function draftWithDiff(row) {
  const sol = getSolution(row.solution_id);
  let payload = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch {}
  const diff = [];
  for (const k of EDITABLE) {
    if (payload[k] === undefined) continue;
    const fmt = v => k === 'bullets' ? (Array.isArray(v) ? v.join(' | ') : '') : String(v ?? '');
    const cur = sol ? fmt(sol[k]) : '(решение исчезло из каталога)';
    const prop = fmt(payload[k]);
    if (cur !== prop) diff.push({ field: k, current: cur, proposed: prop });
  }
  return {
    id: row.id, solution_id: row.solution_id, status: row.status,
    org_name: row.org_name, org_id: row.org_id,
    created_at: row.created_at, reviewed_at: row.reviewed_at, review_note: row.review_note,
    solution_name: sol ? sol.name : '(не найдено в каталоге)',
    diff,
  };
}

/* ---------- seed админ-пользователя из env ---------- */
export function seedAdminUser() {
  const email = String(process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const pass = process.env.ADMIN_PASSWORD;
  if (!email || !pass) return;
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return;
  let org = db.prepare("SELECT id FROM orgs WHERE type='platform'").get();
  const orgId = org ? org.id
    : db.prepare("INSERT INTO orgs(name,type,tariff) VALUES('Железный аргумент','platform','—')").run().lastInsertRowid;
  db.prepare('INSERT INTO users(org_id,email,password_hash,role) VALUES(?,?,?,?)')
    .run(orgId, email, bcrypt.hashSync(pass, 10), 'admin');
  console.log('cabinet: создан админ-пользователь', email);
}

/* ---------- роутер ---------- */
export function createCabinetRouter() {
  seedAdminUser();
  const r = express.Router();

  /* ===== публичное: трекинг просмотров (без PII) ===== */
  r.post('/api/cabinet/track', (req, res) => {
    const id = String(req.body?.solution_id || '').slice(0, 64);
    const type = ['view', 'click'].includes(req.body?.type) ? req.body.type : 'view';
    if (!id) return res.status(400).json({ error: 'solution_id обязателен' });
    db.prepare('INSERT INTO events(solution_id,type) VALUES(?,?)').run(id, type);
    res.json({ ok: true });
  });

  /* ===== auth ===== */
  r.post('/api/cabinet/auth/register', rateLimit, (req, res) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const pass = String(req.body?.password || '');
    const orgName = String(req.body?.org_name || '').trim();
    const role = req.body?.role === 'integrator' ? 'integrator' : 'vendor';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Некорректный e-mail' });
    if (pass.length < 8) return res.status(400).json({ error: 'Пароль — минимум 8 символов' });
    if (orgName.length < 2 || orgName.length > 120) return res.status(400).json({ error: 'Название компании: 2–120 знаков' });
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'Такой e-mail уже зарегистрирован' });
    const orgId = db.prepare('INSERT INTO orgs(name,type,tariff) VALUES(?,?,?)').run(orgName, role, 'trial').lastInsertRowid;
    const uid = db.prepare('INSERT INTO users(org_id,email,password_hash,role) VALUES(?,?,?,?)')
      .run(orgId, email, bcrypt.hashSync(pass, 10), role).lastInsertRowid;
    startSession(res, uid);
    res.json({ ok: true, org_id: orgId });
  });

  r.post('/api/cabinet/auth/login', rateLimit, (req, res) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const user = db.prepare('SELECT id, password_hash FROM users WHERE email=?').get(email);
    if (!user || !bcrypt.compareSync(String(req.body?.password || ''), user.password_hash))
      return res.status(401).json({ error: 'Неверный e-mail или пароль' });
    startSession(res, user.id);
    db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(new Date().toISOString(), user.id);
    res.json({ ok: true });
  });

  r.post('/api/cabinet/auth/logout', (req, res) => {
    const t = parseCookies(req)[COOKIE];
    if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(t);
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  r.get('/api/cabinet/auth/me', (req, res) => {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ error: 'Требуется вход' });
    res.json({ email: u.email, role: u.role, org: { id: u.org_id, name: u.org_name, type: u.org_type, tariff: u.tariff } });
  });

  /* ===== кабинет вендора/интегратора ===== */
  r.get('/api/cabinet/solutions', requireUser, (req, res) => {
    const claims = db.prepare(`SELECT solution_id, status, created_at FROM solution_claims WHERE org_id=? ORDER BY created_at DESC`).all(req.u.org_id);
    const items = claims.map(c => {
      const s = getSolution(c.solution_id);
      return {
        solution_id: c.solution_id, claim_status: c.status,
        name: s ? s.name : '(не найдено)', price_rub: s ? s.price_rub : null,
        img: s ? (s.img || null) : null, description: s ? s.description : '',
      };
    });
    res.json({ items });
  });

  r.put('/api/cabinet/solutions/:id', requireUser, (req, res) => {
    const claim = db.prepare(`SELECT 1 FROM solution_claims WHERE org_id=? AND solution_id=? AND status='approved'`)
      .get(req.u.org_id, req.params.id);
    if (!claim) return res.status(403).json({ error: 'Это решение не закреплено за вашей организацией' });
    if (!getSolution(req.params.id)) return res.status(404).json({ error: 'Решение не найдено в каталоге' });
    const { payload, errs } = cleanPayload(req.body);
    if (errs.length) return res.status(400).json({ error: errs.join('; ') });
    const open = db.prepare(`SELECT id FROM solution_drafts WHERE org_id=? AND solution_id=? AND status='pending'`).get(req.u.org_id, req.params.id);
    if (open) return res.status(409).json({ error: 'У вас уже есть правка на рассмотрении по этой карточке' });
    const id = db.prepare('INSERT INTO solution_drafts(solution_id,org_id,payload) VALUES(?,?,?)')
      .run(req.params.id, req.u.org_id, JSON.stringify(payload)).lastInsertRowid;
    res.json({ ok: true, draft_id: id });
  });

  r.get('/api/cabinet/drafts', requireUser, (req, res) => {
    const rows = db.prepare(`SELECT d.*, o.name org_name FROM solution_drafts d JOIN orgs o ON o.id=d.org_id
                             WHERE d.org_id=? ORDER BY d.id DESC LIMIT 50`).all(req.u.org_id);
    res.json({ items: rows.map(draftWithDiff) });
  });

  r.get('/api/cabinet/stats', requireUser, (req, res) => {
    const ids = db.prepare(`SELECT solution_id FROM solution_claims WHERE org_id=? AND status='approved'`).all(req.u.org_id).map(x => x.solution_id);
    const per = ids.map(id => {
      const views = db.prepare(`SELECT COUNT(*) c FROM events WHERE solution_id=? AND type='view' AND ts > datetime('now','-30 days')`).get(id).c;
      const s = getSolution(id);
      return { solution_id: id, name: s ? s.name : id, views_30d: views };
    }).sort((a, b) => b.views_30d - a.views_30d);
    const leads_total = db.prepare(`SELECT COUNT(*) c FROM leads WHERE org_id=? AND status IN ('given','closed')`)
      .get(req.u.org_id).c;
    res.json({ total_views_30d: per.reduce((a, x) => a + x.views_30d, 0), leads_total, per });
  });

  /* ===== админ: модерация драфтов ===== */
  r.get('/api/cabinet/admin/drafts', requireAdmin, (req, res) => {
    const st = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
    const rows = db.prepare(`SELECT d.*, o.name org_name FROM solution_drafts d JOIN orgs o ON o.id=d.org_id
                             WHERE d.status=? ORDER BY d.id DESC LIMIT 100`).all(st);
    res.json({ items: rows.map(draftWithDiff) });
  });

  r.post('/api/cabinet/admin/drafts/:id/approve', requireAdmin, (req, res) => {
    const d = db.prepare(`SELECT d.*, o.name org_name FROM solution_drafts d JOIN orgs o ON o.id=d.org_id WHERE d.id=?`).get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Драфт не найден' });
    if (d.status !== 'pending') return res.status(409).json({ error: 'Драфт уже рассмотрен' });
    let payload; try { payload = JSON.parse(d.payload); } catch { return res.status(500).json({ error: 'Битый payload' }); }
    try { applyDraft(d.solution_id, payload); }
    catch (e) { return res.status(409).json({ error: e.message }); }
    db.prepare(`UPDATE solution_drafts SET status='approved', reviewed_at=? WHERE id=?`).run(new Date().toISOString(), d.id);
    res.json({ ok: true });
  });

  r.post('/api/cabinet/admin/drafts/:id/reject', requireAdmin, (req, res) => {
    const d = db.prepare('SELECT * FROM solution_drafts WHERE id=?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Драфт не найден' });
    if (d.status !== 'pending') return res.status(409).json({ error: 'Драфт уже рассмотрен' });
    const note = String(req.body?.note || '').slice(0, 500);
    db.prepare(`UPDATE solution_drafts SET status='rejected', review_note=?, reviewed_at=? WHERE id=?`)
      .run(note, new Date().toISOString(), d.id);
    res.json({ ok: true });
  });

  /* ===== админ: организации и закрепления ===== */
  r.get('/api/cabinet/admin/orgs', requireAdmin, (_req, res) => {
    const orgs = db.prepare(`
      SELECT o.*,
        (SELECT GROUP_CONCAT(email, ', ') FROM users u WHERE u.org_id=o.id) emails,
        (SELECT COUNT(*) FROM solution_claims c WHERE c.org_id=o.id AND c.status='approved') claims
      FROM orgs o ORDER BY o.id DESC LIMIT 200`).all();
    res.json({ orgs });
  });
  r.post('/api/cabinet/admin/orgs', requireAdmin, (req, res) => {
    const name = String(req.body?.name || '').trim();
    const type = ['vendor', 'integrator'].includes(req.body?.type) ? req.body.type : 'vendor';
    const tariff = ['trial', 'start', 'growth', 'partner'].includes(req.body?.tariff) ? req.body.tariff : 'trial';
    if (name.length < 2) return res.status(400).json({ error: 'Название слишком короткое' });
    const id = db.prepare('INSERT INTO orgs(name,type,tariff) VALUES(?,?,?)').run(name, type, tariff).lastInsertRowid;
    res.json({ ok: true, id });
  });
  r.patch('/api/cabinet/admin/orgs/:id', requireAdmin, (req, res) => {
    const o = db.prepare('SELECT id FROM orgs WHERE id=?').get(req.params.id);
    if (!o) return res.status(404).json({ error: 'Организация не найдена' });
    if (req.body?.tariff && ['trial', 'start', 'growth', 'partner'].includes(req.body.tariff))
      db.prepare('UPDATE orgs SET tariff=? WHERE id=?').run(req.body.tariff, o.id);
    if (req.body?.name && String(req.body.name).trim().length >= 2)
      db.prepare('UPDATE orgs SET name=? WHERE id=?').run(String(req.body.name).trim().slice(0, 120), o.id);
    res.json({ ok: true });
  });
  r.post('/api/cabinet/admin/claims', requireAdmin, (req, res) => {
    const orgId = Number(req.body?.org_id), sid = String(req.body?.solution_id || '');
    const action = req.body?.action || 'approve';
    if (!db.prepare('SELECT id FROM orgs WHERE id=?').get(orgId)) return res.status(404).json({ error: 'Организация не найдена' });
    if (!getSolution(sid)) return res.status(404).json({ error: 'Решение не найдено в каталоге' });
    if (action === 'revoke') {
      db.prepare(`UPDATE solution_claims SET status='revoked' WHERE org_id=? AND solution_id=?`).run(orgId, sid);
      return res.json({ ok: true });
    }
    db.prepare(`INSERT INTO solution_claims(org_id,solution_id,status) VALUES(?,?,'approved')
                ON CONFLICT(org_id,solution_id) DO UPDATE SET status='approved'`).run(orgId, sid);
    res.json({ ok: true });
  });
  r.get('/api/cabinet/admin/search-solutions', requireAdmin, (req, res) => {
    res.json({ items: searchSolutions(req.query.q || '') });
  });

  /* ===== страница кабинета ===== */
  r.get('/cabinet', (_req, res) => res.sendFile(path.join(CFG.publicDir, 'cabinet.html')));

  return r;
}
