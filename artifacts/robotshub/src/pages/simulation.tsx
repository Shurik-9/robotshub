import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { withCalculationIntent } from '@/lib/calculation-intent';
import { getSimulationSignature, useProject } from '@/store/project';
import { evaluationLimit } from '@/lib/evaluationScope';
import { operationFor } from '@/lib/operationEconomics';
import solutionsData from '@/data/solutions.json';
import { SimCanvas } from '@/sim/SimCanvas';
import { buildFleet, spriteForSolution } from '@/sim/fleet';
import { buildScene, getSceneGeometrySummary } from '@/sim/scene-builder';
import type { SimKpis, SimScene } from '@/sim/sim-engine';
import { sizeFleet, type SizingProgress, type SizingResult } from '@/sim/fleet-sizer';
import { calculateSimulationInputs } from '@/lib/calc';
import { SIMULATION_DEMO, SIMULATION_DEMO_FLEET_COUNT, SIMULATION_DEMO_INITIAL_TASKS, simulationFlowCoverage } from '@/lib/simulation-demo';
import { getSolutionTypeLabel } from '@/lib/solutionPresentation';
import { FormulaVsSim } from '@/components/formula-vs-sim';
import {
  FLOW_WARMUP_SECONDS,
  measurementSecondsForFlow,
  measureSteadyThroughput,
  type SteadyThroughputWindow,
  type ThroughputSample,
} from '@/lib/formula-vs-sim';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  IconCompare,
  IconInfoAssumption,
  IconVisualization,
} from '@/components/brand-icons';
import { StepNav } from '@/components/step-nav';

type SupportedSceneId = 'warehouse' | 'airport' | 'hospital';
type TuningField = 'tasksPerHour' | 'fleetCount' | 'batteryRuntimeHours' | 'chargeTimeMinutes';
type TuningValues = Record<TuningField, number>;
interface FormulaRunState {
  signature: string;
  latest: SimKpis;
  measurement: SteadyThroughputWindow;
}

const DAY_SEEDS = [42, 7, 2026, 99, 123] as const;
const FLEET_SIZING_SEEDS = [42, 7, 2026] as const;

const matchedSpriteRules = [
  /уборщ/i,
  /доставщ|сервисн|консультант|robot/i,
  /вилочн|FMR|погрузчик|штабелер|штабелёр/i,
  /тягач/i,
  /грузовик|беспилот.*транспорт|электрогруз/i,
  /медиц|дезинфек|UVC|UV/i,
  /сортиров|AMR|транспортир|мобильн/i,
];

function isFallbackSprite(solution: (typeof solutionsData.items)[number]) {
  if (spriteForSolution(solution) !== 'amr-pallet') return false;
  const blob = `${solution.subtype ?? ''} ${solution.category ?? ''} ${solution.name ?? ''}`;
  return !matchedSpriteRules.some(rule => rule.test(blob));
}

export default function Simulation() {
  const [, setLocation] = useLocation();
  const { state: projectState, setSimulationKpis } = useProject();
  const [demo, setDemo] = useState(false);
  const state = demo ? SIMULATION_DEMO : projectState;
  const [liveKpis, setLiveKpis] = useState<SimKpis | null>(null);
  const latestKpisRef = useRef<SimKpis | null>(null);
  const diagnosticSamplesRef = useRef<SimKpis[]>([]);
  const formulaSamplesRef = useRef<ThroughputSample[]>([]);
  const formulaWarmupCompleteAtRef = useRef<number | null>(null);
  const formulaSampleSignatureRef = useRef('');
  const lastFormulaSampleSecondRef = useRef(-1);
  const [formulaRunState, setFormulaRunState] = useState<FormulaRunState | null>(null);

  const selectedSolutions = useMemo(
    () => state.selectedSolutions
      .map(id => solutionsData.items.find(solution => solution.id === id))
      .filter((solution): solution is (typeof solutionsData.items)[number] => Boolean(solution)),
    [state.selectedSolutions],
  );
  
  const selectedSolution = selectedSolutions.find(solution => solution.id === state.activeSolutionId) ?? selectedSolutions[0];
  const simulationSignature = useMemo(
    () => getSimulationSignature(state),
    [state.objectType, state.objectParams, state.selectedSolutions, state.assumptionsOverrides, state.whatIfOverrides, state.activeSolutionId],
  );
  const simulationSignatureRef = useRef(simulationSignature);
  if (simulationSignatureRef.current !== simulationSignature) {
    simulationSignatureRef.current = simulationSignature;
    latestKpisRef.current = null;
  }
  const sceneKey: SupportedSceneId = state.objectType === 'airport'
    ? 'airport'
    : state.objectType === 'medical'
      ? 'hospital'
      : 'warehouse';
  const simulationInputs = useMemo(
    () => selectedSolution
      ? calculateSimulationInputs({
          objectParams: state.objectParams,
          solution: selectedSolution,
          whatIf: {
            salaryMultiplier: state.whatIfOverrides.salaryMultiplier ?? 1,
            priceMultiplier: state.whatIfOverrides.priceMultiplier ?? 1,
            volumeMultiplier: state.whatIfOverrides.volumeMultiplier ?? 1,
          },
          assumptionsOverrides: state.assumptionsOverrides,
        })
      : {
          robotCount: 1,
          tasksPerHour: 1,
          laborCostPerTaskRub: 0,
          batteryRuntimeHours: 8,
          chargeTimeMinutes: 120,
          batteryDataSource: 'modeled' as const,
          floorsCount: 1,
          verticalDelaySec: 0,
          verticalLoadFactor: 1,
          elevatorIntegrationReady: true,
          robotCountMode: 'staff' as const,
          targetStaff: 1,
          requiredThroughputPerHour: 0,
          volumeMultiplier: 1,
          unitPrice: 2500000,
          currentStaffCost: 0,
          newStaffCost: 0,
          laborEquivalent: 0,
        },
    [selectedSolution, state.objectParams, state.assumptionsOverrides, state.whatIfOverrides],
  );

  const defaultTuning = useMemo<TuningValues>(() => ({
    tasksPerHour: Number.isFinite(simulationInputs.tasksPerHour)
      ? simulationInputs.tasksPerHour
      : 0.1,
    fleetCount: Math.max(
      1,
      Math.ceil(demo ? SIMULATION_DEMO_FLEET_COUNT : simulationInputs.robotCount),
      selectedSolutions.length,
    ),
    batteryRuntimeHours: Number.isFinite(simulationInputs.batteryRuntimeHours)
      ? simulationInputs.batteryRuntimeHours
      : 8,
    chargeTimeMinutes: Number.isFinite(simulationInputs.chargeTimeMinutes)
      ? simulationInputs.chargeTimeMinutes
      : 120,
  }), [demo, selectedSolutions.length, simulationInputs]);
  const defaultTuningKey = [
    demo,
    state.objectType,
    selectedSolutions.map(solution => solution.id).join(','),
    defaultTuning.tasksPerHour,
    defaultTuning.fleetCount,
    defaultTuning.batteryRuntimeHours,
    defaultTuning.chargeTimeMinutes,
  ].join('|');
  const [tuning, setTuning] = useState<TuningValues>(defaultTuning);
  const [appliedTuning, setAppliedTuning] = useState<TuningValues>(defaultTuning);
  const [tuningText, setTuningText] = useState(() => tuningToText(defaultTuning));
  const [seed, setSeed] = useState<number>(42);
  const [isSizing, setIsSizing] = useState(false);
  const [sizingProgress, setSizingProgress] = useState<SizingProgress | null>(null);
  const [sizingResult, setSizingResult] = useState<SizingResult | null>(null);
  const [sizingError, setSizingError] = useState<string | null>(null);
  const sizingCacheRef = useRef(new Map<string, SizingResult>());
  const sizingRequestRef = useRef(0);
  const flowMin = Math.min(10, defaultTuning.tasksPerHour);
  const flowMax = Math.max(300, defaultTuning.tasksPerHour);
  const fleetMax = Math.max(
    60,
    defaultTuning.fleetCount,
    sizingResult?.passed ? sizingResult.robotCount : 0,
  );
  const chargeMin = Math.min(20, defaultTuning.chargeTimeMinutes);
  const chargeMax = Math.max(180, defaultTuning.chargeTimeMinutes);
  const tuningRanges: Record<TuningField, { min: number; max: number; step: number }> = {
    tasksPerHour: { min: flowMin, max: flowMax, step: 5 },
    fleetCount: { min: 1, max: fleetMax, step: 1 },
    batteryRuntimeHours: { min: 2, max: 12, step: 0.5 },
    chargeTimeMinutes: { min: chargeMin, max: chargeMax, step: 10 },
  };

  const { fleet, stationary } = useMemo(
    () => buildFleet(selectedSolutions, appliedTuning.fleetCount),
    [selectedSolutions, appliedTuning.fleetCount],
  );

  const scene = useMemo(() => {
    const areaM2 = sceneKey === 'airport'
      ? Number(state.objectParams.terminal_area_m2)
      : Number(state.objectParams.total_area_m2);
    const defaultFloors = 2;
    const elevatorIntegrationReady = sceneKey === 'hospital'
      ? /да/i.test(String(state.objectParams.has_elevator_api ?? ''))
      : sceneKey === 'airport'
        ? state.objectParams.has_bms !== false
        : true;
    return buildScene({
      kind: sceneKey,
      areaM2,
      floors: Number(state.objectParams.floors_count) || defaultFloors,
      rackRows: Number(state.objectParams.rack_rows),
      docks: Number(state.objectParams.docks_count),
      chargeStations: Number(state.objectParams.charge_stations),
      elevatorIntegrationReady,
      stationarySolutions: stationary,
    }, 42);
  }, [sceneKey, state.objectParams, stationary]);

  const fleetSizingKey = useMemo(
    () => makeFleetSizingKey(scene, selectedSolutions, tuning),
    [
    scene,
    selectedSolutions,
    tuning.tasksPerHour,
    tuning.batteryRuntimeHours,
    tuning.chargeTimeMinutes,
    ],
  );

  useEffect(() => {
    setTuning(defaultTuning);
    setAppliedTuning(defaultTuning);
    setTuningText(tuningToText(defaultTuning));
    setSeed(42);
    setLiveKpis(null);
    latestKpisRef.current = null;
    diagnosticSamplesRef.current = [];
    formulaSamplesRef.current = [];
    formulaWarmupCompleteAtRef.current = null;
    formulaSampleSignatureRef.current = '';
    lastFormulaSampleSecondRef.current = -1;
    setFormulaRunState(null);
    sizingRequestRef.current += 1;
    setIsSizing(false);
    setSizingProgress(null);
    setSizingResult(null);
    setSizingError(null);
  }, [defaultTuningKey, defaultTuning]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const ranges = tuningRanges;
      const liveValuesAreValid = (
        tuning.tasksPerHour >= ranges.tasksPerHour.min
        && tuning.tasksPerHour <= ranges.tasksPerHour.max
        && tuning.batteryRuntimeHours >= ranges.batteryRuntimeHours.min
        && tuning.batteryRuntimeHours <= ranges.batteryRuntimeHours.max
        && tuning.chargeTimeMinutes >= ranges.chargeTimeMinutes.min
        && tuning.chargeTimeMinutes <= ranges.chargeTimeMinutes.max
      );
      if (!liveValuesAreValid) return;
      setAppliedTuning(current => ({
        ...current,
        tasksPerHour: tuning.tasksPerHour,
        batteryRuntimeHours: tuning.batteryRuntimeHours,
        chargeTimeMinutes: tuning.chargeTimeMinutes,
      }));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [
    tuning.tasksPerHour,
    tuning.batteryRuntimeHours,
    tuning.chargeTimeMinutes,
    tuningRanges.tasksPerHour.min,
    tuningRanges.tasksPerHour.max,
    tuningRanges.chargeTimeMinutes.min,
    tuningRanges.chargeTimeMinutes.max,
  ]);

  useEffect(() => {
    sizingRequestRef.current += 1;
    setIsSizing(false);
    setSizingProgress(null);
    setSizingError(null);
    setSizingResult(sizingCacheRef.current.get(fleetSizingKey) ?? null);
    return () => {
      sizingRequestRef.current += 1;
    };
  }, [fleetSizingKey]);

  const persistSimulationKpis = useCallback(() => {
    const tuningMatchesDefaults = (Object.keys(defaultTuning) as TuningField[])
      .every(field => tuning[field] === defaultTuning[field]
        && appliedTuning[field] === defaultTuning[field]);
    // Interactive what-if settings are intentionally transient: the report
    // schema stores the project baseline, not these unsaved test parameters.
    if (demo || seed !== 42 || !tuningMatchesDefaults) return;
    const kpis = latestKpisRef.current;
    if (!kpis) return;
    const geometry = getSceneGeometrySummary(scene, sceneKey);
    const rawAreaM2 = sceneKey === 'airport'
      ? Number(state.objectParams.terminal_area_m2)
      : Number(state.objectParams.total_area_m2);
    setSimulationKpis({
      seed,
      initialTasks: kpis.initialTasks ?? 0,
      signature: simulationSignature,
      verticalTrips: kpis.verticalTrips,
      geometry,
      generatedAt: new Date().toISOString(),
      sceneInputs: {
        sceneKind: sceneKey,
        areaM2: Number.isFinite(rawAreaM2) && rawAreaM2 > 0 ? rawAreaM2 : null,
        floors: geometry.floors,
        rackRows: geometry.rows.perFloor,
        docks: geometry.posts.total,
        chargeStations: geometry.charges.perFloor,
        elevatorIntegrationReady: scene.verticalLinks?.every(link => link.enabled) ?? true,
      },
      floorStats: kpis.floorStats.map(({ id, label, tasks, completed }) => ({
        id,
        label,
        tasks,
        completed,
      })),
    });
  }, [
    scene,
    sceneKey,
    setSimulationKpis,
    simulationSignature,
    state.objectParams,
    demo,
    seed,
    tuning,
    appliedTuning,
    defaultTuning,
  ]);
  const persistSimulationKpisRef = useRef(persistSimulationKpis);
  persistSimulationKpisRef.current = persistSimulationKpis;

  const fallbackSpriteSolutions = useMemo(
    () => selectedSolutions.filter(isFallbackSprite).map(solution => solution.name),
    [selectedSolutions],
  );
  const activeFleetCount = useMemo(
    () => fleet.reduce((total, entry) => total + entry.count, 0),
    [fleet],
  );
  const runUnitPriceRub = useMemo(() => {
    const priceMultiplier = state.whatIfOverrides.priceMultiplier ?? 1;
    const equipmentPrice = fleet.reduce((sum, entry) => {
      const solution = selectedSolutions.find(item => item.name === entry.title);
      const price = solution
        ? (Number(solution.price_rub) || 2_500_000) * priceMultiplier
        : simulationInputs.unitPrice;
      return sum + entry.count * price;
    }, 0);
    return activeFleetCount > 0 ? equipmentPrice / activeFleetCount : simulationInputs.unitPrice;
  }, [fleet, selectedSolutions, state.whatIfOverrides.priceMultiplier, simulationInputs.unitPrice, activeFleetCount]);
  const measurementWindowSeconds = measurementSecondsForFlow(appliedTuning.tasksPerHour);
  const formulaSamplingSignature = JSON.stringify([
    simulationSignature,
    seed,
    activeFleetCount,
    appliedTuning.tasksPerHour,
    appliedTuning.batteryRuntimeHours,
    appliedTuning.chargeTimeMinutes,
  ]);
  const handleKpisChange = useCallback((kpis: SimKpis) => {
    latestKpisRef.current = kpis;
    const elapsed = kpis.elapsedSec ?? 0;
    const previous = diagnosticSamplesRef.current;
    const last = previous[previous.length - 1];
    if (last && elapsed < (last.elapsedSec ?? 0)) previous.length = 0;
    previous.push(kpis);
    diagnosticSamplesRef.current = previous.filter(
      sample => (sample.elapsedSec ?? 0) >= elapsed - 65,
    );

    const formulaSamples = formulaSamplesRef.current;
    const lastFormulaSample = formulaSamples[formulaSamples.length - 1];
    if (
      formulaSampleSignatureRef.current !== formulaSamplingSignature
      || (lastFormulaSample && elapsed < lastFormulaSample.elapsedSec)
    ) {
      formulaSamples.length = 0;
      formulaWarmupCompleteAtRef.current = null;
      lastFormulaSampleSecondRef.current = -1;
      formulaSampleSignatureRef.current = formulaSamplingSignature;
    }

    const sampleSecond = Math.floor(Math.max(0, elapsed));
    if (sampleSecond !== lastFormulaSampleSecondRef.current) {
      lastFormulaSampleSecondRef.current = sampleSecond;
      const sample: ThroughputSample = {
        elapsedSec: elapsed,
        tasksDone: Math.max(0, kpis.tasksDone - Math.max(0, kpis.initialTasks ?? 0)),
        queueLen: kpis.queueLen,
        utilizationPct: kpis.utilizationPct,
      };
      formulaSamples.push(sample);
      if (
        formulaWarmupCompleteAtRef.current === null
        && elapsed >= FLOW_WARMUP_SECONDS
        && kpis.tasksDone >= Math.max(0, kpis.initialTasks ?? 0)
      ) {
        formulaWarmupCompleteAtRef.current = elapsed;
      }
      if (formulaSamples.length > measurementWindowSeconds + 10) {
        formulaSamples.splice(0, formulaSamples.length - measurementWindowSeconds - 10);
      }
      setFormulaRunState({
        signature: formulaSamplingSignature,
        latest: kpis,
        measurement: measureSteadyThroughput(
          formulaSamples,
          formulaWarmupCompleteAtRef.current,
          measurementWindowSeconds,
        ),
      });
    }
    setLiveKpis(kpis);
  }, [formulaSamplingSignature, measurementWindowSeconds]);
  const currentFormulaRun = formulaRunState?.signature === formulaSamplingSignature
    ? formulaRunState
    : null;
  const minimumFleetCount = Math.max(
    1,
    selectedSolutions.some(solution => spriteForSolution(solution) !== null)
      ? selectedSolutions.length
      : 1,
  );

  const updateTuningField = (field: TuningField, value: number) => {
    setTuning(current => ({ ...current, [field]: value }));
    setTuningText(current => ({ ...current, [field]: formatTuningValue(value) }));
  };

  const updateTuningValues = (values: TuningValues) => {
    setTuning(values);
    setTuningText(tuningToText(values));
  };

  const commitFleetCount = (value: number) => {
    const range = tuningRanges.fleetCount;
    const normalized = normalizeTuningValue(value, range);
    updateTuningField('fleetCount', normalized);
    setAppliedTuning(current => ({ ...current, fleetCount: normalized }));
  };

  const handleNumberChange = (field: TuningField, rawValue: string) => {
    setTuningText(current => ({ ...current, [field]: rawValue }));
    if (!rawValue.trim() || /[.,]$/.test(rawValue.trim())) return;
    const parsed = Number(rawValue.replace(',', '.'));
    if (!Number.isFinite(parsed)) return;
    const { min, max } = tuningRanges[field];
    if (parsed < min || parsed > max) return;
    setTuning(current => ({ ...current, [field]: parsed }));
  };

  const handleNumberBlur = (field: TuningField) => {
    const text = tuningText[field].trim();
    const parsed = text ? Number(text.replace(',', '.')) : tuning[field];
    const normalized = normalizeTuningValue(
      Number.isFinite(parsed) ? parsed : tuning[field],
      tuningRanges[field],
    );
    updateTuningField(field, normalized);
    if (field === 'fleetCount') {
      setAppliedTuning(current => ({ ...current, fleetCount: normalized }));
    }
  };

  const runFleetSizing = async () => {
    const normalizedTuning = (Object.keys(tuning) as TuningField[])
      .reduce((next, field) => ({
        ...next,
        [field]: normalizeTuningValue(tuning[field], tuningRanges[field]),
      }), {} as TuningValues);
    updateTuningValues(normalizedTuning);
    setAppliedTuning(normalizedTuning);

    const key = makeFleetSizingKey(scene, selectedSolutions, normalizedTuning);
    const cached = sizingCacheRef.current.get(key);
    if (cached) {
      setSizingResult({ ...cached, currentCount: normalizedTuning.fleetCount });
      setSizingError(null);
      return;
    }

    const requestId = ++sizingRequestRef.current;
    setIsSizing(true);
    setSizingProgress(null);
    setSizingResult(null);
    setSizingError(null);
    try {
      const result = await sizeFleet({
        scene,
        fleetFor: count => buildFleet(selectedSolutions, count).fleet,
        tasksPerHour: normalizedTuning.tasksPerHour,
        laborCostPerTaskRub: simulationInputs.laborCostPerTaskRub,
        batteryRuntimeHours: normalizedTuning.batteryRuntimeHours,
        chargeTimeMinutes: normalizedTuning.chargeTimeMinutes,
        currentCount: normalizedTuning.fleetCount,
        minimumRobots: minimumFleetCount,
        maxRobots: 80,
        onProgress: progress => {
          if (sizingRequestRef.current === requestId) setSizingProgress(progress);
        },
        shouldCancel: () => sizingRequestRef.current !== requestId,
      });
      if (sizingRequestRef.current !== requestId || !result) return;
      sizingCacheRef.current.set(key, result);
      setSizingResult({ ...result, currentCount: normalizedTuning.fleetCount });
    } catch (error) {
      if (sizingRequestRef.current === requestId) {
        setSizingError(error instanceof Error ? error.message : 'Не удалось выполнить прогоны автоподбора.');
      }
    } finally {
      if (sizingRequestRef.current === requestId) {
        setIsSizing(false);
        setSizingProgress(null);
      }
    }
  };

  const applyPreset = (patch: Partial<TuningValues>) => {
    const next = { ...tuning, ...patch };
    updateTuningValues(next);
    if ('fleetCount' in patch) {
      setAppliedTuning(current => ({ ...current, fleetCount: next.fleetCount }));
    }
  };

  const resetTuning = () => {
    updateTuningValues(defaultTuning);
    setAppliedTuning(defaultTuning);
    setSeed(42);
    sizingRequestRef.current += 1;
    setIsSizing(false);
    setSizingProgress(null);
    setSizingResult(null);
    setSizingError(null);
  };

  const selectNextDay = () => {
    const currentIndex = DAY_SEEDS.indexOf(seed as (typeof DAY_SEEDS)[number]);
    setSeed(DAY_SEEDS[(currentIndex + 1 + DAY_SEEDS.length) % DAY_SEEDS.length]);
  };

  useEffect(() => {
    // Persist only on unmount. Callback identity/scene updates are not a
    // navigation event: saving in their cleanup feeds context back into this
    // effect and used to create an infinite render/save loop.
    return () => {
      persistSimulationKpisRef.current();
    };
  }, []);

  useEffect(() => {
    if (!state.objectType && selectedSolutions.length > 0) {
      setLocation(withCalculationIntent('/calc', selectedSolution?.id));
    }
  }, [state.objectType, selectedSolutions.length, selectedSolution?.id, setLocation]);

  if (!selectedSolution) return (
    <div className="container mx-auto max-w-3xl px-4 py-12" data-testid="simulation-empty-fleet">
      <Badge variant="outline">Интерактивная демонстрация</Badge>
      <h1 className="mt-4 text-3xl font-bold">Симуляция на демо-складе</h1>
      <p className="mt-4 text-muted-foreground">Показываем на типовом складе 5 200 м². Выберите решения в каталоге — построим схему вашего объекта</p>
      <Card className="mt-6 border-primary/30">
        <CardContent className="p-6">
          <p className="font-semibold">3 × Ronavi H1500 · грузоподъёмность до 1 500 кг</p>
          <p className="mt-2 text-sm text-muted-foreground">1 этаж · 140 паллет/смену · 2 смены по 8 часов. Для старта уже ожидают 3 задания. Демо не изменит ваш сохранённый объект.</p>
          <Button className="mt-5" onClick={() => setDemo(true)} data-testid="button-simulation-demo">Показать на демо-складе</Button>
        </CardContent>
      </Card>
      <Button variant="link" className="mt-4" onClick={() => setLocation('/solutions')} data-testid="button-simulation-choose-fleet">Перейти в каталог</Button>
    </div>
  );
  if (!state.objectType) return null;
  const simulationLimit = (operationFor(state.sectorId, selectedSolution?.id)
    ? 'Для этой операции нет маршрутной симуляции: сцена склада, аэропорта или больницы не описывает реальную работу.'
    : null) ?? evaluationLimit(
    state.sectorId, state.objectType, state.objectParams, selectedSolution.id,
  ) ?? (state.sectorId === 'sector-medicine'
    ? 'Для уборки медучреждения ещё нет проверенной модели маршрутов и физики уборки. Визуализация логистических рейсов не подтверждает этот сценарий.'
    : null);
  if (simulationLimit) return (
    <div className="container mx-auto max-w-3xl px-4 py-12" data-testid="alert-simulation-unavailable">
      <h1 className="text-2xl font-bold">Для этой задачи нет проверенной симуляции</h1>
      <p className="mt-4 text-muted-foreground">{simulationLimit}</p>
      <Button className="mt-6 mr-3" onClick={() => setLocation(withCalculationIntent('/calc', selectedSolution.id))} data-testid="button-simulation-setup">К параметрам и экономике этой модели</Button>
      <Button className="mt-6" onClick={() => setLocation('/solutions')} data-testid="button-simulation-back-evidence">Вернуться к решениям</Button>
    </div>
  );

  const sceneNames: Record<SupportedSceneId, string> = {
    warehouse: 'склад',
    airport: 'аэропорт',
    hospital: 'медицинское учреждение',
  };
  const objectName = sceneNames[sceneKey];
  const coverage = liveKpis && liveKpis.elapsedSec && liveKpis.elapsedSec >= 60
    ? simulationFlowCoverage(liveKpis.observedTasksPerHour ?? 0, simulationInputs.requiredThroughputPerHour)
    : null;
  const diagnosis = getSimulationDiagnosis(
    diagnosticSamplesRef.current,
    liveKpis,
    appliedTuning.tasksPerHour,
    activeFleetCount,
  );
  const visibleSizingResult = sizingResult
    ? { ...sizingResult, currentCount: tuning.fleetCount }
    : null;

  return (
    <div className="container mx-auto w-full max-w-none py-8 px-4 flex flex-col h-full gap-6" data-testid="page-simulation">
      <StepNav step="05" label="Симуляция" backTo="/calc" backLabel="К экономике" testId="button-back-simulation" />
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">Имитационная модель</h1>
          {demo && <Badge className="mt-2" data-testid="badge-simulation-demo">Демо-данные</Badge>}
          <p className="text-muted-foreground mt-1 text-sm">
            Визуализация расчетной потребности для объекта «{objectName}»
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {demo && <Button variant="outline" onClick={() => { setDemo(false); setLiveKpis(null); setLocation('/object'); }} data-testid="button-simulation-own-object">Настроить свой объект</Button>}
          {!demo && <Button
            onClick={() => {
              persistSimulationKpis();
              setLocation('/report');
            }}
            data-testid="button-go-report"
            size="lg"
            className="shrink-0"
          >
            Сформировать отчёт
          </Button>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 flex flex-col gap-6">
          {state.objectType === "warehouse" && (
            !("pickers_count" in state.objectParams)
            || !(Number(state.objectParams.inbound_pallets_per_day) > 0 || Number(state.objectParams.outbound_pallets_per_day) > 0)
            || !(Number(state.objectParams.shifts_per_day) > 0)
            || !(Number(state.objectParams.shift_duration_h) > 0)
          ) && (
            <div role="status" data-testid="simulation-incomplete-demand" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
              Параметры потока склада заполнены не полностью. Укажите число комплектовщиков, паллеты в сутки,
              число смен и длительность смены на шаге «Объект». Расчёт использует резервные значения —
              это может давать редкие задания и длительное ожидание, а не блокировку машин.
            </div>
          )}
           <Card className="border-primary/20 shadow-sm overflow-hidden">
            <div className="bg-primary/5 px-4 py-3 flex items-start sm:items-center gap-3 border-b border-primary/10">
               <IconVisualization size={20} className="text-primary shrink-0 mt-0.5 sm:mt-0" />
              <div>
                 <h3 className="font-semibold text-sm text-foreground">
                   Схема объекта: {objectName}
                 </h3>
                 <p className="text-xs text-muted-foreground mt-0.5" data-testid="text-profile-reason">
                   Сцена построена из параметров объекта: площадь, этажность, проезды и зоны пользователя.
                 </p>
              </div>
            </div>
            <CardContent className="p-0">
              <div className="relative h-[min(70vh,720px)] min-h-[520px] max-h-[720px] w-full overflow-hidden border-b border-border bg-muted/30">
                <SimCanvas
                  scene={scene}
                   options={{
                     initialTasks: demo ? SIMULATION_DEMO_INITIAL_TASKS : appliedTuning.tasksPerHour > 0 ? activeFleetCount : 0,
                     tasksPerHour: appliedTuning.tasksPerHour,
                     laborCostPerTaskRub: simulationInputs.laborCostPerTaskRub,
                     batteryRuntimeHours: appliedTuning.batteryRuntimeHours,
                     chargeTimeMinutes: appliedTuning.chargeTimeMinutes,
                   }}
                   fleet={fleet}
                   seed={seed}
                   sceneKind={sceneKey}
                   mobileSceneFirst
                   liveTuning
                   onKpisChange={handleKpisChange}
                  title={scene.title}
                  className="w-full h-full"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 border-b border-border bg-[#0B1220] px-4 py-3 text-xs text-slate-400 sm:grid-cols-4">
                <div>
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Среда</span>
                  <span className="text-slate-200">{objectName}</span>
                </div>
                <div>
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">По формуле (потребность)</span>
                  <span className="font-mono tabular-nums text-slate-200">{activeFleetCount} ед.</span>
                </div>
                <div>
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Этажность</span>
                  <span className="font-mono tabular-nums text-slate-200">{scene.floors?.length ?? 1} ур.</span>
                </div>
                <div>
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Как читать схему</span>
                  <span>Цвет и номер — отдельный процесс; <span className="text-cyan-300">сплошная линия</span> — текущий рейс.</span>
                </div>
              </div>
              <p
                className="border-b border-border bg-[#0B1220] px-4 pb-3 text-xs leading-relaxed text-[#8FA3BB]"
                data-testid="simulation-demand-bridge"
              >
                {activeFleetCount} ед. — расчёт потребности по формуле. Прогон выше показывает, как этот флот закрывает поток в живую: очереди, зарядку, лифты.
              </p>
              {(scene.floors?.length ?? 1) > 1 && (
                <div className={
                  "border-b px-4 py-3 text-xs leading-relaxed " +
                  (simulationInputs.elevatorIntegrationReady
                    ? "border-sky-500/30 bg-sky-500/10 text-sky-100"
                    : "border-red-500/30 bg-red-500/10 text-red-100")
                }>
                  <span className="font-semibold">Вертикальная логистика.</span>{' '}
                  В модели {scene.floors?.length} уровней; средняя добавка к циклу из-за ожидания и движения лифта —
                  {' '}<span className="font-mono">{simulationInputs.verticalDelaySec.toFixed(0)} сек.</span>,
                  расчётная нагрузка на парк —{' '}
                  <span className="font-mono">+{((simulationInputs.verticalLoadFactor - 1) * 100).toFixed(0)}%</span>.
                  {' '}{simulationInputs.elevatorIntegrationReady
                    ? 'Параметры лифта являются редактируемым модельным допущением, а не подтверждёнными ТТХ объекта.'
                    : 'API/BMS управления лифтом не подтверждён: межэтажные потоки заблокированы и не считаются выполнимыми.'}
                </div>
              )}
              <div className="flex items-start gap-3 bg-card p-4 text-sm">
                 <IconInfoAssumption size={16} className="text-primary shrink-0 mt-0.5" />
                <p className="text-muted-foreground leading-relaxed">
                   {demo ? 'Демонстрационный парк — 3 AMR; это заданный пресет, а не рекомендация к покупке. ' : 'Флот собран из всех выбранных решений. '}
                   Расчётная потребность экономики — <span className="font-mono tabular-nums font-medium text-foreground">{simulationInputs.robotCount}</span> ед., в сцене — <span className="font-mono tabular-nums font-medium text-foreground">{activeFleetCount}</span> ед.; тип и скорость каждой мобильной единицы взяты из выбранной карточки и её ТТХ.
                </p>
              </div>
               {(stationary.length > 0 || fallbackSpriteSolutions.length > 0) && (
                 <div className="border-t border-border p-4 space-y-2 text-xs">
                   {stationary.length > 0 && (
                     <p className="text-muted-foreground">
                       <span className="font-semibold text-foreground">Стационарные системы:</span>{' '}
                       {stationary.join(', ')}
                     </p>
                   )}
                   {fallbackSpriteSolutions.length > 0 && (
                     <p className="text-amber-200">
                       Тип техники определён предположительно: {fallbackSpriteSolutions.join(', ')}
                     </p>
                   )}
                 </div>
               )}
            </CardContent>
          </Card>
           <Card className="border-primary/20" aria-label="Живая диагностика симуляции">
             <CardContent className="space-y-3 p-4">
               <div
                 data-testid="sim-tuner-verdict"
                 aria-live="polite"
                 className={`rounded-lg border px-4 py-3 ${diagnosis.verdictTone}`}
               >
                 <div className="font-semibold">{diagnosis.verdict}</div>
                 <p className="mt-1 text-xs leading-relaxed">{diagnosis.verdictDetail}</p>
               </div>
               <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                 <DiagnosticChip
                   testId="sim-kpi-chip-flow"
                   label="Поток"
                   value={`${formatDiagnosticNumber(diagnosis.flowPerHour, 1)} / ${formatDiagnosticNumber(appliedTuning.tasksPerHour, 1)} оп/ч`}
                   tone={diagnosis.ready ? diagnosis.flowTone : 'neutral'}
                 />
                 <DiagnosticChip
                   testId="sim-kpi-chip-queue"
                   label="Очередь"
                   value={`${liveKpis?.queueLen ?? 0} заданий`}
                   tone={diagnosis.ready ? diagnosis.queueTone : 'neutral'}
                 />
                 <DiagnosticChip
                   testId="sim-kpi-chip-waiting"
                   label="Ждут"
                   value={`${liveKpis?.waitingRobots ?? 0} машин`}
                   tone={diagnosis.ready ? diagnosis.waitingTone : 'neutral'}
                 />
                 <DiagnosticChip
                   testId="sim-kpi-chip-util"
                   label="Загрузка"
                   value={`${formatDiagnosticNumber(diagnosis.utilizationPct, 0)}%`}
                   tone={diagnosis.ready ? diagnosis.utilizationTone : 'neutral'}
                 />
                 <DiagnosticChip
                   testId="sim-kpi-chip-battery"
                   label="Батарея"
                   value={`${formatDiagnosticNumber(diagnosis.batteryAvg, 0)}%`}
                   tone={diagnosis.ready ? diagnosis.batteryTone : 'neutral'}
                 />
               </div>
               {diagnosis.bottleneck && (
                 <p className="text-xs text-amber-200">
                   Узкое место: {diagnosis.bottleneck.label} — выполнено {diagnosis.bottleneck.completed} из {diagnosis.bottleneck.total}.
                 </p>
               )}
               <p className="text-[11px] leading-relaxed text-muted-foreground">
                 Диагностика сглажена по последним 60 модельным секундам. До накопления окна показываются фактические KPI движка без вердикта.
               </p>
             </CardContent>
           </Card>
            <FormulaVsSim
              formulaRobots={simulationInputs.robotCount}
              runRobots={activeFleetCount}
              formulaUnitPriceRub={simulationInputs.unitPrice}
              runUnitPriceRub={runUnitPriceRub}
              targetPerHour={appliedTuning.tasksPerHour}
              observedPerHour={currentFormulaRun?.measurement.ready
                && appliedTuning.tasksPerHour * measurementWindowSeconds / 3600 >= 3
                ? currentFormulaRun.measurement.observedPerHour
                : null}
              utilizationPct={currentFormulaRun?.measurement.utilizationPct ?? 0}
              queueLen={currentFormulaRun?.measurement.queueLen ?? liveKpis?.queueLen ?? 0}
            />
        </div>

        <div className="flex flex-col gap-6">
           <Card className="border-primary/30" data-testid="sim-tuner">
             <CardHeader className="pb-3">
               <CardTitle className="text-base">Пульт смены</CardTitle>
               <CardDescription>
                 Меняйте условия сценария; поток и батарея применяются на ходу, парк — после отпускания.
               </CardDescription>
             </CardHeader>
             <CardContent className="space-y-4">
               <TuningControl
                 label="Поток, паллет/ч"
                 testId="sim-tune-flow"
                 valueTestId="sim-tune-flow-value"
                 value={clampValue(tuning.tasksPerHour, tuningRanges.tasksPerHour)}
                 textValue={tuningText.tasksPerHour}
                 min={tuningRanges.tasksPerHour.min}
                 max={tuningRanges.tasksPerHour.max}
                 step={tuningRanges.tasksPerHour.step}
                 effect={`Заданий в час: ${formatDiagnosticNumber(tuning.tasksPerHour, 1)} · факт: ${formatDiagnosticNumber(liveKpis?.observedTasksPerHour ?? 0, 1)} оп/ч`}
                 onRangeChange={value => updateTuningField('tasksPerHour', value)}
                 onNumberChange={value => handleNumberChange('tasksPerHour', value)}
                 onNumberBlur={() => handleNumberBlur('tasksPerHour')}
               />
               <TuningControl
                 label="Парк, машин"
                 testId="sim-tune-fleet"
                 valueTestId="sim-tune-fleet-value"
                 value={clampValue(tuning.fleetCount, tuningRanges.fleetCount)}
                 textValue={tuningText.fleetCount}
                 min={tuningRanges.fleetCount.min}
                 max={tuningRanges.fleetCount.max}
                 step={tuningRanges.fleetCount.step}
                 effect={`Парк: ${tuning.fleetCount} × ${formatDiagnosticNumber(simulationInputs.unitPrice, 0)} ₽ = ${formatDiagnosticNumber(tuning.fleetCount * simulationInputs.unitPrice / 1_000_000, 1)} млн ₽`}
                 note={tuning.fleetCount !== activeFleetCount
                   ? `В симуляции сейчас ${activeFleetCount}; новый парк вступит в силу после отпускания.`
                   : undefined}
                 onRangeChange={value => updateTuningField('fleetCount', value)}
                 onRangeCommit={commitFleetCount}
                 onNumberChange={value => handleNumberChange('fleetCount', value)}
                 onNumberBlur={() => handleNumberBlur('fleetCount')}
               />
               <TuningControl
                 label="Ресурс батареи, ч"
                 testId="sim-tune-battery-hours"
                 value={clampValue(tuning.batteryRuntimeHours, tuningRanges.batteryRuntimeHours)}
                 textValue={tuningText.batteryRuntimeHours}
                 min={tuningRanges.batteryRuntimeHours.min}
                 max={tuningRanges.batteryRuntimeHours.max}
                 step={tuningRanges.batteryRuntimeHours.step}
                 effect={`До зарядки: около ${formatDiagnosticNumber(tuning.batteryRuntimeHours, 1)} ч`}
                 onRangeChange={value => updateTuningField('batteryRuntimeHours', value)}
                 onNumberChange={value => handleNumberChange('batteryRuntimeHours', value)}
                 onNumberBlur={() => handleNumberBlur('batteryRuntimeHours')}
               />
               <TuningControl
                 label="Зарядка, мин"
                 testId="sim-tune-charge-min"
                 value={clampValue(tuning.chargeTimeMinutes, tuningRanges.chargeTimeMinutes)}
                 textValue={tuningText.chargeTimeMinutes}
                 min={tuningRanges.chargeTimeMinutes.min}
                 max={tuningRanges.chargeTimeMinutes.max}
                 step={tuningRanges.chargeTimeMinutes.step}
                 effect={`Время на зарядке в цикле: ~${formatDiagnosticNumber(
                   tuning.chargeTimeMinutes / (tuning.batteryRuntimeHours * 60 + tuning.chargeTimeMinutes) * 100,
                   0,
                 )}%`}
                 onRangeChange={value => updateTuningField('chargeTimeMinutes', value)}
                 onNumberChange={value => handleNumberChange('chargeTimeMinutes', value)}
                 onNumberBlur={() => handleNumberBlur('chargeTimeMinutes')}
               />

               <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
                 <Button variant="outline" size="sm" onClick={selectNextDay} data-testid="sim-seed-next">
                   Другой день · seed {seed}
                 </Button>
                 <Button variant="outline" size="sm" onClick={resetTuning} data-testid="sim-reset">
                   Сброс
                 </Button>
               </div>
               <div className="flex flex-wrap gap-2">
                 <Button
                   variant="secondary"
                   size="sm"
                   onClick={() => applyPreset({
                     tasksPerHour: Math.min(300, Math.max(flowMin, tuning.tasksPerHour * 2.5)),
                   })}
                   data-testid="sim-preset-blackfriday"
                 >
                   Чёрная пятница
                 </Button>
                 <Button
                   variant="secondary"
                   size="sm"
                   onClick={() => applyPreset({ fleetCount: Math.max(minimumFleetCount, tuning.fleetCount - 1) })}
                   data-testid="sim-preset-breakdown"
                 >
                   Поломка робота
                 </Button>
                 <Button
                   variant="secondary"
                   size="sm"
                   onClick={() => applyPreset({ chargeTimeMinutes: Math.min(180, tuning.chargeTimeMinutes * 2) })}
                   data-testid="sim-preset-peak-charge"
                 >
                   Зарядка в пик
                 </Button>
                 <Button
                   variant="secondary"
                   size="sm"
                   onClick={() => applyPreset({
                     tasksPerHour: defaultTuning.tasksPerHour,
                     fleetCount: defaultTuning.fleetCount,
                   })}
                 >
                   Ночь без людей
                 </Button>
               </div>

               <div className="space-y-2 border-t border-border pt-3">
                 <Button
                   className="w-full"
                   onClick={() => void runFleetSizing()}
                   disabled={isSizing || !(tuning.tasksPerHour > 0)}
                   data-testid="sim-size-fleet"
                 >
                   {isSizing ? 'Подбираем парк…' : 'Подобрать парк под SLA'}
                 </Button>
                 <p className="text-[11px] leading-relaxed text-muted-foreground">
                   Критерий модели: не менее 95% заданного потока и очередь без устойчивого роста; контрольные seed 42, 7 и 2026. Это сценарная проверка, не гарантия SLA объекта.
                 </p>
                 {isSizing && (
                   <div role="status" aria-live="polite" className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs" data-testid="sim-size-progress">
                     {sizingProgress
                       ? `Прогонов завершено: ${sizingProgress.completedRuns}. Сейчас проверяем ${sizingProgress.candidateCount} машин · seed ${sizingProgress.seed}.`
                       : 'Подготавливаем первый прогон…'}
                   </div>
                 )}
                 {sizingError && <p role="alert" className="text-xs text-destructive">{sizingError}</p>}
                 {visibleSizingResult && (
                   <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3 text-xs" data-testid="sim-size-result">
                     {visibleSizingResult.passed
                       ? visibleSizingResult.robotCount === visibleSizingResult.currentCount
                         ? <p className="font-semibold text-emerald-300">Текущего парка достаточно: {visibleSizingResult.runs.filter(run => run.passed).length} из {visibleSizingResult.runs.length} прогонов в срок.</p>
                         : <p className="font-semibold text-emerald-300">
                             Нужно {visibleSizingResult.robotCount} роботов: {visibleSizingResult.runs.filter(run => run.passed).length} из {visibleSizingResult.runs.length} прогонов в срок.
                             {' '}Сейчас {visibleSizingResult.currentCount} — {
                               visibleSizingResult.currentCount < visibleSizingResult.robotCount
                                 ? `не хватает ${visibleSizingResult.robotCount - visibleSizingResult.currentCount}`
                                 : `запас ${visibleSizingResult.currentCount - visibleSizingResult.robotCount}`
                             }.
                           </p>
                       : <p className="font-semibold text-amber-200">
                           {visibleSizingResult.limitReached
                             ? `При ${visibleSizingResult.robotCount} роботах расчётный поток не закрывается — проверьте сценарий.`
                             : `Парк ${visibleSizingResult.robotCount} не прошёл все контрольные прогоны; модель не подтверждает SLA.`}
                         </p>}
                     {visibleSizingResult.runs.length > 0 && (
                       <p className="text-muted-foreground">
                         Факт/план: {visibleSizingResult.runs.map(run => `${Math.round(run.throughputRatio * 100)}% · seed ${run.seed}`).join('; ')}.
                       </p>
                     )}
                     {visibleSizingResult.passed && visibleSizingResult.robotCount !== visibleSizingResult.currentCount && (
                       <Button
                         variant="outline"
                         size="sm"
                         className="w-full"
                         onClick={() => commitFleetCount(visibleSizingResult.robotCount)}
                         data-testid="sim-size-apply"
                       >
                         Применить {visibleSizingResult.robotCount}
                       </Button>
                     )}
                   </div>
                 )}
               </div>
               <p className="text-[10px] leading-relaxed text-muted-foreground">
                 Ручки меняют только временный сценарий симуляции. Они не перезаписывают параметры объекта и не попадают в отчёт.
               </p>
             </CardContent>
           </Card>

          <Card className="border-primary/30" data-testid="simulation-economics-bridge">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Связь с экономикой</CardTitle>
              <CardDescription>Симуляция показывает работу техники на схеме, не окупаемость.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>Эквивалент труда: <strong data-testid="sim-labor-equivalent">{simulationInputs.laborEquivalent.toLocaleString('ru-RU')} ставок</strong></p>
              <p className="text-xs text-muted-foreground">Допущение об изменении штата из той же модели экономики, не измеренная экономия симуляции.</p>
              <p data-testid="sim-flow-coverage">{coverage === null ? 'Поток закрывается на —: первые 60 модельных секунд — сбор данных' : `Поток закрывается на ${coverage.toFixed(0)}%`}</p>
              <p className="text-xs text-muted-foreground">{(liveKpis?.observedTasksPerHour ?? 0).toFixed(1)} выполненных оп/ч / {simulationInputs.requiredThroughputPerHour.toFixed(1)} требуемых оп/ч. Среднее с начала прогона; не оценка предельной мощности. Стартовая очередь из {demo ? SIMULATION_DEMO_INITIAL_TASKS : simulationInputs.tasksPerHour > 0 ? activeFleetCount : 0} заданий — условие просмотра; она может временно дать более 100%.</p>
              <p className="text-xs text-muted-foreground">Параллельные рейсы согласованы по времени прохождения проездов и лифта. Выполнение засчитывается только после доставки и разгрузки.</p>
              {!demo && <Button variant="outline" onClick={() => { persistSimulationKpis(); setLocation('/calc'); }} data-testid="button-simulation-economics">Вернуться к экономике</Button>}
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-4 border-b border-border bg-muted/10">
              <CardTitle className="text-base flex items-center gap-2">
                 <IconCompare size={16} className="text-primary" /> Выбранные решения
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex flex-col divide-y divide-border">
                {selectedSolutions.map((solution, idx) => (
                   <div key={`${solution.id}-${solution.name}`} className={`p-4 ${solution.id === selectedSolution.id ? 'bg-primary/5' : 'bg-card'}`} data-testid={`sim-solution-${solution.id}`}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-semibold text-sm">{solution.name}</p>
                        {solution.id === selectedSolution.id && <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">В расчёте</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mb-2 truncate" title={solution.vendor}>{solution.vendor}</p>
                    <p className="text-xs text-foreground/80 line-clamp-2 leading-relaxed">{getSolutionTypeLabel(solution)}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm bg-card">
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-base">Что рассчитывается</CardTitle>
              <CardDescription>Парк и нагрузка по главному выбранному решению</CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4 text-sm">
              <div>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Потребность парка</span>
                   <span className="font-mono tabular-nums font-bold text-base text-foreground" data-testid="sim-stat-count">{simulationInputs.robotCount} шт</span>
                </div>
                <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
                  <div className="bg-primary h-full rounded-full" style={{ width: `${Math.min(100, simulationInputs.robotCount * 5)}%` }} />
                </div>
              </div>
              
              <div className="pt-2 border-t border-border">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Входящий поток заданий</span>
                   <span className="font-mono tabular-nums font-bold text-foreground" data-testid="sim-stat-flow">{simulationInputs.tasksPerHour.toFixed(1)} оп/ч</span>
                </div>
              </div>

              <div className="pt-2 border-t border-border space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Автономная работа</span>
                   <span className="font-mono tabular-nums font-bold text-foreground" data-testid="sim-stat-runtime">
                    {simulationInputs.batteryRuntimeHours.toLocaleString('ru-RU')} ч
                  </span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Полная зарядка</span>
                   <span className="font-mono tabular-nums font-bold text-foreground" data-testid="sim-stat-charge">
                    {simulationInputs.chargeTimeMinutes.toLocaleString('ru-RU')} мин
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {simulationInputs.batteryDataSource === 'confirmed'
                    ? 'Подтверждённые ТТХ выбранной модели'
                    : 'Модельное допущение: подтверждённые ТТХ отсутствуют'}
                </p>
              </div>
              
              <div className="pt-2 border-t border-border">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Себестоимость операции</span>
                   <span className="font-mono tabular-nums font-bold text-foreground" data-testid="sim-stat-cost">
                    {Math.round(simulationInputs.laborCostPerTaskRub).toLocaleString('ru-RU')} ₽
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Оценка текущих расходов при ручном выполнении</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

type DiagnosticTone = 'good' | 'warn' | 'bad' | 'neutral';

interface SimulationDiagnosis {
  ready: boolean;
  verdict: string;
  verdictDetail: string;
  verdictTone: string;
  flowPerHour: number;
  utilizationPct: number;
  batteryAvg: number;
  flowTone: DiagnosticTone;
  queueTone: DiagnosticTone;
  waitingTone: DiagnosticTone;
  utilizationTone: DiagnosticTone;
  batteryTone: DiagnosticTone;
  bottleneck: { label: string; completed: number; total: number } | null;
}

function makeFleetSizingKey(
  scene: SimScene,
  selectedSolutions: Parameters<typeof buildFleet>[0],
  tuning: Pick<TuningValues, 'tasksPerHour' | 'batteryRuntimeHours' | 'chargeTimeMinutes'>,
) {
  const baseFleet = buildFleet(selectedSolutions, Math.max(1, selectedSolutions.length)).fleet;
  return JSON.stringify({
    scene,
    baseFleet,
    tasksPerHour: tuning.tasksPerHour,
    batteryRuntimeHours: tuning.batteryRuntimeHours,
    chargeTimeMinutes: tuning.chargeTimeMinutes,
    seeds: FLEET_SIZING_SEEDS,
  });
}

function getSimulationDiagnosis(
  samples: SimKpis[],
  latest: SimKpis | null,
  targetFlow: number,
  fleetCount: number,
): SimulationDiagnosis {
  const elapsed = latest?.elapsedSec ?? 0;
  const window = samples.filter(sample => (sample.elapsedSec ?? 0) >= elapsed - 60);
  const first = window[0];
  const last = window[window.length - 1];
  const windowSpan = (last?.elapsedSec ?? 0) - (first?.elapsedSec ?? 0);
  const ready = elapsed >= 60 && window.length >= 2 && windowSpan >= 45;
  const mean = (values: number[]) => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
  const finiteValues = (values: Array<number | undefined>) =>
    values.filter((value): value is number => Number.isFinite(value));
  const flowPerHour = ready
    ? mean(finiteValues(window.map(sample => sample.observedTasksPerHour)))
    : latest?.observedTasksPerHour ?? 0;
  const utilizationPct = ready
    ? mean(window.map(sample => sample.utilizationPct))
    : latest?.utilizationPct ?? 0;
  const batteryAvg = ready
    ? mean(window.map(sample => sample.batteryAvg))
    : latest?.batteryAvg ?? 0;
  const queueLen = latest?.queueLen ?? 0;
  const waitingRobots = latest?.waitingRobots ?? 0;
  const flowRatio = targetFlow > 0 ? flowPerHour / targetFlow : 0;
  const queueGrowing = ready && (last?.queueLen ?? 0) - (first?.queueLen ?? 0) >= 2;

  let verdict = 'Собираем данные';
  let verdictDetail = `Нужно 60 модельных секунд; прошло ${Math.floor(elapsed)} с.`;
  let verdictTone = 'border-slate-700 bg-slate-800/60 text-slate-200';
  if (ready) {
    if (flowRatio < 0.85 || queueLen > fleetCount * 0.5) {
      verdict = 'Не справляется';
      verdictDetail = `За окно выполнено ${Math.round(flowRatio * 100)}% заданного потока; очередь ${queueLen}.`;
      verdictTone = 'border-red-500/40 bg-red-500/10 text-red-200';
    } else if (flowRatio >= 0.95 && queueLen <= 2) {
      verdict = 'Парк справляется';
      verdictDetail = `Фактический поток достиг ${Math.round(flowRatio * 100)}% задания; очередь ${queueLen}.`;
      verdictTone = 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
    } else {
      verdict = 'На грани';
      verdictDetail = queueGrowing
        ? `Очередь выросла за последнее минутное окно: ${first?.queueLen ?? 0} → ${last?.queueLen ?? 0}.`
        : `Поток закрыт на ${Math.round(flowRatio * 100)}%; требуется наблюдение.`;
      verdictTone = 'border-amber-500/40 bg-amber-500/10 text-amber-100';
    }
  }

  const availableFlows = (latest?.flowStats ?? []).filter(flow => flow.available);
  const flowTotals = availableFlows.map(flow => ({
    ...flow,
    total: Math.max(1, flow.active + flow.completed),
  }));
  const bottleneckCandidate = flowTotals.length >= 2 && flowTotals.some(flow => flow.active + flow.completed > 0)
    ? flowTotals.reduce((worst, flow) => (
      flow.completed / flow.total < worst.completed / worst.total ? flow : worst
    ))
    : null;
  const toneFlow: DiagnosticTone = !ready
    ? 'neutral'
    : flowRatio >= 0.95 ? 'good' : flowRatio >= 0.85 ? 'warn' : 'bad';
  const toneQueue: DiagnosticTone = !ready
    ? 'neutral'
    : queueLen <= 2 ? 'good' : queueLen <= fleetCount * 0.5 ? 'warn' : 'bad';
  const toneWaiting: DiagnosticTone = !ready
    ? 'neutral'
    : waitingRobots === 0 ? 'good' : waitingRobots === 1 ? 'warn' : 'bad';
  const toneUtilization: DiagnosticTone = !ready
    ? 'neutral'
    : utilizationPct >= 40 && utilizationPct <= 85
      ? 'good'
      : (utilizationPct >= 25 && utilizationPct < 40)
        || (utilizationPct > 85 && utilizationPct <= 95)
        ? 'warn'
        : 'bad';
  const toneBattery: DiagnosticTone = !ready
    ? 'neutral'
    : batteryAvg >= 40 ? 'good' : batteryAvg >= 25 ? 'warn' : 'bad';

  return {
    ready,
    verdict,
    verdictDetail,
    verdictTone,
    flowPerHour,
    utilizationPct,
    batteryAvg,
    flowTone: toneFlow,
    queueTone: toneQueue,
    waitingTone: toneWaiting,
    utilizationTone: toneUtilization,
    batteryTone: toneBattery,
    bottleneck: bottleneckCandidate
      ? {
          label: bottleneckCandidate.label,
          completed: bottleneckCandidate.completed,
          total: bottleneckCandidate.total,
        }
      : null,
  };
}

function formatDiagnosticNumber(value: number, maximumFractionDigits: number) {
  return Number.isFinite(value)
    ? value.toLocaleString('ru-RU', { maximumFractionDigits })
    : '—';
}

function formatTuningValue(value: number) {
  return Number.isFinite(value) ? String(Number(value.toFixed(2))) : '';
}

function tuningToText(values: TuningValues): Record<TuningField, string> {
  return {
    tasksPerHour: formatTuningValue(values.tasksPerHour),
    fleetCount: formatTuningValue(values.fleetCount),
    batteryRuntimeHours: formatTuningValue(values.batteryRuntimeHours),
    chargeTimeMinutes: formatTuningValue(values.chargeTimeMinutes),
  };
}

function clampValue(value: number, range: { min: number; max: number }) {
  return Math.max(range.min, Math.min(range.max, value));
}

function normalizeTuningValue(value: number, range: { min: number; max: number; step: number }) {
  const clamped = clampValue(value, range);
  const snapped = range.min + Math.round((clamped - range.min) / range.step) * range.step;
  return Number(clampValue(snapped, range).toFixed(2));
}

interface TuningControlProps {
  label: string;
  testId: string;
  valueTestId?: string;
  value: number;
  textValue: string;
  min: number;
  max: number;
  step: number;
  effect: string;
  note?: string;
  onRangeChange: (value: number) => void;
  onRangeCommit?: (value: number) => void;
  onNumberChange: (value: string) => void;
  onNumberBlur: () => void;
}

function TuningControl({
  label,
  testId,
  valueTestId,
  value,
  textValue,
  min,
  max,
  step,
  effect,
  note,
  onRangeChange,
  onRangeCommit,
  onNumberChange,
  onNumberBlur,
}: TuningControlProps) {
  const numberId = valueTestId ?? `${testId}-number`;
  const commitFromRange = (event: React.PointerEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>) => {
    if (onRangeCommit) onRangeCommit(Number(event.currentTarget.value));
  };
  return (
    <div className="space-y-1.5">
      <label htmlFor={testId} className="block text-xs font-semibold text-foreground">{label}</label>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-2">
        <input
          id={testId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={event => onRangeChange(Number(event.currentTarget.value))}
          onPointerUp={commitFromRange}
          onKeyUp={commitFromRange}
          aria-label={label}
          data-testid={testId}
          className="h-11 min-w-0 cursor-pointer accent-cyan-400"
        />
        <input
          id={numberId}
          type="number"
          min={min}
          max={max}
          step={step}
          value={textValue}
          onChange={event => onNumberChange(event.currentTarget.value)}
          onBlur={onNumberBlur}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          aria-label={`${label}: числовое значение`}
          data-testid={valueTestId}
          className="h-11 w-full rounded-md border border-input bg-background px-2 font-mono text-sm tabular-nums"
        />
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{effect}</p>
      {note && <p className="text-[10px] leading-relaxed text-amber-200">{note}</p>}
    </div>
  );
}

interface DiagnosticChipProps {
  testId: string;
  label: string;
  value: string;
  tone: DiagnosticTone;
}

function DiagnosticChip({ testId, label, value, tone }: DiagnosticChipProps) {
  const classByTone: Record<DiagnosticTone, string> = {
    good: 'border-emerald-500/30 bg-emerald-500/5',
    warn: 'border-amber-500/30 bg-amber-500/5',
    bad: 'border-red-500/30 bg-red-500/5',
    neutral: 'border-slate-700 bg-slate-900/40',
  };
  return (
    <div className={`min-w-0 rounded-md border p-3 ${classByTone[tone]}`} data-testid={testId}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-sm font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}
