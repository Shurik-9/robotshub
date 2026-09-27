import assumptionsData from '../data/assumptions.json' with { type: 'json' };
import { getSolutionTaxonomy } from './solutionTaxonomy.ts';

export interface ScenarioResult {
  id: string;
  name: string;
  robotCount: number;
  capex: number;
  opexAnnual: number;
  annualSavings: number;
  tco: number; // over 5 years
  paybackYears: number | null;
  roi: number | null; // percentage over the selected horizon
  npv: number;
  depreciationAnnual: number;
  assumptions: CalculationAssumptions;
}

export interface CalculationAssumptions {
  horizonYears: number;
  discountRatePct: number;
  servicePct: number;
  electricityTariffRubKwh: number;
  depreciationYears: number;
  throughputUnitsPerHour: number;
  throughputConfirmed: boolean;
  throughputOverridden: boolean;
  throughputOverrideKey: string;
  floorsCount: number;
  verticalDelaySec: number;
  verticalLoadFactor: number;
  elevatorIntegrationReady: boolean;
}

export interface CalcInputs {
  objectParams: Record<string, any>;
  solution: any;
  whatIf: {
    salaryMultiplier: number; // e.g. 1.1 for +10%
    priceMultiplier: number; // e.g. 0.9 for -10% discount
    volumeMultiplier: number; // e.g. 1.2 for +20% volume
  };
  assumptionsOverrides?: Record<string, number>;
}

export interface SimulationInputs {
  robotCount: number;
  tasksPerHour: number;
  laborCostPerTaskRub: number;
  batteryRuntimeHours: number;
  chargeTimeMinutes: number;
  batteryDataSource: 'confirmed' | 'modeled';
  floorsCount: number;
  verticalDelaySec: number;
  verticalLoadFactor: number;
  elevatorIntegrationReady: boolean;
  robotCountMode: 'warehouse' | 'staff';
  targetStaff: number;
  requiredThroughputPerHour: number;
  volumeMultiplier: number;
  unitPrice: number;
  currentStaffCost: number;
  newStaffCost: number;
}

export interface PaybackRiskAssumption {
  key: string;
  label: string;
  unit: string;
  base: number;
  range: [number, number];
  source: string;
  overridden: boolean;
}

export interface PaybackHistogramBin {
  label: string;
  count: number;
}

export interface PaybackRiskResult {
  iterations: number;
  seed: number;
  baseProbability: number;
  basePaybackYears: number | null;
  p10Years: number | null;
  medianYears: number | null;
  p90Years: number | null;
  probabilityWithinThreeYears: number;
  nonPaybackProbability: number;
  histogram: PaybackHistogramBin[];
  assumptions: PaybackRiskAssumption[];
}

export interface VerticalLogisticsAssumptions {
  floorsCount: number;
  elevatorsCount: number;
  verticalDelaySec: number;
  verticalLoadFactor: number;
  elevatorIntegrationReady: boolean;
}

const THROUGHPUT_FALLBACK = 50;

function numberOverride(
  overrides: Record<string, number> | undefined,
  key: string,
  fallback: number,
) {
  const value = overrides?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseThroughput(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function calculateEconomics({
  objectParams,
  solution,
  whatIf,
  assumptionsOverrides,
}: CalcInputs): ScenarioResult[] {
  const { calc_constants } = assumptionsData;
  const TCO_YEARS = calc_constants.tco_horizon_years.base;
  const discountRatePct = numberOverride(
    assumptionsOverrides,
    'discountRatePct',
    calc_constants.discount_rate_pct.base,
  );
  const servicePct = numberOverride(assumptionsOverrides, 'servicePct', 10);
  const electricityTariffRubKwh = numberOverride(
    assumptionsOverrides,
    'electricityTariff',
    calc_constants.electricity_tariff_rub_kwh.base,
  );
  const depreciationYears = numberOverride(
    assumptionsOverrides,
    'depreciationYears',
    calc_constants.depreciation.default_life_years,
  );
  const throughputOverrideKey = `throughput:${solution.id}`;
  const confirmedThroughput = parseThroughput(solution.specs?.throughput);
  const throughputOverride = numberOverride(
    assumptionsOverrides,
    throughputOverrideKey,
    Number.NaN,
  );
  const hasThroughputOverride = Number.isFinite(throughputOverride) && throughputOverride > 0;
  const throughputUnitsPerHour = hasThroughputOverride
    ? throughputOverride
    : confirmedThroughput ?? THROUGHPUT_FALLBACK;
  const throughputConfirmed = confirmedThroughput !== null && !hasThroughputOverride;
  const verticalLogistics = calculateVerticalLogisticsAssumptions(objectParams);
  const calculationAssumptions: CalculationAssumptions = {
    horizonYears: TCO_YEARS,
    discountRatePct,
    servicePct,
    electricityTariffRubKwh,
    depreciationYears,
    throughputUnitsPerHour,
    throughputConfirmed,
    throughputOverridden: hasThroughputOverride,
    throughputOverrideKey,
    ...verticalLogistics,
  };
  
  // 1. Calculate N robots required
  let robotCount = 0;
  let currentStaffCost = 0;
  let newStaffCost = 0;
  
  // We deduce logic based on object type from params (e.g. if pickers_count exists)
  const isWarehouse = 'pickers_count' in objectParams;
  const isAirport = 'baggage_handlers_count' in objectParams
    || 'ramp_staff' in objectParams
    || 'baggage_units_per_day' in objectParams;
  const isMedical = 'nurses_count' in objectParams
    || 'sanitar_count' in objectParams
    || 'beds_count' in objectParams;

  let baseSalary = 100000;
  let targetStaff = 0;

  if (isWarehouse) {
    baseSalary = Number(objectParams.picker_salary_gross || 100000);
    targetStaff = Number(objectParams.pickers_count || 100);
    
    // Simple heuristic: if throughput is 100 pallets/hr, and we need to move X per day
    const palletsPerDay = Number(objectParams.inbound_pallets_per_day || 1000) * whatIf.volumeMultiplier;
    const throughput = throughputUnitsPerHour;
    // Shifts * hours
    const hoursPerDay = Number(objectParams.shifts_per_day || 2) * Number(objectParams.shift_duration_h || 11);
    
    const requiredThroughputPerHr = palletsPerDay / hoursPerDay;
    robotCount = Math.ceil((requiredThroughputPerHr / throughput) * (1 + (calc_constants.peak_reserve_pct.base/100)) / calc_constants.robot_utilization.base);
    
    if (robotCount < 1) robotCount = 1;
  } else if (isAirport || isMedical) {
    baseSalary = isAirport
      ? Number(objectParams.ramp_salary_gross || objectParams.cleaner_salary_gross || 80000)
      : Number(objectParams.sanitar_salary_gross || objectParams.food_salary_gross || 80000);
    targetStaff = isAirport
      ? Number(objectParams.ramp_staff || objectParams.terminal_staff || 20)
      : Number(objectParams.sanitar_count || objectParams.food_staff_count || 20);
    robotCount = Math.ceil(targetStaff * 0.3 * whatIf.volumeMultiplier); // 1 robot replaces ~3 humans as a dummy
  } else {
    baseSalary = 100000;
    targetStaff = 10;
    robotCount = 5;
  }
  robotCount = Math.max(1, Math.ceil(robotCount * verticalLogistics.verticalLoadFactor));

  // Multiply by taxes and what-if salary inflation
  const annualSalaryCostPerPerson = baseSalary * 12 * calc_constants.payroll_tax_factor * whatIf.salaryMultiplier;
  
  currentStaffCost = targetStaff * annualSalaryCostPerPerson;
  
  // Assume robots replace 70% of staff
  const staffRemaining = Math.max(1, Math.floor(targetStaff * 0.3));
  newStaffCost = staffRemaining * annualSalaryCostPerPerson;
  
  const annualSavings = currentStaffCost - newStaffCost;

  // 2. CAPEX & OPEX
  const unitPrice = (solution.price_rub || 2500000) * whatIf.priceMultiplier;
  const eqCapex = robotCount * unitPrice;
  const integrationCapex = eqCapex * 0.2; // 20%
  const infraCapex = robotCount * 100000; // 100k per robot for charging
  const commissioning = eqCapex * 0.05;
  const totalCapex = eqCapex + integrationCapex + infraCapex + commissioning;

  const serviceOpex = eqCapex * (servicePct / 100);
  const energyOpex = robotCount * 8 * 24 * 365 * electricityTariffRubKwh; // rough
  const totalOpex = serviceOpex + energyOpex + newStaffCost;

  const netAnnualBenefit = currentStaffCost - totalOpex;
  const depreciationAnnual = eqCapex / Math.max(1, depreciationYears);

  // NPV calculation
  const calculateNPV = (capex: number, benefit: number) => {
    let npv = -capex;
    const discountRate = discountRatePct / 100;
    for (let i = 1; i <= TCO_YEARS; i++) {
      npv += benefit / Math.pow(1 + discountRate, i);
    }
    return npv;
  };

  // SCENARIO 1: AS-IS
  const asIs: ScenarioResult = {
    id: 'as_is',
    name: 'Как есть (Ручной труд)',
    robotCount: 0,
    capex: 0,
    opexAnnual: currentStaffCost,
    annualSavings: 0,
    tco: currentStaffCost * TCO_YEARS,
    paybackYears: null,
      roi: 0,
      npv: calculateNPV(0, 0), // 0
      depreciationAnnual: 0,
      assumptions: calculationAssumptions,
  };

  // SCENARIO 2: Purchase
  const purchase: ScenarioResult = {
    id: 'purchase',
    name: 'Покупка (Собственные средства)',
    robotCount,
    capex: totalCapex,
    opexAnnual: totalOpex,
    annualSavings: netAnnualBenefit,
    tco: totalCapex + (totalOpex * TCO_YEARS),
    paybackYears: netAnnualBenefit > 0 ? totalCapex / netAnnualBenefit : null,
      roi: totalCapex > 0 ? (netAnnualBenefit * TCO_YEARS / totalCapex) * 100 : null,
    npv: calculateNPV(totalCapex, netAnnualBenefit),
      depreciationAnnual,
      assumptions: calculationAssumptions,
  };

  // SCENARIO 3: Leasing (3 years)
  // Assume 20% down, remaining over 3 years with 15% markup
  const leaseDown = totalCapex * 0.2;
  const leasePrincipal = totalCapex * 0.8;
  const leaseTotalPay = leasePrincipal * 1.15;
  const leaseAnnual = leaseTotalPay / 3;
  // Opex varies by year, for simplicity we average it
  const avgLeaseOpex = totalOpex + (leaseTotalPay / TCO_YEARS);

  const leasing: ScenarioResult = {
    id: 'leasing',
    name: 'Лизинг',
    robotCount,
    capex: leaseDown,
    opexAnnual: avgLeaseOpex,
    annualSavings: currentStaffCost - avgLeaseOpex,
    tco: leaseDown + (avgLeaseOpex * TCO_YEARS),
    paybackYears: (currentStaffCost - avgLeaseOpex) > 0 ? leaseDown / (currentStaffCost - avgLeaseOpex) : null,
      roi: (leaseDown + leaseTotalPay) > 0
        ? ((currentStaffCost - avgLeaseOpex) * TCO_YEARS / (leaseDown + leaseTotalPay)) * 100
        : null,
    npv: calculateNPV(leaseDown, currentStaffCost - avgLeaseOpex),
      depreciationAnnual,
      assumptions: calculationAssumptions,
  };

  // SCENARIO 4: RaaS (Robot as a Service)
  // 0 Capex, monthly subscription ~ 3% of unit price per month -> 36% per year
  const raasAnnual = eqCapex * 0.36 + totalOpex - serviceOpex; // service usually included
  const raasBenefit = currentStaffCost - raasAnnual;

  const raas: ScenarioResult = {
    id: 'raas',
    name: 'RaaS (Подписка)',
    robotCount,
    capex: 0, // setup might have minimal cost, assume 0
    opexAnnual: raasAnnual,
    annualSavings: raasBenefit,
    tco: raasAnnual * TCO_YEARS,
      paybackYears: null,
      roi: null,
    npv: calculateNPV(0, raasBenefit),
      depreciationAnnual: 0,
      assumptions: calculationAssumptions,
  };

  return [asIs, purchase, leasing, raas];
}

export type PaybackVerdict = {
  label: string;
  detail: string;
  tone: 'success' | 'warning' | 'danger' | 'muted';
};

export function getPaybackVerdict(paybackYears: number | null): PaybackVerdict {
  if (paybackYears === null) {
    return {
      label: 'Не определяется',
      detail: 'Положительный эффект не подтверждён или модель подписочная.',
      tone: 'muted',
    };
  }
  if (paybackYears <= 3) {
    return {
      label: 'До 3 лет — высокая целесообразность',
      detail: 'Решение быстро возвращает вложения при сохранении текущих допущений.',
      tone: 'success',
    };
  }
  if (paybackYears <= 5) {
    return {
      label: '3–5 лет — уместно при стратегических причинах',
      detail: 'Решение требует подтверждения эффекта обследованием объекта.',
      tone: 'warning',
    };
  }
  return {
    label: 'Более 5 лет — осторожно',
    detail: 'Рассмотрите лизинг/RaaS или другой тип решения.',
    tone: 'danger',
  };
}

export function getPaybackRiskVerdict(nonPaybackProbability: number): PaybackVerdict | null {
  if (nonPaybackProbability < 1) return null;

  return {
    label: 'Не окупается',
    detail: 'Во всех проверенных сценариях положительный эффект не подтверждён, поэтому срок окупаемости отсутствует.',
    tone: 'danger',
  };
}

export function formatPaybackYears(
  paybackYears: number | null,
  nonPaybackProbability = 0,
): string {
  if (nonPaybackProbability >= 1) return 'Не окупается';
  if (paybackYears === null) return '—';
  return `${paybackYears.toFixed(1)} лет`;
}

export const ECONOMIC_RISKS = [
  'Волатильность цен на оборудование и сервис может увеличить CAPEX/OPEX.',
  'Интеграция и пусконаладка оценены укрупнённо и требуют обследования.',
  'Текучесть операторов и фактическая загрузка могут изменить эффект.',
];

export function buildScenarioConclusion(results: ScenarioResult[]): string {
  const best = results.reduce<ScenarioResult | null>(
    (winner, result) => (!winner || result.tco < winner.tco ? result : winner),
    null,
  );
  const purchase = results.find(result => result.id === 'purchase');
  const driver = purchase && purchase.annualSavings > 0
    ? 'снижение затрат на ручной труд'
    : 'сдерживание операционных расходов';
  const risk = purchase?.paybackYears && purchase.paybackYears > 5
    ? ECONOMIC_RISKS[1]
    : ECONOMIC_RISKS[0];

  if (!best) return 'Недостаточно данных для текстового заключения по сценариям.';
  const payback = best.paybackYears === null
    ? 'срок окупаемости для него не определяется'
    : `срок окупаемости составит ${best.paybackYears.toFixed(1)} года`;
  return `Наименьший TCO за горизонт ${best.assumptions.horizonYears} лет показывает сценарий «${best.name}». ` +
    `Для выбранного сценария ${payback}. ` +
    `Ключевой драйвер экономики — ${driver}. ` +
    `Главный риск: ${risk}`;
}

export function calculateSimulationInputs({
  objectParams,
  solution,
  whatIf,
  assumptionsOverrides,
}: CalcInputs): SimulationInputs {
  const purchase = calculateEconomics({ objectParams, solution, whatIf, assumptionsOverrides })
    .find(result => result.id === 'purchase');
  const isWarehouse = 'pickers_count' in objectParams;
  const isAirport = 'baggage_handlers_count' in objectParams
    || 'ramp_staff' in objectParams
    || 'baggage_units_per_day' in objectParams;
  const isMedical = 'nurses_count' in objectParams
    || 'sanitar_count' in objectParams
    || 'beds_count' in objectParams;
  const payrollFactor = Number(objectParams.payroll_factor || 1.302);
  const daysPerYear = Number(objectParams.working_days_per_year || 365);

  let tasksPerDay = 1;
  let manualStaff = 1;
  let salaryPerMonth = 80000;

  if (isWarehouse) {
    tasksPerDay = Number(objectParams.inbound_pallets_per_day || objectParams.outbound_pallets_per_day || 1);
    manualStaff = Number(objectParams.pickers_count || 1);
    salaryPerMonth = Number(objectParams.picker_salary_gross || 100000);
  } else if (isAirport) {
    tasksPerDay = Number(objectParams.baggage_units_per_day || objectParams.intra_cart_trips_per_day || 1);
    manualStaff = Number(objectParams.ramp_staff || objectParams.terminal_staff || 1);
    salaryPerMonth = Number(objectParams.ramp_salary_gross || objectParams.cleaner_salary_gross || 80000);
  } else if (isMedical) {
    tasksPerDay = Number(
      objectParams.food_portions_per_day
      || objectParams.medication_requests_per_day
      || objectParams.samples_per_day
      || 1,
    );
    manualStaff = Number(objectParams.sanitar_count || objectParams.food_staff_count || 1);
    salaryPerMonth = Number(objectParams.sanitar_salary_gross || objectParams.food_salary_gross || 55000);
  }

  const hoursPerDay = isWarehouse
    ? Number(objectParams.shifts_per_day || 2) * Number(objectParams.shift_duration_h || 11)
    : 24;
  const tasksPerHour = Math.max(0.1, (tasksPerDay * whatIf.volumeMultiplier) / Math.max(1, hoursPerDay));
  const annualManualCost = manualStaff * salaryPerMonth * 12 * payrollFactor * whatIf.salaryMultiplier;
  const annualTasks = Math.max(1, tasksPerDay * daysPerYear * whatIf.volumeMultiplier);
  const verticalLogistics = calculateVerticalLogisticsAssumptions(objectParams);
  const targetStaff = isWarehouse
    ? Number(objectParams.pickers_count || 100)
    : isAirport
      ? Number(objectParams.ramp_staff || objectParams.terminal_staff || 20)
      : isMedical
        ? Number(objectParams.sanitar_count || objectParams.food_staff_count || 20)
        : 10;
  const simulationBaseSalary = isWarehouse
    ? Number(objectParams.picker_salary_gross || 100000)
    : isAirport
      ? Number(objectParams.ramp_salary_gross || objectParams.cleaner_salary_gross || 80000)
      : isMedical
        ? Number(objectParams.sanitar_salary_gross || objectParams.food_salary_gross || 80000)
        : 100000;
  const annualSalaryCostPerPerson = simulationBaseSalary * 12 * 1.302 * whatIf.salaryMultiplier;
  const currentStaffCost = targetStaff * annualSalaryCostPerPerson;
  const newStaffCost = Math.max(1, Math.floor(targetStaff * 0.3)) * annualSalaryCostPerPerson;
  const requiredThroughputPerHour = isWarehouse
    ? (Number(objectParams.inbound_pallets_per_day || 1000) * whatIf.volumeMultiplier) / Math.max(1, hoursPerDay)
    : 0;
  const unitPrice = (solution.price_rub || 2500000) * whatIf.priceMultiplier;
  const taxonomy = getSolutionTaxonomy(solution);
  const confirmedRuntime = typeof solution.specs?.runtime_h === 'number' && solution.specs.runtime_h > 0
    ? solution.specs.runtime_h
    : null;
  const confirmedCharge = typeof solution.specs?.charge_time_min === 'number' && solution.specs.charge_time_min > 0
    ? solution.specs.charge_time_min
    : null;
  const modeledRuntime = taxonomy.operationId === 'vegetation'
    ? 4
    : taxonomy.operationId === 'clean_outdoor'
      ? 6
      : taxonomy.operationId === 'clean_indoor'
        ? 4
        : taxonomy.areaId === 'air'
          ? 0.7
          : 8;
  const modeledCharge = taxonomy.areaId === 'air' ? 90 : 120;
  return {
    robotCount: Math.max(1, purchase?.robotCount || 1),
    tasksPerHour,
    laborCostPerTaskRub: Math.max(0, annualManualCost / annualTasks),
    batteryRuntimeHours: confirmedRuntime ?? modeledRuntime,
    chargeTimeMinutes: confirmedCharge ?? modeledCharge,
    batteryDataSource: confirmedRuntime && confirmedCharge ? 'confirmed' : 'modeled',
    floorsCount: verticalLogistics.floorsCount,
    verticalDelaySec: verticalLogistics.verticalDelaySec,
    verticalLoadFactor: verticalLogistics.verticalLoadFactor,
    elevatorIntegrationReady: verticalLogistics.elevatorIntegrationReady,
    robotCountMode: isWarehouse ? 'warehouse' : 'staff',
    targetStaff,
    requiredThroughputPerHour,
    volumeMultiplier: whatIf.volumeMultiplier,
    unitPrice,
    currentStaffCost,
    newStaffCost,
  };
}

const PAYBACK_HISTOGRAM_BINS = [
  { label: '0–1', min: 0, max: 1 },
  { label: '1–2', min: 1, max: 2 },
  { label: '2–3', min: 2, max: 3 },
  { label: '3–4', min: 3, max: 4 },
  { label: '4–5', min: 4, max: 5 },
  { label: '5–6', min: 5, max: 6 },
  { label: '6–8', min: 6, max: 8 },
  { label: '8–10', min: 8, max: 10 },
  { label: '>10', min: 10, max: Number.POSITIVE_INFINITY },
] as const;

export const PAYBACK_HISTOGRAM_BOUNDARY_NOTE =
  'Корзина «>10» включает сроки окупаемости от 10 лет включительно (≥ 10 лет); ровно 10 лет попадает сюда.';

export function buildPaybackHistogram(
  sampledPaybacks: readonly number[],
  nonPaybackCount = 0,
): PaybackHistogramBin[] {
  const histogram: PaybackHistogramBin[] = PAYBACK_HISTOGRAM_BINS.map(bin => ({
    label: bin.label,
    count: sampledPaybacks.filter(value => value >= bin.min && value < bin.max).length,
  }));
  histogram.push({ label: 'Не окупается', count: nonPaybackCount });
  return histogram;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(values: number[], probability: number): number | null {
  if (values.length === 0) return null;
  const position = (values.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (position - lower);
}

function sampleRange(
  range: [number, number],
  random: () => number,
  override?: number,
  base?: number,
  baseProbability = 0,
) {
  if (typeof override === 'number' && Number.isFinite(override)) return override;
  if (typeof base === 'number' && random() < baseProbability) return base;
  return range[0] + (range[1] - range[0]) * random();
}

/**
 * Runs a deterministic Monte Carlo layer on top of the purchase scenario.
 * The deterministic calculation above is intentionally not called with sampled
 * values, so its existing result remains the source of the point estimate.
 */
export function simulatePaybackRisk(inputs: CalcInputs): PaybackRiskResult {
  const purchase = calculateEconomics(inputs).find(result => result.id === 'purchase');
  const simulationInputs = calculateSimulationInputs(inputs);
  const config = assumptionsData.payback_simulation;
  const random = mulberry32(config.seed);
  const overrides = inputs.assumptionsOverrides;
  const uncertainty = Object.fromEntries(
    config.uncertainties.map(item => [item.key, item]),
  ) as Record<string, (typeof config.uncertainties)[number]>;
  const sampledPaybacks: number[] = [];
  let withinThreeYears = 0;
  let nonPayback = 0;

  for (let iteration = 0; iteration < config.iterations; iteration += 1) {
    const peakReservePct = sampleRange(
      uncertainty.peak_reserve_pct.range as [number, number],
      random,
      undefined,
      uncertainty.peak_reserve_pct.base,
      config.base_probability,
    );
    const robotUtilization = sampleRange(
      uncertainty.robot_utilization.range as [number, number],
      random,
      undefined,
      uncertainty.robot_utilization.base,
      config.base_probability,
    );
    const servicePct = sampleRange(
      uncertainty.service_pct.range as [number, number],
      random,
      overrides?.servicePct,
      uncertainty.service_pct.base,
      config.base_probability,
    );
    const electricityTariff = sampleRange(
      uncertainty.electricity_tariff_rub_kwh.range as [number, number],
      random,
      overrides?.electricityTariff,
      uncertainty.electricity_tariff_rub_kwh.base,
      config.base_probability,
    );
    const integrationPct = sampleRange(
      uncertainty.integration_pct.range as [number, number],
      random,
      undefined,
      uncertainty.integration_pct.base,
      config.base_probability,
    );
    const commissioningPct = sampleRange(
      uncertainty.commissioning_pct.range as [number, number],
      random,
      undefined,
      uncertainty.commissioning_pct.base,
      config.base_probability,
    );

    const robotCount = simulationInputs.robotCountMode === 'warehouse'
      ? Math.max(1, Math.round(
        simulationInputs.robotCount
        * ((1 + peakReservePct / 100) / (1 + 15 / 100))
        * (0.78 / robotUtilization),
      ))
      : simulationInputs.robotCount;
    const equipmentCapex = robotCount * simulationInputs.unitPrice;
    const capex = equipmentCapex
      + equipmentCapex * (integrationPct / 100)
      + robotCount * 100000
      + equipmentCapex * (commissioningPct / 100);
    const opex = equipmentCapex * (servicePct / 100)
      + robotCount * 8 * 24 * 365 * electricityTariff
      + simulationInputs.newStaffCost;
    const annualBenefit = simulationInputs.currentStaffCost - opex;
    const paybackYears = annualBenefit > 0 ? capex / annualBenefit : null;

    if (paybackYears === null) {
      nonPayback += 1;
    } else {
      sampledPaybacks.push(paybackYears);
      if (paybackYears <= 3) withinThreeYears += 1;
    }
  }

  sampledPaybacks.sort((left, right) => left - right);
  const histogram = buildPaybackHistogram(sampledPaybacks, nonPayback);

  return {
    iterations: config.iterations,
    seed: config.seed,
    baseProbability: config.base_probability,
    basePaybackYears: purchase?.paybackYears ?? null,
    p10Years: percentile(sampledPaybacks, 0.1),
    medianYears: percentile(sampledPaybacks, 0.5),
    p90Years: percentile(sampledPaybacks, 0.9),
    probabilityWithinThreeYears: withinThreeYears / config.iterations,
    nonPaybackProbability: nonPayback / config.iterations,
    histogram,
    assumptions: config.uncertainties.map(item => ({
      key: item.key,
      label: item.label,
      unit: item.unit,
      base: item.base,
      range: item.range as [number, number],
      source: item.source,
      overridden: (item.key === 'service_pct' && typeof overrides?.servicePct === 'number')
        || (item.key === 'electricity_tariff_rub_kwh' && typeof overrides?.electricityTariff === 'number'),
    })),
  };
}

export function calculateVerticalLogisticsAssumptions(
  objectParams: Record<string, any>,
): VerticalLogisticsAssumptions {
  const isAirport = 'baggage_handlers_count' in objectParams
    || 'ramp_staff' in objectParams
    || 'baggage_units_per_day' in objectParams;
  const isMedical = 'nurses_count' in objectParams
    || 'sanitar_count' in objectParams
    || 'beds_count' in objectParams;
  const isWarehouse = 'pickers_count' in objectParams;
  const defaultFloors = isAirport ? 2 : 1;
  const floorsCount = Math.max(1, Math.round(Number(objectParams.floors_count) || defaultFloors));
  const elevatorsCount = Math.max(1, Math.round(Number(objectParams.elevators_count) || 1));
  const elevatorIntegrationReady = isMedical
    ? integrationReady(objectParams.has_elevator_api, true)
    : isAirport
      ? integrationReady(objectParams.has_bms, true)
      : true;

  if (floorsCount <= 1 || (!isAirport && !isMedical && !isWarehouse)) {
    return {
      floorsCount,
      elevatorsCount,
      verticalDelaySec: 0,
      verticalLoadFactor: 1,
      elevatorIntegrationReady,
    };
  }

  const crossFloorShare = isMedical ? 0.7 : isAirport ? 0.25 : 0.15;
  const travelSecPerFloor = isMedical ? 12 : isAirport ? 20 : 15;
  const baseWaitSec = isMedical
    ? Math.max(8, 28 - (elevatorsCount - 1) * 3)
    : isAirport
      ? 30
      : 25;
  const averageFloorSpan = Math.max(1, (floorsCount - 1) / 2);
  const verticalDelaySec = crossFloorShare * (
    baseWaitSec + averageFloorSpan * travelSecPerFloor
  );
  const baseCycleSec = isMedical ? 300 : isAirport ? 240 : 360;
  const verticalLoadFactor = elevatorIntegrationReady
    ? 1 + verticalDelaySec / baseCycleSec
    : 1;

  return {
    floorsCount,
    elevatorsCount,
    verticalDelaySec,
    verticalLoadFactor,
    elevatorIntegrationReady,
  };
}

function integrationReady(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('нет') || normalized.includes('отсутств')) return false;
  return normalized.includes('да')
    || normalized.includes('есть')
    || normalized.includes('частич')
    || normalized.includes('yes');
}
