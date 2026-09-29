import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { fieldsFor, isQuestionnaireType, localizeQuestionnaireText, questionnaireFieldLabel, questionnaireFieldType, questionnaireFieldUnit, questionnaireGroupLabel, questionnaireOptionLabel, questionnaireOptionValue, questionnaireTemplates, validateAnswers, type Field, type QuestionnaireType } from './questionnaire-schema.ts';

export const QUESTIONNAIRE_VERSION = '1';
export const MAX_XLSX_BYTES = 2 * 1024 * 1024;
export const SHEETS = ['Инструкция', 'Метаданные', 'Ответы', 'Примеры'] as const;
export const answerHeaders = ['Ключ (не менять)', 'Группа', 'Параметр', 'Ответ', 'Единица', 'Обязательно', 'Тип', 'Минимум', 'Максимум', 'Допустимые значения', 'Описание', 'Комментарий специалиста', 'Источник', 'Дата данных (ГГГГ-ММ-ДД)'];
export type AnswerEvidence = Record<string, { comment: string; source: string; date: string }>;
export type QuestionnaireImport = ReturnType<typeof validateAnswers> & {
  type: QuestionnaireType; sectorId: string | null; evidence: AnswerEvidence; rawAnswers: Record<string, unknown>;
};
function canonicalRow(field: Field, groupName: string) {
  const options = field.type === 'bool' ? ['Да', 'Нет'] : field.options?.map(option => questionnaireOptionLabel(field.key, option));
  return [field.key, questionnaireGroupLabel(groupName), questionnaireFieldLabel(field), null, questionnaireFieldUnit(field.unit), field.required === false ? 'Нет' : 'Да', questionnaireFieldType(field.type), field.min ?? '', field.max ?? '', options?.join(' | ') ?? '', field.note ? localizeQuestionnaireText(field.note) : '', null, null, null];
}
const instructions = [
  'Анкета параметров объекта. Заполняйте лист «Ответы»: вносите данные в жёлтые ячейки столбца «Ответ».',
  'Поля «Комментарий специалиста», «Источник» и «Дата данных» заполняйте при необходимости. Дата вводится текстом в формате ГГГГ-ММ-ДД.',
  'Ответы изначально пустые. Лист «Примеры» содержит только учебные значения, а не сведения о вашем объекте. Не копируйте их без проверки.',
  'Все поля типовых объектов обязательны для применения: пустое значение не заменяется нулём или типовым значением. В своём объекте обязательны только название и задача.',
  'Числа вводите без единиц измерения. Для ответов «Да / Нет» используйте список. Для остальных списков выбирайте подходящий вариант. Формулы запрещены.',
  'В столбце «Тип» указано, какой ответ нужен: число, целое число, текст или выбор из списка. Минимум и максимум включены в допустимый диапазон.',
  'Первый столбец с техническими кодами и лист «Метаданные» скрыты: заполнять и менять их не нужно. Не меняйте заголовки, названия параметров и состав листов.',
  'Анкета привязана к направлению, выбранному при скачивании. Не копируйте значения из других анкет.',
  'Комментарии, источники и даты сохраняются с проектом, но НЕ участвуют в расчёте. Дата — текст ГГГГ-ММ-ДД.',
  'Анкета содержит параметры объекта. Отдельные исходные данные экономики операций могут потребоваться после выбора модели. Импорт не подтверждает применимость моделей.',
  'Планы отдельных этажей и зон в этой анкете не редактируются.',
  'После загрузки проверьте предварительный просмотр. Только кнопка «Применить» заменяет объект и очищает старые выборы моделей, расчётные поправки и показатели расчёта. Кнопка «Отмена» ничего не меняет.',
];

export async function createQuestionnaire(type: QuestionnaireType, sectorId: string | null) {
  const book = new ExcelJS.Workbook();
  book.creator = 'RobotsHub';
  const help = book.addWorksheet(SHEETS[0]);
  help.getColumn(1).width = 130;
  instructions.forEach(text => { const row = help.addRow([text]); row.alignment = { wrapText: true, vertical: 'top' }; row.height = 45; });
  const meta = book.addWorksheet(SHEETS[1]);
  meta.addRows([['format', 'robotshub-object-questionnaire'], ['version', QUESTIONNAIRE_VERSION], ['object_type', type], ['sector_id', sectorId ?? '']]);
  meta.columns = [{ width: 28 }, { width: 65 }];
  meta.state = 'hidden';
  const answers = book.addWorksheet(SHEETS[2], { views: [{ state: 'frozen', ySplit: 1, xSplit: 3 }] });
  answers.addRow(answerHeaders);
  answers.getColumn(1).hidden = true;
  const examples = book.addWorksheet(SHEETS[3]);
  examples.addRow(['Раздел', 'Параметр', 'Единица', 'Пояснение', 'Учебный пример — НЕ переносить без проверки']);
  examples.columns = [{ width: 34 }, { width: 54 }, { width: 18 }, { width: 76 }, { width: 46 }];
  for (const group of questionnaireTemplates[type].groups) for (const field of group.fields) {
    const options = field.type === 'bool' ? ['Да', 'Нет'] : field.options;
    const row = answers.addRow(canonicalRow(field, group.name));
    const cell = row.getCell(4);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    cell.note = `${questionnaireFieldLabel(field)}. ${field.note ? localizeQuestionnaireText(field.note) : ''} ${field.required === false ? 'Необязательно.' : 'Обязательно.'}`;
    const displayOptions = options?.map(option => questionnaireOptionLabel(field.key, option));
    if (displayOptions && displayOptions.join(',').length < 250) cell.dataValidation = { type: 'list', allowBlank: true, formulae: [`"${displayOptions.join(',')}"`], showErrorMessage: true, errorTitle: 'Недопустимый ответ', error: 'Выберите значение из списка.' };
    row.getCell(14).numFmt = '@';
    const example = field.example ?? (typeof field.base === 'boolean' ? field.base ? 'Да' : 'Нет' : field.base);
    examples.addRow([
      questionnaireGroupLabel(group.name),
      questionnaireFieldLabel(field),
      questionnaireFieldUnit(field.unit),
      field.note ? localizeQuestionnaireText(field.note) : '',
      field.type === 'enum' && typeof example === 'string'
        ? questionnaireOptionLabel(field.key, example)
        : typeof example === 'string' ? localizeQuestionnaireText(example) : example,
    ]);
    row.alignment = { wrapText: true, vertical: 'top' };
    row.height = 55;
  }
  answers.columns.forEach((column, i) => { column.width = [34, 26, 45, 30, 12, 14, 12, 12, 12, 48, 65, 40, 40, 24][i]; });
  answers.getRow(1).font = { bold: true };
  answers.getRow(1).height = 35;
  answers.autoFilter = `A1:N${answers.rowCount}`;
  answers.getColumn(1).hidden = true;
  examples.getRow(1).font = { bold: true };
  examples.getRow(1).height = 36;
  examples.columns.forEach(column => { column.alignment = { wrapText: true, vertical: 'top' }; });
  for (let row = 2; row <= examples.rowCount; row++) examples.getRow(row).height = 42;
  examples.autoFilter = `A1:E${examples.rowCount}`;
  return book.xlsx.writeBuffer();
}

// Reject huge/deceptive ZIP envelopes before ExcelJS inflates XML.
export function checkXlsxEnvelope(data: ArrayBuffer) {
  if (data.byteLength > MAX_XLSX_BYTES) throw new Error('Файл превышает 2 МБ.');
  const view = new DataView(data);
  if (data.byteLength < 22 || view.getUint32(0, true) !== 0x04034b50) throw new Error('Ожидается обычный файл XLSX (ZIP), не XLS/CSV.');
  let end = -1;
  for (let i = data.byteLength - 22; i >= Math.max(0, data.byteLength - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('Повреждённый или многотомный XLSX.');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true), total = 0;
  if (count > 200 || count === 0) throw new Error('Слишком много частей XLSX.');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Некорректный ZIP-каталог.');
    const size = view.getUint32(offset + 24, true);
    total += size;
    const nameLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(new Uint8Array(data, offset + 46, nameLength));
    if (total > 12 * 1024 * 1024 || size > 4 * 1024 * 1024 || /(?:vbaProject|externalLinks|embeddings|activeX|\.\.)/i.test(name) || view.getUint16(offset + 8, true) & 1) throw new Error('Неподдерживаемое или слишком большое содержимое XLSX.');
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
}

function primitive(cell: ExcelJS.Cell): string | number | boolean | null {
  const value = cell.value;
  if (value == null) return null;
  if (typeof value === 'object') throw new Error(`${cell.address}: формулы, ссылки, даты-объекты и составные значения запрещены. Введите обычное значение (дату — текстом).`);
  if (typeof value === 'string' && value.length > 4000) throw new Error(`${cell.address}: слишком длинное значение.`);
  return value;
}

function isValidIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

export async function parseQuestionnaire(data: ArrayBuffer): Promise<QuestionnaireImport> {
  checkXlsxEnvelope(data);
  // Stream and discard once with hard limits; do not trust advertised ZIP sizes.
  const zip = await JSZip.loadAsync(data);
  let inflated = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    await new Promise<void>((resolve, reject) => {
      let size = 0;
      // JSZip exposes this documented streaming API but omits it from JSZipObject's typings.
      const stream = (entry as typeof entry & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream('uint8array');
      stream.on('data', chunk => {
        size += chunk.length; inflated += chunk.length;
        if (size > 4 * 1024 * 1024 || inflated > 12 * 1024 * 1024) {
          stream.pause(); reject(new Error('Распакованное содержимое XLSX слишком велико.'));
        }
      }).on('error', reject).on('end', resolve).resume();
    });
  }
  const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(data); } catch { throw new Error('Не удалось прочитать XLSX. Скачайте новую анкету и перенесите ответы.'); }
  const presentSheets = new Set(book.worksheets.map(sheet => sheet.name));
  const missingSheets = SHEETS.filter(name => !presentSheets.has(name));
  const extraSheets = book.worksheets.map(sheet => sheet.name).filter(name => !SHEETS.includes(name as typeof SHEETS[number]));
  if (missingSheets.length || extraSheets.length || book.worksheets.length !== SHEETS.length) {
    const problems = [
      missingSheets.length ? `не хватает листов «${missingSheets.join('», «')}»` : '',
      extraSheets.length ? `есть неподдерживаемые листы «${extraSheets.join('», «')}»` : '',
    ].filter(Boolean).join('; ');
    throw new Error(`Неполная или несовместимая анкета: ${problems}. Скачайте новую XLSX в RobotsHub и перенесите в неё только ответы, комментарии, источники и даты. Не удаляйте листы и не меняйте заголовки.`);
  }
  const meta = book.getWorksheet(SHEETS[1])!;
  if (meta.rowCount !== 4 || meta.columnCount !== 2) throw new Error('Повреждена структура метаданных.');
  const expectedKeys = ['format', 'version', 'object_type', 'sector_id'];
  const metadata = expectedKeys.map((key, index) => {
    if (primitive(meta.getCell(index + 1, 1)) !== key) throw new Error('Неизвестный, отсутствующий или повторный ключ метаданных.');
    return primitive(meta.getCell(index + 1, 2));
  });
  if (metadata[0] !== 'robotshub-object-questionnaire' || metadata[1] !== QUESTIONNAIRE_VERSION) throw new Error('Неподдерживаемый формат или версия анкеты.');
  const type = metadata[2];
  if (!isQuestionnaireType(type)) throw new Error('Неподдерживаемый тип объекта.');
  const sectorId = metadata[3];
  if (sectorId != null && sectorId !== '' && (typeof sectorId !== 'string' || !/^[\p{L}\p{N} _-]{1,80}$/u.test(sectorId))) throw new Error('Некорректное направление анкеты.');
  const sheet = book.getWorksheet(SHEETS[2])!;
  const fields = fieldsFor(type);
  const descriptors = new Map(questionnaireTemplates[type].groups.flatMap(group =>
    group.fields.map(field => [field.key, canonicalRow(field, group.name)] as const)));
  if (sheet.rowCount > fields.length + 10 || sheet.columnCount > answerHeaders.length) throw new Error('Неожиданный размер таблицы ответов.');
  answerHeaders.forEach((header, index) => { if (primitive(sheet.getCell(1, index + 1)) !== header) throw new Error('Изменены заголовки анкеты.'); });
  const raw: Record<string, unknown> = Object.create(null);
  const evidence: AnswerEvidence = {};
  const errors: string[] = [];
  const rawAnswers: Record<string, unknown> = Object.create(null);
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    if (!row.hasValues) continue;
    const key = primitive(row.getCell(1));
    if (typeof key !== 'string' || !fields.some(field => field.key === key)) { errors.push(`Строка ${i}: неизвестный служебный код параметра. Не меняйте скрытые столбцы; скачайте новую анкету.`); continue; }
    if (Object.hasOwn(raw, key)) { errors.push('Один и тот же параметр указан несколько раз. Скачайте новую анкету и перенесите только ответы.'); continue; }
    const field = fields.find(candidate => candidate.key === key)!;
    const expected = descriptors.get(key)!;
    for (const column of [2, 3, 5, 6, 7, 8, 9, 10, 11]) {
      if ((primitive(row.getCell(column)) ?? '') !== expected[column - 1]) {
        errors.push(`Строка ${i}, параметр «${questionnaireFieldLabel(field)}»: изменён неизменяемый столбец «${answerHeaders[column - 1]}». Ожидается «${expected[column - 1] === '' ? '(пусто)' : expected[column - 1]}». Скачайте новую анкету и перенесите только ответы и сведения специалиста; единицы измерения и описание полей менять нельзя.`);
      }
    }
    const enteredAnswer = primitive(row.getCell(4));
    rawAnswers[key] = enteredAnswer;
    raw[key] = typeof enteredAnswer === 'string' ? questionnaireOptionValue(key, enteredAnswer) : enteredAnswer;
    const notes = [12, 13, 14].map(column => {
      const value = primitive(row.getCell(column));
      if (value != null && typeof value !== 'string') throw new Error(`Строка ${i}: комментарий, источник и дата должны быть текстом.`);
      return String(value ?? '').trim();
    });
    if (notes[2] && !isValidIsoDate(notes[2])) errors.push(`${key}: дата должна быть действительной датой ГГГГ-ММ-ДД.`);
    if (notes.some(Boolean)) evidence[key] = { comment: notes[0], source: notes[1], date: notes[2] };
  }
  for (const field of fields) if (!Object.hasOwn(raw, field.key)) errors.push(`Отсутствует строка параметра «${questionnaireFieldLabel(field)}». Скачайте новую анкету и перенесите ответы.`);
  const validated = validateAnswers(type, raw);
  return { ...validated, errors: [...errors, ...validated.errors], type, sectorId: typeof sectorId === 'string' && sectorId ? sectorId : null, evidence, rawAnswers: { ...rawAnswers } };
}