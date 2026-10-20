import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('src/data/solutions.json', root), 'utf8'));
const audit = JSON.parse(readFileSync(new URL('src/data/catalog-enrichment-audit.json', root), 'utf8'));

test('import is addressed by row, ID, model and company, not duplicate ID alone', () => {
  assert.equal(catalog.items.length, audit.catalog_count);
  assert.equal(new Set(audit.entries.map(entry => entry.card_ref)).size, audit.entries.length);
  for (const entry of audit.entries) {
    const item = catalog.items[entry.row];
    for (const key of ['id', 'name', 'vendor']) assert.equal(item[key], entry[key], entry.card_ref);
    for (const [key, value] of Object.entries(entry.after)) assert.equal(item[key], value, `${entry.card_ref}: ${key}`);
    assert.deepEqual(Object.keys(entry.after), entry.fields);
  }
});

test('only placeholders were replaced, asset bytes match the archive, all local images exist', () => {
  for (const entry of audit.entries.filter(entry => entry.fields.includes('img'))) {
    assert.notEqual(entry.before.img_kind, 'vendor-photo');
    assert.ok(!entry.before.img || !entry.before.img.includes('/real/'));
    assert.equal(entry.after.img_kind, 'catalog-photo');
    const bytes = readFileSync(new URL(`public${entry.after.img}`, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.image_sha256);
    const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.ok(webp || png, `Unsupported image bytes: ${entry.after.img}`);
    if (entry.before.img) assert.ok(existsSync(new URL(`public${entry.before.img}`, root)), 'Original illustration preserved');
  }
  for (const item of catalog.items) {
    if (item.img?.startsWith('/')) assert.ok(existsSync(new URL(`public${item.img}`, root)), item.name);
  }
});

test('only empty or very short descriptions were supplemented, with explicit provenance', () => {
  for (const entry of audit.entries.filter(entry => entry.fields.includes('description'))) {
    assert.ok((entry.before.description || '').trim().length < 20, entry.name);
    assert.ok(entry.after.description.trim().length >= 20, entry.name);
    assert.ok(['primary-purpose-checked', 'secondary-only'].includes(entry.description_source.status));
    assert.ok(entry.description_source.url.startsWith('https://'));
  }
});

test('import changes no technical, financial, registry or taxonomy fields', () => {
  const allowed = new Set(['img', 'img_kind', 'img_source', 'img_lowres', 'description']);
  for (const entry of audit.entries) {
    for (const field of entry.fields) assert.ok(allowed.has(field), field);
  }
  assert.ok(!catalog.items.some(item => Object.hasOwn(item, 'in_registry')));
  assert.ok(audit.source_notice.includes('демонстрационный'));
});
