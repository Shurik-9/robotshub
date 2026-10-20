import { objectProcesses, type SiteProcess } from './start-processes.ts';
import { parseStartValueInputs, type StartValueInputs } from './start-value.ts';
import { parseWorkbenchPlan, type WorkbenchPlan } from './start-workbench.ts';

export type StartObjectId = 'warehouse' | 'production' | 'airport' | 'medical' | 'public' | 'other';
export type StartScope = 'whole' | 'multiple' | 'single' | 'unsure';
export type StartProcessDetails = Record<string, {
  values: Record<string, string>;
  unknown: Record<string, boolean>;
}>;
export interface StartScopeDraft {
  version: 1;
  step: 1 | 2 | 3 | 4;
  objectId: StartObjectId | null;
  customObject: string;
  scope: StartScope | null;
  processes: SiteProcess[];
  selectedIds: string[];
  details: StartProcessDetails;
  activeProcess: string | null;
  valueScenarios?: Record<string, StartValueInputs>;
  valueFocusId?: string;
  workbenchPlans?: Record<string, WorkbenchPlan>;
}

export const START_SCOPE_STORAGE_KEY = 'robotshub_start_scope_v1';
export const START_SCOPE_LABELS: Record<StartScope, string> = {
  whole: 'Весь объект', multiple: 'Несколько участков',
  single: 'Один участок', unsure: 'Масштаб пока не определён',
};
export const START_OBJECT_LABELS: Record<StartObjectId, string> = {
  warehouse: 'Склад', production: 'Производство', airport: 'Аэропорт',
  medical: 'Медучреждение', public: 'Офис или общественное здание', other: 'Другой объект',
};
const objectIds = Object.keys(START_OBJECT_LABELS);
const scopes = Object.keys(START_SCOPE_LABELS);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, limit = 4000): value is string =>
  typeof value === 'string' && value.length <= limit;

/** Rebuild suggested processes from the current template, not arbitrary stored metadata. */
export function parseStartScopeDraft(value: unknown): StartScopeDraft | null {
  if (!record(value) || value.version !== 1
    || ![1, 2, 3, 4].includes(Number(value.step))
    || (value.objectId !== null && !objectIds.includes(String(value.objectId)))
    || !text(value.customObject, 160)
    || (value.scope !== null && !scopes.includes(String(value.scope)))
    || !Array.isArray(value.processes) || value.processes.length > 80
    || !Array.isArray(value.selectedIds) || !record(value.details)) return null;
  const objectId = value.objectId as StartObjectId | null;
  if (Number(value.step) > 1 && (!objectId || (objectId === 'other' && !value.customObject.trim()))) return null;
  if (Number(value.step) > 2 && !value.scope) return null;
  const template = objectId ? objectProcesses[objectId] : [];
  const processes: SiteProcess[] = [];
  for (const entry of value.processes) {
    if (!record(entry) || !text(entry.id, 100)) return null;
    const suggested = template.find(item => item.id === entry.id);
    if (suggested) processes.push(suggested);
    else if (/^custom-[1-9]\d{0,5}$/.test(entry.id) && text(entry.name, 160) && entry.name.trim()) {
      processes.push({
        id: entry.id, name: entry.name, kind: 'custom',
        summary: 'Пользовательская рабочая зона для уточнения на площадке',
        focus: 'Опишите содержание работы и её место в общем процессе.',
      });
    } else return null;
  }
  const ids = new Set(processes.map(item => item.id));
  if (ids.size !== processes.length
    || value.selectedIds.some(id => typeof id !== 'string' || !ids.has(id))
    || new Set(value.selectedIds).size !== value.selectedIds.length
    || (value.activeProcess !== null && !ids.has(String(value.activeProcess)))) return null;
  if (Number(value.step) > 1 && (!processes.length || template.some(item => !ids.has(item.id)))) return null;
  if (value.scope === 'single' && value.selectedIds.length > 1) return null;
  if (Number(value.step) === 4
    && ((value.scope === 'single' && value.selectedIds.length !== 1)
      || (value.scope === 'multiple' && value.selectedIds.length < 2))) return null;
  const details: StartProcessDetails = {};
  for (const [id, detail] of Object.entries(value.details)) {
    if (!ids.has(id) || !record(detail) || !record(detail.values) || !record(detail.unknown)
      || Object.keys(detail.values).length > 20 || Object.keys(detail.unknown).length > 20
      || Object.values(detail.values).some(answer => !text(answer))
      || Object.values(detail.unknown).some(answer => typeof answer !== 'boolean')) return null;
    details[id] = {
      values: { ...detail.values } as Record<string, string>,
      unknown: { ...detail.unknown } as Record<string, boolean>,
    };
  }
  const valueScenarios: Record<string, StartValueInputs> = {};
  if (value.valueScenarios !== undefined) {
    if (!record(value.valueScenarios) || Object.keys(value.valueScenarios).length > 80) return null;
    for (const [id, candidate] of Object.entries(value.valueScenarios)) {
      const parsed = parseStartValueInputs(candidate);
      if (!ids.has(id) || !parsed) return null;
      valueScenarios[id] = parsed;
    }
  }
  if (value.valueFocusId !== undefined && (typeof value.valueFocusId !== 'string' || !ids.has(value.valueFocusId))) return null;
  const workbenchPlans: Record<string, WorkbenchPlan> = {};
  if (value.workbenchPlans !== undefined) {
    if (!record(value.workbenchPlans) || Object.keys(value.workbenchPlans).length > 80) return null;
    for (const [id, candidate] of Object.entries(value.workbenchPlans)) {
      const plan = parseWorkbenchPlan(candidate);
      if (!ids.has(id) || !plan) return null;
      workbenchPlans[id] = plan;
    }
  }
  return {
    version: 1, step: Number(value.step) as StartScopeDraft['step'], objectId,
    customObject: value.customObject, scope: value.scope as StartScope | null,
    processes, selectedIds: value.scope === 'whole' ? processes.map(item => item.id) : value.selectedIds as string[],
    details, activeProcess: value.activeProcess as string | null,
    ...(value.valueScenarios !== undefined ? { valueScenarios } : {}),
    ...(value.valueFocusId !== undefined ? { valueFocusId: value.valueFocusId as string } : {}),
    ...(value.workbenchPlans !== undefined ? { workbenchPlans } : {}),
  };
}

export function readStartScopeDraft(): { draft: StartScopeDraft | null; warning: string | null } {
  try {
    const raw = window.localStorage.getItem(START_SCOPE_STORAGE_KEY);
    if (!raw) return { draft: null, warning: null };
    const draft = parseStartScopeDraft(JSON.parse(raw));
    return draft
      ? { draft, warning: null }
      : { draft: null, warning: 'Сохранённая карта повреждена. Она не загружена; существующий расчёт не изменён.' };
  } catch {
    return { draft: null, warning: 'Не удалось прочитать карту из хранилища браузера. Существующий расчёт не изменён.' };
  }
}

export function saveStartScopeDraft(draft: StartScopeDraft): boolean {
  try {
    const previous = window.localStorage.getItem(START_SCOPE_STORAGE_KEY);
    if (previous) {
      let valid = false;
      try { valid = !!parseStartScopeDraft(JSON.parse(previous)); } catch { /* preserve unreadable input below */ }
      if (!valid) window.localStorage.setItem(`${START_SCOPE_STORAGE_KEY}_recovery`, previous);
    }
    window.localStorage.setItem(START_SCOPE_STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function startScopeProcesses(draft: StartScopeDraft): SiteProcess[] {
  return draft.scope === 'whole' || (draft.scope === 'unsure' && draft.selectedIds.length === 0)
    ? draft.processes
    : draft.processes.filter(item => draft.selectedIds.includes(item.id));
}

export function startScopeObjectLabel(draft: StartScopeDraft): string {
  return draft.objectId === 'other' ? draft.customObject
    : draft.objectId ? START_OBJECT_LABELS[draft.objectId] : 'Объект пока не выбран';
}

export function startScopeSelectionPath(objectId: StartObjectId | null): string {
  const physicalType = ['warehouse', 'airport', 'medical'].includes(objectId ?? '') ? objectId : 'custom';
  return `/quick-select?from=start&objectType=${physicalType}`;
}
