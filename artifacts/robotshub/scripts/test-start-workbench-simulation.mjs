import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultWorkbenchInputs, calculateWorkbench, createWorkbenchPlan, approveWorkbenchPlan, workbenchContext } from '../src/lib/start-workbench.ts';
import { buildStartWorkbenchSimulation } from '../src/lib/start-workbench-simulation.ts';
import { objectProcesses } from '../src/lib/start-processes.ts';
import { createSim } from '../src/sim/sim-engine.ts';
import { createStartBriefUrl, decodeStartBriefHash } from '../src/lib/start-brief.ts';
import { generateStartWorkbenchDocx } from '../src/lib/start-value-docx.ts';
import JSZip from 'jszip';

const process = objectProcesses.warehouse[0];
const inputs = defaultWorkbenchInputs();
function supported(raw = inputs, selected = process) {
  const config = buildStartWorkbenchSimulation('warehouse', selected, raw);
  assert.equal(config.supported, true, config.reason);
  return config;
}
test('four controls share exactly the economic inputs; fleet auto, explicit zero and charge-hour conversion are preserved', () => {
  const config = supported({ ...inputs, loadPerHour: 120, robotCount: 4, batteryHours: 6, chargeHours: 1.5 });
  assert.equal(config.options.tasksPerHour, 120);
  assert.equal(config.options.batteryRuntimeHours, 6);
  assert.equal(config.options.chargeTimeMinutes, 90);
  assert.equal(config.fleet.reduce((sum, item) => sum + item.count, 0), 4);
  const auto = supported();
  assert.equal(auto.fleet[0].count, calculateWorkbench(inputs).robotCount);
  const zero = supported({ ...inputs, robotCount: 0 });
  assert.equal(zero.fleet.length, 0);
  const sim = createSim(zero.scene, { ...zero.options, fleet: zero.fleet, seed: zero.seed });
  for (let step = 0; step < 240; step++) sim.update(1);
  assert.equal(sim.robots.length, 0);
  assert.equal(sim.getKpis().tasksDone, 0);
  assert.equal(zero.options.tasksPerHour, inputs.loadPerHour, 'zero fleet must not change requested demand');
});
test('selected warehouse transport process runs only its own compatible route with real delivery completion', () => {
  for (const selected of objectProcesses.warehouse.filter(item => !['cleaning', 'inspection'].includes(item.kind))) {
    const config = supported({ ...inputs, robotCount: 3 }, selected);
    assert.equal(config.scene.floors.length, 1);
    assert.equal(config.scene.flows.length, 1);
    assert.equal(config.scene.flows[0].share, 1);
    assert.equal(config.scene.flows[0].sprite, config.fleet[0].sprite);
    const sim = createSim(config.scene, { ...config.options, fleet: config.fleet, seed: config.seed });
    let maxActive = 0;
    for (let step = 0; step < 1800; step++) {
      sim.update(1);
      maxActive = Math.max(maxActive, sim.getKpis().activeRobots);
    }
    assert.ok(maxActive >= 2, selected.id + ': several robots must actually work');
    assert.ok(sim.getKpis().tasksDone > 0, selected.id + ': a real trip must complete');
    assert.equal(sim.getKpis().moneySavedRub, 0, 'route sketch must not invent cash savings');
  }
});
test('no fake warehouse for cleaning, inspection or another object; no silently clamped fleet; invalid inputs stop simulation', () => {
  for (const item of objectProcesses.warehouse.filter(p => ['cleaning', 'inspection'].includes(p.kind))) {
    assert.equal(buildStartWorkbenchSimulation('warehouse', item, inputs).supported, false);
  }
  assert.equal(buildStartWorkbenchSimulation('medical', process, inputs).supported, false);
  assert.equal(buildStartWorkbenchSimulation('production', process, inputs).supported, false);
  assert.equal(buildStartWorkbenchSimulation('warehouse', process, { ...inputs, robotCount: 31 }).supported, false);
  assert.equal(buildStartWorkbenchSimulation('warehouse', process, { ...inputs, loadPerHour: NaN }).supported, false);
});
test('formula rate never changes physical speed, seed or layout to manufacture a successful run', () => {
  const one = supported({ ...inputs, robotCount: 3, robotRatePerHour: 20 });
  const two = supported({ ...inputs, robotCount: 3, robotRatePerHour: 200 });
  assert.deepEqual(one.scene, two.scene);
  assert.deepEqual(one.fleet, two.fleet);
  assert.equal(one.seed, two.seed);
  assert.equal(one.options.initialTasks, 3);
});
test('approved DOCX and shared link keep selected controls, alternatives and honest observation conditions', async () => {
  const draft = { version: 1, step: 4, objectId: 'warehouse', customObject: '', scope: 'single',
    processes: objectProcesses.warehouse, selectedIds: [process.id], details: {}, activeProcess: null, workbenchPlans: {} };
  const plan = createWorkbenchPlan();
  plan.variants[0].inputs = { ...inputs, loadPerHour: 120, robotCount: 4, batteryHours: 6, chargeHours: 1.5 };
  plan.variants.push({ id: 'alternative', name: 'Меньший парк', inputs: { ...inputs, robotCount: 2 } });
  const approved = approveWorkbenchPlan(plan, workbenchContext(draft, process));
  draft.workbenchPlans[process.id] = approved;
  draft.valueFocusId = process.id;
  const url = createStartBriefUrl(draft, 'https://robotshub.ru');
  const restored = decodeStartBriefHash(new URL(url).hash);
  assert.deepEqual(restored.workbenchPlans[process.id], approved);
  const logoUrl = 'data:image/jpeg;base64,' + readFileSync(new URL('../public/brand/logo.jpg', import.meta.url)).toString('base64');
  const blob = await generateStartWorkbenchDocx({ draft, process, plan: approved, url, logoUrl });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file('word/document.xml').async('string');
  for (const text of ['120 перемещений/ч', '4 машин', '6 ч', '1,5 ч', 'Меньший парк', 'Начальная очередь: 4', 'Краткие живые KPI']) {
    assert.ok(xml.includes(text), text);
  }
  assert.ok(await zip.file('word/media/scenario.png')?.async('uint8array'));
});
