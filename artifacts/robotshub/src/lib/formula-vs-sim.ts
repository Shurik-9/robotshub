export interface ThroughputSample {
  elapsedSec: number;
  tasksDone: number;
  queueLen: number;
  utilizationPct: number;
}

export interface SteadyThroughputWindow {
  ready: boolean;
  observedPerHour: number | null;
  windowSeconds: number;
  utilizationPct: number;
  queueLen: number;
}

export interface FormulaVsSimInput {
  formulaRobots: number;
  runRobots: number;
  formulaUnitPriceRub: number;
  runUnitPriceRub: number;
  targetPerHour: number;
  observedPerHour: number | null;
  utilizationPct: number;
  queueLen: number;
}

export type FormulaVsSimTone = 'waiting' | 'ok' | 'tight' | 'layout' | 'shortage';

export interface FormulaVsSimResult {
  tone: FormulaVsSimTone;
  headline: string;
  detail: string;
  formulaRobots: number;
  runRobots: number;
  neededRobots: number;
  formulaCapexRub: number;
  neededCapexRub: number;
  deltaRobots: number;
  deltaRub: number;
  ratio: number;
  ready: boolean;
  estimateCapped: boolean;
}

export const FLOW_WARMUP_SECONDS = 60;
export const FLOW_MEASUREMENT_SECONDS = 60;
export const MAX_ESTIMATED_ROBOTS = 80;

export function measurementSecondsForFlow(targetPerHour: number) {
  return Math.min(900, Math.max(FLOW_MEASUREMENT_SECONDS, Math.ceil(3 * 3600 / Math.max(0.1, targetPerHour))));
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/**
 * Measures a counter delta after the startup completion budget is deducted.
 * This is an observation window, not a measurement of maximum capacity.
 */
export function measureSteadyThroughput(
  samples: readonly ThroughputSample[],
  warmupCompleteSec: number | null,
  windowSeconds = FLOW_MEASUREMENT_SECONDS,
): SteadyThroughputWindow {
  const latest = samples[samples.length - 1];
  const waiting: SteadyThroughputWindow = {
    ready: false,
    observedPerHour: null,
    windowSeconds: 0,
    utilizationPct: latest?.utilizationPct ?? 0,
    queueLen: latest?.queueLen ?? 0,
  };

  if (!latest || warmupCompleteSec === null || latest.elapsedSec - warmupCompleteSec < windowSeconds) {
    return waiting;
  }

  const targetStartSec = Math.max(warmupCompleteSec, latest.elapsedSec - windowSeconds);
  const start = samples.find(sample => sample.elapsedSec >= targetStartSec);
  if (!start) return waiting;

  const elapsed = latest.elapsedSec - start.elapsedSec;
  if (elapsed < windowSeconds - 2) return waiting;

  const completed = Math.max(0, latest.tasksDone - start.tasksDone);
  const windowSamples = samples.filter(
    sample => sample.elapsedSec >= start.elapsedSec && sample.elapsedSec <= latest.elapsedSec,
  );

  return {
    ready: true,
    observedPerHour: completed * 3600 / elapsed,
    windowSeconds: elapsed,
    utilizationPct: mean(windowSamples.map(sample => sample.utilizationPct)),
    queueLen: latest.queueLen,
  };
}

function finiteCount(value: number, minimum: number) {
  return Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : minimum;
}

export function computeFormulaVsSim(input: FormulaVsSimInput): FormulaVsSimResult {
  const formulaRobots = finiteCount(input.formulaRobots, 0);
  const runRobots = finiteCount(input.runRobots, 1);
  const formulaUnitPriceRub = Number.isFinite(input.formulaUnitPriceRub)
    ? Math.max(0, input.formulaUnitPriceRub)
    : 0;
  const runUnitPriceRub = Number.isFinite(input.runUnitPriceRub)
    ? Math.max(0, input.runUnitPriceRub)
    : 0;
  const targetPerHour = Number.isFinite(input.targetPerHour) ? Math.max(0, input.targetPerHour) : 0;
  const formulaCapexRub = formulaRobots * formulaUnitPriceRub;
  const base = {
    formulaRobots,
    runRobots,
    formulaCapexRub,
    neededRobots: runRobots,
    neededCapexRub: runRobots * runUnitPriceRub,
    deltaRobots: runRobots - formulaRobots,
    deltaRub: runRobots * runUnitPriceRub - formulaCapexRub,
    ratio: 0,
    estimateCapped: false,
  };

  if (input.observedPerHour === null || targetPerHour <= 0 || !Number.isFinite(input.observedPerHour)) {
    return {
      ...base,
      tone: 'waiting',
      headline: 'Прогон набирает данные',
      detail: 'Нужны разогрев, вычитание стартового объёма и окно минимум 60 модельных секунд с не менее чем тремя ожидаемыми операциями. Для быстрого отдельного расчёта используйте «Подобрать парк под SLA».',
      ready: false,
    };
  }

  const observedPerHour = Math.max(0, input.observedPerHour);
  const queueLen = Math.max(0, input.queueLen);
  const utilizationPct = Math.max(0, input.utilizationPct);
  const ratio = observedPerHour / targetPerHour;
  const layoutBound = ratio < 0.9 && utilizationPct < 55 && runRobots >= 3;
  const enough = ratio >= 0.95 && queueLen <= 2;
  const proportionalEstimate = enough || layoutBound
    ? runRobots
    : Math.max(runRobots, Math.ceil(runRobots * targetPerHour / Math.max(observedPerHour, 0.1)));
  const estimateCapped = proportionalEstimate > MAX_ESTIMATED_ROBOTS;
  const neededRobots = Math.max(runRobots, Math.min(MAX_ESTIMATED_ROBOTS, proportionalEstimate));
  const neededCapexRub = neededRobots * runUnitPriceRub;
  const deltaRobots = neededRobots - formulaRobots;
  const deltaRub = neededCapexRub - formulaCapexRub;
  const common = {
    formulaRobots,
    runRobots,
    neededRobots,
    formulaCapexRub,
    neededCapexRub,
    deltaRobots,
    deltaRub,
    ratio,
    ready: true,
    estimateCapped,
  };
  const runContext = `В прогоне было ${runRobots} ед.; выполнено ${Math.round(ratio * 100)}% потока, очередь ${queueLen}.`;

  if (layoutBound) {
    return {
      ...common,
      tone: 'layout',
      headline: 'Проверьте маршруты и распределение заданий',
      detail: `${runContext} Загрузка ${Math.round(utilizationPct)}%: низкая выработка не доказывает нехватку машин. Автоматически увеличивать парк по этим данным нельзя.`,
    };
  }

  if (enough) {
    return {
      ...common,
      tone: 'ok',
      headline: runRobots === formulaRobots
        ? 'Формула и прогон сошлись по парку'
        : 'Текущий парк выполняет заданный поток',
      detail: `${runContext} Этот прогон не определяет минимально необходимый парк.`,
    };
  }

  if (ratio >= 0.9) {
    return {
      ...common,
      tone: 'tight',
      headline: 'Парк на грани',
      detail: `${runContext} Оценка потребности основана на фактическом парке; держите резерв и проверьте результат на объекте.`,
    };
  }

  return {
    ...common,
    tone: 'shortage',
    headline: `Оценка по прогону: ${neededRobots} вместо ${formulaRobots}`,
    detail: `${runContext} Это пропорциональный ориентир от текущего парка, не результат отдельного подбора.${estimateCapped ? ` Оценка ограничена ${MAX_ESTIMATED_ROBOTS} ед.` : ''}`,
  };
}

export function fmtMln(rub: number): string {
  const value = rub / 1_000_000;
  const digits = Math.abs(value) >= 10 ? 1 : 2;
  return `${value.toFixed(digits).replace('.', ',')} млн ₽`;
}
