import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { defaultWorkbenchInputs, calculateWorkbench, createWorkbenchPlan, parseWorkbenchInputs,
  parseWorkbenchPlan, approveWorkbenchPlan, isWorkbenchApproved, updateWorkbenchVariant,
  workbenchContext } from '../src/lib/start-workbench.ts';
import { parseStartScopeDraft } from '../src/lib/start-scope.ts';
import { objectProcesses } from '../src/lib/start-processes.ts';
import { createStartBriefUrl, decodeStartBriefHash } from '../src/lib/start-brief.ts';
import { generateStartWorkbenchDocx } from '../src/lib/start-value-docx.ts';
import { parseTexts, toTexts } from '../src/components/start-scope/start-brief/workbench-fields.ts';

const almost = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const fixture = () => ({
  version: 1, step: 4, objectId: 'warehouse', customObject: '', scope: 'whole',
  processes: objectProcesses.warehouse, selectedIds: objectProcesses.warehouse.map(p => p.id),
  details: {}, activeProcess: null, workbenchPlans: {},
});
const first = objectProcesses.warehouse[0];

test('default example: capacity, cost, savings and TCO reconcile without area heuristics', () => {
  const input = defaultWorkbenchInputs(), r = calculateWorkbench(input);
  assert.equal(r.robotCount, 1);
  almost(r.capacityPerHour, 49.92);
  almost(r.peakDemandPerHour, 46);
  assert.equal(r.capexRub, 2800000);
  assert.equal(r.opexAnnualRub, 300000); // service applies to equipment, not integration
  assert.equal(r.annualGrossCashRub, 1200000);
  assert.equal(r.annualNetCashRub, 900000);
  almost(r.paybackYears, 28 / 9);
  assert.equal(r.tcoRub, 3700000);
  assert.equal(r.maxOwnershipBudgetRub, 3600000);
  assert.ok(r.paybackYears > input.targetYears);
});

test('insufficient fleet reduces benefits and cannot claim payback', () => {
  const r = calculateWorkbench({ ...defaultWorkbenchInputs(), loadPerHour: 200, robotCount: 1 });
  assert.equal(r.requiredRobotCount, 5);
  assert.equal(r.meetsDemand, false);
  almost(r.coveragePct, 24.96);
  almost(r.annualGrossCashRub, 299520);
  assert.equal(r.paybackYears, null);
  const peakOnly = calculateWorkbench({ ...defaultWorkbenchInputs(), loadPerHour: 45, robotCount: 1 });
  assert.equal(peakOnly.coveragePct, 100);
  assert.equal(peakOnly.meetsDemand, false);
  assert.equal(peakOnly.paybackYears, null);
});

test('negative cash stays negative and zero robots free no manual hours', () => {
  const r = calculateWorkbench({ ...defaultWorkbenchInputs(), cashablePct: 0 });
  assert.equal(r.annualNetCashRub, -300000);
  assert.equal(r.paybackYears, null);
  const none = calculateWorkbench({ ...defaultWorkbenchInputs(), robotCount: 0 });
  assert.equal(none.freedHoursPerShift, 0);
  assert.equal(none.annualGrossCashRub, 0);
  assert.equal(none.paybackYears, null);
});

test('hours set shift volume, while a slower battery cycle increases required fleet', () => {
  const base = defaultWorkbenchInputs();
  assert.equal(calculateWorkbench({ ...base, hoursPerShift: 4 }).operationsPerShift, 160);
  assert.equal(calculateWorkbench({ ...base, hoursPerShift: 4 }).annualOperatingHours, 1000);
  assert.ok(calculateWorkbench({ ...base, chargeHours: 16 }).robotCount > calculateWorkbench(base).robotCount);
});

test('inputs reject invalid/nonfinite data, not silently clamp it; UI ranges match parser', () => {
  for (const patch of [{ loadPerHour: 0 }, { batteryHours: 0 }, { operatingPct: 0 },
    { pricePerRobotRub: 0 }, { robotCount: 1.2 }, { reservePct: -1 }, { targetYears: 21 },
    { manualHoursPerShift: NaN }, { energyRubYear: Infinity }, { hoursPerShift: 24, shiftsYear: 1000 }]) {
    assert.equal(parseWorkbenchInputs({ ...defaultWorkbenchInputs(), ...patch }), null);
  }
  const text = toTexts(defaultWorkbenchInputs());
  assert.ok(parseTexts(text, parseWorkbenchInputs).inputs);
  assert.equal(parseTexts({ ...text, loadPerHour: '' }, parseWorkbenchInputs).inputs, null);
  assert.equal(parseTexts({ ...text, hourCostRub: '600,50' }, parseWorkbenchInputs).inputs.hourCostRub, 600.5);
  assert.ok(parseTexts({ ...text, robotCount: '0', hoursPerShift: '0.5', batteryHours: '0.1' }, parseWorkbenchInputs).inputs);
});

test('approval covers comparison, chosen variant, source facts and model version', () => {
  const draft = fixture(), context = workbenchContext(draft, first), raw = createWorkbenchPlan();
  raw.variants.push({ id: 'alternative', name: 'Другой парк', inputs: { ...raw.variants[0].inputs, loadPerHour: 200 } });
  const approved = approveWorkbenchPlan(raw, context);
  assert.equal(raw.approval, undefined);
  assert.ok(isWorkbenchApproved(parseWorkbenchPlan(JSON.parse(JSON.stringify(approved))), context));
  const changed = updateWorkbenchVariant(approved, 'alternative', { ...raw.variants[1].inputs, loadPerHour: 201 });
  assert.equal(changed.approval, undefined);
  assert.equal(raw.variants[1].inputs.loadPerHour, 200);
  assert.equal(isWorkbenchApproved({ ...approved, selectedId: 'alternative' }, context), false);
  assert.equal(isWorkbenchApproved({ ...approved, approval: { ...approved.approval, modelVersion: 'future' } }, context), false);
  draft.details[first.id] = { values: { route: 'Новый маршрут' }, unknown: {} };
  assert.equal(isWorkbenchApproved(approved, workbenchContext(draft, first)), false);
});

test('corrupt plans do not replace a valid draft; old drafts remain compatible', () => {
  const draft = fixture();
  assert.ok(parseStartScopeDraft(draft));
  draft.workbenchPlans[first.id] = createWorkbenchPlan();
  assert.ok(parseStartScopeDraft(draft));
  draft.workbenchPlans[first.id].variants[0].name = '';
  assert.equal(parseStartScopeDraft(draft), null);
  assert.equal(parseWorkbenchPlan({ selectedId: 'x', variants: Array.from({ length: 7 }, (_, i) => ({ id: `v${i}`, name: 'Вариант', inputs: defaultWorkbenchInputs() })) }), null);
});

test('approved scenario and alternatives roundtrip in one compressed public link', () => {
  const draft = fixture();
  const plan = createWorkbenchPlan();
  plan.variants.push({ id: 'lean', name: 'Малый парк', inputs: { ...plan.variants[0].inputs, loadPerHour: 200, robotCount: 1 } });
  draft.workbenchPlans[first.id] = approveWorkbenchPlan(plan, workbenchContext(draft, first));
  draft.valueFocusId = first.id;
  const url = createStartBriefUrl(draft, 'https://robotshub.ru');
  const decoded = decodeStartBriefHash(new URL(url).hash);
  assert.ok(url.length < 2200);
  assert.deepEqual(decoded.workbenchPlans, draft.workbenchPlans);
  assert.ok(isWorkbenchApproved(decoded.workbenchPlans[first.id], workbenchContext(decoded, first)));
});

test('DOCX includes approved sections, real comparison tables, logo and matching public QR', async () => {
  const draft = fixture();
  const plan = createWorkbenchPlan();
  plan.variants.push({ id: 'lean', name: 'Малый парк', inputs: { ...plan.variants[0].inputs, loadPerHour: 200, robotCount: 1 } });
  draft.workbenchPlans[first.id] = approveWorkbenchPlan(plan, workbenchContext(draft, first));
  const second = draft.processes[1];
  draft.workbenchPlans[second.id] = approveWorkbenchPlan(createWorkbenchPlan(), workbenchContext(draft, second));
  draft.valueFocusId = first.id;
  const url = createStartBriefUrl(draft, 'https://robotshub.ru');
  const oldFetch = globalThis.fetch;
  const logo = await readFile(new URL('../public/brand/logo.jpg', import.meta.url));
  globalThis.fetch = async () => new Response(logo);
  try {
    const args = { draft, process: first, plan: draft.workbenchPlans[first.id], url, logoUrl: '/brand/logo.jpg' };
    const blob = await generateStartWorkbenchDocx(args);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml').async('string');
    assert.match(xml, /Малый парк/);
    assert.ok(xml.includes(first.name) && xml.includes(second.name));
    assert.equal((xml.match(/<w:tbl>/g) ?? []).length, 2);
    assert.match(xml, /900[  ]000/);
    assert.ok(zip.file('word/media/logo.jpg') && zip.file('word/media/scenario.png'));
    const rels = await zip.file('word/_rels/document.xml.rels').async('string');
    assert.ok(rels.includes('https://robotshub.ru/start#brief='));
    assert.ok(!rels.includes('.replit'));
    await assert.rejects(generateStartWorkbenchDocx({ ...args, plan: createWorkbenchPlan() }), /утвердите/);
    await assert.rejects(generateStartWorkbenchDocx({ ...args, url: url.replace('https://robotshub.ru', 'https://example.com') }), /QR/);
    const wrong = { ...draft, workbenchPlans: { ...draft.workbenchPlans, [first.id]: createWorkbenchPlan() } };
    await assert.rejects(generateStartWorkbenchDocx({ ...args, url: createStartBriefUrl(wrong, 'https://robotshub.ru') }), /не соответствует/);
  } finally { globalThis.fetch = oldFetch; }
});
