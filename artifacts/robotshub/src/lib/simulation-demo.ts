import warehouse from '../data/object-templates/warehouse.json' with { type: 'json' };
import solutions from '../data/solutions.json' with { type: 'json' };
import type { ProjectState } from '../store/project.tsx';

const solution = solutions.items.find(item => /Ronavi H1500/i.test(item.name));
if (!solution) throw new Error('В каталоге отсутствует Ronavi H1500 для демо-склада.');

// A separate, read-only project: opening the demo must never replace a user's inputs.
export const SIMULATION_DEMO: ProjectState = {
  objectType: 'warehouse',
  sectorId: null,
  objectParams: {
    ...Object.fromEntries(warehouse.groups.flatMap(group => group.fields.map(field => [field.key, field.base]))),
    total_area_m2: 5200,
    floors_count: 1,
    inbound_pallets_per_day: 280,
    outbound_pallets_per_day: 280,
    shifts_per_day: 2,
    shift_duration_h: 8,
    pickers_count: 6,
    rack_rows: 6,
    docks_count: 2,
    charge_stations: 3,
  },
  selectedSolutions: [solution.id],
  activeSolutionId: solution.id,
  whatIfOverrides: {},
  assumptionsOverrides: {},
  financingScenario: 'purchase',
  simulationKpis: null,
};

export const SIMULATION_DEMO_FLEET_COUNT = 3;
export const SIMULATION_DEMO_INITIAL_TASKS = 3;

export function simulationFlowCoverage(observedTasksPerHour: number, requiredTasksPerHour: number) {
  if (!(requiredTasksPerHour > 0)) return null;
  return Math.max(0, observedTasksPerHour / requiredTasksPerHour * 100);
}
