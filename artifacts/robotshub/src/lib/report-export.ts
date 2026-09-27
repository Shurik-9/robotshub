import type { SimulationKpiSnapshot } from '@/store/project';

function csvText(value: string): string {
  // Quoting keeps commas, quotes, and embedded line breaks inside one CSV cell.
  return `"${value.replaceAll('"', '""')}"`;
}

function formatFloorCount(count: number): string {
  const remainder = count % 100;
  const lastDigit = count % 10;
  const word = remainder >= 11 && remainder <= 14
    ? 'этажей'
    : lastDigit === 1
      ? 'этаж'
      : lastDigit >= 2 && lastDigit <= 4
        ? 'этажа'
        : 'этажей';
  return `${count.toLocaleString('ru-RU')} ${word}`;
}

function formatSnapshotDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

const sceneKindLabels: Record<string, string> = {
  warehouse: 'склад',
  airport: 'аэропорт',
  hospital: 'медучреждение',
};

export interface SimulationSnapshotDisplay {
  floorCount: string;
  generatedAt: string;
  sceneInputs: string;
}

export function getSimulationSnapshotDisplay(
  simulationKpis: SimulationKpiSnapshot | null,
): SimulationSnapshotDisplay | null {
  if (!simulationKpis?.generatedAt || !simulationKpis.sceneInputs) return null;

  const inputs = simulationKpis.sceneInputs;
  const area = inputs.areaM2 === null
    ? 'площадь не указана'
    : `площадь ${inputs.areaM2.toLocaleString('ru-RU')} м²`;
  const sceneKind = sceneKindLabels[inputs.sceneKind] ?? inputs.sceneKind;

  return {
    floorCount: formatFloorCount(inputs.floors),
    generatedAt: formatSnapshotDate(simulationKpis.generatedAt),
    sceneInputs: [
      sceneKind,
      area,
      `рядов ${inputs.rackRows.toLocaleString('ru-RU')}`,
      `постов ${inputs.docks.toLocaleString('ru-RU')}`,
      `зарядок ${inputs.chargeStations.toLocaleString('ru-RU')} на этаж`,
      `лифт: ${inputs.elevatorIntegrationReady ? 'подключён' : 'не подключён'}`,
    ].join(' · '),
  };
}

/**
 * Keeps the report card and CSV export on the same snapshot contract.
 * Every floor row carries the snapshot-level values so rows remain
 * self-contained when sorted or copied out of the CSV.
 */
export function buildSimulationKpiCsvSection(
  simulationKpis: SimulationKpiSnapshot | null,
): string {
  let csv = '\nМежэтажная логистика\n';
  csv += 'Seed,Поездки через вертикальный переход,Этаж,Задачи назначено,Задачи выполнено,Этажность снимка,Момент формирования,Состав входных параметров\n';

  if (!simulationKpis) {
    return `${csv}-,-,-,-,-,-,-,-\n`;
  }

  const display = getSimulationSnapshotDisplay(simulationKpis);
  const snapshotColumns = display
    ? `${csvText(display.floorCount)},${csvText(display.generatedAt)},${csvText(display.sceneInputs)}`
    : '-,-,-';

  simulationKpis.floorStats.forEach((floor) => {
    csv += `${simulationKpis.seed},${simulationKpis.verticalTrips},${csvText(floor.label)},${floor.tasks},${floor.completed},${snapshotColumns}\n`;
  });

  return csv;
}