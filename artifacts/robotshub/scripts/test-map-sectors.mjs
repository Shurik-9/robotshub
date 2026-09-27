import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const catalog = JSON.parse(read('src/data/solutions.json')).items;
const base = JSON.parse(read('public/map/map-data.json'));
const context = { window: {} };
vm.runInNewContext(read('public/map/extra-sectors.js'), context);
const sectors = context.window.MAP_EXTRA_SECTORS(base);
const catalogByRecord = new Map(catalog.map(item => [`${item.id}|${item.industry}`, item]));

test('новые направления не меняют исходные 223 записи и не включают внешний PuduBot', () => {
  assert.equal(base.industries.length, 9);
  assert.equal(base.industries.reduce((sum, item) => sum + item.n, 0), 223);
  assert.equal(catalog.filter(item => item.id !== 'ext-pudubot-2').length, 223);
  assert.deepEqual(Array.from(sectors, item => item.id), ['sector-water', 'sector-mining', 'sector-medicine']);
  assert.deepEqual(Array.from(sectors, item => item.n), [23, 5, 6]);
});

for (const sector of sectors) {
  test(`${sector.label}: записи, статусы, УГТ и цена совпадают с каталогом`, () => {
    assert.equal(new Set(sector.records).size, sector.n, 'повтор одной и той же отраслевой записи');
    const items = sector.records.map(key => {
      const item = catalogByRecord.get(key);
      assert.ok(item, `нет каталожной записи ${key}`);
      assert.notEqual(item.id, 'ext-pudubot-2');
      return item;
    });
    assert.equal(items.length, sector.n);
    assert.equal(new Set(items.map(item => item.id)).size, sector.uniqueModels);
    for (const [field, status] of [['op', 'operation'], ['pil', 'piloting'], ['rnd', 'rnd']]) {
      assert.equal(sector[field], items.filter(item => item.status === status).length);
    }
    assert.equal(sector.op + sector.pil + sector.rnd, sector.n);
    assert.equal(sector.trlAvg, Math.round(items.reduce((sum, item) => sum + item.trl, 0) / items.length * 10) / 10);
    const prices = items.map(item => item.price_rub).filter(Boolean).sort((a, b) => a - b);
    assert.equal(sector.medianPrice, (prices[(prices.length - 1) >> 1] + prices[prices.length >> 1]) / 2);
    assert.equal(sector.mix.reduce((sum, item) => sum + item.n, 0), sector.n);
    assert.equal(sector.origin.reduce((sum, item) => sum + item.n, 0), sector.n);
    for (const group of sector.origin) {
      assert.equal(group.n, items.filter(item => item.industry === (group.id ?? group.name)).length);
    }
  });
}

test('водная группа охватывает все водные сценарии исходного каталога', () => {
  const waterScenario = /подводн|воде|водой|водных|водоём|водоем|акватори|мелковод|морск|речн|гидротех|рыбы/i;
  const matches = catalog.filter(item => item.id !== 'ext-pudubot-2' && waterScenario.test(item.scenario || ''));
  assert.deepEqual(
    new Set(sectors[0].records),
    new Set(matches.map(item => `${item.id}|${item.industry}`)),
  );
});

test('медицина не включает немедицинский вариант TFM-15-8E и не называет ортез протезом', () => {
  const records = sectors[2].records;
  assert.ok(records.includes('5a5b3599-bd64-4330-9bbb-4f8ce7d780b9|Торговля и услуги'));
  assert.ok(records.includes('0aaaa4d1-9ca6-4737-a3d6-92081635402c|Безопасность'));
  assert.ok(!records.includes('ac5b3159-9df0-4911-8cc3-31227a5b3b59|Транспорт и логистика'));
  assert.match(sectors[2].sourceNote, /ортез, не протез/i);
});