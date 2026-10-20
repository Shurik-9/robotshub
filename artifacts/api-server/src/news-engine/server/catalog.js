// Адаптер каталога solutions.json: чтение + применение одобренных драфтов вендоров.
// Правки идут атомарно (tmp+rename), с бэкапом прежней версии в .data/catalog-backups/.
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.js';

// Что вендор может менять. name/vendor/category/kind — не правятся никем.
export const EDITABLE = ['price_rub', 'description', 'case_study', 'scenario', 'region', 'industry', 'img', 'bullets'];

function file() {
  return process.env.CATALOG_FILE || path.join(CFG.root, 'data', 'solutions.json');
}

export function readCatalog() {
  const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
  return raw;
}

export function getSolution(id) {
  const raw = readCatalog();
  return (raw.items || []).find(x => String(x.id) === String(id)) || null;
}

export function searchSolutions(q, limit = 8) {
  const s = String(q || '').toLowerCase().trim();
  const items = readCatalog().items || [];
  return items
    .filter(x => !s || String(x.name).toLowerCase().includes(s) || String(x.id) === s)
    .slice(0, limit)
    .map(x => ({ id: x.id, name: x.name, price_rub: x.price_rub, img: x.img || null }));
}

export function applyDraft(id, payload) {
  const raw = readCatalog();
  if (!Array.isArray(raw.items)) throw new Error('Каталог имеет неожиданный формат (нет items)');
  const it = raw.items.find(x => String(x.id) === String(id));
  if (!it) throw new Error('Решение не найдено в каталоге');
  for (const k of EDITABLE) {
    if (payload[k] === undefined) continue;
    it[k] = k === 'bullets' ? payload[k].slice(0, 8) : payload[k];
  }
  if (raw.count !== undefined) raw.count = raw.items.length;
  raw.updated = new Date().toISOString().slice(0, 10);

  const bakDir = path.join(CFG.dataDir, 'catalog-backups');
  fs.mkdirSync(bakDir, { recursive: true });
  try { fs.copyFileSync(file(), path.join(bakDir, 'solutions-' + Date.now() + '.json')); } catch {}

  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2));
  fs.renameSync(tmp, file());
  return it;
}
