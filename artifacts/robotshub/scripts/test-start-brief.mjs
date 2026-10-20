import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { objectProcesses } from '../src/lib/start-processes.ts';
import { briefForProcess, buildStartBriefText, createStartBriefUrl, decodeStartBriefHash } from '../src/lib/start-brief.ts';

function draft(objectId = 'warehouse') {
  return {
    version: 1, step: 4, objectId, customObject: objectId === 'other' ? 'Моя площадка' : '',
    scope: 'whole', processes: objectProcesses[objectId],
    selectedIds: objectProcesses[objectId].map(process => process.id), details: {}, activeProcess: null,
  };
}

test('all objects produce useful brief and share without any numerical answers', () => {
  for (const objectId of Object.keys(objectProcesses)) {
    const input = draft(objectId);
    const text = buildStartBriefText(input);
    assert.ok(text.includes('Что рассмотреть:'));
    assert.ok(text.includes('Что проверить в экономике:'));
    assert.ok(!text.includes('не заполнено:'));
    const url = new URL(createStartBriefUrl(input, 'https://robotshub.ru'));
    assert.equal(url.origin, 'https://robotshub.ru');
    assert.equal(url.pathname, '/start');
    assert.deepEqual(decodeStartBriefHash(url.hash), input);
  }
});

test('answers, unknowns, custom zones and Unicode survive portable handoff', () => {
  const input = draft();
  input.processes = [...input.processes, { id: 'custom-1', name: 'Передача «Север → Юг»', kind: 'custom', summary: 'Пользовательская рабочая зона для уточнения на площадке', focus: 'Опишите содержание работы и её место в общем процессе.' }];
  input.selectedIds.push('custom-1');
  input.details = { receiving: { values: { volume: '125', route: 'Только известное <script>alert(1)</script>' }, unknown: { shift: true } } };
  const restored = decodeStartBriefHash(new URL(createStartBriefUrl(input, 'https://robotshub.ru')).hash);
  assert.deepEqual(restored.details, input.details);
  assert.equal(restored.processes.at(-1).name, input.processes.at(-1).name);
  assert.ok(buildStartBriefText(restored).includes('Только известное <script>alert(1)</script>'));
  assert.ok(buildStartBriefText(restored).includes('125 за смену'));
  assert.ok(buildStartBriefText(restored).includes('Длительность рабочего окна: пока неизвестно'));
});

test('single and multiple scopes do not expand to whole object in a shared brief', () => {
  for (const [scope, selectedIds] of [['single', ['picking']], ['multiple', ['receiving', 'shipping']]]) {
    const input = { ...draft(), scope, selectedIds };
    const output = decodeStartBriefHash(new URL(createStartBriefUrl(input, 'https://robotshub.ru')).hash);
    assert.equal(output.scope, scope);
    assert.deepEqual(output.selectedIds, selectedIds);
    const text = buildStartBriefText(output);
    assert.ok(!text.includes('Уборка складских зон'));
  }
});

test('only explicitly matched examples are used; medical indoor flow never borrows drones', () => {
  const casesSource = readFileSync(new URL('../src/pages/cases.tsx', import.meta.url), 'utf8');
  for (const [objectId, processes] of Object.entries(objectProcesses)) {
    for (const process of processes) {
      for (const item of briefForProcess(objectId, process).evidence) {
        assert.ok(casesSource.includes(`id: '${item.caseId}'`), item.caseId);
      }
    }
  }
  assert.deepEqual(briefForProcess('medical', objectProcesses.medical.find(process => process.id === 'lab-samples')).evidence, []);
  assert.deepEqual(briefForProcess('warehouse', objectProcesses.warehouse.find(process => process.id === 'picking')).evidence, []);
});

test('invalid, oversized and incomplete shared payloads fail explicitly', () => {
  assert.equal(decodeStartBriefHash(''), null);
  assert.throws(() => decodeStartBriefHash('#brief=broken'), /повреждена/);
  assert.throws(() => decodeStartBriefHash('#brief=' + 'x'.repeat(24_001)), /длинная/);
  assert.throws(() => createStartBriefUrl({ ...draft(), scope: 'single', selectedIds: [] }, 'https://robotshub.ru'), /проверьте/);
  const compressible = { ...draft(), details: { receiving: { values: { route: 'я'.repeat(4000), flow: 'я'.repeat(4000) }, unknown: {} } } };
  assert.deepEqual(decodeStartBriefHash(new URL(createStartBriefUrl(compressible, 'https://robotshub.ru')).hash), compressible);
  const tooLarge = { ...draft(), details: { receiving: { values: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`answer${i}`, 'я'.repeat(4000)])), unknown: {} } } };
  assert.throws(() => createStartBriefUrl(tooLarge, 'https://robotshub.ru'), /[Сс]лишком много/);
});
