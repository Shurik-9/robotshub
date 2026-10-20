import solutions from '@/data/solutions.json';
import { matchesWarehouseCatalog } from '@/lib/catalogObjectScope';
import { getSolutionTaxonomy } from '@/lib/solutionTaxonomy';
import { CLINIC_CLEANER_ID } from '@/lib/evaluationScope';

export const CALCULATION_OBJECTS = [
  { type: 'warehouse', title: 'Склад', description: 'Грузы, рейсы, расстояния и смены.' },
  { type: 'airport', title: 'Аэропорт', description: 'Наземные операции и режим работы.' },
  { type: 'medical', title: 'Медучреждение', description: 'Оценка уборки; маршрутная симуляция для неё пока недоступна.' },
] as const;

export function calculationObjectsFor(solutionId: string) {
  const variants = solutions.items.filter(item => item.id === solutionId);
  return CALCULATION_OBJECTS.filter(option => variants.some(item => {
    const tax = getSolutionTaxonomy(item);
    if (item.kind === 'bas' || item.kind === 'software'
      || tax.areaIds.includes('air') || tax.areaIds.includes('water')) return false;
    if (option.type === 'warehouse') return matchesWarehouseCatalog([item]);
    if (option.type === 'airport') return (
      /аэропорт|аэродром|багаж/.test(`${item.name} ${item.scenario} ${item.description}`.toLowerCase())
      && ['transport', 'handling'].includes(tax.operationId)
    );
    return item.id === CLINIC_CLEANER_ID;
  }));
}
