import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluationLimit } from '../src/lib/evaluationScope.ts';

const clinicCleaner = '5a5b3599-bd64-4330-9bbb-4f8ce7d780b9';
const medicalDrone = '0861538d-75c8-473e-a2ab-499a6b8c1d49';

test('бриф произвольного объекта не превращается в фиктивное ТЭО', () => {
  assert.match(evaluationLimit('sector-water', 'custom', { site_name: 'Причал' }), /нет отдельной/);
  assert.match(evaluationLimit(null, null, {}), /шаблонов объекта/);
  assert.match(evaluationLimit(null, 'warehouse', {}), /шаблонов объекта/);
});

test('для воды и карьеров универсальный расчёт по типовым объектам не открывается', () => {
  assert.match(evaluationLimit('sector-water', 'airport', { terminal_area_m2: 1000 }, '018cc2dd-3dfe-4bd2-aac6-f54cbebd783e'), /Свой объект/);
  assert.match(evaluationLimit('sector-mining', 'warehouse', { pickers_count: 10 }, '33fca97e-ef4f-459d-a773-ab58b7f84fd5'), /Свой объект/);
  assert.equal(evaluationLimit('sector-water', 'custom', { site_name: 'Балаклавская бухта', task: 'сбор мусора' }, '018cc2dd-3dfe-4bd2-aac6-f54cbebd783e'), null);
  assert.equal(evaluationLimit('sector-mining', 'custom', { site_name: 'Карьер №1', task: 'съёмка' }, '33fca97e-ef4f-459d-a773-ab58b7f84fd5'), null);
  assert.match(evaluationLimit('sector-water', 'custom', { task: 'сбор мусора' }, '018cc2dd-3dfe-4bd2-aac6-f54cbebd783e'), /точным названием площадки/);
});

test('медицинская экономика не наследуется доставкой дронами и реабилитацией', () => {
  const hospital = { sanitar_count: 20 };
  assert.equal(evaluationLimit('sector-medicine', 'medical', hospital, clinicCleaner), null);
  assert.match(evaluationLimit('sector-medicine', 'medical', hospital, medicalDrone), /Свой объект/);
  assert.match(evaluationLimit('sector-medicine', 'medical', hospital, '0aaaa4d1-9ca6-4737-a3d6-92081635402c'), /Свой объект/);
  assert.match(evaluationLimit('sector-medicine', 'warehouse', { pickers_count: 10 }, clinicCleaner), /только.*уборки/);
});

test('старый расчётный шаблон остаётся доступен для своей исходной отрасли', () => {
  assert.equal(evaluationLimit('Транспорт и логистика', 'warehouse', { pickers_count: 10 }, 'some-solution'), null);
});