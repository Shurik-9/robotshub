import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { answerHeaders, createQuestionnaire, parseQuestionnaire, MAX_XLSX_BYTES } from '../src/lib/questionnaire-xlsx.ts';
import { fieldsFor, questionnaireFieldLabel, questionnaireFieldUnit, questionnaireOptionLabel, validateAnswers } from '../src/lib/questionnaire-schema.ts';
import { applyQuestionnaireToProject, projectFingerprint } from '../src/lib/questionnaire-state.ts';

const sector = 'Транспорт и логистика';
const bytes = value => Uint8Array.from(value).buffer;
const read = value => parseQuestionnaire(bytes(value));
const state = {
  objectType: 'warehouse', sectorId: sector, objectParams: { total_area_m2: 80000 },
  selectedSolutions: ['old-model'], activeSolutionId: 'old-model',
  whatIfOverrides: { price: 5 }, assumptionsOverrides: { salary: 100 },
  simulationKpis: { seed: 7 }, questionnaireEvidence: { old: { comment: 'Old', source: '', date: '' } },
};
async function bookFor(type, filled = true, sectorId = sector) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await createQuestionnaire(type, sectorId));
  if (filled) {
    const sheet = book.getWorksheet('Ответы');
    fieldsFor(type).forEach((field, i) => {
      sheet.getCell(i + 2, 4).value = type === 'custom'
        ? (field.required ? field.example : null)
        : typeof field.base === 'boolean' ? field.base ? 'Да' : 'Нет' : field.base;
    });
    sheet.getCell('L2').value = 'Измерено специалистом (тестовый пример)';
    sheet.getCell('M2').value = 'Тестовый протокол, не данные реального объекта';
    sheet.getCell('N2').value = '2026-01-30';
  }
  return book;
}
async function parsedBook(book) { return read(await book.xlsx.writeBuffer()); }
const officeSavedFixtures = [
  { file: 'airport-excel.xlsx', type: 'airport', application: /Microsoft Excel/ },
  { file: 'warehouse-libreoffice.xlsx', type: 'warehouse', application: /LibreOffice/ },
  { file: 'warehouse-libreoffice-us-date-format.xlsx', type: 'warehouse', application: /LibreOffice/, dateFormat: '[$-409]m/d/yyyy' },
  { file: 'warehouse-libreoffice-german-date-format.xlsx', type: 'warehouse', application: /LibreOffice/, dateFormat: '[$-407]dd/mm/yyyy' },
  { file: 'airport-libreoffice.xlsx', type: 'airport', application: /LibreOffice/ },
  { file: 'medical-libreoffice.xlsx', type: 'medical', application: /LibreOffice/ },
  { file: 'custom-libreoffice.xlsx', type: 'custom', application: /LibreOffice/ },
];
for (const type of ['warehouse', 'airport', 'medical', 'custom']) {
  test(`${type}: blank export, roundtrip, evidence, scalar floors`, async () => {
    const blank = await bookFor(type, false);
    const answerSheet = blank.getWorksheet('Ответы');
    fieldsFor(type).forEach((_, i) => assert.equal(answerSheet.getCell(i + 2, 4).value, null));
    assert.equal(answerSheet.getColumn(1).hidden, true, 'служебные ключи не должны быть видны заполняющему');
    const metadata = blank.getWorksheet('Метаданные');
    assert.equal(metadata.state, 'hidden');
    assert.deepEqual(
      [1, 2, 3, 4].map(row => [metadata.getCell(row, 1).value, metadata.getCell(row, 2).value]),
      [['format', 'robotshub-object-questionnaire'], ['version', '1'], ['object_type', type], ['sector_id', sector]],
    );
    assert.equal(answerSheet.getCell('C2').value, questionnaireFieldLabel(fieldsFor(type)[0]));
    assert.notEqual(answerSheet.getCell('G2').value, fieldsFor(type)[0].type, 'вид типа должен быть по-русски');
    assert.equal(answerSheet.getCell('N2').numFmt, '@', 'дата должна оставаться текстом');
    const examples = blank.getWorksheet('Примеры');
    assert.equal(examples.getCell('A1').value, 'Раздел');
    assert.equal(examples.getCell('B1').value, 'Параметр');
    assert.equal(examples.getCell('B2').value, questionnaireFieldLabel(fieldsFor(type)[0]));
    for (const field of fieldsFor(type)) {
      const row = fieldsFor(type).indexOf(field) + 2;
      assert.equal(answerSheet.getCell(row, 3).value, questionnaireFieldLabel(field));
      if (field.options || field.type === 'bool') {
        const options = field.type === 'bool' ? ['Да', 'Нет'] : field.options;
        assert.deepEqual(
          answerSheet.getCell(row, 4).dataValidation.formulae,
          [`"${options.map(option => questionnaireOptionLabel(field.key, option)).join(',')}"`],
        );
      }
      for (const sheet of [blank.getWorksheet('Инструкция'), answerSheet, examples]) {
        if (sheet.state !== 'visible') continue;
        for (let row = 1; row <= sheet.rowCount; row++) for (let column = 1; column <= sheet.columnCount; column++) {
          if (sheet.getColumn(column).hidden) continue;
          const value = sheet.getCell(row, column).value;
          assert.ok(typeof value !== 'string' || !value.includes(field.key), `технический ключ ${field.key} не должен быть виден в ${sheet.name}`);
        }
      }
    }
    const empty = await parsedBook(blank);
    assert.deepEqual(empty.values, {});
    assert.equal(empty.missing.length, fieldsFor(type).filter(field => field.required !== false).length);
    assert.throws(() => applyQuestionnaireToProject(state, empty, projectFingerprint(state)), /обязательные/);
    const filled = await parsedBook(await bookFor(type));
    assert.deepEqual(filled.errors, []);
    assert.deepEqual(filled.missing, []);
    assert.equal(filled.evidence[fieldsFor(type)[0].key].date, '2026-01-30');
    if (type !== 'custom') assert.equal(filled.values.floors_count, 2);
    else {
      assert.equal(filled.values.site_area_m2, undefined);
      assert.equal(filled.values.shifts_per_day, undefined);
      assert.equal(filled.values.constraints, undefined);
    }
    const original = structuredClone(state);
    const next = applyQuestionnaireToProject(state, filled, projectFingerprint(state));
    assert.deepEqual(state, original);
    assert.equal(next.sectorId, sector);
    assert.deepEqual(next.selectedSolutions, []);
    assert.equal(next.activeSolutionId, null);
    assert.equal(next.simulationKpis, null);
    assert.deepEqual(next.whatIfOverrides, {});
    assert.deepEqual(next.assumptionsOverrides, {});
    assert.deepEqual(JSON.parse(JSON.stringify(next)).questionnaireEvidence, filled.evidence);
    assert.deepEqual(next.objectParams, filled.values);
  });
}
test('desktop Excel and LibreOffice saves preserve questionnaire data and structure', async () => {
  for (const fixture of officeSavedFixtures) {
    const file = await readFile(new URL(`./fixtures/questionnaire-office/${fixture.file}`, import.meta.url));
    const data = bytes(file);
    const zip = await JSZip.loadAsync(file);
    const appProperties = await zip.file('docProps/app.xml')?.async('string');
    const application = appProperties?.match(/<Application>(.*?)<\/Application>/)?.[1] ?? '';
    assert.match(application, fixture.application, `${fixture.file}: fixture must come from the named desktop editor`);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file);
    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['Инструкция', 'Метаданные', 'Ответы', 'Примеры']);
    const metadata = workbook.getWorksheet('Метаданные');
    assert.equal(metadata.state, 'hidden', `${fixture.file}: metadata sheet must remain hidden`);
    assert.deepEqual(
      [1, 2, 3, 4].map(row => [metadata.getCell(row, 1).value, metadata.getCell(row, 2).value]),
      [['format', 'robotshub-object-questionnaire'], ['version', '1'], ['object_type', fixture.type], ['sector_id', sector]],
    );

    const sheet = workbook.getWorksheet('Ответы');
    assert.equal(sheet.getColumn(1).hidden, true, `${fixture.file}: technical keys must remain hidden`);
    assert.deepEqual(
      answerHeaders.map((_, index) => sheet.getCell(1, index + 1).value),
      answerHeaders,
      `${fixture.file}: headers must survive the editor save`,
    );
    const fields = fieldsFor(fixture.type);
    const rowsByKey = new Map();
    for (let row = 2; row <= sheet.rowCount; row++) {
      const key = sheet.getCell(row, 1).value;
      if (key != null) {
        assert.equal(rowsByKey.has(key), false, `${fixture.file}: duplicate hidden key ${key}`);
        rowsByKey.set(key, row);
      }
    }
    assert.deepEqual([...rowsByKey.keys()].sort(), fields.map(field => field.key).sort());

    for (const field of fields) {
      const row = rowsByKey.get(field.key);
      assert.equal(sheet.getCell(row, 3).value, questionnaireFieldLabel(field), `${fixture.file}: field label ${field.key}`);
      assert.equal(sheet.getCell(row, 5).value ?? '', questionnaireFieldUnit(field.unit), `${fixture.file}: field unit ${field.key}`);
      const options = field.type === 'bool'
        ? ['Да', 'Нет']
        : field.options?.map(option => questionnaireOptionLabel(field.key, option));
      if (options?.length && options.join(',').length < 250) {
        const validation = sheet.getCell(row, 4).dataValidation;
        assert.equal(validation?.type, 'list', `${fixture.file}: choice list missing for ${field.key}`);
        const normalizeListFormula = formula => formula?.replace(/,\s+/g, ',');
        assert.equal(
          normalizeListFormula(validation.formulae?.[0]),
          normalizeListFormula(`"${options.join(',')}"`),
          `${fixture.file}: choice list changed for ${field.key}`,
        );
        assert.equal(validation.allowBlank, true, `${fixture.file}: blank choice state changed for ${field.key}`);
      }
    }

    const imported = await parseQuestionnaire(data);
    assert.deepEqual(imported.errors, [], fixture.file);
    assert.deepEqual(imported.missing, [], fixture.file);
    assert.equal(imported.type, fixture.type);
    assert.equal(imported.sectorId, sector);
    const importedKeys = fields
      .filter(field => fixture.type !== 'custom' || field.required !== false)
      .map(field => field.key);
    assert.deepEqual(Object.keys(imported.values).sort(), importedKeys.sort());
    for (const field of fields) {
      const expected = fixture.type === 'custom'
        ? field.required !== false ? field.example : undefined
        : fixture.type === 'warehouse' && field.key === 'rack_type' ? 'Shuttle' : field.base;
      assert.equal(imported.values[field.key], expected, `${fixture.file}: imported answer ${field.key}`);
    }

    const evidenceKey = fields[0].key;
    const evidenceRow = rowsByKey.get(evidenceKey);
    assert.deepEqual(imported.evidence[evidenceKey], {
      comment: 'Измерено специалистом (тестовый пример)',
      source: 'Тестовый протокол, не данные реального объекта',
      date: '2026-01-30',
    });
    assert.equal(typeof sheet.getCell(evidenceRow, 14).value, 'string', `${fixture.file}: provenance date must stay text`);
    assert.equal(sheet.getCell(evidenceRow, 14).value, '2026-01-30');
    assert.equal(sheet.getCell(evidenceRow, 14).numFmt, fixture.dateFormat ?? '@');
    if (fixture.type === 'warehouse') {
      assert.equal(imported.rawAnswers.rack_type, 'Стеллажи с челночными тележками');
      assert.equal(imported.values.rack_type, 'Shuttle', 'localized choice must import as its canonical value');
    }
  }
});
test('desktop-editor saves still reject formulas and keep required answers mandatory', async () => {
  for (const fixture of officeSavedFixtures) {
    const file = await readFile(new URL(`./fixtures/questionnaire-office/${fixture.file}`, import.meta.url));
    const requiredField = fieldsFor(fixture.type).find(field => field.required !== false);

    const formulaBook = new ExcelJS.Workbook();
    await formulaBook.xlsx.load(file);
    const formulaSheet = formulaBook.getWorksheet('Ответы');
    let row = 2;
    while (formulaSheet.getCell(row, 1).value !== requiredField.key) row++;
    formulaSheet.getCell(row, 4).value = { formula: '1+1', result: 2 };
    await assert.rejects(parsedBook(formulaBook), /формулы/, fixture.file);

    const partialBook = new ExcelJS.Workbook();
    await partialBook.xlsx.load(file);
    partialBook.getWorksheet('Ответы').getCell(row, 4).value = null;
    const partial = await parsedBook(partialBook);
    assert.ok(partial.missing.includes(requiredField.key), fixture.file);
    assert.throws(() => applyQuestionnaireToProject(state, partial, projectFingerprint(state)), /обязательные/);
  }
});
test('parsing and cancelling leave project unchanged; stale/context apply blocked', async () => {
  const before = JSON.stringify(state);
  const staged = await parsedBook(await bookFor('custom'));
  assert.equal(JSON.stringify(state), before);
  // Cancel discards only the staged result, never invoking the transition.
  assert.throws(() => applyQuestionnaireToProject({ ...state, objectParams: {} }, staged, before), /изменился/);
  assert.throws(() => applyQuestionnaireToProject(state, { ...staged, sectorId: null }, before), /Направление/);
  assert.equal(JSON.stringify(state), before);
});
test('reject formulas in answers and every metadata cell, unsupported version/type', async () => {
  for (const [sheet, cell, value] of [
    ['Ответы', 'D2', { formula: '1+1', result: 2 }],
    ['Метаданные', 'B2', { formula: '"1"', result: '1' }],
    ['Метаданные', 'A1', { formula: '"format"', result: 'format' }],
    ['Метаданные', 'B2', '999'], ['Метаданные', 'B3', 'unknown'],
  ]) {
    const book = await bookFor('warehouse');
    book.getWorksheet(sheet).getCell(cell).value = value;
    await assert.rejects(parsedBook(book));
  }
});
test('duplicate/missing/unknown keys and bad provenance dates', async () => {
  for (const mutate of [
    sheet => { sheet.getCell('A3').value = sheet.getCell('A2').value; },
    sheet => { sheet.spliceRows(2, 1); },
    sheet => { sheet.getCell('A2').value = '__proto__'; },
    sheet => { sheet.getCell('N2').value = '2026-02-30'; },
  ]) {
    const book = await bookFor('warehouse');
    mutate(book.getWorksheet('Ответы'));
    assert.ok((await parsedBook(book)).errors.length);
  }
});
test('text provenance dates are locale-independent and require real Gregorian dates', async () => {
  for (const value of ['2024-02-29', '2000-02-29']) {
    const valid = await bookFor('warehouse');
    valid.getWorksheet('Ответы').getCell('N2').value = value;
    const imported = await parsedBook(valid);
    assert.deepEqual(imported.errors, []);
    assert.equal(imported.evidence[fieldsFor('warehouse')[0].key].date, value);
  }

  for (const value of ['2026-02-29', '1900-02-29', '2100-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-01', '0000-01-01', '30.01.2026', '1/30/2026']) {
    const book = await bookFor('warehouse');
    book.getWorksheet('Ответы').getCell('N2').value = value;
    const invalid = await parsedBook(book);
    assert.ok(invalid.errors.some(error => /дата должна быть действительной датой ГГГГ-ММ-ДД/.test(error)), value);
  }

  const formattedDate = await bookFor('warehouse');
  const dateCell = formattedDate.getWorksheet('Ответы').getCell('N2');
  dateCell.value = new Date(Date.UTC(2026, 0, 30));
  dateCell.numFmt = 'm/d/yyyy';
  await assert.rejects(parsedBook(formattedDate), /даты-объекты/);
});
test('validation rejects invalid scalar values and contradictions', () => {
  const base = Object.fromEntries(fieldsFor('warehouse').map(field => [field.key, field.base]));
  for (const change of [
    { floors_count: 1.5 }, { total_area_m2: Infinity }, { total_area_m2: NaN },
    { total_area_m2: 1 }, { floor_type: 'invalid' },
    { total_area_m2: 10000, active_area_m2: 20000 },
    { shifts_per_day: 3 }, { pick_units_per_day: 75000, pick_lines_per_day: 100000 },
    { total_staff: 30, pickers_count: 100 },
  ]) assert.ok(validateAnswers('warehouse', { ...base, ...change }).errors.length, JSON.stringify(change));
  const bool = fieldsFor('warehouse').find(field => field.type === 'bool').key;
  assert.ok(validateAnswers('warehouse', { ...base, [bool]: 'yes' }).errors.length);
  assert.equal(validateAnswers('warehouse', { ...base, [bool]: 'Нет' }).values[bool], false);
  assert.ok(validateAnswers('custom', { site_name: 'x', task: 'y', shifts_per_day: 2.5 }).errors.length);
  assert.ok(validateAnswers('custom', { site_name: 'x', task: 'y', site_area_m2: 0 }).errors.length);
});
test('changed immutable row descriptors block apply, including altered units', async () => {
  for (const [column, changed] of [
    [2, 'Другая группа'], [3, 'Другое название'], [5, 'га'], [6, 'Нет'],
    [7, 'text'], [8, 0], [9, 999999], [10, 'Новый вариант'], [11, 'Другое описание'],
  ]) {
    const book = await bookFor('warehouse');
    book.getWorksheet('Ответы').getCell(2, column).value = changed;
    const staged = await parsedBook(book);
    assert.ok(staged.errors.some(error => /Общая площадь склада.*изменён неизменяемый столбец/.test(error)), `column ${column}`);
    if (column === 5) assert.match(staged.errors.join('\n'), /Единица.*м²/);
    assert.throws(() => applyQuestionnaireToProject(state, staged, projectFingerprint(state)), /Исправьте ошибки/);
  }
});
test('valid reordered rows preserve answers and evidence for all four types', async () => {
  for (const type of ['warehouse', 'airport', 'medical', 'custom']) {
    const book = await bookFor(type);
    const original = await parsedBook(book);
    const sheet = book.getWorksheet('Ответы');
    const rows = [];
    for (let row = 2; row <= sheet.rowCount; row++) rows.push(sheet.getRow(row).values);
    rows.reverse().forEach((values, index) => { sheet.getRow(index + 2).values = values; });
    const reordered = await parsedBook(book);
    assert.deepEqual(reordered.errors, []);
    assert.deepEqual(reordered.missing, []);
    assert.deepEqual(reordered.values, original.values);
    assert.deepEqual(reordered.evidence, original.evidence);
  }
});
test('Russian spreadsheet answers stay readable and enum choices import as canonical values', async () => {
  const book = await bookFor('warehouse', false);
  const sheet = book.getWorksheet('Ответы');
  const fieldIndex = fieldsFor('warehouse').findIndex(field => field.key === 'rack_type');
  const rackRow = fieldIndex + 2;
  assert.equal(sheet.getCell(rackRow, 3).value, 'Тип системы стеллажного хранения');
  assert.equal(sheet.getCell(rackRow, 7).value, 'Выбор из списка');
  assert.match(sheet.getCell(rackRow, 10).value, /Стеллажи с челночными тележками/);
  assert.match(sheet.getCell(rackRow, 4).dataValidation.formulae[0], /Стеллажи с челночными тележками/);
  sheet.getCell(rackRow, 4).value = 'Стеллажи с челночными тележками';
  const imported = await parsedBook(book);
  assert.equal(imported.values.rack_type, 'Shuttle');
  assert.equal(imported.rawAnswers.rack_type, 'Стеллажи с челночными тележками');
});
test('reject oversized/non-xlsx, extra sheets, macros and oversized inflated XML', async () => {
  await assert.rejects(parseQuestionnaire(new ArrayBuffer(MAX_XLSX_BYTES + 1)), /2 МБ/);
  await assert.rejects(parseQuestionnaire(new TextEncoder().encode('not xlsx').buffer));
  const book = await bookFor('custom'); book.addWorksheet('Unexpected');
  await assert.rejects(parsedBook(book), /Неполная или несовместимая анкета.*неподдерживаемые листы «Unexpected».*перенесите в неё только ответы/);
  const incomplete = await bookFor('custom');
  incomplete.removeWorksheet('Инструкция');
  incomplete.removeWorksheet('Метаданные');
  await assert.rejects(parsedBook(incomplete), /не хватает листов «Инструкция», «Метаданные».*перенесите в неё только ответы/);
  const zip = await JSZip.loadAsync(await createQuestionnaire('custom', sector));
  zip.file('xl/vbaProject.bin', 'macro');
  await assert.rejects(read(await zip.generateAsync({ type: 'uint8array' })), /Неподдерживаемое/);
  zip.remove('xl/vbaProject.bin');
  zip.file('xl/too-large.xml', 'a'.repeat(5 * 1024 * 1024));
  await assert.rejects(read(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })), /слишком большое/);
});

if (process.env.QUESTIONNAIRE_FIXTURES) {
  const dir = process.env.QUESTIONNAIRE_FIXTURES;
  await mkdir(dir, { recursive: true });
  for (const type of ['warehouse', 'airport', 'medical', 'custom']) {
    await writeFile(`${dir}/${type}-blank.xlsx`, Buffer.from(await createQuestionnaire(type, sector)));
    await writeFile(`${dir}/${type}-filled.xlsx`, Buffer.from(await (await bookFor(type)).xlsx.writeBuffer()));
  }
  const localizedChoice = await bookFor('warehouse');
  const rackTypeRow = fieldsFor('warehouse').findIndex(field => field.key === 'rack_type') + 2;
  localizedChoice.getWorksheet('Ответы').getCell(rackTypeRow, 4).value = 'Стеллажи с челночными тележками';
  await writeFile(`${dir}/warehouse-russian-choice-filled.xlsx`, Buffer.from(await localizedChoice.xlsx.writeBuffer()));
  const invalid = await bookFor('warehouse'); invalid.getWorksheet('Ответы').getCell('D2').value = { formula: '1+1', result: 2 };
  await writeFile(`${dir}/warehouse-formula-invalid.xlsx`, Buffer.from(await invalid.xlsx.writeBuffer()));
  const partial = await bookFor('warehouse'); partial.getWorksheet('Ответы').getCell('D2').value = null;
  await writeFile(`${dir}/warehouse-partial.xlsx`, Buffer.from(await partial.xlsx.writeBuffer()));
  await writeFile(`${dir}/custom-no-sector.xlsx`, Buffer.from(await (await bookFor('custom', true, null)).xlsx.writeBuffer()));
}