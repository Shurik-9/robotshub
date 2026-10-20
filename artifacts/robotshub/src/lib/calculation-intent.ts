import solutionsData from '@/data/solutions.json';

export function requestedCalculationSolution(search: string) {
  const id = new URLSearchParams(search).get('solution');
  return id ? solutionsData.items.find(item => item.id === id) ?? null : null;
}

export function withCalculationIntent(path: string, solutionId?: string | null) {
  if (!solutionId) return path;
  const [pathname, query = ''] = path.split('?', 2);
  const params = new URLSearchParams(query);
  params.set('solution', solutionId);
  return `${pathname}?${params.toString()}`;
}

export function findCaseCatalogSolution(name: string) {
  const normalize = (value: string) => value.toLowerCase().replaceAll('ё', 'е').replace(/[^a-zа-я0-9]/g, '');
  const matches = new Map(
    solutionsData.items.filter(item => normalize(item.name) === normalize(name)).map(item => [item.id, item]),
  );
  // An ambiguous name must not silently select another model.
  return matches.size === 1 ? [...matches.values()][0] : null;
}
