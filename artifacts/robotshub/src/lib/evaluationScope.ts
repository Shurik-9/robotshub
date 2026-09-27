import type { ObjectType } from '@/store/project';
import { operationFor, operationScopeError } from './operationEconomics.ts';

// Only the clinic-cleaning record has a task compatible with the existing
// staff-based medical estimate. The other medical records concern drones
// or rehabilitation and must not inherit that estimate.
const CLINIC_CLEANER_ID = '5a5b3599-bd64-4330-9bbb-4f8ce7d780b9';

export function evaluationLimit(
  sectorId: string | null,
  objectType: ObjectType,
  objectParams: Record<string, number | string | boolean>,
  solutionId?: string | null,
): string | null {
  if (sectorId === 'sector-water' || sectorId === 'sector-mining'
    || (sectorId === 'sector-medicine' && solutionId !== CLINIC_CLEANER_ID)) {
    const scopeError = operationScopeError(sectorId, objectType, solutionId);
    if (scopeError) return scopeError;
    if (!String(objectParams.site_name ?? '').trim() || !String(objectParams.task ?? '').trim()) {
      return 'Сначала сохраните бриф с точным названием площадки и конкретной операцией. Для годовой мощности укажите период наблюдений, принятый объём по датам, отмены, повторы и простой с причинами. Паспортный максимум и разовый кейс этого не подтверждают.';
    }
    return operationFor(sectorId, solutionId) ? null : 'Для операции нет модели ТЭО.';
  }
  if (!objectType || objectType === 'custom' || Object.keys(objectParams).length === 0) {
    return 'Для расчёта сначала заполните один из трёх расчётных шаблонов объекта.';
  }
  if (sectorId === 'sector-medicine' && objectType !== 'medical') {
    return 'Текущий медицинский расчёт применим только как предварительная оценка уборки учреждения. Для доставки дронами и реабилитации нужны другие исходные данные и модель.';
  }
  return null;
}