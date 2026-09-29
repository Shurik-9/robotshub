import type { ProjectState } from '../store/project';
import { validateAnswers } from './questionnaire-schema.ts';
import type { QuestionnaireImport } from './questionnaire-xlsx.ts';

export const projectFingerprint = (state: ProjectState) => JSON.stringify(state);

/** Pure, atomic replacement. Parsing/preview/cancel never calls this transition. */
export function applyQuestionnaireToProject(state: ProjectState, staged: QuestionnaireImport, expected: string): ProjectState {
  if (projectFingerprint(state) !== expected) throw new Error('Проект изменился после загрузки. Загрузите анкету повторно.');
  if (staged.sectorId !== state.sectorId) throw new Error('Направление анкеты не совпадает с текущим. Скачайте анкету для выбранного направления.');
  const checked = validateAnswers(staged.type, staged.values);
  if (staged.errors.length || staged.missing.length || checked.errors.length || checked.missing.length) throw new Error('Исправьте ошибки и заполните обязательные поля.');
  return {
    ...state,
    objectType: staged.type,
    objectParams: { ...checked.values },
    questionnaireEvidence: structuredClone(staged.evidence),
    selectedSolutions: [],
    activeSolutionId: null,
    whatIfOverrides: {},
    assumptionsOverrides: {},
    simulationKpis: null,
  };
}