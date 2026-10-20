import type { WorkbenchInputs } from '@/lib/start-workbench';

export type WbKey = keyof WorkbenchInputs;
export type WbField = {
  key: WbKey; label: string; unit: string; min: number; max: number; step: number;
  sliderMax?: number; optional?: string; hint?: string;
};
export type WbTexts = Record<WbKey, string>;

/** unit placeholder «{u}» is replaced by the process operation unit */
export const FLOW_FIELDS: WbField[] = [
  { key: 'loadPerHour', label: 'Нагрузка участка', unit: '{u}', min: 0.1, max: 1000000, step: 1, sliderMax: 2000, hint: 'Задаётся отдельно: площадь не определяет поток.' },
  { key: 'robotRatePerHour', label: 'Темп одного робота без простоев', unit: '{u}', min: 0.1, max: 1000000, step: 0.1, sliderMax: 500, hint: 'Простои и зарядка учитываются отдельно.' },
  { key: 'robotCount', label: 'Число роботов', unit: 'шт.', min: 0, max: 1000000, step: 1, sliderMax: 50, optional: 'авто', hint: 'Пусто — подбор; 0 — без роботов.' },
  { key: 'pricePerRobotRub', label: 'Цена одного робота', unit: '₽', min: 1, max: 1e10, step: 10000, sliderMax: 15e6 },
];
export const LABOR_FIELDS: WbField[] = [
  { key: 'manualHoursPerShift', label: 'Ручная работа всех людей', unit: 'чел·ч/смену', min: 0, max: 2400, step: 0.5, sliderMax: 200, hint: 'Человеко-часы, не время работы робота.' },
  { key: 'automationPct', label: 'Доля ручного времени, которую надеемся высвободить', unit: '%', min: 0, max: 100, step: 1 },
  { key: 'hourCostRub', label: 'Полная стоимость часа сотрудника', unit: '₽/чел·ч', min: 0, max: 100000, step: 10, sliderMax: 3000 },
  { key: 'cashablePct', label: 'Доля времени, ставшая деньгами', unit: '%', min: 0, max: 100, step: 1 },
];
export const ADVANCED_FIELDS: WbField[] = [
  { key: 'hoursPerShift', label: 'Часов в смене', unit: 'ч', min: 0.5, max: 24, step: 0.5 },
  { key: 'shiftsYear', label: 'Смен в году', unit: 'смен', min: 1, max: 1098, step: 1 },
  { key: 'operatingPct', label: 'Рабочая загрузка без учёта зарядки', unit: '%', min: 1, max: 100, step: 1 },
  { key: 'reservePct', label: 'Резерв на пики', unit: '%', min: 0, max: 200, step: 1, sliderMax: 100 },
  { key: 'batteryHours', label: 'Работа от одного заряда', unit: 'ч', min: 0.1, max: 168, step: 0.5, sliderMax: 24 },
  { key: 'chargeHours', label: 'Время зарядки', unit: 'ч', min: 0, max: 168, step: 0.25, sliderMax: 8 },
  { key: 'integrationRub', label: 'Интеграция и запуск (фикс.)', unit: '₽', min: 0, max: 1e11, step: 50000, sliderMax: 30e6 },
  { key: 'servicePctYear', label: 'Сервис оборудования', unit: '% цены роботов/год', min: 0, max: 100, step: 0.5, sliderMax: 30 },
  { key: 'energyRubYear', label: 'Энергия и прочий OPEX роботов', unit: '₽/год', min: 0, max: 1e11, step: 5000, sliderMax: 3e6 },
  { key: 'targetYears', label: 'Горизонт / целевой срок', unit: 'лет', min: 1, max: 20, step: 0.5 },
  { key: 'quotedTotalCostRub', label: 'Ранее записанное предложение TCO (справочно)', unit: '₽', min: 1, max: 1e12, step: 100000, sliderMax: 100e6, optional: 'нет предложения', hint: 'Не подставляется в цену оборудования: TCO включает эксплуатацию.' },
];
export const ALL_FIELDS = [...FLOW_FIELDS, ...LABOR_FIELDS, ...ADVANCED_FIELDS];

export const toTexts = (i: WorkbenchInputs): WbTexts => {
  const out = {} as WbTexts;
  for (const f of ALL_FIELDS) { const v = i[f.key]; out[f.key] = v == null ? '' : String(v); }
  return out;
};

export function parseTexts(t: WbTexts, validate: (raw: unknown) => WorkbenchInputs | null): { inputs: WorkbenchInputs | null; errors: Partial<Record<WbKey, string>> } {
  const errors: Partial<Record<WbKey, string>> = {};
  const out: Record<string, number | null> = {};
  for (const f of ALL_FIELDS) {
    const raw = (t[f.key] ?? '').trim().replace(/\s/g, '').replace(',', '.');
    if (!raw && f.optional) { out[f.key] = null; continue; }
    const n = Number(raw);
    if (!raw || !Number.isFinite(n)) errors[f.key] = 'Введите число.';
    else if (n < f.min || n > f.max) errors[f.key] = `Допустимо ${f.min.toLocaleString('ru-RU')}–${f.max.toLocaleString('ru-RU')}. Не исправлено автоматически.`;
    else if (f.key === 'robotCount' && !Number.isInteger(n)) errors[f.key] = 'Целое число или пусто.';
    out[f.key] = n;
  }
  if (Object.keys(errors).length) return { inputs: null, errors };
  if (Number(out.hoursPerShift) * Number(out.shiftsYear) > 8784) {
    return { inputs: null, errors: { shiftsYear: 'Рабочих часов в году не может быть больше 8 784. Проверьте длительность и число смен.' } };
  }
  const parsed = validate(out);
  return parsed ? { inputs: parsed, errors } : { inputs: null, errors: { loadPerHour: 'Набор параметров не прошёл проверку модели.' } };
}

export const fieldLabel = (key: WbKey) => ALL_FIELDS.find(f => f.key === key)?.label ?? key;
export const rubShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return { v: (n / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 2 }), u: 'млрд ₽' };
  if (a >= 1e6) return { v: (n / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 }), u: 'млн ₽' };
  if (a < 1000) return { v: Math.round(n).toLocaleString('ru-RU'), u: '₽' };
  return { v: Math.round(n / 1000).toLocaleString('ru-RU'), u: 'тыс ₽' };
};
export const num = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ru-RU');
