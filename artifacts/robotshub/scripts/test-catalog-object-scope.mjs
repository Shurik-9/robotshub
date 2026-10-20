import assert from 'node:assert/strict';
import { test } from 'node:test';
import solutions from '../src/data/solutions.json' with { type: 'json' };
import { matchesWarehouseCatalog, warehouseCatalogPriority } from '../src/lib/catalogObjectScope.ts';

test('склад исключает воздушную, водную, пассажирскую и патрульную логистику', () => {
  const unrelated = solutions.items.filter(s =>
    /Херсонес|Барабулька|Геоскан 701|Supercam X4|Беспилотное такси|Львёнок|Роботизированная система патрулирования|MARTin|Тьюбот/.test(s.name));
  assert.ok(unrelated.length >= 7);
  for (const solution of unrelated) assert.equal(matchesWarehouseCatalog([solution]), false, solution.name);
});

test('склад находит AMR и обработку грузов вне широкой отрасли транспорта', () => {
  const warehouse = solutions.items.filter(s => /Ronavi H1500|RONAVI H1500|EVOCARGO N1/i.test(s.name));
  assert.ok(warehouse.length >= 2);
  assert.ok(warehouse.some(s => s.industry !== 'Транспорт и логистика'));
  for (const solution of warehouse) assert.equal(matchesWarehouseCatalog([solution]), true, solution.name);
});

test('назначение проверяется в одной записи, а не склеивается между вариантами', () => {
  assert.equal(matchesWarehouseCatalog([
    { name: 'Охрана склада', scenario: 'Патрулирование склада' },
    { name: 'Доставка по воде', scenario: 'Доставка грузов по воде' },
  ]), false);
  assert.equal(matchesWarehouseCatalog([{ name: 'Поломоечный робот', scenario: 'Уборка помещений' }]), true);
  assert.equal(matchesWarehouseCatalog([{ name: 'Грузовое такси', scenario: 'Перевозка пассажиров' }]), false);
});

test('профильная складская логистика предшествует вспомогательному клинингу', () => {
  const amr = solutions.items.find(s => /Ronavi H1500/i.test(s.name));
  const cleaner = solutions.items.find(s => s.name === 'MARK 2 SE');
  assert.ok(amr && cleaner);
  assert.equal(warehouseCatalogPriority([amr]), 0);
  assert.equal(warehouseCatalogPriority([cleaner]), 1);
});
