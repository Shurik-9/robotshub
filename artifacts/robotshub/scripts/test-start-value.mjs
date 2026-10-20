import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { defaultStartValueInputs, calculateStartValue, parseStartValueInputs, buildStartValueTask } from '../src/lib/start-value.ts';
import { generateStartValueDocx } from '../src/lib/start-value-docx.ts';
import { parseStartScopeDraft } from '../src/lib/start-scope.ts';
import { objectProcesses } from '../src/lib/start-processes.ts';
import { createStartBriefUrl, decodeStartBriefHash } from '../src/lib/start-brief.ts';

const fixture = objectId => ({
  version: 1, step: 4, objectId, customObject: '', scope: 'whole',
  processes: objectProcesses[objectId], selectedIds: objectProcesses[objectId].map(item => item.id),
  details: {}, activeProcess: null,
});

test('example arithmetic: 2 person-hours, 500 hours/year, 150k cash/year, 450k ALL ownership costs', () => {
  const input = defaultStartValueInputs();
  const result = calculateStartValue(input);
  assert.equal(result.freedHoursPerShift, 2);
  assert.equal(result.remainingHoursPerShift, 2);
  assert.equal(result.annualFreedHours, 500);
  assert.equal(result.annualCashEffectRub, 150000);
  assert.equal(result.maxOwnershipBudgetRub, 450000);
  assert.equal(result.quotedPaybackYears, null);
  assert.equal(input.quotedTotalCostRub, null);
});

test('free time is not automatically money or staff reduction; quote below/above bound', () => {
  const base = defaultStartValueInputs();
  for (const patch of [{ cashablePct: 0 }, { automationPct: 0 }, { manualHoursPerShift: 0 }, { hourCostRub: 0 }]) {
    const result = calculateStartValue({ ...base, ...patch, quotedTotalCostRub: 500000 });
    assert.equal(result.maxOwnershipBudgetRub, 0);
    assert.equal(result.quotedPaybackYears, null);
    assert.match(result.verdict, /не обоснована/);
  }
  assert.match(calculateStartValue({ ...base, quotedTotalCostRub: 450000 }).verdict, /укладывается/);
  assert.match(calculateStartValue({ ...base, quotedTotalCostRub: 450001 }).verdict, /не покрывает/);
  assert.equal(calculateStartValue({ ...base, manualHoursPerShift: 80 }).freedHoursPerShift, 40);
});

test('invalid inputs are rejected, never clamped or silently replaced', () => {
  for (const patch of [{ automationPct: 101 }, { hourCostRub: -1 }, { shiftsYear: 1.5 },
    { cashablePct: Number.NaN }, { targetYears: Infinity }, { quotedTotalCostRub: 0 }]) {
    const value = { ...defaultStartValueInputs(), ...patch };
    assert.equal(parseStartValueInputs(value), null);
    assert.throws(() => calculateStartValue(value), /Проверьте/);
  }
});

test('every object, focused process and ALL scenario numbers survive shared links and reload parsing', () => {
  for (const objectId of ['warehouse', 'production', 'airport', 'medical', 'public', 'other']) {
    const draft = fixture(objectId);
    if (objectId === 'other') draft.customObject = 'Новая площадка';
    const process = draft.processes.at(-1);
    const scenario = { ...defaultStartValueInputs(), manualHoursPerShift: 6, hourCostRub: 850, cashablePct: 75 };
    draft.valueScenarios = { [process.id]: scenario };
    draft.valueFocusId = process.id;
    const original = structuredClone(draft);
    const url = createStartBriefUrl(draft, 'https://robotshub.ru');
    assert.ok(url.startsWith('https://robotshub.ru/start#brief=z.'));
    assert.ok(url.length < 2500, 'typical QR must not contain an excessively long URL');
    const restored = decodeStartBriefHash(new URL(url).hash);
    assert.deepEqual(restored.valueScenarios[process.id], scenario);
    assert.equal(restored.valueFocusId, process.id);
    assert.deepEqual(parseStartScopeDraft(restored).valueScenarios, draft.valueScenarios);
    assert.deepEqual(draft, original, 'sharing must not mutate source');
  }
});

test('old uncompressed links stay valid and hostile compressed or model data fail', () => {
  const draft = fixture('warehouse');
  assert.equal(decodeStartBriefHash(`#brief=${encodeURIComponent(JSON.stringify(draft))}`).objectId, 'warehouse');
  for (const hash of ['#brief=z.broken', '#brief=z.AAAA', '#brief=broken']) assert.throws(() => decodeStartBriefHash(hash), /повреждена/);
  assert.equal(parseStartScopeDraft({ ...draft, valueScenarios: { receiving: { ...defaultStartValueInputs(), automationPct: 500 } } }), null);
  assert.equal(parseStartScopeDraft({ ...draft, valueFocusId: 'missing' }), null);
});

test('task gives an objective, measurable checks and all ownership costs, never robot count from area', () => {
  const draft = fixture('warehouse');
  const task = buildStartValueTask(draft, draft.processes[0], defaultStartValueInputs());
  for (const text of ['2 чел·ч', '150', '450', 'пиковый', 'не цена робота']) {
    assert.ok(task.includes(text), text);
  }
  assert.match(task, /Это не утверждение о сокращении сотрудников/);
  assert.match(task, /оборудование, интеграция/);
  assert.doesNotMatch(task, /5200|1 робот/i);
});

test('DOCX has actual OOXML, embedded logo, embedded QR and exact reproducible public scenario link', async () => {
  const draft = fixture('warehouse');
  const process = draft.processes[0];
  const inputs = { ...defaultStartValueInputs(), manualHoursPerShift: 6 };
  draft.valueScenarios = { [process.id]: inputs };
  draft.valueFocusId = process.id;
  const url = createStartBriefUrl(draft, 'https://robotshub.ru');
  const logo = await readFile(new URL('../public/brand/logo.jpg', import.meta.url));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(logo, { status: 200 });
  try {
    const blob = await generateStartValueDocx({ draft, process, inputs, url, logoUrl: '/brand/logo.jpg' });
    assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer(), { checkCRC32: true });
    for (const path of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/media/logo.jpg', 'word/media/scenario.png']) assert.ok(zip.file(path), path);
    const document = await zip.file('word/document.xml').async('string');
    const relationships = await zip.file('word/_rels/document.xml.rels').async('string');
    assert.ok(relationships.includes(url));
    assert.match(document, /675[   ]?000/);
    assert.match(document, /ЗАДАНИЕ НА ПРОВЕРКУ/);
    const qr = await zip.file('word/media/scenario.png').async('uint8array');
    assert.deepEqual([...qr.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(qr.length > 1000);
    assert.deepEqual(decodeStartBriefHash(new URL(url).hash).valueScenarios.receiving, inputs);
    assert.doesNotMatch(document, /replit\./i);
    assert.match(document, /Железный аргумент/);
    assert.match(document, /Центр подбора роботизации/);
    await assert.rejects(() => generateStartValueDocx({ draft, process, inputs, url: 'https://replit.com/login', logoUrl: '' }), /служебный адрес/);
  } finally { globalThis.fetch = originalFetch; }
});
