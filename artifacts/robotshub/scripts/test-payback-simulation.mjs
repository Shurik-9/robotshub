import assert from 'node:assert/strict';
import { test } from 'node:test';
import warehouseTemplate from '../src/data/object-templates/warehouse.json' with { type: 'json' };
import assumptionsData from '../src/data/assumptions.json' with { type: 'json' };
import solutionsData from '../src/data/solutions.json' with { type: 'json' };
import { calculateEconomics, simulatePaybackRisk } from '../src/lib/calc.ts';

const solution = solutionsData.items.find(item => /Ronavi H1500/i.test(item.name))
  ?? solutionsData.items[0];
const objectParams = Object.fromEntries(
  warehouseTemplate.groups.flatMap(group => group.fields.map(field => [field.key, field.base])),
);
const inputs = {
  objectParams,
  solution,
  whatIf: { salaryMultiplier: 1, priceMultiplier: 1, volumeMultiplier: 1 },
};

test('Monte Carlo factors use only the reserved range and distribution set', () => {
  const settings = assumptionsData.payback_simulation.uncertainties;
  assert.deepEqual(
    settings.map(item => [item.key, item.distribution]),
    [
      ['service_pct', 'uniform'],
      ['integration_pct', 'uniform'],
      ['commissioning_pct', 'uniform'],
      ['volume_multiplier', 'triangular'],
      ['price_multiplier', 'uniform'],
    ],
  );
  assert.equal(assumptionsData.payback_simulation.iterations, 1000);
  assert.deepEqual(settings.find(item => item.key === 'volume_multiplier').range, [80, 120]);
  assert.deepEqual(settings.find(item => item.key === 'price_multiplier').range, [85, 115]);
});

test('Monte Carlo is deterministic, explainable, and remains near the unchanged point estimate', () => {
  const first = simulatePaybackRisk(inputs);
  const second = simulatePaybackRisk(inputs);
  const point = calculateEconomics(inputs).find(result => result.id === 'purchase');
  assert.deepEqual(first, second);
  assert.equal(first.iterations, 1000);
  assert.deepEqual(first.assumptions.map(item => item.key), [
    'service_pct',
    'integration_pct',
    'commissioning_pct',
    'volume_multiplier',
    'price_multiplier',
  ]);
  assert.equal(first.assumptions.find(item => item.key === 'volume_multiplier').distribution, 'triangular');
  assert.equal(first.histogram.reduce((total, bin) => total + bin.count, 0), first.iterations);
  assert.ok(point.paybackYears > 0);
  assert.ok(first.medianYears > 0);
  assert.ok(Math.abs(first.medianYears - point.paybackYears) / point.paybackYears <= 0.15);
});

test('discount and payroll What-If stay fixed while volume and purchase-price What-If move the base', () => {
  const base = simulatePaybackRisk(inputs);
  const changed = simulatePaybackRisk({
    ...inputs,
    whatIf: { salaryMultiplier: 1.2, priceMultiplier: 0.9, volumeMultiplier: 1.1 },
    assumptionsOverrides: { discountRatePct: 20 },
  });
  assert.equal(changed.seed, base.seed);
  assert.equal(changed.iterations, base.iterations);
  assert.notEqual(changed.basePaybackYears, base.basePaybackYears);
  assert.equal(changed.assumptions.find(item => item.key === 'price_multiplier').overridden, true);
  assert.equal(changed.assumptions.find(item => item.key === 'volume_multiplier').overridden, true);
});
