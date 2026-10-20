import { createSim, type SimOptions, type SimScene } from './sim-engine';

export interface SizingRun {
  seed: number;
  throughputRatio: number;
  maxQueue: number;
  utilizationPct: number;
  passed: boolean;
}

export interface SizingResult {
  robotCount: number;
  passed: boolean;
  runs: SizingRun[];
  currentCount: number;
  limitReached: boolean;
}

export interface SizingProgress {
  completedRuns: number;
  candidateCount: number;
  seed: number;
  phase: 'search' | 'validation';
}

interface FleetSizingInput {
  scene: SimScene;
  fleetFor: (count: number) => SimOptions['fleet'];
  tasksPerHour: number;
  laborCostPerTaskRub: number;
  batteryRuntimeHours: number;
  chargeTimeMinutes: number;
  currentCount: number;
  minimumRobots?: number;
  maxRobots?: number;
  onProgress?: (progress: SizingProgress) => void;
  shouldCancel?: () => boolean;
}

const VALIDATION_SEEDS = [42, 7, 2026] as const;
const WARMUP_SECONDS = 5 * 60;
const MEASUREMENT_SECONDS = 20 * 60;
const REAL_STEP_SECONDS = 0.1;
const YIELD_EVERY_UPDATES = 500;

/**
 * Runs the production simulation engine without a renderer. The model is
 * warmed up first so the recommendation is based on observed work, not the
 * initial queue or the first few robot assignments.
 */
export async function sizeFleet(input: FleetSizingInput): Promise<SizingResult | null> {
  const maxRobots = Math.max(1, Math.floor(input.maxRobots ?? 80));
  const minimumRobots = Math.min(
    maxRobots,
    Math.max(1, Math.floor(input.minimumRobots ?? 1)),
  );
  const currentCount = Math.max(1, Math.floor(input.currentCount));
  const demand = Math.max(0.1, input.tasksPerHour);
  const runCache = new Map<string, SizingRun>();
  let completedRuns = 0;

  const run = async (
    count: number,
    seed: number,
    phase: SizingProgress['phase'],
  ): Promise<SizingRun | null> => {
    if (input.shouldCancel?.()) return null;
    const cacheKey = `${count}:${seed}`;
    const cached = runCache.get(cacheKey);
    if (cached) return cached;

    const sim = createSim(input.scene, {
      fleet: input.fleetFor(count),
      tasksPerHour: demand,
      laborCostPerTaskRub: input.laborCostPerTaskRub,
      batteryRuntimeHours: input.batteryRuntimeHours,
      chargeTimeMinutes: input.chargeTimeMinutes,
      initialTasks: 0,
      speedMultiplier: 1,
      seed,
    });

    // Generated production scenes advance at 0.1 model seconds per update;
    // the legacy scene mode advances at 0.6. Sample at roughly five-second
    // model intervals in either mode, without assuming the legacy rate.
    const updatesPerSample = input.scene.id.startsWith('generated-') ? 50 : 8;
    let updates = 0;
    let snapshot = sim.getKpis();

    while ((snapshot.elapsedSec ?? 0) < WARMUP_SECONDS) {
      for (let index = 0; index < updatesPerSample; index += 1) {
        sim.update(REAL_STEP_SECONDS);
        updates += 1;
        if (updates % YIELD_EVERY_UPDATES === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          if (input.shouldCancel?.()) return null;
        }
      }
      snapshot = sim.getKpis();
    }

    const start = sim.getKpis();
    const startElapsed = start.elapsedSec ?? 0;
    const targetElapsed = startElapsed + MEASUREMENT_SECONDS;
    const samples = [start];
    let end = start;

    while ((end.elapsedSec ?? startElapsed) < targetElapsed) {
      for (let index = 0; index < updatesPerSample; index += 1) {
        sim.update(REAL_STEP_SECONDS);
        updates += 1;
        if (updates % YIELD_EVERY_UPDATES === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          if (input.shouldCancel?.()) return null;
        }
      }
      end = sim.getKpis();
      samples.push(end);
    }

    if (input.shouldCancel?.()) return null;
    const elapsed = Math.max(1, (end.elapsedSec ?? startElapsed) - startElapsed);
    const completedTasks = Math.max(0, end.tasksDone - start.tasksDone);
    const observedPerHour = completedTasks * 3600 / elapsed;
    const throughputRatio = observedPerHour / demand;
    const maxQueue = Math.max(...samples.map((sample) => sample.queueLen));
    const averageUtilization = samples.reduce((sum, sample) => sum + sample.utilizationPct, 0) / samples.length;
    const passed = throughputRatio >= 0.95
      && maxQueue <= Math.max(2, Math.ceil(0.5 * count))
      && end.queueLen <= start.queueLen + 1;
    const result: SizingRun = {
      seed,
      throughputRatio,
      maxQueue,
      utilizationPct: averageUtilization,
      passed,
    };
    runCache.set(cacheKey, result);
    completedRuns += 1;
    input.onProgress?.({ completedRuns, candidateCount: count, seed, phase });
    return result;
  };

  let high = Math.min(
    maxRobots,
    Math.max(minimumRobots, Math.ceil(currentCount * 1.5), 6),
  );
  let highRun = await run(high, 42, 'search');
  if (!highRun) return null;

  while (!highRun.passed && high < maxRobots) {
    high = Math.min(maxRobots, high * 2);
    highRun = await run(high, 42, 'search');
    if (!highRun) return null;
  }

  if (!highRun.passed) {
    return {
      robotCount: maxRobots,
      passed: false,
      runs: [highRun],
      currentCount,
      limitReached: true,
    };
  }

  let low = minimumRobots;
  let upper = high;
  while (low < upper) {
    const candidate = Math.floor((low + upper) / 2);
    const candidateRun = await run(candidate, 42, 'search');
    if (!candidateRun) return null;
    if (candidateRun.passed) upper = candidate;
    else low = candidate + 1;
  }

  let selectedCount = low;
  let validationRuns: SizingRun[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    validationRuns = [];
    for (const seed of VALIDATION_SEEDS) {
      const validationRun = await run(selectedCount, seed, 'validation');
      if (!validationRun) return null;
      validationRuns.push(validationRun);
    }
    if (validationRuns.every((result) => result.passed)) {
      return {
        robotCount: selectedCount,
        passed: true,
        runs: validationRuns,
        currentCount,
        limitReached: false,
      };
    }
    if (selectedCount >= maxRobots || attempt === 4) break;
    selectedCount = Math.min(maxRobots, selectedCount + 1);
  }

  return {
    robotCount: selectedCount,
    passed: false,
    runs: validationRuns,
    currentCount,
    limitReached: selectedCount >= maxRobots,
  };
}
