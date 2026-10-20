import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateWarehouseParams } from '../src/lib/start-estimate.ts';
import { isEmptyProject } from '../src/lib/demo-project.ts';
import { calculateEconomics, calculateSimulationInputs } from '../src/lib/calc.ts';
import solutions from '../src/data/solutions.json' with { type: 'json' };

test('even partial financial inputs prevent automatic replacement', () => {
  const blank = {
    objectType: null, sectorId: null, activeSolutionId: null, objectParams: {},
    selectedSolutions: [], whatIfOverrides: {}, assumptionsOverrides: {},
    financingScenario: 'purchase', simulationKpis: null,
  };
  assert.equal(isEmptyProject(blank), true);
  assert.equal(isEmptyProject({ ...blank, assumptionsOverrides: { servicePct: 12 } }), false);
  assert.equal(isEmptyProject({ ...blank, whatIfOverrides: { volumeMultiplier: 1.2 } }), false);
  assert.equal(isEmptyProject({ ...blank, financingScenario: 'leasing' }), false);
  assert.equal(isEmptyProject({ ...blank, sectorId: 'Промышленность' }), false);
});

test('warehouse estimate uses the entered area and explicit scenario assumptions', () => {
  const params = estimateWarehouseParams(5200);
  assert.equal(params.total_area_m2, 5200);
  assert.equal(params.inbound_pallets_per_day, 260);
  assert.equal(params.pickers_count, 3);
  assert.equal(params.shift_duration_h, 11);
  assert.equal(params.shifts_per_day, 2);
  assert.equal(params.floors_count, 1);
  assert.equal(params.outbound_pallets_per_day, 260);
  assert.equal(params.active_area_m2, 2600);
  assert.equal(params.working_days_per_year, 365);
  assert.equal(params.payroll_factor, 1.302);
  assert.equal(params.picker_salary_gross, 100000);
});

test('warehouse estimate rejects invalid and out-of-range input', () => {
  for (const area of [NaN, Infinity, -1, 0, 99, 100001]) {
    assert.throws(() => estimateWarehouseParams(area), RangeError);
  }
  for (const area of [100, 5200, 100000]) assert.doesNotThrow(() => estimateWarehouseParams(area));
});

test('warehouse estimate feeds the existing finance and throughput engines', () => {
  const solution = solutions.items.find(item => item.id === '5760e938-9a43-45a7-b8e8-f4f2e6383930');
  assert.ok(solution);
  const input = {
    objectParams: estimateWarehouseParams(5200),
    solution,
    whatIf: { salaryMultiplier: 1, priceMultiplier: 1, volumeMultiplier: 1 },
    assumptionsOverrides: {},
  };
  const simulation = calculateSimulationInputs(input);
  const purchase = calculateEconomics(input).find(item => item.id === 'purchase');
  assert.equal(simulation.robotCount, 1);
  assert.ok(Math.abs(simulation.tasksPerHour - 260 / 22) < 1e-10);
  assert.ok(purchase.capex > solution.price_rub);
  assert.ok(Number.isFinite(purchase.paybackYears));
  console.log(JSON.stringify({ capex: purchase.capex, paybackYears: purchase.paybackYears, flow: simulation.tasksPerHour }));
});
