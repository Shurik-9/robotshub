import warehouse from '../data/object-templates/warehouse.json' with { type: 'json' };
import airport from '../data/object-templates/airport.json' with { type: 'json' };
import medical from '../data/object-templates/medical.json' with { type: 'json' };
import custom from '../data/object-templates/custom.json' with { type: 'json' };

export type QuestionnaireType = 'warehouse' | 'airport' | 'medical' | 'custom';
export type Answers = Record<string, string | number | boolean>;
export type Field = {
  key: string; label: string; type: string; base: string | number | boolean;
  unit?: string; min?: number; max?: number; note?: string; options?: string[];
  required?: boolean; maxLength?: number; example?: string | number;
};
export type Template = { name: string; groups: { id: string; name: string; fields: Field[] }[] };
export const questionnaireTemplates: Record<QuestionnaireType, Template> = { warehouse, airport, medical, custom };
export const isQuestionnaireType = (value: unknown): value is QuestionnaireType =>
  typeof value === 'string' && Object.hasOwn(questionnaireTemplates, value);
export const fieldsFor = (type: QuestionnaireType): Field[] => questionnaireTemplates[type].groups.flatMap(group => group.fields);

const russianFieldLabels: Record<string, string> = {
  piece_pick_share_pct: 'Доля мелкоштучного отбора',
  active_sku_count: 'Количество активных товарных позиций',
  fast_moving_sku_share_pct: 'Доля быстрооборачиваемых товаров',
  picker_salary_gross: 'Средняя зарплата комплектовщика до удержания НДФЛ',
  forklift_salary_gross: 'Средняя зарплата оператора погрузчика до удержания НДФЛ',
  rack_type: 'Тип системы стеллажного хранения',
  has_wms: 'Наличие системы управления складом',
  erp_type: 'Система управления предприятием',
  peak_pax_per_hour: 'Максимальный пассажиропоток за час',
  tat_min: 'Время обслуживания самолёта на стоянке',
  ramp_staff: 'Сотрудники наземного обслуживания самолётов',
  ramp_salary_gross: 'Средняя зарплата сотрудника наземного обслуживания до удержания НДФЛ',
  cleaner_salary_gross: 'Средняя зарплата уборщика терминала до удержания НДФЛ',
  has_access_control: 'Система контроля доступа в зоны объекта',
  airside_certification: 'Требования к допуску оборудования в полётную зону',
  has_fids_aodb: 'Информационная система аэропорта и база данных рейсов',
  has_bms: 'Система управления инженерным оборудованием здания',
  medication_names_count: 'Количество наименований лекарств в обращении',
  stat_share_pct: 'Доля срочных доставок лекарств',
  sanitar_salary_gross: 'Средняя зарплата санитаров и транспортировщиков до удержания НДФЛ',
  food_salary_gross: 'Средняя зарплата сотрудников пищеблока до удержания НДФЛ',
  disinfection_required: 'Требования к обеззараживанию робота',
  has_elevator_api: 'Возможность автоматического вызова лифта роботом',
};

const wording: [RegExp, string][] = [
  [/Типичный FFC\/RDC в логистическом парке/gi, 'Типичный распределительный центр в логистическом парке'],
  [/piece-pick/gi, 'мелкоштучный отбор'],
  [/\bSKU\b/gi, 'товарных позиций'],
  [/\bgross\b/gi, 'до удержания НДФЛ'],
  [/\bPHF\b/gi, 'часовой пик'],
  [/\bTAT\b/gi, 'время обслуживания самолёта на стоянке'],
  [/\bramp\b/gi, 'наземное обслуживание самолётов'],
  [/\bAMR\b/gi, 'автономных мобильных роботов'],
  [/\bairside\b/gi, 'полётную зону'],
  [/\blandside\b/gi, 'общедоступную зону'],
  [/\bFIDS\/AODB\b/gi, 'информационные системы аэропорта и базу данных рейсов'],
  [/\bBMS\b/gi, 'систему управления зданием'],
  [/\bERP\b/gi, 'систему управления предприятием'],
  [/\bREST API\b/gi, 'интерфейс обмена данными'],
  [/\bAPI\b/gi, 'интерфейс обмена данными'],
  [/\bKPI\b/gi, 'ключевой показатель'],
  [/\be-com\b/gi, 'электронная торговля'],
  [/\bOPEX\b/gi, 'операционные расходы'],
  [/\bVNA\b/gi, 'узкопроходные погрузчики'],
  [/\bSTAT\b/gi, 'срочных'],
  [/\bКДЛ\b/gi, 'клинико-диагностическая лаборатория'],
  [/\bCAPEX\b/gi, 'капитальные затраты'],
  [/\bRaaS\b/gi, 'роботы как услуга'],
  [/COM-коннектор/gi, 'компонент для связи с другими программами'],
  [/DIN 15185\s*\/\s*FM2\.?\s*Критично для высотных решений/gi, 'Для высоких стеллажей пол должен быть особенно ровным'],
  [/DIN 15185\s*\/\s*FM2/gi, 'стандарт оценки ровности пола'],
  [/Ключевой KPI/gi, 'Ключевой показатель'],
  [/\bABS\b/gi, 'ударопрочный пластик'],
];

const russianOptions: Record<string, Record<string, string>> = {
  rack_type: {
    Shuttle: 'Стеллажи с челночными тележками',
    AutoStore: 'Автоматизированная система хранения с роботами',
    Miniload: 'Автоматизированная система хранения коробов',
    'Drive-in': 'Стеллажи с въездом погрузчика',
    'Push-back': 'Стеллажи с выдвижными паллетами',
  },
  has_access_control: {
    'Да (OSDP)': 'Да, по стандартному протоколу связи',
    'Да (другая)': 'Да, по другому протоколу связи',
  },
  airside_certification: {
    'EASA/ИКАО': 'Международные требования авиационной безопасности',
  },
  erp_type: {
    '1С:ERP': 'Система 1С для управления предприятием',
    SAP: 'Система SAP',
  },
};

export function localizeQuestionnaireText(value: string) {
  return wording.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

export function questionnaireFieldLabel(field: Pick<Field, 'key' | 'label'>) {
  return russianFieldLabels[field.key] ?? localizeQuestionnaireText(field.label);
}

export function questionnaireGroupLabel(value: string) {
  return localizeQuestionnaireText(value);
}

export function questionnaireFieldUnit(value: string | undefined) {
  return value === 'SKU' ? 'позиций' : value ? localizeQuestionnaireText(value) : '';
}

export function questionnaireFieldType(type: string) {
  return ({ number: 'Число', int: 'Целое число', text: 'Текст', enum: 'Выбор из списка', bool: 'Да / Нет' } as Record<string, string>)[type] ?? 'Текст';
}

export function questionnaireOptionLabel(key: string, option: string) {
  return russianOptions[key]?.[option] ?? localizeQuestionnaireText(option);
}

export function questionnaireOptionValue(key: string, option: string) {
  return Object.entries(russianOptions[key] ?? {}).find(([, label]) => label === option)?.[0] ?? option;
}

export function validateAnswers(type: QuestionnaireType, raw: Record<string, unknown>) {
  const values: Answers = {};
  const errors: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];
  const fields = fieldsFor(type);
  for (const key of Object.keys(raw)) if (!fields.some(field => field.key === key)) errors.push(`Неизвестный ключ: ${key}`);
  for (const field of fields) {
    let value = raw[field.key];
    if (typeof value === 'string') value = value.trim();
    if (value === '' || value == null) {
      if (field.required !== false) missing.push(field.key);
      continue;
    }
    const fail = (reason: string) => errors.push(`${questionnaireFieldLabel(field)}: ${reason}`);
    if (field.type === 'number' || field.type === 'int') {
      if (typeof value === 'string' && /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value)) value = Number(value.replace(',', '.'));
      if (typeof value !== 'number' || !Number.isFinite(value)) { fail('нужно конечное число'); continue; }
      if (field.type === 'int' && !Number.isInteger(value)) { fail('нужно целое число'); continue; }
      if ((field.min != null && value < field.min) || (field.max != null && value > field.max)) { fail(`вне диапазона ${field.min ?? '—'} … ${field.max ?? '—'}`); continue; }
    } else if (field.type === 'bool') {
      if (value === 'Да') value = true;
      if (value === 'Нет') value = false;
      if (typeof value !== 'boolean') { fail('допустимо только Да / Нет'); continue; }
    } else if (field.type === 'enum') {
      if (typeof value !== 'string' || !field.options?.includes(value)) { fail('значение отсутствует в списке'); continue; }
    } else if (typeof value !== 'string' || value.length > (field.maxLength ?? 2000)) {
      fail(`нужен текст до ${field.maxLength ?? 2000} символов`); continue;
    }
    values[field.key] = value as string | number | boolean;
  }
  const n = (key: string) => typeof values[key] === 'number' ? values[key] as number : undefined;
  const lte = (a: string, b: string, message: string) => {
    if (n(a) != null && n(b) != null && n(a)! > n(b)!) errors.push(message);
  };
  lte('active_area_m2', 'total_area_m2', 'Активная площадь не может превышать общую.');
  lte('cleaning_area_m2', 'terminal_area_m2', 'Площадь уборки не может превышать площадь терминалов.');
  lte('pick_lines_per_day', 'pick_units_per_day', 'Количество штук не может быть меньше количества строк отбора.');
  lte('refueling_flights_per_day', 'flights_per_day', 'Заправляемых рейсов больше общего числа рейсов.');
  lte('peak_flights_per_hour', 'flights_per_day', 'Рейсов в пиковый час больше, чем за сутки.');
  lte('peak_pax_per_hour', 'pax_per_day', 'Пассажиров в пиковый час больше, чем за сутки.');
  if (n('shifts_per_day') != null && n('shift_duration_h') != null && n('shifts_per_day')! * n('shift_duration_h')! > 24) errors.push('Суммарная продолжительность смен превышает 24 часа в сутки.');
  for (const key of ['pickers_count', 'forklift_operators_count', 'packing_operators_count']) lte(key, 'total_staff', 'Численность отдельной группы превышает общую численность персонала.');
  if (n('pax_per_year_mln') && n('pax_per_day') && Math.abs(n('pax_per_year_mln')! * 1e6 / 365 - n('pax_per_day')!) / n('pax_per_day')! > 0.1) warnings.push('Среднесуточный пассажиропоток отличается от годового / 365 более чем на 10%. Проверьте сезонность и период измерения.');
  if (type === 'medical' && n('beds_count') && n('food_portions_per_day') && n('meals_per_day_count') && n('beds_occupancy_pct')) {
    const estimate = n('beds_count')! * n('beds_occupancy_pct')! / 100 * n('meals_per_day_count')!;
    if (Math.abs(estimate - n('food_portions_per_day')!) / estimate > 0.1) warnings.push('Порции питания отличаются от оценки по занятым койкам и кратности более чем на 10%. Уточните дополнительные потоки.');
  }
  if (n('floors_count')! > 1) warnings.push('Этажи генерируются из скалярных параметров. Отдельные планы этажей и зон не импортируются; доступность лифтов и интеграций проверяется далее.');
  return { values, errors, missing, warnings };
}