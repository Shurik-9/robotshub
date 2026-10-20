import { buildScene, type GeneratedScene } from '../sim/scene-builder.ts';
import type { FleetEntry, SimOptions } from '../sim/sim-engine.ts';
import type { SiteProcess } from './start-processes.ts';
import { calculateWorkbench, parseWorkbenchInputs, type WorkbenchInputs } from './start-workbench.ts';

/** A route sketch for the selected transport operation, not a surveyed site plan. */
export const START_SIMULATION_SEED = 42;
export const START_SIMULATION_AREA_M2 = 5200;
export const START_SIMULATION_MAX_ROBOTS = 30;
const FLOW_BY_PROCESS: Record<string, string> = {
  receiving: 'inbound', putaway: 'inbound', 'storage-access': 'inbound',
  replenishment: 'replenishment', picking: 'outbound', shipping: 'outbound',
};

export type StartWorkbenchSimulation =
  | { supported: false; reason: string }
  | {
    supported: true; scene: GeneratedScene; fleet: FleetEntry[];
    options: Omit<SimOptions, 'fleet'>; seed: number; assumptions: string[];
  };

export function startSimulationConditions(objectId: string | null, process: SiteProcess, raw: WorkbenchInputs) {
  const inputs = parseWorkbenchInputs(raw);
  if (!inputs) return { supported: false as const, reason: 'Исправьте параметры сценария. Сцена с прежними значениями не используется.' };
  if (objectId !== 'warehouse' || !FLOW_BY_PROCESS[process.id]
    || !['flow', 'storage', 'replenishment', 'picking', 'shipping'].includes(process.kind)) {
    return { supported: false as const, reason: 'Для этого участка пока нет подходящей маршрутной сцены. Расчёт вариантов и DOCX доступны; чужой склад вместо вашей операции не показываем.' };
  }
  const robotCount = calculateWorkbench(inputs).robotCount;
  if (robotCount > START_SIMULATION_MAX_ROBOTS || inputs.loadPerHour > 10000) {
    return { supported: false as const, reason: 'Быстрый просмотр рассчитан на парк до 30 машин и поток до 10 000 перемещений/ч. Ваши значения сохранены в расчёте и DOCX, но сцена не запускается с уменьшенными вводными.' };
  }
  const initialTasks = robotCount === 0 ? 0 : Math.min(robotCount, 6);
  return {
    supported: true as const, robotCount, initialTasks, flowId: FLOW_BY_PROCESS[process.id],
    assumptions: [
      `Планировка условная: ${START_SIMULATION_AREA_M2.toLocaleString('ru-RU')} м², 1 этаж, 6 рядов и 3 зарядных места; не измеренная схема вашего объекта.`,
      'Показан транспортный участок: погрузка, захват товара, проверка и работа людей не автоматизируются этой сценой.',
      'Скорость условной техники — 1,5 м/с. Поле «Темп одного робота» относится к формуле экономики и не ускоряет движение в сцене.',
      `Начальная очередь — ${initialTasks} заданий для быстрого старта; дальше поступления идут с заданным потоком. Очередь не добавляется к сменному объёму в экономике.`,
      'Короткое наблюдение не доказывает производительность за смену или окупаемость. Прогон сбрасывается при смене потока, парка или батареи.',
      'Сценарии участка не суммируются в общий парк объекта: один робот может участвовать в нескольких участках.',
    ],
  };
}

export function buildStartWorkbenchSimulation(objectId: string | null, process: SiteProcess, inputs: WorkbenchInputs): StartWorkbenchSimulation {
  const conditions = startSimulationConditions(objectId, process, inputs);
  if (!conditions.supported) return conditions;
  const scene = buildScene({
    kind: 'warehouse', areaM2: START_SIMULATION_AREA_M2, floors: 1,
    rackRows: 6, docks: 2, chargeStations: 3,
  }, START_SIMULATION_SEED);
  // Restrict both routing and workload to this one process, not the whole warehouse.
  scene.flows = scene.flows.filter(flow => flow.id === conditions.flowId)
    .map(flow => ({ ...flow, share: 1, core: true }));
  scene.title = `Транспортный участок · ${process.name}`;
  const sprite = scene.flows[0]?.sprite;
  if (!sprite) return { supported: false, reason: 'Для выбранного участка отсутствует маршрут. Сцена не заменена другим процессом.' };
  const fleet: FleetEntry[] = conditions.robotCount === 0 ? [] : [{
    sprite, count: conditions.robotCount, speedMps: 1.5, title: 'Условная техника · сценарий участка',
  }];
  return {
    supported: true, scene, fleet, seed: START_SIMULATION_SEED,
    options: {
      tasksPerHour: inputs.loadPerHour, laborCostPerTaskRub: 0,
      batteryRuntimeHours: inputs.batteryHours, chargeTimeMinutes: inputs.chargeHours * 60,
      initialTasks: conditions.initialTasks,
    },
    assumptions: conditions.assumptions,
  };
}
