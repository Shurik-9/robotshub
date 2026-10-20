import type { ProjectState } from '@/store/project';

export const DEMO_SOLUTION_ID = '5760e938-9a43-45a7-b8e8-f4f2e6383930';
export const DEMO_AREA_M2 = 5200;

export const DEMO_BANNER_TEXT =
  'Демонстрационный пример: склад 5 200 м², решение — Ronavi H1500. Это не данные вашего объекта.';

export function isEmptyProject(state: ProjectState): boolean {
  return !state.objectType
    && !state.sectorId
    && !state.activeSolutionId
    && !state.demoProject
    && !state.simulationKpis
    && state.selectedSolutions.length === 0
    && Object.keys(state.objectParams).length === 0
    && Object.keys(state.whatIfOverrides).length === 0
    && Object.keys(state.assumptionsOverrides).length === 0
    && Object.keys(state.questionnaireEvidence ?? {}).length === 0
    && state.financingScenario === 'purchase';
}
