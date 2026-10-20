import type { StartScopeDraft } from './start-scope.ts';
import { fieldsForProcess, type SiteProcess } from './start-processes.ts';

export type StartValueInputs = {
  manualHoursPerShift: number;
  automationPct: number;
  hourCostRub: number;
  shiftsYear: number;
  cashablePct: number;
  targetYears: number;
  quotedTotalCostRub: number | null;
};

export function defaultStartValueInputs(): StartValueInputs {
  return { manualHoursPerShift: 4, automationPct: 50, hourCostRub: 600,
    shiftsYear: 250, cashablePct: 50, targetYears: 3, quotedTotalCostRub: null };
}

export function parseStartValueInputs(value: unknown): StartValueInputs | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const bounds = {
    manualHoursPerShift: [0, 2400], automationPct: [0, 100], hourCostRub: [0, 100000],
    shiftsYear: [1, 1098], cashablePct: [0, 100], targetYears: [1, 20],
  } as const;
  const result = {} as StartValueInputs;
  for (const key of Object.keys(bounds) as (keyof typeof bounds)[]) {
    const number = input[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < bounds[key][0] || number > bounds[key][1]) return null;
    result[key] = number;
  }
  if (!Number.isInteger(result.shiftsYear)) return null;
  const quote = input.quotedTotalCostRub;
  if (quote !== null && (typeof quote !== 'number' || !Number.isFinite(quote) || quote <= 0 || quote > 1e12)) return null;
  result.quotedTotalCostRub = quote as number | null;
  return result;
}

export function calculateStartValue(input: StartValueInputs) {
  const value = parseStartValueInputs(input);
  if (!value) throw new Error('Проверьте исходные значения: отрицательные, пустые и выходящие за границы числа считать нельзя.');
  const freedHoursPerShift = value.manualHoursPerShift * value.automationPct / 100;
  const remainingHoursPerShift = value.manualHoursPerShift - freedHoursPerShift;
  const annualFreedHours = freedHoursPerShift * value.shiftsYear;
  const annualCashEffectRub = annualFreedHours * value.hourCostRub * value.cashablePct / 100;
  // This is a break-even ceiling on all ownership costs, NOT an assumed robot price.
  const maxOwnershipBudgetRub = annualCashEffectRub * value.targetYears;
  const quotedPaybackYears = value.quotedTotalCostRub !== null && annualCashEffectRub > 0
    ? value.quotedTotalCostRub / annualCashEffectRub : null;
  const verdict = annualCashEffectRub === 0
    ? 'Денежная окупаемость на этих вводных не обоснована. Свободное время само по себе не уменьшает расходы.'
    : value.quotedTotalCostRub === null
      ? 'Есть условный экономический предел для проверки предложения. Цены и пригодность решения пока не подтверждены.'
      : value.quotedTotalCostRub <= maxOwnershipBudgetRub
        ? 'Указанная полная стоимость укладывается в предел сценария. Следующий шаг — проверить эффект и состав цены на пилоте.'
        : 'Указанная полная стоимость выше предела сценария. За выбранный срок этот эффект затраты не покрывает.';
  return { manualHoursPerShift: value.manualHoursPerShift, freedHoursPerShift, remainingHoursPerShift,
    annualFreedHours, annualCashEffectRub, maxOwnershipBudgetRub, quotedPaybackYears, verdict };
}

export function processDivision(process: SiteProcess) {
  if (process.kind === 'cleaning') return {
    robot: 'Повторяемые проходы по доступному полу',
    human: 'Кромки, подготовка зоны, заправка и контроль качества',
    limitation: 'Доступная площадь, покрытие и ручная доработка ещё не проверены.',
  };
  if (process.kind === 'inspection') return {
    robot: 'Повторяемый сбор доступных показаний или идентификаторов',
    human: 'Разбор расхождений и решение по результатам проверки',
    limitation: 'Способ считывания, доступ к точкам и точность ещё не подтверждены.',
  };
  if (process.kind === 'picking') return {
    robot: 'Возможный подвоз товара или тары к месту отбора',
    human: 'Отбор единиц товара, сложные захваты и контроль комплектации',
    limitation: 'Автоматический захват и сборка заказа здесь не оценены; подвоз не равен автоматизации всего отбора.',
  };
  if (process.kind === 'custom') return {
    robot: 'Повторяемая часть работы — её ещё нужно определить',
    human: 'Исключения, передача работы и контроль результата',
    limitation: 'Состав операции неизвестен. Цифры ниже — проверка условного бюджета, не подтверждение роботизируемости.',
  };
  return {
    robot: 'Повторяемое перемещение между согласованными точками',
    human: 'Приёмка, подготовка груза, передача и обработка исключений',
    limitation: 'Маршрут, груз, безопасность и передача человеку ещё не проверены. Сортировка, захват, хранение и весь процесс не считаются автоматизированными.',
  };
}

const number = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

export function buildStartValueTask(draft: StartScopeDraft, process: SiteProcess, input: StartValueInputs): string {
  const result = calculateStartValue(input);
  const division = processDivision(process);
  const facts = draft.details[process.id];
  const known = fieldsForProcess(process.kind)
    .filter(field => facts && (facts.unknown[field.key] || facts.values[field.key]?.trim()))
    .map(field => `${field.label}: ${facts!.unknown[field.key] ? 'неизвестно' : `${facts!.values[field.key]} ${field.unit ?? ''}`.trim()}.`);
  return [
    `ЗАДАНИЕ НА ПРОВЕРКУ: ${process.name}`,
    'Статус: условный сценарий. Вводные и применимость робота не подтверждены обследованием.',
    '',
    `1. Проверить, можно ли высвободить ${number(result.freedHoursPerShift)} чел·ч за смену из ${number(input.manualHoursPerShift)} чел·ч ручной работы (${number(input.automationPct)}%). Это не утверждение о сокращении сотрудников.`,
    `2. Подтвердить ${number(input.shiftsYear)} рабочих смен в год и полную стоимость ручного часа ${number(input.hourCostRub)} ₽, включая связанные затраты работодателя.`,
    `3. Проверить денежный эффект: в сценарии только ${number(input.cashablePct)}% высвобождённого времени превращается в сокращение сверхурочных, подряда, незамещаемых вакансий или других реальных расходов. Условный эффект — ${number(result.annualCashEffectRub)} ₽/год. Если деньги не высвобождаются, этот эффект равен нулю.`,
    `4. Запросить полную стоимость роботизации за ${number(input.targetYears)} года: оборудование, интеграция, подготовка площадки, сервис и энергия. Для покрытия затрат этим эффектом суммарный бюджет не должен превышать ${number(result.maxOwnershipBudgetRub)} ₽. Сохранённую ручную работу повторно в бюджет не добавлять: она уже не входит в высвобождённые часы. Обслуживание силами своих работников учесть либо при замере чистого высвобождения времени, либо отдельной статьёй затрат, не дважды. Это не цена робота и не инвестиционная рекомендация; дисконтирование и другие эффекты не учтены.`,
    input.quotedTotalCostRub === null ? 'Полное ценовое предложение ещё не получено.' : `В сценарий внесена полная стоимость ${number(input.quotedTotalCostRub)} ₽. ${result.verdict}`,
    '',
    `5. На пилоте измерить работу до и после на сопоставимом объёме, включая пиковый период. Отдельно учитывать оставшиеся ручные операции, простои, ошибки и безопасность. Ожидаемая роль робота: ${division.robot}. Человека: ${division.human}.`,
    `Ограничение: ${division.limitation}`,
    '',
    known.length ? `УЖЕ ЗАПИСАННЫЕ ФАКТЫ ПО УЧАСТКУ (не заменяют замеры времени):\n${known.join('\n')}` : 'Фактические замеры и ограничения участка пока не записаны.',
    '',
    'РЕЗУЛЬТАТ ПРОВЕРКИ: подтвердить или отклонить гипотезу с замерами времени, реальной монетизацией и полным предложением по стоимости. Не выбирать парк и не обещать окупаемость только по площади объекта.',
    'Расчёты по участкам нельзя складывать без проверки: они могут описывать одних и тех же сотрудников и часы.',
  ].join('\n');
}
