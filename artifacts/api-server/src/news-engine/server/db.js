import Database from 'better-sqlite3';
import fs from 'node:fs';
import { CFG } from './config.js';

fs.mkdirSync(CFG.dataDir, { recursive: true });

export const db = new Database(CFG.dbFile);
db.pragma('journal_mode = WAL');

// The same visibility rule as /api/news. Source dates/fetch times are NOT
// modification dates, so sitemap queries deliberately do not select them.
export function getPublishedNewsSitemapItems() {
  return db.prepare("SELECT id FROM items WHERE status='published' ORDER BY id").all();
}

export function getPublishedNewsItem(id) {
  return db.prepare("SELECT * FROM items WHERE id=? AND status='published'").get(id);
}

db.exec(`
CREATE TABLE IF NOT EXISTS sources(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'rss',
  category TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  last_status TEXT DEFAULT '',
  last_ok_at TEXT,
  last_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER,
  source_name TEXT DEFAULT '',
  source_url TEXT DEFAULT '',
  url TEXT UNIQUE,
  url_key TEXT,
  title_key TEXT,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  category TEXT DEFAULT 'other',
  tags TEXT DEFAULT '[]',
  item_date TEXT,
  score INTEGER DEFAULT 0,
  fetched_at TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status, item_date DESC);
CREATE INDEX IF NOT EXISTS idx_items_cat ON items(category, item_date DESC);
CREATE TABLE IF NOT EXISTS runs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT, finished_at TEXT,
  stats TEXT DEFAULT '{}', log TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);

-- ===== Этап 2: кабинеты вендоров/интеграторов =====
CREATE TABLE IF NOT EXISTS orgs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'vendor',        -- vendor | integrator | platform
  tariff TEXT DEFAULT 'trial',                -- trial | start | growth | partner
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'vendor',        -- admin | vendor | integrator
  created_at TEXT DEFAULT (datetime('now')),
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS solution_claims(
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  solution_id TEXT NOT NULL,
  status TEXT DEFAULT 'approved',             -- pending | approved | revoked
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(org_id, solution_id)
);
CREATE TABLE IF NOT EXISTS solution_drafts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solution_id TEXT NOT NULL,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  payload TEXT NOT NULL,                      -- JSON: предложенные поля (allowlist)
  status TEXT DEFAULT 'pending',              -- pending | approved | rejected
  review_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS leads(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solution_id TEXT, org_id INTEGER,
  contact TEXT, object_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  given_at TEXT, status TEXT DEFAULT 'new'
);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solution_id TEXT NOT NULL,
  type TEXT NOT NULL,                         -- view | click | lead
  ts TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_sol ON events(solution_id, ts);
`);

const SEED = JSON.parse(fs.readFileSync(new URL('./keywords.json', import.meta.url), 'utf-8'));

export function getSettings() {
  const defaults = {
    auto_publish: 1,
    window_days: 10,
    max_per_run: 40,
    dup_threshold: 0.55,
    include: SEED.include,
    exclude: SEED.exclude,
    core: SEED.core,
    categories: SEED.categories,
    models: SEED.models,
    rex: SEED.rex || [],
    geo: SEED.geo || [],
    civil: SEED.civil || [],
  };
  const row = db.prepare("SELECT value FROM settings WHERE key='config'").get();
  if (row) { try { Object.assign(defaults, JSON.parse(row.value)); } catch {} }
  return defaults;
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  db.prepare("INSERT INTO settings(key,value) VALUES('config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify(next));
  return next;
}

export function seedSources() {
  const n = db.prepare('SELECT COUNT(*) c FROM sources').get().c;
  if (n > 0) return;
  const ins = db.prepare('INSERT OR IGNORE INTO sources(name,url,type,category,enabled) VALUES(?,?,?,?,?)');
  for (const s of SEED.sources) ins.run(s.name, s.url, s.type, s.category || '', s.enabled === false ? 0 : 1);
}

// Миграция правил до версии 2: перезаписывает старые слабые списки, прячет
// старую непроверенную ленту и выключает общие ленты агентств.
export function migrateRulesV2() {
  const row = db.prepare("SELECT value FROM settings WHERE key='config'").get();
  let saved = {}; try { saved = row ? JSON.parse(row.value) : {}; } catch {}
  if ((saved.config_version || 1) >= 2) return;
  saved.config_version = 2;
  saved.core = SEED.core; saved.include = SEED.include; saved.exclude = SEED.exclude;
  saved.rex = SEED.rex || []; saved.geo = SEED.geo || []; saved.civil = SEED.civil || [];
  saved.categories = SEED.categories; saved.models = SEED.models;
  db.prepare("INSERT INTO settings(key,value) VALUES('config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify(saved));
  db.prepare("UPDATE items SET status='hidden' WHERE status='published'").run();
  db.prepare("UPDATE sources SET enabled=0 WHERE url LIKE '%tass.ru%' OR url LIKE '%lenta.ru%'").run();
}
