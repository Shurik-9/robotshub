import { calculateStartValue, defaultStartValueInputs, parseStartValueInputs, type StartValueInputs } from './start-value.ts';
import type { StartScopeDraft } from './start-scope.ts';
import type { SiteProcess } from './start-processes.ts';

export const WORKBENCH_MODEL_VERSION = '1';
export type WorkbenchInputs = StartValueInputs & {
  loadPerHour: number; robotRatePerHour: number; hoursPerShift: number;
  operatingPct: number; reservePct: number; batteryHours: number; chargeHours: number;
  robotCount: number | null; pricePerRobotRub: number; integrationRub: number;
  servicePctYear: number; energyRubYear: number;
};
export type WorkbenchVariant = { id: string; name: string; inputs: WorkbenchInputs };
export type WorkbenchPlan = {
  selectedId: string; variants: WorkbenchVariant[];
  approval?: { at: string; signature: string; modelVersion: string };
};

export function defaultWorkbenchInputs(legacy?: StartValueInputs): WorkbenchInputs {
  return {
    ...defaultStartValueInputs(), manualHoursPerShift: 32, ...legacy,
    loadPerHour: 40, robotRatePerHour: 80, hoursPerShift: 8,
    operatingPct: 78, reservePct: 15, batteryHours: 8, chargeHours: 2,
    robotCount: null, pricePerRobotRub: 2700000, integrationRub: 100000,
    servicePctYear: 10, energyRubYear: 30000,
  };
}

export function parseWorkbenchInputs(raw: unknown): WorkbenchInputs | null {
  const base = parseStartValueInputs(raw);
  if (!base || !raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const ranges = {
    loadPerHour: [0.1, 1000000], robotRatePerHour: [0.1, 1000000],
    hoursPerShift: [0.5, 24], operatingPct: [1, 100], reservePct: [0, 200],
    batteryHours: [0.1, 168], chargeHours: [0, 168], pricePerRobotRub: [1, 1e10],
    integrationRub: [0, 1e11], servicePctYear: [0, 100], energyRubYear: [0, 1e11],
  } as const;
  const result = { ...base } as WorkbenchInputs;
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
    const value = source[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < ranges[key][0] || value > ranges[key][1]) return null;
    result[key] = value;
  }
  if (source.robotCount !== null && (typeof source.robotCount !== 'number' || !Number.isInteger(source.robotCount)
    || source.robotCount < 0 || source.robotCount > 1000000)) return null;
  result.robotCount = source.robotCount as number | null;
  if (result.hoursPerShift * result.shiftsYear > 8784) return null;
  return result;
}

export function calculateWorkbench(raw: WorkbenchInputs) {
  const input = parseWorkbenchInputs(raw);
  if (!input) throw new Error('Параметры сценария неверны. Пустые или недопустимые значения не заменяются типовыми.');
  // Utilization excludes charging; the independent battery factor is applied once.
  const batteryFactor = input.batteryHours / (input.batteryHours + input.chargeHours);
  const effectiveRate = input.robotRatePerHour * input.operatingPct / 100 * batteryFactor;
  const peakDemandPerHour = input.loadPerHour * (1 + input.reservePct / 100);
  const requiredRobotCount = Math.ceil(peakDemandPerHour / effectiveRate - 1e-10);
  const robotCount = input.robotCount ?? requiredRobotCount;
  const capacityPerHour = robotCount * effectiveRate;
  const meetsDemand = capacityPerHour + 1e-8 >= peakDemandPerHour;
  const coverage = Math.min(1, capacityPerHour / input.loadPerHour);
  // An undersized fleet cannot generate benefits on work it cannot process.
  const labor = calculateStartValue({ ...input, automationPct: input.automationPct * coverage });
  const equipmentRub = robotCount * input.pricePerRobotRub;
  const capexRub = equipmentRub + input.integrationRub;
  const opexAnnualRub = equipmentRub * input.servicePctYear / 100 + input.energyRubYear;
  const annualGrossCashRub = labor.annualCashEffectRub;
  const annualNetCashRub = annualGrossCashRub - opexAnnualRub;
  const paybackYears = meetsDemand && annualNetCashRub > 0 ? capexRub / annualNetCashRub : null;
  const tcoRub = capexRub + opexAnnualRub * input.targetYears;
  const verdict = !meetsDemand
    ? 'Парк не покрывает пиковую нагрузку с резервом. Увеличьте парк или проверьте производительность; окупаемость такого варианта не подтверждена.'
    : annualNetCashRub <= 0
      ? 'Эксплуатационные затраты не ниже денежного эффекта. По этому сценарию вложения не окупаются.'
      : paybackYears! <= input.targetYears
        ? 'В модели парк покрывает нагрузку, а эффект покрывает затраты за выбранный срок. Нужны проверка производительности и полное предложение по стоимости.'
        : 'Парк покрывает нагрузку, но вложения не возвращаются за выбранный срок. Не меняйте реальную нагрузку ради красивой окупаемости.';
  return {
    robotCount, requiredRobotCount, capacityPerHour, peakDemandPerHour, coveragePct: coverage * 100,
    meetsDemand, capexRub, opexAnnualRub, annualGrossCashRub, annualNetCashRub, paybackYears,
    tcoRub, freedHoursPerShift: labor.freedHoursPerShift, annualFreedHours: labor.annualFreedHours,
    maxOwnershipBudgetRub: labor.maxOwnershipBudgetRub,
    operationsPerShift: input.loadPerHour * input.hoursPerShift,
    annualOperatingHours: input.hoursPerShift * input.shiftsYear, verdict,
  };
}

export function createWorkbenchPlan(legacy?: StartValueInputs): WorkbenchPlan {
  return { selectedId: 'base', variants: [{ id: 'base', name: 'Базовый вариант', inputs: defaultWorkbenchInputs(legacy) }] };
}

export function parseWorkbenchPlan(raw: unknown): WorkbenchPlan | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  if (typeof source.selectedId !== 'string' || !Array.isArray(source.variants)
    || source.variants.length < 1 || source.variants.length > 6) return null;
  const variants: WorkbenchVariant[] = [];
  for (const item of source.variants) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id)
      || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60) return null;
    const inputs = parseWorkbenchInputs(item.inputs);
    if (!inputs || variants.some(entry => entry.id === item.id)) return null;
    variants.push({ id: item.id, name: item.name.trim(), inputs });
  }
  if (!variants.some(item => item.id === source.selectedId)) return null;
  const plan: WorkbenchPlan = { selectedId: source.selectedId, variants };
  if (source.approval !== undefined) {
    const a = source.approval as Record<string, unknown> | null;
    if (!a || typeof a !== 'object' || typeof a.at !== 'string' || a.at.length > 40 || !Number.isFinite(Date.parse(a.at))
      || typeof a.signature !== 'string' || a.signature.length > 20000
      || typeof a.modelVersion !== 'string' || a.modelVersion.length > 40) return null;
    plan.approval = { at: a.at, signature: a.signature, modelVersion: a.modelVersion };
  }
  return plan;
}

export function workbenchContext(draft: StartScopeDraft, process: SiteProcess): string {
  return JSON.stringify({
    objectId: draft.objectId, customObject: draft.customObject, scope: draft.scope,
    selectedIds: [...draft.selectedIds].sort(), process: { id: process.id, name: process.name, kind: process.kind },
    facts: draft.details[process.id] ?? null,
  });
}
function signature(plan: WorkbenchPlan, context: string) {
  // Staleness detection, not an electronic signature or identity verification.
  const text = JSON.stringify({ context, selectedId: plan.selectedId, variants: plan.variants });
  let a = 2166136261, b = 2246822519;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b ^ text.charCodeAt(i), 3266489917);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
export function approveWorkbenchPlan(raw: WorkbenchPlan, context: string): WorkbenchPlan {
  const plan = parseWorkbenchPlan(raw);
  if (!plan) throw new Error('Нельзя утвердить повреждённый набор вариантов.');
  return { ...plan, approval: { at: new Date().toISOString(), modelVersion: WORKBENCH_MODEL_VERSION, signature: signature(plan, context) } };
}
export function isWorkbenchApproved(raw: WorkbenchPlan, context: string): boolean {
  const plan = parseWorkbenchPlan(raw);
  return !!plan?.approval && plan.approval.modelVersion === WORKBENCH_MODEL_VERSION
    && plan.approval.signature === signature(plan, context);
}
export function updateWorkbenchVariant(raw: WorkbenchPlan, id: string, input: WorkbenchInputs): WorkbenchPlan {
  const plan = parseWorkbenchPlan(raw), inputs = parseWorkbenchInputs(input);
  if (!plan || !inputs || !plan.variants.some(item => item.id === id)) throw new Error('Не удалось обновить вариант.');
  return { selectedId: plan.selectedId, variants: plan.variants.map(item => item.id === id ? { ...item, inputs } : item) };
}
export function workbenchUnit(process: SiteProcess): string {
  return process.kind === 'cleaning' ? 'м²/ч' : process.kind === 'inspection' ? 'проверок/ч' : 'перемещений/ч';
}

export const WORKBENCH_LABELS: Record<keyof WorkbenchInputs, string> = {
  manualHoursPerShift: 'Ручная работа, чел·ч/смену', automationPct: 'Высвобождаемая доля работы, %',
  hourCostRub: 'Полная стоимость ручного часа, ₽', shiftsYear: 'Смен в году',
  cashablePct: 'Реальная монетизация высвобождённого времени, %', targetYears: 'Горизонт проверки, лет',
  quotedTotalCostRub: 'Отдельное предложение полной стоимости, ₽',
  loadPerHour: 'Нагрузка в час', robotRatePerHour: 'Производительность одного робота в час',
  hoursPerShift: 'Длительность смены, ч', operatingPct: 'Рабочая загрузка без учёта зарядки, %',
  reservePct: 'Резерв на пик, %', batteryHours: 'Работа от батареи, ч', chargeHours: 'Зарядка, ч',
  robotCount: 'Парк (null = автоподбор)', pricePerRobotRub: 'Цена одного робота, ₽',
  integrationRub: 'Внедрение и инфраструктура на весь парк, ₽',
  servicePctYear: 'Сервис в год от стоимости оборудования, %', energyRubYear: 'Энергия и прочие дополнительные расходы в год, ₽',
};
