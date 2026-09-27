import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'wouter';
import { getSimulationSignature, useProject } from '@/store/project';
import { evaluationLimit } from '@/lib/evaluationScope';
import { operationFor } from '@/lib/operationEconomics';
import solutionsData from '@/data/solutions.json';
import { SimCanvas } from '@/sim/SimCanvas';
import { buildFleet, spriteForSolution } from '@/sim/fleet';
import { buildScene, getSceneGeometrySummary } from '@/sim/scene-builder';
import type { SimKpis } from '@/sim/sim-engine';
import { calculateSimulationInputs } from '@/lib/calc';
import { getSolutionTypeLabel } from '@/lib/solutionPresentation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  IconCompare,
  IconInfoAssumption,
  IconVisualization,
} from '@/components/brand-icons';

type SupportedSceneId = 'warehouse' | 'airport' | 'hospital';

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
  const { state, setSimulationKpis } = useProject();
  const latestKpisRef = useRef<SimKpis | null>(null);

  const selectedSolutions = useMemo(
    () => state.selectedSolutions
      .map(id => solutionsData.items.find(solution => solution.id === id))
      .filter((solution): solution is (typeof solutionsData.items)[number] => Boolean(solution)),
    [state.selectedSolutions],
  );
  
  const selectedSolution = selectedSolutions[0];
  const simulationSignature = useMemo(
    () => getSimulationSignature(state),
    [state.objectType, state.objectParams, state.selectedSolutions, state.assumptionsOverrides],
  );
  const simulationSignatureRef = useRef(simulationSignature);
  if (simulationSignatureRef.current !== simulationSignature) {
    simulationSignatureRef.current = simulationSignature;
    latestKpisRef.current = null;
  }
  const handleKpisChange = useCallback((kpis: SimKpis) => {
    latestKpisRef.current = kpis;
  }, []);

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
          whatIf: { salaryMultiplier: 1, priceMultiplier: 1, volumeMultiplier: 1 },
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
        },
    [selectedSolution, state.objectParams, state.assumptionsOverrides],
  );

  const { fleet, stationary } = useMemo(
    () => buildFleet(selectedSolutions, simulationInputs.robotCount),
    [selectedSolutions, simulationInputs.robotCount],
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

  const persistSimulationKpis = useCallback(() => {
    const kpis = latestKpisRef.current;
    if (!kpis) return;
    const geometry = getSceneGeometrySummary(scene, sceneKey);
    const rawAreaM2 = sceneKey === 'airport'
      ? Number(state.objectParams.terminal_area_m2)
      : Number(state.objectParams.total_area_m2);
    setSimulationKpis({
      seed: 42,
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
  }, [scene, sceneKey, setSimulationKpis, simulationSignature, state.objectParams]);
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

  useEffect(() => {
    // Persist only on unmount. Callback identity/scene updates are not a
    // navigation event: saving in their cleanup feeds context back into this
    // effect and used to create an infinite render/save loop.
    return () => {
      persistSimulationKpisRef.current();
    };
  }, []);

  useEffect(() => {
    if (!state.objectType || selectedSolutions.length === 0) {
      setLocation('/solutions');
    }
  }, [state.objectType, selectedSolutions.length, setLocation]);

  if (!state.objectType || selectedSolutions.length === 0 || !selectedSolution) return null;
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
      <Button className="mt-6" onClick={() => setLocation('/solutions')} data-testid="button-simulation-back-evidence">Вернуться к решениям</Button>
    </div>
  );

  const sceneNames: Record<SupportedSceneId, string> = {
    warehouse: 'склад',
    airport: 'аэропорт',
    hospital: 'медицинское учреждение',
  };
  const objectName = sceneNames[sceneKey];

  return (
    <div className="container mx-auto w-full max-w-none py-8 px-4 flex flex-col h-full gap-6" data-testid="page-simulation">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">Имитационная модель</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Визуализация расчетной потребности для объекта «{objectName}»
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setLocation('/simulation/sandbox')}
            data-testid="button-open-simulation-sandbox"
            size="lg"
          >
            Витринные сцены
          </Button>
          <Button
            onClick={() => {
              persistSimulationKpis();
              setLocation('/report');
            }}
            data-testid="button-go-report"
            size="lg"
            className="shrink-0"
          >
            Сформировать отчёт
          </Button>
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
                     tasksPerHour: simulationInputs.tasksPerHour,
                     laborCostPerTaskRub: simulationInputs.laborCostPerTaskRub,
                     batteryRuntimeHours: simulationInputs.batteryRuntimeHours,
                     chargeTimeMinutes: simulationInputs.chargeTimeMinutes,
                   }}
                   fleet={fleet}
                   seed={42}
                   sceneKind={sceneKey}
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
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Всего в модели</span>
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
                   Флот собран из всех выбранных решений. Расчётная потребность — <span className="font-mono tabular-nums font-medium text-foreground">{simulationInputs.robotCount}</span> ед., в сцене — <span className="font-mono tabular-nums font-medium text-foreground">{activeFleetCount}</span> ед.; тип и скорость каждой мобильной единицы взяты из выбранной карточки и её ТТХ.
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
        </div>

        <div className="flex flex-col gap-6">
          <Card className="shadow-sm">
            <CardHeader className="pb-4 border-b border-border bg-muted/10">
              <CardTitle className="text-base flex items-center gap-2">
                 <IconCompare size={16} className="text-primary" /> Выбранные решения
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex flex-col divide-y divide-border">
                {selectedSolutions.map((solution, idx) => (
                  <div key={`${solution.id}-${solution.name}`} className={`p-4 ${idx === 0 ? 'bg-primary/5' : 'bg-card'}`} data-testid={`sim-solution-${solution.id}`}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-semibold text-sm">{solution.name}</p>
                       {idx === 0 && <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">В расчёте</Badge>}
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
