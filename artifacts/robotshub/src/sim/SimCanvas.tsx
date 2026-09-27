// ============================================================
// SimCanvas — React-обёртка: canvas + панель KPI + контролы.
// Использование:
//   <SimCanvas scene={warehouseScene}
//              options={{ robotCount: calc.robotsCount,
//                         tasksPerHour: calc.throughputPerHour,
//                         laborCostPerTaskRub: calc.laborCostPerOp }}
//              title="Имитация работы: склад" />
// ============================================================

import { useEffect, useRef, useState } from "react";
import { createSim, type Sim, type SimFloor, type SimScene, type SimOptions, type SimKpis } from "./sim-engine";
import { drawFrame, preloadSprites, type SpriteBank } from "./sim-renderer";
import { getSceneGeometrySummary, type SceneBuilderKind } from "./scene-builder";

interface Props {
  scene: SimScene;
  options: Omit<SimOptions, "fleet"> & { fleet?: SimOptions["fleet"] };
  title?: string;
  className?: string;
  fleet?: SimOptions["fleet"]; // из buildFleet(selectedSolutions, robotCount)
  seed?: number;
  sceneKind?: SceneBuilderKind;
  onKpisChange?: (kpis: SimKpis) => void;
}

const fmt = new Intl.NumberFormat("ru-RU");
const FLOW_COLORS = ["#22D3EE", "#F59E0B", "#34D399", "#A78BFA", "#FB7185", "#60A5FA"];

export function SimCanvas({ scene, options, title, className, fleet, seed = 42, sceneKind, onKpisChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bankRef = useRef<SpriteBank | null>(null);
  const simRef = useRef<Sim | null>(null);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(true);
  const activeFloorRef = useRef("");
  const followFloorRef = useRef(true);
  const [speed, setSpeed] = useState(1);
  const [running, setRunning] = useState(true);
  const [floors, setFloors] = useState<SimFloor[]>([]);
  const [activeFloorId, setActiveFloorId] = useState("");
  const [followFloor, setFollowFloor] = useState(true);
  const [kpis, setKpis] = useState<SimKpis | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const onKpisChangeRef = useRef(onKpisChange);
  onKpisChangeRef.current = onKpisChange;

  const publishKpis = (nextKpis: SimKpis) => {
    setKpis(nextKpis);
    onKpisChangeRef.current?.(nextKpis);
  };
  const geometry = getSceneGeometrySummary(
    scene,
    sceneKind ?? inferSceneKind(scene.id),
  );

  // (пере)создание симуляции при смене сцены или числа роботов
  useEffect(() => {
    const resolvedFleet =
      fleet !== undefined
        ? fleet
        : options.fleet && options.fleet.length > 0
        ? options.fleet
        : [{ sprite: "amr-pallet", count: 1, speedMps: 1.5 }];
    simRef.current = createSim(scene, { ...options, fleet: resolvedFleet, speedMultiplier: speed, seed });
    publishKpis(simRef.current.getKpis());
    setFloors(simRef.current.floors);
    activeFloorRef.current = simRef.current.activeFloorId;
    setActiveFloorId(simRef.current.activeFloorId);
    setEvents([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, fleet, options.fleet, options.tasksPerHour, options.laborCostPerTaskRub, options.batteryRuntimeHours, options.chargeTimeMinutes, seed]);

  useEffect(() => {
    if (simRef.current) simRef.current.opts.speedMultiplier = speed;
  }, [speed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!bankRef.current) bankRef.current = preloadSprites();

    let last = performance.now();
    let kpiAcc = 0;

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const sim = simRef.current;
      if (sim) {
        if (runningRef.current) sim.update(dt);
        drawFrame(ctx, sim, bankRef.current!, runningRef.current ? dt : 0);
        kpiAcc += dt;
        if (kpiAcc > 0.25) {
          kpiAcc = 0;
          const nextKpis = sim.getKpis();
          publishKpis(nextKpis);
          if (followFloorRef.current && nextKpis.focusFloorId !== activeFloorRef.current) {
            sim.setActiveFloor(nextKpis.focusFloorId);
            activeFloorRef.current = nextKpis.focusFloorId;
            setActiveFloorId(nextKpis.focusFloorId);
          }
          setEvents(sim.getEvents());
        }
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  const restart = () => {
    const resolvedFleet =
      fleet !== undefined
        ? fleet
        : options.fleet && options.fleet.length > 0
        ? options.fleet
        : [{ sprite: "amr-pallet", count: 1, speedMps: 1.5 }];
    simRef.current = createSim(scene, { ...options, fleet: resolvedFleet, speedMultiplier: speed, seed });
    publishKpis(simRef.current.getKpis());
    setFloors(simRef.current.floors);
    activeFloorRef.current = simRef.current.activeFloorId;
    setActiveFloorId(simRef.current.activeFloorId);
    setTick((t) => t + 1);
    setEvents([]);
  };

  const selectFloor = (floorId: string) => {
    followFloorRef.current = false;
    setFollowFloor(false);
    activeFloorRef.current = floorId;
    setActiveFloorId(floorId);
    simRef.current?.setActiveFloor(floorId);
  };

  const toggleFollowFloor = () => {
    const next = !followFloorRef.current;
    followFloorRef.current = next;
    setFollowFloor(next);
    if (next && kpis?.focusFloorId) {
      activeFloorRef.current = kpis.focusFloorId;
      setActiveFloorId(kpis.focusFloorId);
      simRef.current?.setActiveFloor(kpis.focusFloorId);
    }
  };

  return (
    <div className={"flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#0B1220] " + (className ?? "")}>
      {/* шапка */}
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-4 border-b border-slate-800 px-4 py-3">
        <div className="min-w-0 truncate text-sm font-semibold text-slate-200">{title ?? "Имитация работы"}</div>
        <div className="shrink-0 font-mono text-sm text-cyan-300">
          <span>{kpis?.clock ?? scene.startClock}</span>
        </div>
      </div>
      <div className="shrink-0 border-b border-slate-800 bg-slate-950/70 px-4 py-2 text-xs leading-relaxed text-slate-300" data-testid="simulation-model-explanation">
        <strong className="text-cyan-200">Схема работы, не прогноз окупаемости.</strong>{" "}
        Прошло {Math.floor((kpis?.elapsedSec ?? 0) / 60)} мин {Math.floor((kpis?.elapsedSec ?? 0) % 60)} с модельного времени.
        {" "}Входящий поток: {options.tasksPerHour.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} оп/ч.
        {" "}Фактически в модели: {(kpis?.observedTasksPerHour ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} оп/ч с начала запуска.
        <span className="block text-amber-200" data-testid="simulation-next-arrival">
          {options.tasksPerHour > 0
            ? `Следующее задание через ${formatDuration(kpis?.nextTaskInSec ?? 3600 / options.tasksPerHour)} модельного времени.`
            : "Входящий поток равен нулю: новые задания не поступают."}
          {(kpis?.queueLen ?? 0) === 0 && (kpis?.activeRobots ?? 0) === 0
            ? " Парк стоит, потому что заданий пока нет, а не из-за затора."
            : ` Заданий в очереди: ${kpis?.queueLen ?? 0}.`}
          {options.tasksPerHour > 0 && options.tasksPerHour < 1
            ? " Очень редкий поток: проверьте объём операций и сменность в параметрах объекта."
            : ""}
        </span>
        {scene.id.startsWith("generated-") && <span className="block text-slate-400">
          Пересекающиеся рейсы допускаются по очереди целиком, включая возврат; независимые — параллельно.
          На местах ожидания: {kpis?.waitingRobots ?? 0}. Это консервативная схема движения, не оценка максимальной мощности парка.
          При ×1 секунда на экране равна секунде модели. Стоянки условные, этажи равной площади; погрузка и разгрузка — допущения.
        </span>}
      </div>
      {floors.length > 1 && (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-800 bg-slate-950/40 px-3 py-2">
          {floors.map((floor) => {
            const floorStat = kpis?.floorStats.find((item) => item.id === floor.id);
            return (
              <button
                key={floor.id}
                data-testid={`simulation-floor-${floor.id}`}
                aria-pressed={activeFloorId === floor.id}
                onClick={() => selectFloor(floor.id)}
                className={
                  "shrink-0 rounded-md border px-2.5 py-1.5 text-[11px] transition-colors " +
                  (activeFloorId === floor.id
                    ? "border-cyan-500 bg-cyan-500/10 text-cyan-200"
                    : "border-slate-700 text-slate-400 hover:text-slate-200")
                }
              >
                {floor.label}
                <span className="ml-1.5 font-mono text-[10px] opacity-70">
                  {floorStat?.active ?? 0}/{floorStat?.robots ?? 0}
                </span>
              </button>
            );
          })}
          <button
            onClick={toggleFollowFloor}
            className={
              "ml-auto shrink-0 rounded-md border px-2.5 py-1.5 text-[11px] " +
              (followFloor
                ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                : "border-slate-700 text-slate-500")
            }
          >
            Автоэтаж {followFloor ? "вкл." : "выкл."}
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* сцена */}
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-[#0B1220]">
          <canvas
            ref={canvasRef}
            width={scene.width}
            height={scene.height}
            data-testid="simulation-canvas"
            className="block h-full w-full object-contain"
          />
        </div>

        {/* правая панель KPI */}
        <div className="max-h-full w-full shrink-0 overflow-y-auto border-t border-slate-800 lg:w-64 lg:border-l lg:border-t-0">
           <div className="border-b border-slate-800/60 px-4 py-3" data-testid="simulation-geometry">
             <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Состав сцены</div>
             <div className="grid grid-cols-2 gap-x-3 gap-y-2">
               <GeometryMetric
                 testId="simulation-geometry-floors"
                 label="Этажи"
                 value={fmt.format(geometry.floors)}
                 detail="уровней"
               />
               <GeometryMetric
                 testId="simulation-geometry-rows"
                 label="Ряды"
                 value={geometry.rows.applicable ? fmt.format(geometry.rows.total) : "—"}
                 detail={
                   geometry.rows.applicable
                     ? `${fmt.format(geometry.rows.perFloor)} на этаж`
                     : "не применяется"
                 }
               />
               <GeometryMetric
                 testId="simulation-geometry-posts"
                 label="Посты"
                 value={geometry.posts.applicable ? fmt.format(geometry.posts.total) : "—"}
                 detail={geometry.posts.applicable ? "погрузочных" : "не применяется"}
               />
               <GeometryMetric
                 testId="simulation-geometry-charges"
                 label="Зарядки"
                 value={fmt.format(geometry.charges.total)}
                 detail={`${fmt.format(geometry.charges.perFloor)} на этаж`}
               />
             </div>
           </div>
          <Kpi testId="simulation-kpi-tasks" label="Операций выполнено" value={kpis ? fmt.format(kpis.tasksDone) : "—"} color="text-amber-300" big />
          <Kpi testId="simulation-kpi-money" label="Эквивалент труда, ₽ · не прибыль" value={kpis ? fmt.format(Math.round(kpis.moneySavedRub)) : "—"} color="text-cyan-300" big />
          <Kpi testId="simulation-kpi-distance" label="Пробег парка" value={kpis ? (kpis.distanceM / 1000).toFixed(1) + " км" : "—"} />
          <Kpi testId="simulation-kpi-utilization" label="Средняя занятость с начала" value={kpis ? kpis.utilizationPct.toFixed(0) + " %" : "—"} />
          <Kpi testId="simulation-kpi-battery" label="Средний заряд" value={kpis ? kpis.batteryAvg.toFixed(0) + " %" : "—"} />
          <Kpi
            testId="simulation-kpi-vertical-trips"
            label="Поездки через вертикальный переход"
            value={kpis ? fmt.format(kpis.verticalTrips) : "—"}
            color="text-violet-300"
          />
          <div className="border-b border-slate-800/60 px-4 py-3" data-testid="simulation-floor-kpis">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Задачи по этажам</div>
            <div className="space-y-1.5">
              {kpis?.floorStats.map((floor) => (
                <div key={floor.id} className="flex items-center gap-2" data-testid={`simulation-floor-tasks-${floor.id}`}>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">{floor.label}</span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-300">
                    {fmt.format(floor.tasks)}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-600">
                    / {fmt.format(floor.completed)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10px] leading-relaxed text-slate-600">назначено / выполнено</div>
          </div>
          <div className="border-b border-slate-800/60 px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Сейчас в работе</div>
            <div className="mt-1 truncate text-sm font-semibold text-cyan-200">{kpis?.focusRobot ?? "—"}</div>
            <div className="mt-1 text-xs leading-relaxed text-slate-400">
              {kpis ? focusStateLabel(kpis.focusState) : "Подготовка маршрута"}
              {kpis?.focusFlow ? ` · ${kpis.focusFlow}` : ""}
            </div>
            <div className="mt-1 text-[11px] text-sky-300">
              {kpis?.focusFloor ?? "—"}
              {kpis?.focusVertical ? ` · ${kpis.focusVertical}` : ""}
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Одновременно занято: <span className="font-mono text-slate-300">{kpis?.activeRobots ?? 0}</span>
            </div>
          </div>

          <div className="border-b border-slate-800/60 px-4 py-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Потоки объекта</div>
            <div className="space-y-2">
              {kpis?.flowStats.map((flow, index) => (
                <div key={flow.id} className={flow.available ? "" : "opacity-40"}>
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-[#08111F]"
                      style={{ backgroundColor: flow.available ? FLOW_COLORS[index % FLOW_COLORS.length] : "#475569" }}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">{flow.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-500">
                      {flow.available ? `${flow.active} / ${flow.completed}` : "недоступен"}
                    </span>
                  </div>
                  {!flow.available && flow.unavailableReason && (
                    <div className="ml-6 mt-0.5 text-[9px] leading-snug text-amber-300">
                      {flow.unavailableReason}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10px] leading-relaxed text-slate-600">в работе / завершено</div>
          </div>

          {/* контролы */}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 px-4 py-3">
            <button
              data-testid="sim-toggle-running"
              onClick={() => { setRunning(!running); runningRef.current = !running; }}
              className="min-w-[82px] flex-1 rounded-md border border-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:border-cyan-500 hover:text-cyan-300"
            >
              {running ? "Пауза" : "Пуск"}
            </button>
            <button
              onClick={restart}
              className="rounded-md border border-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:border-cyan-500 hover:text-cyan-300"
            >
              Сброс
            </button>
            <span className="text-[10px] text-slate-400">Скорость модели</span>
            {(scene.id.startsWith("generated-") ? [1, 10, 60] : [0.5, 1, 2]).map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                aria-label={`Скорость модели ×${s}`}
                aria-pressed={speed === s}
                className={
                  "rounded-md border px-2 py-1.5 text-xs " +
                  (speed === s
                    ? "border-cyan-500 bg-cyan-500/10 text-cyan-300"
                    : "border-slate-700 text-slate-400 hover:text-slate-200")
                }
              >
                ×{s}
              </button>
            ))}
          </div>

          {/* лента событий */}
          <div className="max-h-36 border-t border-slate-800 px-4 py-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
              Журнал операций
            </div>
            <div className="space-y-1">
              {events.map((e, i) => (
                <div key={i} className="truncate font-mono text-[11px] text-slate-400">{e}</div>
              ))}
              {events.length === 0 && (
                <div className="font-mono text-[11px] text-slate-600">ожидание событий…</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function focusStateLabel(state: SimKpis["focusState"]) {
  const labels: Record<SimKpis["focusState"], string> = {
    idle: "Ожидает задания",
    toPickup: "Едет к точке забора",
    loading: "Забирает груз",
    toDrop: "Везёт груз по маршруту",
    unloading: "Передаёт груз",
    toCharge: "Едет на зарядку",
    charging: "Заряжается",
    returning: "Возвращается на место ожидания",
  };
  return labels[state];
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  return `${hours ? `${hours} ч ` : ""}${minutes} мин ${total % 60} с`;
}

function inferSceneKind(sceneId: string): SceneBuilderKind {
  if (sceneId.includes("warehouse")) return "warehouse";
  if (sceneId.includes("airport")) return "airport";
  if (sceneId.includes("hospital")) return "hospital";
  return "medical";
}

function GeometryMetric({
  testId,
  label,
  value,
  detail,
}: {
  testId: string;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div data-testid={testId}>
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="font-mono text-sm tabular-nums text-slate-200">{value}</div>
      <div className="text-[9px] leading-tight text-slate-600">{detail}</div>
    </div>
  );
}

function Kpi({ testId, label, value, color, big }: {
  testId: string; label: string; value: string; color?: string; big?: boolean;
}) {
  return (
    <div className="border-b border-slate-800/60 px-4 py-3" data-testid={testId}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={(big ? "text-2xl " : "text-lg ") + "font-mono tabular-nums " + (color ?? "text-slate-200")}>
        {value}
      </div>
    </div>
  );
}
